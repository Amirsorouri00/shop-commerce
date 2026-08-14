'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SandboxScenarioDto, SandboxSessionDto } from '@xb/contracts';
import { api, ApiError, sandbox, toPersianDigits } from '../lib/api';

/**
 * The sandbox demo control panel.
 *
 * This is the surface that makes the simulation usable by a person rather than only by a
 * test: pick a scenario, run the flow, fast-forward the clock, watch the exception fire.
 *
 * It renders nothing when the sandbox API is unreachable, so a production build with the
 * sandbox disabled simply has no demo affordance rather than a broken button.
 */
export function DemoPanel() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [scenarios, setScenarios] = useState<SandboxScenarioDto[]>([]);
  const [session, setSession] = useState<SandboxSessionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.sandbox
      .scenarios()
      .then((list) => {
        if (cancelled) return;
        setScenarios(list);
        setAvailable(true);

        // Reattach to a session already in progress so a page navigation doesn't lose it.
        const existing = sandbox.sessionId;
        if (existing) {
          api.sandbox
            .get(existing)
            .then((s) => !cancelled && setSession(s))
            .catch(() => sandbox.clear());
        }
      })
      .catch(() => {
        // Sandbox disabled or API down — the panel stays hidden.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async (scenarioId: string) => {
    setBusy(true);
    setError(null);
    try {
      // A fixed seed makes a demo replay identically, which is what turns "watch this" into
      // something you can rehearse and rely on in front of an audience.
      const s = await api.sandbox.create(scenarioId, 42);
      sandbox.set(s.id);
      setSession(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.text('fa') : 'شروع سناریو ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, []);

  const advance = useCallback(
    async (hours: number) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        setSession(await api.sandbox.advance(session.id, hours));
      } catch (e) {
        // A session that expired server-side should drop the demo cleanly, not crash it.
        if (e instanceof ApiError && e.status === 404) {
          sandbox.clear();
          setSession(null);
          setError('نشست نمایشی منقضی شده است. سناریوی تازه‌ای انتخاب کنید.');
        } else {
          setError(e instanceof ApiError ? e.text('fa') : 'جلو بردن زمان ناموفق بود.');
        }
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const reset = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await api.sandbox.reset(session.id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        sandbox.clear();
        setSession(null);
        setError('نشست نمایشی منقضی شده است. سناریوی تازه‌ای انتخاب کنید.');
      } else {
        setError(e instanceof ApiError ? e.text('fa') : 'بازنشانی ناموفق بود.');
      }
    } finally {
      setBusy(false);
    }
  }, [session]);

  const exit = useCallback(() => {
    sandbox.clear();
    setSession(null);
  }, []);

  if (!available) return null;

  const grouped = groupByStage(scenarios);

  return (
    <>
      <button
        className="demo-fab"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="کنترل حالت نمایشی"
      >
        {session ? '● حالت نمایشی فعال' : 'حالت نمایشی'}
      </button>

      {open && (
        <aside className="demo-drawer" role="dialog" aria-label="کنترل حالت نمایشی">
          <div className="demo-header">
            <div>
              <strong>حالت نمایشی</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                شبیه‌سازی کامل، بدون پرداخت واقعی
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              بستن
            </button>
          </div>

          <div className="demo-body">
            {error && (
              <div className="alert alert-crit" style={{ marginBottom: 12 }} role="alert">
                {error}
              </div>
            )}
            {session ? (
              <div className="stack">
                <div className="card" style={{ padding: 14 }}>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <strong style={{ fontSize: 14 }}>
                      {scenarios.find((s) => s.id === session.scenarioId)?.title.fa ??
                        session.scenarioId}
                    </strong>
                    <span className="badge badge-warn">فعال</span>
                  </div>

                  <div className="muted" style={{ fontSize: 12.5 }}>
                    شناسه نشست: <span className="mono">{session.id}</span>
                  </div>

                  {session.hoursSincePurchase !== null && (
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      زمان سپری‌شده از خرید:{' '}
                      {toPersianDigits(Math.round(session.hoursSincePurchase))} ساعت
                    </div>
                  )}
                </div>

                <div>
                  <label>جلو بردن زمان</label>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {[6, 24, 72].map((h) => (
                      <button
                        key={h}
                        className="btn btn-accent btn-sm"
                        disabled={busy}
                        onClick={() => void advance(h)}
                      >
                        +{toPersianDigits(h)} ساعت
                      </button>
                    ))}
                  </div>
                  <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    مراحل ارسال بر اساس ساعت مجازی نمایش داده می‌شوند — بدون انتظار واقعی.
                  </p>
                </div>

                {session.log.length > 0 && (
                  <div>
                    <label>رویدادهای شبیه‌سازی</label>
                    <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                      {[...session.log].reverse().map((entry, i) => (
                        <div className="log-entry" key={i}>
                          <div className="log-stage">{entry.stage}</div>
                          <div>{entry.message.fa}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="row">
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void reset()}>
                    شروع دوباره
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={exit}>
                    خروج از حالت نمایشی
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack-sm">
                <p className="muted" style={{ fontSize: 13 }}>
                  یک سناریو انتخاب کنید تا کل مسیر سفارش — از ثبت لینک تا تحویل یا بروز خطا —
                  به‌صورت شبیه‌سازی‌شده اجرا شود.
                </p>

                {Object.entries(grouped).map(([stage, items]) => (
                  <div key={stage} style={{ marginTop: 10 }}>
                    <div className="eyebrow">{STAGE_LABELS[stage] ?? stage}</div>
                    {items.map((s) => (
                      <button
                        key={s.id}
                        className="scenario"
                        disabled={busy}
                        onClick={() => void start(s.id)}
                      >
                        <div className="scenario-title">{s.title.fa}</div>
                        <div className="scenario-desc">{s.description.fa}</div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

const STAGE_LABELS: Record<string, string> = {
  resolution: 'شناسایی کالا',
  quote: 'قیمت‌گذاری',
  checkout: 'پرداخت',
  procurement: 'خرید از فروشگاه',
  fulfilment: 'ارسال و تحویل',
};

function groupByStage(scenarios: SandboxScenarioDto[]): Record<string, SandboxScenarioDto[]> {
  const order = ['resolution', 'quote', 'checkout', 'procurement', 'fulfilment'];
  const out: Record<string, SandboxScenarioDto[]> = {};
  for (const stage of order) {
    const items = scenarios.filter((s) => s.stage === stage);
    if (items.length > 0) out[stage] = items;
  }
  return out;
}
