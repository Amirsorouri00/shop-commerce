/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the back office is a data-dense internal tool with no SEO need and no
  // reason to pay for a Node runtime.
  output: 'export',
  transpilePackages: ['@xb/contracts', '@xb/core', '@xb/validation'],
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
