/**
 * Repere strategice.
 *
 * A shared screen, not an Admin-only one (spec 11.8): everyone reads the
 * strategic frame, ADMIN additionally edits it in place. That is why the edit
 * controls appear inline rather than in a separate back office.
 *
 * Codes are shown alongside labels because the code is the identity — it is
 * what campaigns point at, and what stays stable when a label is reworded.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';

interface StrategyVersion {
  id: string;
  label: string;
  status: string;
  periodStartYear: number;
  periodEndYear: number;
  campaignCount: number;
  pillarCount: number;
  programCount: number;
  objectiveCount: number;
}

interface Pillar {
  code: string;
  label: string;
  displayLabel: string;
  hint: string;
  isActive: number;
  usageCount: number;
}

interface Program {
  code: string;
  name: string;
  label: string;
  result: string;
  marketingObjective: string;
  approach: string;
  horizonResult: string;
  targetGroups: string;
  kpiText: string;
  sources: string;
  annualActions: string;
  validationStatus: string;
  isActive: number;
  usageCount: number;
}

interface Objective {
  code: string;
  name: string;
  label: string;
  source: string;
  isActive: number;
  usageCount: number;
}

interface StrategyPayload {
  version: { id: string; label: string; status: string };
  pillars: Pillar[];
  programs: Program[];
  objectives: Objective[];
  programObjectives: Array<{ programCode: string; objectiveCode: string }>;
}

type Tab = 'pillars' | 'programs' | 'objectives' | 'versions';

export function StrategyPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [data, setData] = useState<StrategyPayload | null>(null);
  const [tab, setTab] = useState<Tab>('pillars');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: Tab; code: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (version: string | null) => {
    setError(null);
    try {
      const query = version ? `?version=${encodeURIComponent(version)}` : '';
      const response = await api.get<StrategyPayload>(`/strategy${query}`);
      setData(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Strategia nu a putut fi încărcată.');
    }
  }, []);

  useEffect(() => {
    api
      .get<StrategyVersion[]>('/strategy/versions')
      .then((response) => setVersions(response.data))
      .catch(() => setVersions([]));
  }, []);

  useEffect(() => {
    void load(selectedVersion).finally(() => setLoading(false));
  }, [selectedVersion, load]);

  async function save(kind: Tab, code: string) {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/strategy/${encodeURIComponent(data.version.id)}/${kind}/${encodeURIComponent(code)}`, draft);
      setEditing(null);
      setNotice(`Reperul ${code} a fost actualizat.`);
      await load(selectedVersion);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Modificarea nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(kind: Tab, code: string) {
    if (!data) return;
    setError(null);
    try {
      await api.post(
        `/strategy/${encodeURIComponent(data.version.id)}/${kind}/${encodeURIComponent(code)}/toggle-active`,
      );
      await load(selectedVersion);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Starea nu a putut fi schimbată.');
    }
  }

  async function activateVersion(id: string) {
    setError(null);
    try {
      await api.post(`/strategy/versions/${encodeURIComponent(id)}/activate`);
      const refreshed = await api.get<StrategyVersion[]>('/strategy/versions');
      setVersions(refreshed.data);
      setNotice(`Versiunea ${id} este acum activă.`);
      await load(selectedVersion);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Versiunea nu a putut fi activată.');
    }
  }

  if (loading) return <div className="state-note">Se încarcă reperele strategice…</div>;
  if (!data) return <div className="state-note error">{error ?? 'Strategia nu este disponibilă.'}</div>;

  const TABS: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'pillars', label: 'Piloni', count: data.pillars.length },
    { key: 'programs', label: 'Programe', count: data.programs.length },
    { key: 'objectives', label: 'Obiective', count: data.objectives.length },
    { key: 'versions', label: 'Versiuni strategice', count: versions.length },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Repere strategice</h1>
          <p>
            {data.version.label} · <span className="badge status">{data.version.status}</span>
            {isAdmin ? ' · poți edita denumirile; codurile rămân neschimbate' : null}
          </p>
        </div>
      </header>

      {versions.length > 1 ? (
        <div className="calendar-year-switch">
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              className={version.id === data.version.id ? 'btn primary' : 'btn secondary'}
              onClick={() => setSelectedVersion(version.id)}
            >
              {version.id}
            </button>
          ))}
        </div>
      ) : null}

      <div className="wizard-steps">
        {TABS.map((entry, index) => (
          <button
            key={entry.key}
            type="button"
            className={entry.key === tab ? 'wizard-step active' : 'wizard-step'}
            onClick={() => setTab(entry.key)}
          >
            <b>{entry.count}</b>
            <span>{entry.label}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <div className="state-note">{notice}</div> : null}

      {tab === 'pillars' ? (
        <section className="activation-list-card">
          <div className="activation-table-scroll">
            <table className="activation-list-table">
              <thead>
                <tr>
                  <th>Cod</th>
                  <th>Denumire</th>
                  <th>Etichetă scurtă</th>
                  <th>Utilizat în</th>
                  <th>Stare</th>
                  {isAdmin ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {data.pillars.map((pillar) => (
                  <tr key={pillar.code}>
                    <td>
                      <code>{pillar.code}</code>
                    </td>
                    <td>
                      {editing?.kind === 'pillars' && editing.code === pillar.code ? (
                        <input
                          value={draft.label ?? ''}
                          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                        />
                      ) : (
                        pillar.label
                      )}
                    </td>
                    <td>
                      {editing?.kind === 'pillars' && editing.code === pillar.code ? (
                        <input
                          value={draft.displayLabel ?? ''}
                          onChange={(e) => setDraft({ ...draft, displayLabel: e.target.value })}
                        />
                      ) : (
                        pillar.displayLabel
                      )}
                    </td>
                    <td>{pillar.usageCount} campanii</td>
                    <td>
                      <span className={pillar.isActive ? 'badge status' : 'badge'}>
                        {pillar.isActive ? 'Activ' : 'Inactiv'}
                      </span>
                    </td>
                    {isAdmin ? (
                      <td>
                        {editing?.kind === 'pillars' && editing.code === pillar.code ? (
                          <>
                            <button
                              className="btn primary"
                              type="button"
                              disabled={saving}
                              onClick={() => void save('pillars', pillar.code)}
                            >
                              Salvează
                            </button>
                            <button className="btn ghost" type="button" onClick={() => setEditing(null)}>
                              Renunță
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn secondary"
                              type="button"
                              onClick={() => {
                                setEditing({ kind: 'pillars', code: pillar.code });
                                setDraft({
                                  label: pillar.label,
                                  displayLabel: pillar.displayLabel,
                                  hint: pillar.hint,
                                });
                              }}
                            >
                              Editează
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => void toggleActive('pillars', pillar.code)}
                            >
                              {pillar.isActive ? 'Dezactivează' : 'Activează'}
                            </button>
                          </>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'objectives' ? (
        <section className="activation-list-card">
          <div className="activation-table-scroll">
            <table className="activation-list-table">
              <thead>
                <tr>
                  <th>Cod</th>
                  <th>Obiectiv</th>
                  <th>Sursă</th>
                  <th>Utilizat în</th>
                  <th>Stare</th>
                  {isAdmin ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {data.objectives.map((objective) => (
                  <tr key={objective.code}>
                    <td>
                      <code>{objective.code}</code>
                    </td>
                    <td>
                      {editing?.kind === 'objectives' && editing.code === objective.code ? (
                        <textarea
                          rows={2}
                          value={draft.name ?? ''}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                      ) : (
                        objective.name
                      )}
                    </td>
                    <td>{objective.source}</td>
                    <td>{objective.usageCount} campanii</td>
                    <td>
                      <span className={objective.isActive ? 'badge status' : 'badge'}>
                        {objective.isActive ? 'Activ' : 'Inactiv'}
                      </span>
                    </td>
                    {isAdmin ? (
                      <td>
                        {editing?.kind === 'objectives' && editing.code === objective.code ? (
                          <>
                            <button
                              className="btn primary"
                              type="button"
                              disabled={saving}
                              onClick={() => void save('objectives', objective.code)}
                            >
                              Salvează
                            </button>
                            <button className="btn ghost" type="button" onClick={() => setEditing(null)}>
                              Renunță
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn secondary"
                              type="button"
                              onClick={() => {
                                setEditing({ kind: 'objectives', code: objective.code });
                                setDraft({
                                  name: objective.name,
                                  label: objective.label,
                                  source: objective.source,
                                });
                              }}
                            >
                              Editează
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => void toggleActive('objectives', objective.code)}
                            >
                              {objective.isActive ? 'Dezactivează' : 'Activează'}
                            </button>
                          </>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'programs' ? (
        <div className="campaign-full-view">
          {data.programs.map((program) => {
            const linked = data.programObjectives
              .filter((link) => link.programCode === program.code)
              .map((link) => link.objectiveCode);
            const isEditing = editing?.kind === 'programs' && editing.code === program.code;

            return (
              <section className="campaign-full-section" key={program.code}>
                <header>
                  <b>{program.code}</b>
                  <h3>{program.name}</h3>
                </header>
                <div className="campaign-full-section-body">
                  {isEditing ? (
                    <>
                      <label className="form-field">
                        <span className="form-label">Denumire</span>
                        <input
                          value={draft.name ?? ''}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                      </label>
                      <label className="form-field">
                        <span className="form-label">Rezultat urmărit</span>
                        <textarea
                          rows={2}
                          value={draft.result ?? ''}
                          onChange={(e) => setDraft({ ...draft, result: e.target.value })}
                        />
                      </label>
                      <label className="form-field">
                        <span className="form-label">Obiectiv de marketing</span>
                        <textarea
                          rows={2}
                          value={draft.marketingObjective ?? ''}
                          onChange={(e) => setDraft({ ...draft, marketingObjective: e.target.value })}
                        />
                      </label>
                      <div className="wizard-actions">
                        <button className="btn secondary" type="button" onClick={() => setEditing(null)}>
                          Renunță
                        </button>
                        <button
                          className="btn primary"
                          type="button"
                          disabled={saving}
                          onClick={() => void save('programs', program.code)}
                        >
                          Salvează
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <table className="table">
                        <tbody>
                          <tr>
                            <th>Rezultat urmărit</th>
                            <td>{program.result || '—'}</td>
                          </tr>
                          <tr>
                            <th>Obiectiv de marketing</th>
                            <td>{program.marketingObjective || '—'}</td>
                          </tr>
                          <tr>
                            <th>Abordare</th>
                            <td>{program.approach || '—'}</td>
                          </tr>
                          <tr>
                            <th>Rezultat pe orizont</th>
                            <td>{program.horizonResult || '—'}</td>
                          </tr>
                          <tr>
                            <th>Obiective asociate</th>
                            <td>
                              <div className="badges">
                                {linked.length ? (
                                  linked.map((code) => (
                                    <span className="badge" key={code}>
                                      {code}
                                    </span>
                                  ))
                                ) : (
                                  <span className="muted-copy">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <th>Utilizat în</th>
                            <td>{program.usageCount} campanii</td>
                          </tr>
                        </tbody>
                      </table>

                      {isAdmin ? (
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => {
                            setEditing({ kind: 'programs', code: program.code });
                            setDraft({
                              name: program.name,
                              label: program.label,
                              result: program.result,
                              marketingObjective: program.marketingObjective,
                              approach: program.approach,
                              horizonResult: program.horizonResult,
                              targetGroups: program.targetGroups,
                              kpiText: program.kpiText,
                              sources: program.sources,
                              annualActions: program.annualActions,
                              validationStatus: program.validationStatus,
                            });
                          }}
                        >
                          Editează programul
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {tab === 'versions' ? (
        <section className="activation-list-card">
          <div className="activation-list-count">
            <strong>{versions.length} versiuni strategice</strong>
            <span>
              Codurile sunt unice per versiune: același cod poate însemna altceva într-un alt ciclu
              strategic, iar campaniile istorice își păstrează contextul.
            </span>
          </div>
          <div className="activation-table-scroll">
            <table className="activation-list-table">
              <thead>
                <tr>
                  <th>Versiune</th>
                  <th>Denumire</th>
                  <th>Perioadă</th>
                  <th>Stare</th>
                  <th>Campanii</th>
                  <th>Repere</th>
                  {isAdmin ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td>
                      <code>{version.id}</code>
                    </td>
                    <td>{version.label}</td>
                    <td>
                      {version.periodStartYear}–{version.periodEndYear}
                    </td>
                    <td>
                      <span className={version.status === 'ACTIVE' ? 'badge status' : 'badge'}>
                        {version.status}
                      </span>
                    </td>
                    <td>{version.campaignCount}</td>
                    <td>
                      {version.pillarCount} / {version.programCount} / {version.objectiveCount}
                    </td>
                    {isAdmin ? (
                      <td>
                        {version.status !== 'ACTIVE' ? (
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => void activateVersion(version.id)}
                          >
                            Activează
                          </button>
                        ) : (
                          <span className="muted-copy">versiunea curentă</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
