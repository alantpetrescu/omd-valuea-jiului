/**
 * Schimbă parola.
 *
 * Reachable from the topbar, and mandatory when the account still carries a
 * temporary password (`mustChangePassword`). Spec 11.5: an Admin sets a
 * temporary password, the user must replace it.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { useAuth } from './AuthContext';

export function ChangePasswordPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== repeatPassword) {
      setError('Cele două parole noi nu coincid.');
      return;
    }
    if (newPassword.length < 10) {
      setError('Parola nouă trebuie să aibă minimum 10 caractere.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      await refresh();
      navigate('/campaigns');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Parola nu a putut fi schimbată.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Schimbă parola</h1>
          <p>
            {user?.mustChangePassword
              ? 'Contul folosește o parolă temporară.'
              : 'Parola se schimbă imediat; sesiunea curentă rămâne activă.'}
          </p>
        </div>
      </header>

      {user?.mustChangePassword ? (
        <div className="state-note locked-note" role="status">
          <strong>Restul aplicației este blocat până alegi o parolă proprie.</strong>
          <br />
          Administratorul ți-a creat contul cu o parolă temporară. Completează formularul de mai
          jos, iar meniul din stânga se deblochează imediat.
        </div>
      ) : null}

      <form className="wizard-body" onSubmit={submit}>
        <label className="form-field">
          <span className="form-label">Parola actuală</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>

        <label className="form-field">
          <span className="form-label">
            Parola nouă<small>Minimum 10 caractere</small>
          </span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>

        <label className="form-field">
          <span className="form-label">Repetă parola nouă</span>
          <input
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            required
          />
        </label>

        {error ? (
          <div className="state-note error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="wizard-actions">
          <button
            className="btn secondary"
            type="button"
            onClick={() => navigate('/campaigns')}
            disabled={user?.mustChangePassword}
          >
            Renunță
          </button>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? 'Se salvează…' : 'Schimbă parola'}
          </button>
        </div>
      </form>
    </>
  );
}
