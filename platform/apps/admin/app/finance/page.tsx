'use client';

import { useEffect, useState } from 'react';
import type { LedgerEntryDto } from '@xb/contracts';
import { api, ApiError, formatMoney, session } from '../../lib/api';
import { LoginForm } from '../../components/LoginForm';

/**
 * Finance view.
 *
 * Read-only by construction — there is no ledger write endpoint at any privilege level.
 * Entries are produced only by domain transactions, which is what makes the ledger an audit
 * record rather than a table someone can tidy up.
 */
export default function FinancePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<LedgerEntryDto[] | null>(null);
  const [balances, setBalances] = useState<
    { account: string; balance: { amount: number; currency: string } }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAuthed(session.isAuthenticated), []);

  useEffect(() => {
    if (!authed) return;
    Promise.all([api.ledger(), api.balances()])
      .then(([l, b]) => {
        setEntries(l.items);
        setBalances(b);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.text() : 'Failed to load ledger.');
        setEntries([]);
      });
  }, [authed]);

  if (authed === null) return null;
  if (!authed) return <LoginForm onSuccess={() => setAuthed(true)} />;

  return (
    <div className="stack">
      <div>
        <h1>Finance</h1>
        <p className="sub">
          Double-entry ledger. Append-only, balanced per currency by a database constraint.
        </p>
      </div>

      {error && <div className="alert alert-crit">{error}</div>}

      <div className="tiles">
        {balances.map((b) => (
          <div className="tile" key={b.account}>
            <div className="tile-label">{b.account.replace(/[:_]/g, ' ')}</div>
            <div className="tile-value">{formatMoney(b.balance)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Recent entries</h2>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Txn</th>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Debit</th>
                <th style={{ textAlign: 'right' }}>Credit</th>
                <th>Ref</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {entries?.map((e) => (
                <tr key={e.seq}>
                  <td className="mono nums">{e.seq}</td>
                  <td className="mono" title={e.txnId}>
                    {e.txnId.slice(0, 8)}
                  </td>
                  <td>{e.account}</td>
                  <td className="nums" style={{ textAlign: 'right' }}>
                    {e.debit ? formatMoney({ amount: e.debit, currency: e.currency }) : '—'}
                  </td>
                  <td className="nums" style={{ textAlign: 'right' }}>
                    {e.credit ? formatMoney({ amount: e.credit, currency: e.currency }) : '—'}
                  </td>
                  <td className="mono">{e.refType}</td>
                  <td className="mono" style={{ color: 'var(--ink-3)' }}>
                    {new Date(e.postedAt).toLocaleString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {entries?.length === 0 && (
          <div className="empty">
            <strong>No ledger entries yet.</strong>
            <p style={{ margin: '4px 0 0' }}>Entries appear once an order is paid.</p>
          </div>
        )}
      </div>
    </div>
  );
}
