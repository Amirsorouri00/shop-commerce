import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UpstreamError, uuidv7, type StoragePort } from '@xb/core';
import { logger } from '@xb/observability';

/**
 * MinIO adapter.
 *
 * Uses the S3 SDK rather than the MinIO client, so moving to S3, R2 or any other
 * S3-compatible provider is an endpoint change with no code change. MinIO is a deployment
 * choice here, not an architectural one.
 *
 * Every access is a presigned URL. The API never proxies file bytes: streaming a 5MB package
 * photo through a Node process burns a request slot for the duration of the transfer, and at
 * any volume that is the first thing to fall over.
 */

export interface StorageOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly buckets: { readonly packages: string; readonly documents: string };
}

export class MinioStorageAdapter implements StoragePort {
  readonly name = 'minio';
  private readonly client: S3Client;

  constructor(private readonly options: StorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
      // MinIO serves buckets as a path segment rather than a subdomain.
      forcePathStyle: true,
    });
  }

  async presignUpload(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; fields?: Record<string, string> }> {
    try {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          ContentType: input.contentType,
        }),
        { expiresIn: input.expiresInSeconds ?? 900 },
      );
      return { url };
    } catch (e) {
      throw new UpstreamError('minio', `presign upload failed: ${String(e)}`, { cause: e });
    }
  }

  async presignDownload(input: {
    bucket: string;
    key: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { expiresIn: input.expiresInSeconds ?? 900 },
      );
    } catch (e) {
      throw new UpstreamError('minio', `presign download failed: ${String(e)}`, { cause: e });
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.buckets.packages }));
      return true;
    } catch (e) {
      logger.error({ err: e }, 'storage healthcheck failed');
      return false;
    }
  }
}

/**
 * Object keys.
 *
 * Date-prefixed so a lifecycle rule can archive or expire by age with a prefix filter, and
 * so a listing is never a single directory with a million entries.
 */
export const StorageKeys = {
  packagePhoto: (orderId: string, ext = 'jpg'): string => {
    const d = new Date();
    const day = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
    return `packages/${day}/${orderId}/${uuidv7()}.${ext}`;
  },
  customsDocument: (orderId: string, kind: string, ext = 'pdf'): string =>
    `documents/${orderId}/${kind}-${uuidv7()}.${ext}`,
} as const;

/** In-memory adapter for tests and for running the API without MinIO. */
export class InMemoryStorageAdapter implements StoragePort {
  readonly name = 'memory-storage';
  readonly objects = new Map<string, { contentType: string }>();

  async presignUpload(input: { bucket: string; key: string; contentType: string }) {
    this.objects.set(`${input.bucket}/${input.key}`, { contentType: input.contentType });
    return { url: `memory://${input.bucket}/${input.key}?op=put` };
  }

  async presignDownload(input: { bucket: string; key: string }) {
    return `memory://${input.bucket}/${input.key}?op=get`;
  }

  async healthcheck(): Promise<boolean> {
    return true;
  }
}
