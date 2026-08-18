/**
 * Administrare — users, catalogs, imports, audit.
 *
 * A module of the same application, not a separate back office (spec 11.8):
 * same shell, same sidebar, same components. Nothing here looks like phpMyAdmin.
 *
 * The catalogs tab is where the deletion policy becomes visible: a system value
 * shows a protected badge, a used value offers deactivation instead of delete,
 * and the reference count is shown before the user commits to anything.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { formatDateTime } from '../../domain/services';

type Tab = 'users' | 'catalogs' | 'imports' | 'audit';

const CATALOGS: Array<{ key: string; label: string }> = [
  { key: 'audience_segments', label: 'Publicuri' },
  { key: 'cta_types', label: 'CTA-uri' },
  { key: 'product_catalog', label: 'Produse' },
  { key: 'channel_catalog', label: 'Canale' },
  { key: 'campaign_types', label: 'Tipuri de campanie' },
  { key: 'campaign_statuses', label: 'Stadii' },
  { key: 'seasonality_types', label: 'Sezonalitate' },
  { key: 'activation_channels', label: 'Canale de activare' },
  { key: 'implementation_modes', label: 'Moduri de implementare' },
  { key: 'funding_types', label: 'Tipuri de finanțare' },
];

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  isActive: number;
  mustChangePassword: number;
  lastLoginAt: string | null;
}

interface CatalogRow {
  code: string;
  label: string;
  displayLabel: string | null;
  hint: string | null;
  isActive: number;
  isSystem: number;
  sortOrder: number;
  usageCount: number;
  dependencies: Array<{ type: string; count: number }>;
}

interface ImportRow {
  id: string;
  packageType: string;
  packageId: string | null;
  filename: string | null;
  purpose: string | null;
  status: string;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  warningCount: number;
  errorCount: number;
  completedAt: string | null;
}

interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityExternalKey: string | null;
  source: string;
  userName: string | null;
  userEmail: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  EDITOR: 'Editor',
  VIEWER: 'Vizualizare',
};

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Administrare</h1>
          <p>Utilizatori, nomenclatoare, importuri și jurnal de audit.</p>
        </div>
      </header>

      <div className="wizard-steps">
        {(
          [
            ['users', 'Utilizatori'],
            ['catalogs', 'Nomenclatoare'],
            ['imports', 'Importuri'],
            ['audit', 'Audit'],
          ] as Array<[Tab, string]>
        ).map(([key, label], index) => (
          <button
            key={key}
            type="button"
            className={key === tab ? 'wizard-step active' : 'wizard-step'}
            onClick={() => {
              setTab(key);
              setError(null);
              setNotice(null);
            }}
          >
            <b>{index + 1}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="state-note">{notice}</div> : null}

      {tab === 'users' ? <UsersTab onError={setError} onNotice={setNotice} /> : null}
      {tab === 'catalogs' ? <CatalogsTab onError={setError} onNotice={setNotice} /> : null}
      {tab === 'imports' ? <ImportsTab onError={setError} /> : null}
      {tab === 'audit' ? <AuditTab onError={setError} /> : null}
    </>
  );
}

function UsersTab({
  onError,
  onNotice,
}: {
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'VIEWER', password: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get<UserRow[]>('/admin/users');
      setUsers(response.data);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Utilizatorii nu au putut fi încărcați.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setSaving(true);
    onError(null);
    try {
      if (editingId) {
        const body: Record<string, unknown> = { ...form };
        if (!form.password) delete body.password;
        await api.put(`/admin/users/${editingId}`, body);
        onNotice(`Utilizatorul ${form.email} a fost actualizat.`);
      } else {
        await api.post('/admin/users', form);
        onNotice(`Utilizatorul ${form.email} a fost creat. Va schimba parola la prima autentificare.`);
      }
      setCreating(false);
      setEditingId(null);
      setForm({ name: '', email: '', role: 'VIEWER', password: '' });
      await load();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Utilizatorul nu a putut fi salvat.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(user: UserRow) {
    onError(null);
    try {
      await api.post(`/admin/users/${user.id}/toggle-active`);
      await load();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Starea nu a putut fi schimbată.');
    }
  }

  return (
    <section className="activation-list-card">
      <div className="activation-list-count">
        <strong>{users.length} utilizatori</strong>
        <span>
          Conturile nu se șterg — se dezactivează, fiindcă jurnalul de audit face referire la ele.
        </span>
      </div>

      {creating || editingId ? (
        <div className="wizard-body">
          <label className="form-field">
            <span className="form-label">Nume</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="form-field">
            <span className="form-label">E-mail</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="form-field">
            <span className="form-label">Rol</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="ADMIN">Administrator</option>
              <option value="EDITOR">Editor</option>
              <option value="VIEWER">Vizualizare</option>
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">
              Parolă temporară
              <small>
                {editingId
                  ? 'Lasă gol pentru a păstra parola actuală'
                  : 'Minimum 10 caractere; utilizatorul o schimbă la prima autentificare'}
              </small>
            </span>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <div className="wizard-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setCreating(false);
                setEditingId(null);
              }}
            >
              Renunță
            </button>
            <button className="btn primary" type="button" disabled={saving} onClick={() => void submit()}>
              {saving ? 'Se salvează…' : 'Salvează'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '0 18px 12px' }}>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              setCreating(true);
              setForm({ name: '', email: '', role: 'VIEWER', password: '' });
            }}
          >
            ＋ Utilizator nou
          </button>
        </div>
      )}

      <div className="activation-table-scroll">
        <table className="activation-list-table">
          <thead>
            <tr>
              <th>Nume</th>
              <th>E-mail</th>
              <th>Rol</th>
              <th>Status</th>
              <th>Ultima autentificare</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  {user.mustChangePassword ? <small>trebuie să schimbe parola</small> : null}
                </td>
                <td>{user.email}</td>
                <td>{ROLE_LABELS[user.role] ?? user.role}</td>
                <td>
                  <span className={user.isActive ? 'badge status' : 'badge'}>
                    {user.isActive ? 'Activ' : 'Inactiv'}
                  </span>
                </td>
                <td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</td>
                <td>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setEditingId(user.id);
                      setCreating(false);
                      setForm({ name: user.name, email: user.email, role: user.role, password: '' });
                    }}
                  >
                    Editează
                  </button>
                  <button className="btn ghost" type="button" onClick={() => void toggle(user)}>
                    {user.isActive ? 'Dezactivează' : 'Activează'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CatalogsTab({
  onError,
  onNotice,
}: {
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [catalog, setCatalog] = useState(CATALOGS[0]!.key);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', label: '', displayLabel: '', hint: '', sortOrder: 0 });

  const load = useCallback(
    async (target: string) => {
      try {
        const response = await api.get<CatalogRow[]>(`/admin/catalogs/${target}`);
        setRows(response.data);
      } catch (caught) {
        onError(caught instanceof ApiError ? caught.message : 'Nomenclatorul nu a putut fi încărcat.');
      }
    },
    [onError],
  );

  useEffect(() => {
    void load(catalog);
  }, [catalog, load]);

  async function save() {
    onError(null);
    try {
      if (editing) {
        await api.put(`/admin/catalogs/${catalog}/${encodeURIComponent(editing)}`, form);
        onNotice(`Valoarea ${editing} a fost actualizată.`);
      } else {
        await api.post(`/admin/catalogs/${catalog}`, form);
        onNotice(`Valoarea ${form.code} a fost creată.`);
      }
      setEditing(null);
      setCreating(false);
      await load(catalog);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Valoarea nu a putut fi salvată.');
    }
  }

  async function remove(row: CatalogRow) {
    onError(null);
    const confirmed = window.confirm(
      `Ștergi definitiv „${row.label}"? Operația este posibilă doar pentru valori nefolosite.`,
    );
    if (!confirmed) return;

    try {
      await api.del(`/admin/catalogs/${catalog}/${encodeURIComponent(row.code)}`);
      onNotice(`Valoarea ${row.code} a fost ștearsă.`);
      await load(catalog);
    } catch (caught) {
      // The API explains why, including which entities still reference it.
      onError(caught instanceof ApiError ? caught.message : 'Valoarea nu a putut fi ștearsă.');
    }
  }

  async function deactivate(row: CatalogRow) {
    onError(null);
    try {
      await api.post(`/admin/catalogs/${catalog}/${encodeURIComponent(row.code)}/deactivate`);
      await load(catalog);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Starea nu a putut fi schimbată.');
    }
  }

  return (
    <section className="activation-list-card">
      <div className="activation-filter-panel">
        <div className="activation-filter-main">
          <select value={catalog} onChange={(e) => setCatalog(e.target.value)} aria-label="Nomenclator">
            {CATALOGS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              setCreating(true);
              setEditing(null);
              setForm({ code: '', label: '', displayLabel: '', hint: '', sortOrder: rows.length });
            }}
          >
            ＋ Adaugă
          </button>
        </div>
      </div>

      {creating || editing ? (
        <div className="wizard-body">
          {creating ? (
            <label className="form-field">
              <span className="form-label">
                Cod<small>Identitatea valorii; nu se mai poate schimba după creare</small>
              </span>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </label>
          ) : null}
          <label className="form-field">
            <span className="form-label">Denumire</span>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="form-field">
            <span className="form-label">Etichetă scurtă</span>
            <input
              value={form.displayLabel}
              onChange={(e) => setForm({ ...form, displayLabel: e.target.value })}
            />
          </label>
          <label className="form-field">
            <span className="form-label">Descriere</span>
            <textarea
              rows={2}
              value={form.hint}
              onChange={(e) => setForm({ ...form, hint: e.target.value })}
            />
          </label>
          <div className="wizard-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Renunță
            </button>
            <button className="btn primary" type="button" onClick={() => void save()}>
              Salvează
            </button>
          </div>
        </div>
      ) : null}

      <div className="activation-table-scroll">
        <table className="activation-list-table">
          <thead>
            <tr>
              <th>Cod</th>
              <th>Denumire</th>
              <th>Utilizat în</th>
              <th>Stare</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td>
                  <code>{row.code}</code>
                  {row.isSystem ? <span className="badge status">Sistem</span> : null}
                </td>
                <td>
                  <strong>{row.label}</strong>
                  {row.hint ? <small>{row.hint}</small> : null}
                </td>
                <td>
                  {row.usageCount > 0 ? (
                    <span title={row.dependencies.map((d) => `${d.type}: ${d.count}`).join(', ')}>
                      {row.usageCount} referințe
                    </span>
                  ) : (
                    <span className="muted-copy">nefolosit</span>
                  )}
                </td>
                <td>
                  <span className={row.isActive ? 'badge status' : 'badge'}>
                    {row.isActive ? 'Activ' : 'Inactiv'}
                  </span>
                </td>
                <td>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setEditing(row.code);
                      setCreating(false);
                      setForm({
                        code: row.code,
                        label: row.label,
                        displayLabel: row.displayLabel ?? '',
                        hint: row.hint ?? '',
                        sortOrder: row.sortOrder,
                      });
                    }}
                  >
                    Editează
                  </button>

                  {/* A system value offers neither delete nor deactivate. */}
                  {row.isSystem ? (
                    <span className="muted-copy">valoare protejată</span>
                  ) : row.usageCount > 0 ? (
                    <button className="btn ghost" type="button" onClick={() => void deactivate(row)}>
                      {row.isActive ? 'Dezactivează' : 'Activează'}
                    </button>
                  ) : (
                    <button className="btn ghost" type="button" onClick={() => void remove(row)}>
                      Șterge
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImportsTab({ onError }: { onError: (message: string | null) => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);

  useEffect(() => {
    api
      .get<ImportRow[]>('/admin/imports?pageSize=100')
      .then((response) => setRows(response.data))
      .catch((caught: unknown) =>
        onError(caught instanceof ApiError ? caught.message : 'Importurile nu au putut fi încărcate.'),
      );
  }, [onError]);

  return (
    <section className="activation-list-card">
      <div className="activation-list-count">
        <strong>{rows.length} importuri</strong>
        <span>
          Fiecare import este tranzacțional: ori se aplică integral, ori nu lasă nicio urmă în date.
        </span>
      </div>

      <div className="activation-table-scroll">
        <table className="activation-list-table">
          <thead>
            <tr>
              <th>Pachet</th>
              <th>Fișier</th>
              <th>Scop</th>
              <th>Status</th>
              <th>Create</th>
              <th>Actualizate</th>
              <th>Neschimbate</th>
              <th>Avertismente</th>
              <th>Finalizat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.packageType}</strong>
                    {row.packageId ? <small>{row.packageId}</small> : null}
                  </td>
                  <td>{row.filename ?? '—'}</td>
                  <td>{row.purpose ?? '—'}</td>
                  <td>
                    <span
                      className={`activation-status ${row.status === 'SUCCESS' ? 'done' : row.status === 'FAILED' ? 'prep' : 'active'}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td>{row.createdCount}</td>
                  <td>{row.updatedCount}</td>
                  <td>{row.unchangedCount}</td>
                  <td>{row.warningCount}</td>
                  <td>{row.completedAt ? formatDateTime(row.completedAt) : '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9}>Nu există importuri înregistrate.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="view-note" style={{ margin: 18 }}>
        <b>Import prin interfață.</b> Încărcarea unui pachet nou din browser, cu previzualizare
        înainte de confirmare, nu este încă disponibilă. Momentan importurile se rulează din linia
        de comandă: <code>npm run import -- fisier.json</code>.
      </div>
    </section>
  );
}

function AuditTab({ onError }: { onError: (message: string | null) => void }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState('');

  useEffect(() => {
    const query = action ? `&action=${encodeURIComponent(action)}` : '';
    api
      .get<AuditRow[]>(`/admin/audit?pageSize=100${query}`)
      .then((response) => setRows(response.data))
      .catch((caught: unknown) =>
        onError(caught instanceof ApiError ? caught.message : 'Jurnalul nu a putut fi încărcat.'),
      );
  }, [action, onError]);

  return (
    <section className="activation-list-card">
      <div className="activation-filter-panel">
        <div className="activation-filter-main">
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Acțiune">
            <option value="">Toate acțiunile</option>
            {['LOGIN', 'CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'IMPORT', 'MASTER_DATA_CHANGE', 'STRATEGY_CHANGE', 'USER_CHANGE'].map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      <div className="activation-table-scroll">
        <table className="activation-list-table">
          <thead>
            <tr>
              <th>Dată</th>
              <th>Utilizator</th>
              <th>Acțiune</th>
              <th>Entitate</th>
              <th>Cheie</th>
              <th>Sursă</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.userName ?? row.userEmail ?? 'sistem'}</td>
                  <td>{row.action}</td>
                  <td>{row.entityType}</td>
                  <td>
                    <code>{row.entityExternalKey ?? '—'}</code>
                  </td>
                  <td>{row.source}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>Nu există intrări pentru filtrul selectat.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
