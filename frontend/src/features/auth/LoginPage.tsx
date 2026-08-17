/**
 * Login — page 1.
 *
 * Uses the prototype's design tokens and control styles so it belongs to the
 * same product as the rest of the application (spec 11.8). One login, one app:
 * ADMIN, EDITOR and VIEWER all arrive here.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError } from '../../api/client';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Read from the form, not from state. Browser autofill and password
      // managers set the DOM value without firing onChange, which would leave
      // the controlled state empty and post two blank fields.
      const data = new FormData(event.currentTarget);
      const submittedEmail = String(data.get('email') ?? '').trim() || email;
      const submittedPassword = String(data.get('password') ?? '') || password;

      if (!submittedEmail || !submittedPassword) {
        setError('Completează adresa de e-mail și parola.');
        return;
      }

      await login(submittedEmail, submittedPassword);
    } catch (caught) {
      // The form keeps what was typed on failure (spec 37).
      setError(
        caught instanceof ApiError ? caught.message : 'Autentificarea nu a putut fi finalizată.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="brand-mark">OMD</div>
          <div>
            <h1>OMD Valea Jiului</h1>
            <p>Sistem digital de marketing</p>
          </div>
        </div>

        <label className="login-field">
          <span>E-mail</span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="login-field">
          <span>Parolă</span>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? (
          <div className="login-error" role="alert">
            {error}
          </div>
        ) : null}

        <button className="btn primary login-submit" type="submit" disabled={submitting}>
          {submitting ? 'Se autentifică…' : 'Autentificare'}
        </button>

        <p className="login-note">
          Accesul este acordat de administratorul OMD. Dacă ai primit o parolă temporară, o vei
          schimba după prima autentificare.
        </p>
      </form>
    </div>
  );
}
