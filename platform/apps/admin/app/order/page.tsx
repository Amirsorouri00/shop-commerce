'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { OrderDto, ProcurementCopilotDto } from '@xb/contracts';
import { api, ApiError, formatMoney } from '../../lib/api';

/**
 * Order detail and the procurement copilot.
 *
 * The copilot is the screen where a human authorises real money leaving the business, so it
 * is built to make the one number that matters impossible to miss: current price against the
 * authorised ceiling, with the breach state encoded in colour and layout rather than buried
 * in a sentence.
 */
export default function OrderPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
      <OrderInner />
    </Suspense>
  );
}

function OrderInner() {
  const params = useSearchParams();
  const orderId = params.get('id');
  const procurementId = params.get('procurement');

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [copilot, setCopilot] = useState<ProcurementCopilotDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      setOrder(await api.order(orderId));
      if (procurementId) {
        setCopilot(await api.copilot(procurementId).catch(() => null));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.text() : 'Failed to load the order.');
    }
  }, [orderId, procurementId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!orderId) return <div className="alert alert-crit">No order id supplied.</div>;
  if (error) return <div className="alert alert-crit">{error}</div>;
  if (!order) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1>
            Order <span className="mono">{order.publicRef}</span>
          </h1>
          <p className="sub" style={{ margin: 0 }}>
            State: <strong>{order.state.replace(/_/g, ' ')}</strong> · version {order.version}
          </p>
        </div>
        <Link href="/" className="btn btn-ghost">
          ← Queue
        </Link>
      </div>

      {notice && <div className="alert alert-ok">{notice}</div>}

      {copilot && <Copilot copilot={copilot} onDone={(m) => { setNotice(m); void load(); }} />}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2 style={{ margin: 0 }}>Product</h2>
          </div>
          <div className="card-body">
            <div style={{ fontWeight: 650, marginBottom: 6 }}>
              {order.quote.productSnapshot.title}
            </div>
            <div className="mono" style={{ color: 'var(--ink-3)', marginBottom: 10 }}>
              {order.quote.productSnapshot.marketplace} ·{' '}
              {order.quote.productSnapshot.externalProductId}
            </div>
            <table>
              <tbody>
                <tr>
                  <td>Unit price</td>
                  <td className="nums">{formatMoney(order.quote.productSnapshot.price)}</td>
                </tr>
                <tr>
                  <td>Quantity</td>
                  <td className="nums">{order.quote.quantity}</td>
                </tr>
                <tr>
                  <td>Max procurement</td>
                  <td className="nums">{formatMoney(order.quote.maxProcurementPrice)}</td>
                </tr>
                <tr>
                  <td>Customer total</td>
                  <td className="nums">
                    <strong>{formatMoney(order.quote.finalPrice)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Overhead ratio</td>
                  <td className="nums">{(order.quote.overheadRatio * 100).toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>Risk factor</td>
                  <td className="nums">{(order.quote.riskFactor * 100).toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 style={{ margin: 0 }}>Customer timeline</h2>
          </div>
          <div className="card-body">
            <table>
              <tbody>
                {order.timeline.map((step) => (
                  <tr key={step.key}>
                    <td style={{ width: 26 }} aria-hidden="true">
                      {step.status === 'DONE' ? '✓' : step.status === 'CURRENT' ? '●' : '○'}
                    </td>
                    <td style={{ opacity: step.status === 'PENDING' ? 0.5 : 1 }}>
                      {step.label.en}
                    </td>
                    <td className="mono" style={{ color: 'var(--ink-3)', textAlign: 'right' }}>
                      {step.occurredAt ? new Date(step.occurredAt).toLocaleString('en-GB') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <TransitionPanel order={order} onDone={(m) => { setNotice(m); void load(); }} />
    </div>
  );
}

function Copilot({
  copilot,
  onDone,
}: {
  copilot: ProcurementCopilotDto;
  onDone: (message: string) => void;
}) {
  const [externalOrderId, setExternalOrderId] = useState('');
  const [paid, setPaid] = useState(String(copilot.currentPrice.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.confirmProcurement(copilot.procurementId, {
        externalOrderId,
        actualPaid: { amount: Number(paid), currency: copilot.currentPrice.currency },
      });
      onDone('Purchase confirmed. Order moved to PURCHASED.');
    } catch (e) {
      setError(e instanceof ApiError ? e.text() : 'Confirmation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Procurement copilot</h2>
        <span className={`chip ${copilot.withinGuard ? 'ok' : 'crit'}`}>
          {copilot.withinGuard ? 'within ceiling' : 'ceiling breached'}
        </span>
      </div>

      <div className="card-body stack">
        <div className="compare">
          <div className="compare-cell">
            <div className="compare-label">Expected</div>
            <div className="compare-value">{formatMoney(copilot.expectedPrice)}</div>
          </div>
          <div className={`compare-cell ${copilot.withinGuard ? '' : 'breach'}`}>
            <div className="compare-label">Current</div>
            <div className="compare-value">{formatMoney(copilot.currentPrice)}</div>
          </div>
          <div className="compare-cell">
            <div className="compare-label">Max authorised</div>
            <div className="compare-value">{formatMoney(copilot.maxAuthorised)}</div>
          </div>
          <div className="compare-cell">
            <div className="compare-label">Margin if proceed</div>
            <div className="compare-value">{formatMoney(copilot.marginIfProceed)}</div>
          </div>
        </div>

        <div className={`alert ${copilot.withinGuard ? 'alert-ok' : 'alert-crit'}`}>
          <strong>{copilot.recommendation.action}</strong> — {copilot.recommendation.rationale.en}
        </div>

        <a
          className="btn btn-ghost"
          href={copilot.productUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open listing ↗
        </a>

        {copilot.withinGuard ? (
          <form className="stack" onSubmit={confirm}>
            {error && <div className="alert alert-crit">{error}</div>}

            <div className="grid-2">
              <div>
                <label htmlFor="ext">Marketplace order id</label>
                <input
                  id="ext"
                  className="mono"
                  value={externalOrderId}
                  onChange={(e) => setExternalOrderId(e.target.value)}
                  placeholder="404-1234567-1234567"
                  required
                />
              </div>
              <div>
                <label htmlFor="paid">Actually paid (minor units)</label>
                <input
                  id="paid"
                  className="nums"
                  inputMode="numeric"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  required
                />
              </div>
            </div>

            <button className="btn btn-accent" disabled={busy || externalOrderId.length === 0}>
              {busy ? <span className="spinner" /> : 'Confirm purchase'}
            </button>

            <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 12.5 }}>
              The ceiling is re-checked server-side. A figure above the authorised maximum is
              rejected regardless of what is entered here.
            </p>
          </form>
        ) : (
          <div className="alert alert-warn">
            Purchase is blocked while the live price exceeds the authorised ceiling. Reprice the
            order below, or refund it.
          </div>
        )}
      </div>
    </div>
  );
}

function TransitionPanel({
  order,
  onDone,
}: {
  order: OrderDto;
  onDone: (message: string) => void;
}) {
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.transition(order.id, to, reason, order.version);
      onDone(`Order moved to ${to}.`);
      setTo('');
      setReason('');
    } catch (e) {
      setError(e instanceof ApiError ? e.text() : 'Transition failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Manual transition</h2>
      </div>
      <form className="card-body stack" onSubmit={submit}>
        {error && <div className="alert alert-crit">{error}</div>}

        <div className="grid-2">
          <div>
            <label htmlFor="to">Target state</label>
            <select id="to" value={to} onChange={(e) => setTo(e.target.value)} required>
              <option value="">Select…</option>
              {['PROCUREMENT_PENDING', 'REFUND_PENDING', 'CANCELLED', 'CUSTOMER_ACTION_REQUIRED'].map(
                (s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label htmlFor="reason">Reason (audited)</label>
            <input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              required
            />
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy || !to || reason.length < 3}>
          {busy ? <span className="spinner" /> : 'Apply transition'}
        </button>

        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 12.5 }}>
          Subject to the same transition table as the automated path. Illegal moves are rejected,
          and `If-Match` prevents two operators acting on the same order.
        </p>
      </form>
    </div>
  );
}
