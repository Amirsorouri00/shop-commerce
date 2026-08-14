'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ExceptionItemDto, ProviderHealthDto } from '@xb/contracts';
import { api, ApiError, formatAge, formatMoney, session } from '../lib/api';
import { LoginForm } from '../components/LoginForm';

/**
 * The exception queue — the back office's front door.
 *
 * Manage-by-exception means this screen never lists healthy orders. Everything visible here
 * is work that needs a human, ranked by margin-at-risk multiplied by urgency, so the top of
 * the list is genuinely the next thing to do.
 */
export default function QueuePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [items, setItems] = useState<ExceptionItemDto[] | null>(null);
  const [providers, setProviders] = useState<ProviderHealthDto[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAuthed(session.isAuthenticated), []);

  const load = useCallback(async () => {
    try {
      const [queue, health] = await Promise.all([
        api.exceptions(filter || undefined),
        api.providers().catch(() => []),
      ]);
      setItems(queue.items);
      setProviders(health);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.text() : 'Failed to load the queue.');
      setItems([]);
    }
  }, [filter]);

  useEffect(() => {
    if (!authed) return;
    void load();
    // The queue is the operator's live workload; a stale one sends two people to one order.
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [authed, load]);

  if (authed === null) return null;
  if (!authed) return <LoginForm onSuccess={() => setAuthed(true)} />;

  const critical = items?.filter((i) => isCritical(i.type)).length ?? 0;
  const totalRisk = (items ?? []).reduce((sum, i) => sum + i.marginAtRisk.amount, 0);
  const degraded = providers.filter((p) => p.state !== 'HEALTHY');

  return (
    <div>
      <h1>Exception queue</h1>
      <p className="sub">Ranked by margin at risk × urgency. Healthy orders never appear here.</p>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Open exceptions</div>
          <div className="tile-value">{items?.length ?? '—'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Critical</div>
          <div className={`tile-value ${critical > 0 ? 'crit' : ''}`}>{critical}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Margin at risk</div>
          <div className={`tile-value ${totalRisk > 0 ? 'warn' : ''}`}>
            {formatMoney({ amount: totalRisk, currency: 'IRR' })}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Providers degraded</div>
          <div className={`tile-value ${degraded.length > 0 ? 'crit' : ''}`}>{degraded.length}</div>
        </div>
      </div>

      {degraded.length > 0 && (
        <div className="alert alert-warn" style={{ marginBottom: 18 }}>
          <strong>Provider health:</strong>{' '}
          {degraded.map((p) => `${p.port}/${p.provider} (${p.state})`).join(', ')}
        </div>
      )}

      {error && (
        <div className="alert alert-crit" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Needs a decision</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 220 }}
            aria-label="Filter by exception type"
          >
            <option value="">All types</option>
            <option value="PRICE_CHANGED">Price changed</option>
            <option value="OUT_OF_STOCK">Out of stock</option>
            <option value="PROCUREMENT_FAILED">Procurement failed</option>
            <option value="SHIPMENT_EXCEPTION">Shipment stalled</option>
            <option value="CUSTOMS_EXCEPTION">Customs hold</option>
          </select>
        </div>

        {items === null && (
          <div className="card-body">
            <div className="skeleton" style={{ height: 56, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 56, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 56 }} />
          </div>
        )}

        {items?.length === 0 && (
          <div className="empty">
            <div className="empty-big" aria-hidden="true">
              ✓
            </div>
            <strong>Queue is clear.</strong>
            <p style={{ margin: '4px 0 0' }}>Nothing needs a human right now.</p>
          </div>
        )}

        {items && items.length > 0 && (
          <ul className="queue">
            {items.map((item) => (
              <li key={item.id}>
                <Link className="queue-item" href={`/order/?id=${item.orderId}`}>
                  <span
                    className={`severity ${isCritical(item.type) ? 'crit' : 'warn'}`}
                    aria-hidden="true"
                  />

                  <div className="queue-main">
                    <div className="queue-title">{item.summary.en}</div>
                    <div className="queue-meta">
                      <span className={`chip ${isCritical(item.type) ? 'crit' : 'warn'}`}>
                        {item.type.replace(/_/g, ' ')}
                      </span>
                      <span className="mono">{item.publicRef}</span>
                      <span>{item.state.replace(/_/g, ' ')}</span>
                      {item.rankedBy === 'deterministic' && (
                        <span className="chip neutral" title="Model ranker unavailable">
                          fallback rank
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="queue-right">
                    <div className="queue-risk">{formatMoney(item.marginAtRisk)}</div>
                    <div className="queue-age">{formatAge(item.ageMinutes)} old</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function isCritical(type: string): boolean {
  return ['PRICE_CHANGED', 'OUT_OF_STOCK', 'PROCUREMENT_FAILED', 'CUSTOMS_EXCEPTION'].includes(type);
}
