'use client';

import type { ResolvedProductDto } from '@xb/contracts';
import { formatMoney } from '../lib/api';

/**
 * Product card.
 *
 * Shows a confidence hint when a field was estimated rather than read from an authoritative
 * source. That honesty is not decoration: an estimated weight drives the freight figure, and
 * a customer who was told the number might move is a customer who is not surprised later.
 */
export function ProductCard({ product }: { product: ResolvedProductDto }) {
  const weightConfidence = product.provenance?.['weightKg']?.confidence;
  const weightIsEstimated = weightConfidence !== undefined && weightConfidence < 0.7;

  return (
    <div className="product">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- static export has no optimiser
        <img className="product-img" src={product.imageUrl} alt="" loading="lazy" />
      ) : (
        <div className="product-img" aria-hidden="true" />
      )}

      <div>
        <h3 className="product-title">{product.title}</h3>

        <div className="muted" style={{ marginBottom: 6 }}>
          {product.brand && <span>{product.brand} · </span>}
          <span className="ltr">{product.seller}</span>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong style={{ fontSize: 16 }}>{formatMoney(product.price, 'fa')}</strong>

          {product.available ? (
            <span className="badge badge-ok">موجود</span>
          ) : (
            <span className="badge badge-crit">ناموجود</span>
          )}

          {weightIsEstimated && (
            <span className="badge badge-warn" title="وزن این کالا برآوردی است">
              وزن برآوردی
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
