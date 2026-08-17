/**
 * Activation editor — create and edit.
 *
 * Tabbed like the prototype: Plan, Publicuri, Finanțare, Materiale, Indicatori.
 *
 * Two rules are visible in the UI rather than hidden in the backend:
 *   - an audience is either a catalog value or free text, never both, so the
 *     custom entry is a separate control (spec 21);
 *   - ticking "Inclusă în Planul anual" materialises plan relations for every
 *     year the period touches, which is why the hint mentions the years.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { formatMoney, overlapsYear } from '../../domain/services';
import { useCampaigns, useCatalogs, EMPTY_FILTERS } from '../campaigns/useCampaigns';

interface AudienceRow {
  code: string | null;
  customLabel: string | null;
}

interface FundingRow {
  typeCode: string;
  label: string;
  amount: number | string;
}

interface MaterialRow {
  id?: string;
  title: string;
  channel: string;
  format: string;
  budgetAllocated: string;
  runStartDate: string;
  runEndDate: string;
  publicUrl: string;
  copy: string;
  visualName: string;
}

interface KpiRow {
  id?: string;
  enabled: boolean;
  name: string;
  target: string;
  result: string;
  source: string;
  collection: string;
}

interface EditorState {
  title: string;
  campaignExternalKey: string | null;
  pillarCode: string | null;
  startDate: string;
  endDate: string;
  statusCode: string;
  responsible: string;
  plannedBudget: string;
  actualSpend: string;
  implementationModeCode: string;
  implementationPartners: string;
  objective: string;
  zone: string;
  message: string;
  landingUrl: string;
  resultSummary: string;
  whatWorked: string;
  recommendation: string;
  includeAnnualPlan: boolean;
  audiences: AudienceRow[];
  fundingSources: FundingRow[];
  materials: MaterialRow[];
  kpis: KpiRow[];
}

const EMPTY: EditorState = {
  title: '',
  campaignExternalKey: null,
  pillarCode: null,
  startDate: '',
  endDate: '',
  statusCode: 'DRAFT',
  responsible: '',
  plannedBudget: '',
  actualSpend: '',
  implementationModeCode: '',
  implementationPartners: '',
  objective: '',
  zone: '',
  message: '',
  landingUrl: '',
  resultSummary: '',
  whatWorked: '',
  recommendation: '',
  includeAnnualPlan: false,
  audiences: [],
  fundingSources: [],
  materials: [],
  kpis: [],
};

const TABS = ['Plan', 'Publicuri', 'Finanțare', 'Materiale', 'Indicatori'] as const;

export function ActivationEditor() {
  const { externalKey } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = Boolean(externalKey);

  const catalogs = useCatalogs();
  const { items: campaigns } = useCampaigns(EMPTY_FILTERS);

  const [form, setForm] = useState<EditorState>(() => ({
    ...EMPTY,
    // "＋ Activare" on a campaign card pre-selects that campaign.
    campaignExternalKey: searchParams.get('campaign'),
  }));
  const [tab, setTab] = useState<(typeof TABS)[number]>('Plan');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [customAudience, setCustomAudience] = useState('');

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!isEdit) return;
    api
      .get<any>(`/activations/${encodeURIComponent(externalKey!)}`)
      .then(({ data }) => {
        setVersion(typeof data.versionNumber === 'number' ? data.versionNumber : null);
        setForm({
          title: data.title ?? '',
          campaignExternalKey: data.campaignId ?? null,
          pillarCode: data.activationPillarCode ?? null,
          startDate: data.startDate ?? '',
          endDate: data.endDate ?? '',
          statusCode: data.statusCode ?? 'DRAFT',
          responsible: data.responsible ?? '',
          plannedBudget: data.plannedBudget == null ? '' : String(data.plannedBudget),
          actualSpend: data.actualSpend == null ? '' : String(data.actualSpend),
          implementationModeCode: data.implementationModeCode ?? '',
          implementationPartners: data.implementationPartners ?? '',
          objective: data.objective ?? '',
          zone: data.zone ?? '',
          message: data.message ?? '',
          landingUrl: data.landingUrl ?? '',
          resultSummary: data.resultSummary ?? '',
          whatWorked: data.whatWorked ?? '',
          recommendation: data.recommendation ?? '',
          includeAnnualPlan: Boolean(data.includeAnnualPlan),
          audiences: (data.audiences ?? []).map((a: any) => ({
            code: a.code ?? null,
            customLabel: a.code ? null : a.label,
          })),
          fundingSources: (data.fundingSources ?? []).map((f: any) => ({
            typeCode: f.typeCode ?? '',
            label: f.label ?? '',
            amount: f.amount ?? 0,
          })),
          materials: (data.materials ?? []).map((m: any) => ({
            id: m.id,
            title: m.title ?? '',
            channel: m.channel ?? '',
            format: m.format ?? '',
            budgetAllocated: m.budgetAllocated == null ? '' : String(m.budgetAllocated),
            runStartDate: m.runStartDate ?? '',
            runEndDate: m.runEndDate ?? '',
            publicUrl: m.publicUrl ?? '',
            copy: m.copy ?? '',
            visualName: m.visualName ?? '',
          })),
          kpis: (data.kpis ?? []).map((k: any) => ({
            id: k.id,
            enabled: Boolean(k.enabled),
            name: k.name ?? '',
            target: k.target ?? '',
            result: k.result ?? '',
            source: k.source ?? '',
            collection: k.collection ?? '',
          })),
        });
      })
      .catch((caught: unknown) =>
        setMessage(caught instanceof ApiError ? caught.message : 'Activarea nu a putut fi încărcată.'),
      )
      .finally(() => setLoading(false));
  }, [externalKey, isEdit]);

  /** Years the plan relations will cover — shown so the effect is not a surprise. */
  const planYears = useMemo(() => {
    if (!form.startDate || !form.endDate) return [];
    const first = Number(form.startDate.slice(0, 4));
    const last = Number(form.endDate.slice(0, 4));
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }, [form.startDate, form.endDate]);

  const fundingTotal = form.fundingSources.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

  async function save() {
    if (!form.title.trim()) {
      setTab('Plan');
      setMessage('Completează denumirea activării.');
      return;
    }
    if (!form.startDate || !form.endDate) {
      setTab('Plan');
      setMessage('Completează perioada activării.');
      return;
    }
    if (form.endDate < form.startDate) {
      setTab('Plan');
      setMessage('Data de final trebuie să fie după data de început.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        ...form,
        campaignExternalKey: form.campaignExternalKey || null,
        implementationModeCode: form.implementationModeCode || null,
        pillarCode: form.campaignExternalKey ? null : form.pillarCode,
        plannedBudget: form.plannedBudget === '' ? null : form.plannedBudget,
        actualSpend: form.actualSpend === '' ? null : form.actualSpend,
        materials: form.materials.filter((m) => m.title.trim()),
        kpis: form.kpis.filter((k) => k.name.trim()),
        audiences: form.audiences.filter((a) => a.code || a.customLabel?.trim()),
      };

      if (isEdit) {
        await api.put(`/activations/${encodeURIComponent(externalKey!)}`, payload, {
          'If-Match': `"${version ?? 0}"`,
        });
        navigate(`/activations/${externalKey}`);
      } else {
        const created = await api.post<{ id: string }>('/activations', payload);
        navigate(`/activations/${created.data.id}`);
      }
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Activarea nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="state-note">Se încarcă activarea…</div>;

  const activeCampaigns = campaigns.filter((c) => c.statusCode === 'ACTIVE');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{isEdit ? 'Editează activarea' : 'Activare nouă'}</h1>
          <p>{form.title || 'Fișă operațională'}</p>
        </div>
        <div className="actions">
          <button className="btn secondary" type="button" onClick={() => navigate('/activations')}>
            Renunță
          </button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Se salvează…' : 'Salvează'}
          </button>
        </div>
      </header>

      <div className="wizard-steps">
        {TABS.map((entry, index) => (
          <button
            key={entry}
            type="button"
            className={entry === tab ? 'wizard-step active' : 'wizard-step'}
            onClick={() => setTab(entry)}
          >
            <b>{index + 1}</b>
            <span>{entry}</span>
          </button>
        ))}
      </div>

      {message ? (
        <div className="state-note error" role="alert">
          {message}
        </div>
      ) : null}

      <div className="wizard-body">
        {tab === 'Plan' ? (
          <>
            <label className="form-field">
              <span className="form-label">Denumirea activării</span>
              <input value={form.title} onChange={(e) => set('title', e.target.value)} />
            </label>

            <label className="form-field">
              <span className="form-label">
                Campanie<small>Doar campaniile Active pot genera activări noi</small>
              </span>
              <select
                value={form.campaignExternalKey ?? ''}
                onChange={(e) => set('campaignExternalKey', e.target.value || null)}
              >
                <option value="">Activare independentă</option>
                {(isEdit ? campaigns : activeCampaigns).map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.title}
                  </option>
                ))}
              </select>
            </label>

            {/* Pillar only matters without a campaign to inherit the frame from. */}
            {!form.campaignExternalKey ? (
              <label className="form-field">
                <span className="form-label">Pilon (activare independentă)</span>
                <select
                  value={form.pillarCode ?? ''}
                  onChange={(e) => set('pillarCode', e.target.value || null)}
                >
                  <option value="">Nespecificat</option>
                  {(catalogs?.pillars ?? []).map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.displayLabel ?? entry.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="editor-row">
              <label className="form-field">
                <span className="form-label">Început</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </label>
              <label className="form-field">
                <span className="form-label">Final</span>
                <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
              </label>
            </div>

            <div className="editor-row">
              <label className="form-field">
                <span className="form-label">Stadiu</span>
                <select value={form.statusCode} onChange={(e) => set('statusCode', e.target.value)}>
                  {(catalogs?.campaign_statuses ?? []).map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Responsabil</span>
                <input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
              </label>
            </div>

            <div className="editor-row">
              <label className="form-field">
                <span className="form-label">Buget planificat (lei)</span>
                <input
                  type="number"
                  value={form.plannedBudget}
                  onChange={(e) => set('plannedBudget', e.target.value)}
                />
              </label>
              <label className="form-field">
                <span className="form-label">Cheltuit (lei)</span>
                <input
                  type="number"
                  value={form.actualSpend}
                  onChange={(e) => set('actualSpend', e.target.value)}
                />
              </label>
            </div>

            <div className="editor-row">
              <label className="form-field">
                <span className="form-label">Mod de implementare</span>
                <select
                  value={form.implementationModeCode}
                  onChange={(e) => set('implementationModeCode', e.target.value)}
                >
                  <option value="">Nespecificat</option>
                  {(catalogs?.implementation_modes ?? []).map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Parteneri</span>
                <input
                  value={form.implementationPartners}
                  onChange={(e) => set('implementationPartners', e.target.value)}
                />
              </label>
            </div>

            <label className="form-field">
              <span className="form-label">Obiectiv operațional</span>
              <textarea rows={2} value={form.objective} onChange={(e) => set('objective', e.target.value)} />
            </label>

            <label className="form-field">
              <span className="form-label">Mesaj</span>
              <textarea rows={2} value={form.message} onChange={(e) => set('message', e.target.value)} />
            </label>

            <div className="editor-row">
              <label className="form-field">
                <span className="form-label">Zonă</span>
                <input value={form.zone} onChange={(e) => set('zone', e.target.value)} />
              </label>
              <label className="form-field">
                <span className="form-label">Landing URL</span>
                <input value={form.landingUrl} onChange={(e) => set('landingUrl', e.target.value)} />
              </label>
            </div>

            <label className="quick-filter">
              <input
                type="checkbox"
                checked={form.includeAnnualPlan}
                onChange={(e) => set('includeAnnualPlan', e.target.checked)}
              />
              <span>
                Inclusă în Planul anual
                {planYears.length ? ` — se va adăuga la ${planYears.join(', ')}` : ''}
              </span>
            </label>
          </>
        ) : null}

        {tab === 'Publicuri' ? (
          <>
            <div className="form-field">
              <span className="form-label">
                Publicuri din nomenclator<small>Apasă pentru a selecta</small>
              </span>
              <div className="badges picker">
                {(catalogs?.audience_segments ?? []).map((entry) => {
                  const selected = form.audiences.some((a) => a.code === entry.code);
                  return (
                    <button
                      key={entry.code}
                      type="button"
                      className={selected ? 'badge status' : 'badge'}
                      onClick={() =>
                        set(
                          'audiences',
                          selected
                            ? form.audiences.filter((a) => a.code !== entry.code)
                            : [...form.audiences, { code: entry.code, customLabel: null }],
                        )
                      }
                    >
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom audiences stay custom — they never create a catalog entry. */}
            <div className="form-field">
              <span className="form-label">
                Public personalizat
                <small>Rămâne doar pe această activare, fără cod de nomenclator</small>
              </span>
              <div className="editor-row">
                <input
                  value={customAudience}
                  placeholder="ex. Public regional și vizitatori de weekend"
                  onChange={(e) => setCustomAudience(e.target.value)}
                />
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    const label = customAudience.trim();
                    if (!label) return;
                    set('audiences', [...form.audiences, { code: null, customLabel: label }]);
                    setCustomAudience('');
                  }}
                >
                  ＋ Adaugă
                </button>
              </div>
            </div>

            <div className="form-field">
              <span className="form-label">Publicuri selectate</span>
              <div className="badges">
                {form.audiences.length ? (
                  form.audiences.map((audience, index) => (
                    <span key={index} className={audience.code ? 'badge' : 'badge season'}>
                      {audience.code
                        ? (catalogs?.audience_segments ?? []).find((e) => e.code === audience.code)
                            ?.label ?? audience.code
                        : audience.customLabel}
                      <button
                        type="button"
                        className="badge-remove"
                        aria-label="Elimină"
                        onClick={() =>
                          set(
                            'audiences',
                            form.audiences.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="muted-copy">Niciun public selectat.</span>
                )}
              </div>
            </div>
          </>
        ) : null}

        {tab === 'Finanțare' ? (
          <div className="form-field">
            <span className="form-label">
              Surse de finanțare<small>Total: {formatMoney(fundingTotal, '0 lei')}</small>
            </span>
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Tip</th>
                  <th>Denumire</th>
                  <th>Sumă</th>
                  <th />
                </tr>
                {form.fundingSources.map((source, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        value={source.typeCode}
                        onChange={(e) => {
                          const next = [...form.fundingSources];
                          next[index] = { ...source, typeCode: e.target.value };
                          set('fundingSources', next);
                        }}
                      >
                        <option value="">Selectează</option>
                        {(catalogs?.funding_types ?? []).map((entry) => (
                          <option key={entry.code} value={entry.code}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={source.label}
                        onChange={(e) => {
                          const next = [...form.fundingSources];
                          next[index] = { ...source, label: e.target.value };
                          set('fundingSources', next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={source.amount}
                        onChange={(e) => {
                          const next = [...form.fundingSources];
                          next[index] = { ...source, amount: e.target.value };
                          set('fundingSources', next);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() =>
                          set(
                            'fundingSources',
                            form.fundingSources.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Elimină
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                set('fundingSources', [...form.fundingSources, { typeCode: '', label: '', amount: 0 }])
              }
            >
              ＋ Adaugă sursă
            </button>
          </div>
        ) : null}

        {tab === 'Materiale' ? (
          <div className="form-field">
            <span className="form-label">
              Materiale<small>Materialele cu rezultate importate nu se șterg definitiv</small>
            </span>
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Denumire</th>
                    <th>Canal</th>
                    <th>Format</th>
                    <th>Început</th>
                    <th>Final</th>
                    <th>Buget</th>
                    <th>Link public</th>
                    <th />
                  </tr>
                  {form.materials.map((material, index) => {
                    const patch = (changes: Partial<MaterialRow>) => {
                      const next = [...form.materials];
                      next[index] = { ...material, ...changes };
                      set('materials', next);
                    };
                    return (
                      <tr key={index}>
                        <td>
                          <input value={material.title} onChange={(e) => patch({ title: e.target.value })} />
                        </td>
                        <td>
                          <select value={material.channel} onChange={(e) => patch({ channel: e.target.value })}>
                            <option value="">—</option>
                            {(catalogs?.activation_channels ?? []).map((entry) => (
                              <option key={entry.code} value={entry.label}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input value={material.format} onChange={(e) => patch({ format: e.target.value })} />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={material.runStartDate}
                            onChange={(e) => patch({ runStartDate: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={material.runEndDate}
                            onChange={(e) => patch({ runEndDate: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={material.budgetAllocated}
                            onChange={(e) => patch({ budgetAllocated: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            value={material.publicUrl}
                            onChange={(e) => patch({ publicUrl: e.target.value })}
                          />
                        </td>
                        <td>
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() =>
                              set(
                                'materials',
                                form.materials.filter((_, i) => i !== index),
                              )
                            }
                          >
                            Elimină
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                set('materials', [
                  ...form.materials,
                  {
                    title: '', channel: '', format: '', budgetAllocated: '',
                    runStartDate: '', runEndDate: '', publicUrl: '', copy: '', visualName: '',
                  },
                ])
              }
            >
              ＋ Adaugă material
            </button>
          </div>
        ) : null}

        {tab === 'Indicatori' ? (
          <div className="form-field">
            <span className="form-label">Indicatori</span>
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Activ</th>
                    <th>Indicator</th>
                    <th>Țintă</th>
                    <th>Rezultat</th>
                    <th>Sursă</th>
                    <th>Colectare</th>
                    <th />
                  </tr>
                  {form.kpis.map((kpi, index) => {
                    const patch = (changes: Partial<KpiRow>) => {
                      const next = [...form.kpis];
                      next[index] = { ...kpi, ...changes };
                      set('kpis', next);
                    };
                    return (
                      <tr key={index}>
                        <td>
                          <input
                            type="checkbox"
                            checked={kpi.enabled}
                            onChange={(e) => patch({ enabled: e.target.checked })}
                          />
                        </td>
                        {(['name', 'target', 'result', 'source', 'collection'] as const).map((field) => (
                          <td key={field}>
                            <input value={kpi[field]} onChange={(e) => patch({ [field]: e.target.value })} />
                          </td>
                        ))}
                        <td>
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() =>
                              set(
                                'kpis',
                                form.kpis.filter((_, i) => i !== index),
                              )
                            }
                          >
                            Elimină
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                set('kpis', [
                  ...form.kpis,
                  { enabled: true, name: '', target: '', result: '', source: '', collection: '' },
                ])
              }
            >
              ＋ Adaugă indicator
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
