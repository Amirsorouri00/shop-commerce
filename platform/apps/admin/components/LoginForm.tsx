'use client';

import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      onSuccess();
    } catch (e) {
      // Deliberately does not distinguish "no such operator" from "wrong password".
      setError(e instanceof ApiError ? e.text() : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '48px auto' }}>
      <h1>Ops console</h1>
      <p className="sub">Sign in with your operator account.</p>

      <form className="card card-body stack" onSubmit={submit}>
        {error && <div className="alert alert-crit">{error}</div>}

        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
