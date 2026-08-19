/**
 * Administrare → Strategie.
 *
 * Versiuni strategice, piloni, programe și obiective SMART — the strategic
 * repere, which are NOT master catalogs: they are scoped to a strategy version,
 * they carry no `is_system` flag, and their codes are unique per version rather
 * than globally. That is why they sit in their own tab instead of joining the
 * ten nomenclatoare.
 *
 * Placement note: README_PROGRAMMER §5.1 and spec §11.8 put strategic editing on
 * the `Repere strategice` screen and state that the repere must not be
 * duplicated in Admin. This module is a deliberate departure, recorded as D-002
 * in KNOWN_DEVIATIONS.md — editing lives here and only here, so the operational
 * screen stays a read-only projection identical to the v13.3 prototype for
 * every role.
 *
 * Two rules the UI must not soften:
 *   - the code is never editable; it is the identity campaigns point at, and
 *     reusing it with a new meaning is what strategy versions exist to prevent;
 *   - a used reper is deactivated, never deleted, so historical campaigns keep
 *     resolving (spec 35.1.4).
 */
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../api/client';

type Kind = 'pillars' | 'programs' | 'objectives';

interface StrategyVersion {
  id: string;
  label: string;
  status: string;
  periodStartYear: number;
  periodEndYear: number;
  notes: string | null;
  campaignCount: number;
  pillarCount: number;
  programCount: number;
  objectiveCount: number;
}

interface StrategyRecord {
  code: string;
  label: string;
  isActive: number;
  usageCount: number;
  [field: string]: unknown;
}

interface StrategyPayload {
  version: { id: string; label: string; status: string; periodEndYear: number };
  pillars: StrategyRecord[];
  programs: StrategyRecord[];
  objectives: StrategyRecord[];
}

type Field = { key: string; label: string; control: 'input' | 'textarea'; hint?: string };

/**
 * The PUT replaces every column it names, so a field omitted here would be
 * silently blanked on save. Each list must stay complete.
 */
const FIELDS: Record<Kind, Field[]> = {
  pillars: [
    { key: 'label', label: 'Denumire', control: 'input' },
    { key: 'displayLabel', label: 'Etichetă scurtă', control: 'input', hint: 'Apare ca badge pe campanii' },
    { key: 'hint', label: 'Descriere', control: 'textarea' },
  ],
  programs: [
    { key: 'name', label: 'Denumire', control: 'input' },
    { key: 'label', label: 'Etichetă scurtă', control: 'input' },
    { key: 'result', label: 'Rezultat urmărit', control: 'textarea' },
    { key: 'marketingObjective', label: 'Obiectiv de marketing', control: 'textarea' },
    { key: 'approach', label: 'Abordare', control: 'textarea' },
    { key: 'horizonResult', label: 'Rezultat pe orizontul strategiei', control: 'textarea' },
    { key: 'targetGroups', label: 'Grupuri-țintă din matrice', control: 'textarea' },
    { key: 'kpiText', label: 'KPI strategici', control: 'textarea' },
    { key: 'sources', label: 'Surse de date', control: 'textarea' },
    { key: 'annualActions', label: 'Acțiuni anuale', control: 'textarea' },
    { key: 'validationStatus', label: 'Stadiu de validare', control: 'input' },
  ],
  objectives: [
    { key: 'name', label: 'Obiectiv', control: 'textarea' },
    { key: 'label', label: 'Etichetă scurtă', control: 'input' },
    { key: 'source', label: 'Sursă oficială', control: 'input' },
  ],
};

const KINDS: Array<[Kind, string]> = [
  ['pillars', 'Piloni'],
  ['programs', 'Programe'],
  ['objectives', 'Obiective SMART'],
];

const USAGE_LABEL: Record<Kind, string> = {
  pillars: 'campanii',
  programs: 'campanii',
  objectives: 'campanii',
};

export function StrategyAdminTab({
  onError,
  onNotice,
}: {
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [data, setData] = useState<StrategyPayload | null>(null);
  const [kind, setKind] = useState<Kind>('pillars');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [versionForm, setVersionForm] = useState({
    externalKey: '',
    label: '',
    periodStartYear: new Date().getFullYear(),
    periodEndYear: new Date().getFullYear() + 2,
    notes: '',
  });

  const loadVersions = useCallback(async () => {
    try {
      const response = await api.get<StrategyVersion[]>('/strategy/versions');
      setVersions(response.data);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Versiunile nu au putut fi încărcate.');
    }
  }, [onError]);

  const loadContent = useCallback(
    async (version: string | null) => {
      try {
        const query = version ? `?version=${encodeURIComponent(version)}` : '';
        const response = await api.get<StrategyPayload>(`/strategy${query}`);
        setData(response.data);
      } catch (caught) {
        onError(caught instanceof ApiError ? caught.message : 'Strategia nu a putut fi încărcată.');
      }
    },
    [onError],
  );

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    void loadContent(selectedVersion);
  }, [selectedVersion, loadContent]);

  const rows = data ? ((data[kind] ?? []) as StrategyRecord[]) : [];
  const versionKey = data?.version.id ?? '';

  function beginEdit(row: StrategyRecord) {
    const initial: Record<string, string> = {};
    for (const field of FIELDS[kind]) initial[field.key] = String(row[field.key] ?? '');
    setDraft(initial);
    setEditing(row.code);
    onError(null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    onError(null);
    try {
      await api.put(`/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(editing)}`, draft);
      onNotice(`Reperul ${editing} a fost actualizat.`);
      setEditing(null);
      await loadContent(selectedVersion);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Modificarea nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: StrategyRecord) {
    onError(null);
    try {
      await api.post(
        `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(row.code)}/toggle-active`,
      );
      await loadContent(selectedVersion);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Starea nu a putut fi schimbată.');
    }
  }

  async function activateVersion(id: string) {
    onError(null);
    const confirmed = window.confirm(
      `Activezi versiunea „${id}"? Versiunea activă curentă devine arhivată, iar campaniile noi se vor lega de cea nouă. Campaniile existente își păstrează versiunea.`,
    );
    if (!confirmed) return;

    try {
      await api.post(`/strategy/versions/${encodeURIComponent(id)}/activate`);
      onNotice(`Versiunea ${id} este acum activă.`);
      await loadVersions();
      await loadContent(selectedVersion);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Versiunea nu a putut fi activată.');
    }
  }

  async function createVersion() {
    onError(null);
    try {
      await api.post('/strategy/versions', {
        ...versionForm,
        periodStartYear: Number(versionForm.periodStartYear),
        periodEndYear: Number(versionForm.periodEndYear),
      });
      onNotice(`Versiunea ${versionForm.externalKey} a fost creată ca DRAFT.`);
      setCreatingVersion(false);
      await loadVersions();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Versiunea nu a putut fi creată.');
    }
  }

  return (
    <>
      <section className="activation-list-card">
        <div className="activation-list-count">
          <strong>{versions.length} versiuni strategice</strong>
          <span>
            Codurile sunt unice per versiune: același cod poate însemna altceva într-un ciclu
            strategic următor, iar campaniile istorice își păstrează contextul. O corecție de text se
            face în aceeași versiune; o schimbare de sens cere o versiune nouă.
          </span>
        </div>

        <div className="activation-filter-panel">
          <div className="activation-filter-main">
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                setCreatingVersion((open) => !open);
                onError(null);
              }}
            >
              ＋ Versiune nouă
            </button>
          </div>
        </div>

        {creatingVersion ? (
          <div className="wizard-body">
            <label className="form-field">
              <span className="form-label">
                Cheie<small>Identificator stabil, ex. strategy-2029-2033</small>
              </span>
              <input
                value={versionForm.externalKey}
                onChange={(e) => setVersionForm({ ...versionForm, externalKey: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span className="form-label">Denumire</span>
              <input
                value={versionForm.label}
                onChange={(e) => setVersionForm({ ...versionForm, label: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span className="form-label">Primul an</span>
              <input
                type="number"
                value={versionForm.periodStartYear}
                onChange={(e) => setVersionForm({ ...versionForm, periodStartYear: Number(e.target.value) })}
              />
            </label>
            <label className="form-field">
              <span className="form-label">Ultimul an</span>
              <input
                type="number"
                value={versionForm.periodEndYear}
                onChange={(e) => setVersionForm({ ...versionForm, periodEndYear: Number(e.target.value) })}
              />
            </label>
            <label className="form-field">
              <span className="form-label">Note</span>
              <textarea
                rows={2}
                value={versionForm.notes}
                onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })}
              />
            </label>
            <div className="wizard-actions">
              <button className="btn secondary" type="button" onClick={() => setCreatingVersion(false)}>
                Renunță
              </button>
              <button className="btn primary" type="button" onClick={() => void createVersion()}>
                Creează ca DRAFT
              </button>
            </div>
          </div>
        ) : null}

        <div className="activation-table-scroll">
          <table className="activation-list-table admin-narrow-table">
            <thead>
              <tr>
                <th>Versiune</th>
                <th>Denumire</th>
                <th>Perioadă</th>
                <th>Stare</th>
                <th>Campanii</th>
                <th>Piloni / programe / obiective</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id}>
                  <td>
                    <code>{version.id}</code>
                  </td>
                  <td>
                    <strong>{version.label}</strong>
                  </td>
                  <td>{`${version.periodStartYear}–${version.periodEndYear}`}</td>
                  <td>
                    <span className={version.status === 'ACTIVE' ? 'badge status' : 'badge'}>
                      {version.status}
                    </span>
                  </td>
                  <td>{version.campaignCount}</td>
                  <td>{`${version.pillarCount} / ${version.programCount} / ${version.objectiveCount}`}</td>
                  <td>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => setSelectedVersion(version.id)}
                    >
                      {version.id === versionKey ? 'Se editează' : 'Editează reperele'}
                    </button>
                    {version.status !== 'ACTIVE' ? (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => void activateVersion(version.id)}
                      >
                        Activează
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="activation-list-card">
        <div className="activation-list-count">
          <strong>{data ? `Repere · ${data.version.label}` : 'Repere'}</strong>
          <span>
            Codul nu se editează — este identitatea la care trimit campaniile. Un reper utilizat nu
            se șterge, ci se dezactivează: rămâne rezolvabil în istoric, dar nu mai poate fi ales în
            înregistrări noi.
          </span>
        </div>

        <div className="sub-toggle">
          {KINDS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={kind === id ? 'active' : ''}
              onClick={() => {
                setKind(id);
                setEditing(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {editing ? (
          <div className="wizard-body">
            {FIELDS[kind].map((field) => (
              <label className="form-field" key={field.key}>
                <span className="form-label">
                  {field.label}
                  {field.hint ? <small>{field.hint}</small> : null}
                </span>
                {field.control === 'textarea' ? (
                  <textarea
                    rows={2}
                    value={draft[field.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  />
                ) : (
                  <input
                    value={draft[field.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <div className="wizard-actions">
              <button className="btn secondary" type="button" onClick={() => setEditing(null)}>
                Renunță
              </button>
              <button className="btn primary" type="button" disabled={saving} onClick={() => void save()}>
                {saving ? 'Se salvează…' : 'Salvează'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="activation-table-scroll">
          <table className="activation-list-table admin-narrow-table">
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
              {rows.map((row) => {
                const title = String(row.name ?? row.label ?? '');
                return (
                  <tr key={row.code}>
                    <td>
                      <code>{row.code}</code>
                    </td>
                    <td>
                      <strong>{title}</strong>
                      {kind === 'programs' && row.result ? <small>{String(row.result)}</small> : null}
                      {kind === 'objectives' && row.source ? <small>{String(row.source)}</small> : null}
                    </td>
                    <td>
                      {row.usageCount > 0 ? (
                        `${row.usageCount} ${USAGE_LABEL[kind]}`
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
                      <button className="btn secondary" type="button" onClick={() => beginEdit(row)}>
                        Editează
                      </button>
                      <button className="btn ghost" type="button" onClick={() => void toggleActive(row)}>
                        {row.isActive ? 'Dezactivează' : 'Activează'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <span className="muted-copy">Versiunea nu are încă repere de acest tip.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
