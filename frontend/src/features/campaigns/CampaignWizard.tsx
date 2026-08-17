/**
 * Campaign wizard — the port of the prototype's `form.js`.
 *
 * Eight steps, the same fields, the same per-step validation messages. The
 * prototype held state in module-level variables and re-rendered by rewriting
 * innerHTML; here it is a single state object and controlled inputs.
 *
 * On save it POSTs (create) or PUTs with If-Match (edit), so a concurrent edit
 * surfaces as 409 STALE_VERSION rather than silently overwriting.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { useCatalogs, type CatalogEntry } from './useCampaigns';
import {
  MONTH_LABELS,
  STEPS,
  emptyForm,
  toApiPayload,
  validateStep,
  type CampaignFormState,
} from './campaignForm';

type Setter = <K extends keyof CampaignFormState>(key: K, value: CampaignFormState[K]) => void;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span className="form-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

/** Comma/newline separated text mapped onto a string array. */
function ListField({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label={label} hint={hint ?? 'Un element pe linie'}>
      <textarea
        rows={4}
        value={values.join('\n')}
        onChange={(event) =>
          onChange(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))
        }
      />
    </Field>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: CatalogEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);

  return (
    <Field label={label} hint="Selectează una sau mai multe valori">
      <div className="badges picker">
        {options.map((option) => (
          <button
            key={option.code}
            type="button"
            className={selected.includes(option.code) ? 'badge status' : 'badge'}
            onClick={() => toggle(option.code)}
          >
            {option.displayLabel ?? option.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function CampaignWizard() {
  const { externalKey } = useParams();
  const navigate = useNavigate();
  const catalogs = useCatalogs();
  const isEdit = Boolean(externalKey);

  const [form, setForm] = useState<CampaignFormState>(() => emptyForm({}));
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(isEdit);

  const set: Setter = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // Defaults come from the database, never hardcoded (rule 68.14).
  useEffect(() => {
    if (!catalogs || isEdit) return;
    setForm((current) =>
      current.campaignTypeCode
        ? current
        : {
            ...current,
            campaignTypeCode: catalogs.campaign_types[0]?.code ?? '',
            seasonalityTypeCode: catalogs.seasonality_types?.[0]?.code ?? '',
          },
    );
  }, [catalogs, isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get<Record<string, any>>(`/campaigns/${encodeURIComponent(externalKey!)}`)
      .then((response) => {
        const d = response.data as Record<string, any>;
        setVersion(typeof d.versionNumber === 'number' ? d.versionNumber : null);
        setForm((current) => ({ ...current, ...mapDetailToForm(d) }));
      })
      .catch((caught: unknown) =>
        setMessage(caught instanceof ApiError ? caught.message : 'Campania nu a putut fi încărcată.'),
      )
      .finally(() => setLoading(false));
  }, [externalKey, isEdit]);

  const types = catalogs?.campaign_types ?? [];
  const typeLabel = useMemo(
    () => types.find((entry) => entry.code === form.campaignTypeCode)?.label ?? '',
    [types, form.campaignTypeCode],
  );
  const isUmbrella = typeLabel.includes('umbrelă');

  function goNext() {
    const problem = validateStep(step, form, types);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(null);
    setStep((current) => Math.min(STEPS.length, current + 1));
  }

  async function save() {
    for (let index = 1; index <= STEPS.length; index += 1) {
      const problem = validateStep(index, form, types);
      if (problem) {
        setStep(index);
        setMessage(problem);
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = toApiPayload(form);
      if (isEdit) {
        await api.put(`/campaigns/${encodeURIComponent(externalKey!)}`, payload, {
          // Guards against overwriting a concurrent edit (spec 18).
          'If-Match': `"${version ?? 0}"`,
        });
        navigate(`/campaigns/${externalKey}`);
      } else {
        const created = await api.post<{ id: string }>('/campaigns', payload);
        navigate(`/campaigns/${created.data.id}`);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'STALE_VERSION') {
        setMessage(`${caught.message}`);
      } else {
        setMessage(caught instanceof ApiError ? caught.message : 'Campania nu a putut fi salvată.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="state-note">Se încarcă campania…</div>;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{isEdit ? 'Editează campania' : 'Campanie nouă'}</h1>
          <p>
            Pasul {step} din {STEPS.length} · {STEPS[step - 1]!.title} — {STEPS[step - 1]!.hint}
          </p>
        </div>
        <div className="actions">
          <button className="btn secondary" type="button" onClick={() => navigate('/campaigns')}>
            Renunță
          </button>
        </div>
      </header>

      <div className="wizard-steps">
        {STEPS.map((entry, index) => (
          <button
            key={entry.title}
            type="button"
            className={index + 1 === step ? 'wizard-step active' : 'wizard-step'}
            onClick={() => setStep(index + 1)}
          >
            <b>{index + 1}</b>
            <span>{entry.title}</span>
          </button>
        ))}
      </div>

      {message ? (
        <div className="state-note error" role="alert">
          {message}
        </div>
      ) : null}

      <div className="wizard-body">
        {step === 1 ? (
          <>
            <Field label="Denumirea campaniei">
              <input value={form.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Tipul campaniei">
              <select
                value={form.campaignTypeCode}
                onChange={(e) => set('campaignTypeCode', e.target.value)}
              >
                {types.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.displayLabel ?? entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pilon strategic">
              <select value={form.pillarCode} onChange={(e) => set('pillarCode', e.target.value)}>
                <option value="">Selectează pilonul</option>
                {(catalogs?.pillars ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.displayLabel ?? entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tip sezonalitate">
              <select
                value={form.seasonalityTypeCode}
                onChange={(e) => set('seasonalityTypeCode', e.target.value)}
              >
                {(catalogs?.seasonality_types ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Luni de relevanță" hint="Selectează lunile în care campania este activă">
              <div className="badges picker">
                {MONTH_LABELS.map((month, index) => {
                  const value = index + 1;
                  const active = form.seasonalityMonths.includes(value);
                  return (
                    <button
                      key={month}
                      type="button"
                      className={active ? 'badge status' : 'badge'}
                      onClick={() =>
                        set(
                          'seasonalityMonths',
                          active
                            ? form.seasonalityMonths.filter((m) => m !== value)
                            : [...form.seasonalityMonths, value].sort((a, b) => a - b),
                        )
                      }
                    >
                      {month}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Observații sezonalitate">
              <textarea
                rows={2}
                value={form.seasonalityNote}
                onChange={(e) => set('seasonalityNote', e.target.value)}
              />
            </Field>
            <Field label="Responsabil">
              <input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
            </Field>
            <Field label="Stadiu">
              <select value={form.statusCode} onChange={(e) => set('statusCode', e.target.value)}>
                {(catalogs?.campaign_statuses ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Field label="Program principal">
              <select
                value={form.programPrimaryCode}
                onChange={(e) => set('programPrimaryCode', e.target.value)}
              >
                <option value="">Selectează programul</option>
                {(catalogs?.programs ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <MultiSelect
              label="Programe secundare"
              options={catalogs?.programs ?? []}
              selected={form.programSecondaryCodes}
              onChange={(next) => set('programSecondaryCodes', next)}
            />
            <Field label="Obiectiv SMART principal">
              <select
                value={form.objectivePrimaryCode}
                onChange={(e) => set('objectivePrimaryCode', e.target.value)}
              >
                <option value="">Selectează obiectivul</option>
                {(catalogs?.objectives ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <MultiSelect
              label="Obiective secundare"
              options={catalogs?.objectives ?? []}
              selected={form.objectiveSecondaryCodes}
              onChange={(next) => set('objectiveSecondaryCodes', next)}
            />
            <Field label="Obiectiv de marketing">
              <textarea
                rows={3}
                value={form.marketingObjective}
                onChange={(e) => set('marketingObjective', e.target.value)}
              />
            </Field>
            <Field label="Rezultat direct urmărit">
              <textarea
                rows={3}
                value={form.directResult}
                onChange={(e) => set('directResult', e.target.value)}
              />
            </Field>
            <ListField
              label="Contribuție strategică"
              values={form.strategicContribution}
              onChange={(next) => set('strategicContribution', next)}
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Field label="Public principal">
              <select
                value={form.primaryAudienceCode}
                onChange={(e) => set('primaryAudienceCode', e.target.value)}
              >
                <option value="">Selectează publicul principal</option>
                {(catalogs?.audience_segments ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <MultiSelect
              label="Publicuri secundare"
              options={catalogs?.audience_segments ?? []}
              selected={form.secondaryAudienceCodes}
              onChange={(next) => set('secondaryAudienceCodes', next)}
            />
            <Field label="Descrierea publicului principal">
              <textarea
                rows={3}
                value={form.primaryAudienceDescription}
                onChange={(e) => set('primaryAudienceDescription', e.target.value)}
              />
            </Field>
            <Field label="Insight și motivație">
              <textarea rows={3} value={form.insight} onChange={(e) => set('insight', e.target.value)} />
            </Field>
            <Field label="Propunerea de valoare">
              <textarea
                rows={3}
                value={form.valueProposition}
                onChange={(e) => set('valueProposition', e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Field label="Ideea centrală">
              <textarea rows={3} value={form.centralIdea} onChange={(e) => set('centralIdea', e.target.value)} />
            </Field>
            <Field label="Promisiunea campaniei">
              <textarea rows={2} value={form.promise} onChange={(e) => set('promise', e.target.value)} />
            </Field>
            <Field label="Mesajul principal">
              <textarea rows={3} value={form.mainMessage} onChange={(e) => set('mainMessage', e.target.value)} />
            </Field>
            <ListField
              label="Mesaje secundare"
              values={form.secondaryMessages}
              onChange={(next) => set('secondaryMessages', next)}
            />
            <ListField
              label="Direcții de storytelling"
              values={form.storytellingDirections}
              onChange={(next) => set('storytellingDirections', next)}
            />
            <Field label="Tonul comunicării">
              <input value={form.tone} onChange={(e) => set('tone', e.target.value)} />
            </Field>
            <MultiSelect
              label="CTA-uri"
              options={catalogs?.cta_types ?? []}
              selected={form.ctaCodes}
              onChange={(next) => set('ctaCodes', next)}
            />
          </>
        ) : null}

        {step === 5 ? (
          <>
            <ListField
              label="Produse și experiențe promovate"
              values={form.products}
              onChange={(next) => set('products', next)}
            />
            <Field label="Introducere produse">
              <textarea rows={2} value={form.productsIntro} onChange={(e) => set('productsIntro', e.target.value)} />
            </Field>
            <Field label="Condiții de utilizare">
              <textarea
                rows={2}
                value={form.productCondition}
                onChange={(e) => set('productCondition', e.target.value)}
              />
            </Field>
            <ListField
              label="Canale recomandate"
              values={form.channels}
              onChange={(next) => set('channels', next)}
            />
            <Field label="PR și parteneriate">
              <textarea rows={2} value={form.prPartnerships} onChange={(e) => set('prPartnerships', e.target.value)} />
            </Field>

            <div className="form-field">
              <span className="form-label">
                Indicatori și surse<small>Cel puțin un indicator cu sursă completată</small>
              </span>
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Indicator</th>
                    <th>Referință</th>
                    <th>Țintă</th>
                    <th>Sursă</th>
                  </tr>
                  {form.kpiDefinitions.map((kpi, index) => (
                    <tr key={index}>
                      {(['name', 'baseline', 'target', 'source'] as const).map((field) => (
                        <td key={field}>
                          <input
                            value={kpi[field]}
                            onChange={(e) => {
                              const next = [...form.kpiDefinitions];
                              next[index] = { ...kpi, [field]: e.target.value };
                              set('kpiDefinitions', next);
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="btn secondary"
                type="button"
                onClick={() =>
                  set('kpiDefinitions', [
                    ...form.kpiDefinitions,
                    { name: '', baseline: '', target: '', source: '' },
                  ])
                }
              >
                ＋ Adaugă indicator
              </button>
            </div>
          </>
        ) : null}

        {step === 6 ? (
          <>
            <ListField
              label="Elemente fixe"
              values={form.fixedElements}
              onChange={(next) => set('fixedElements', next)}
            />
            <ListField
              label="Elemente adaptabile"
              values={form.adaptableElements}
              onChange={(next) => set('adaptableElements', next)}
            />
            <ListField
              label="Limite de adaptare"
              values={form.adaptationLimits}
              onChange={(next) => set('adaptationLimits', next)}
            />
            <div className="form-field">
              <span className="form-label">Exemple de aplicare</span>
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Context</th>
                    <th>Adaptare recomandată</th>
                    <th>Elemente fixe</th>
                  </tr>
                  {form.applicationExamples.map((example, index) => (
                    <tr key={index}>
                      {(['context', 'adaptation', 'fixed'] as const).map((field) => (
                        <td key={field}>
                          <input
                            value={example[field]}
                            onChange={(e) => {
                              const next = [...form.applicationExamples];
                              next[index] = { ...example, [field]: e.target.value };
                              set('applicationExamples', next);
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="btn secondary"
                type="button"
                onClick={() =>
                  set('applicationExamples', [
                    ...form.applicationExamples,
                    { context: '', adaptation: '', fixed: '' },
                  ])
                }
              >
                ＋ Adaugă exemplu
              </button>
            </div>
          </>
        ) : null}

        {step === 7 ? (
          isUmbrella ? (
            <>
              <Field label="Introducere livrabile">
                <textarea
                  rows={3}
                  value={form.deliverableIntro}
                  onChange={(e) => set('deliverableIntro', e.target.value)}
                />
              </Field>
              <div className="form-field">
                <span className="form-label">Livrabile de cadru</span>
                <table className="table wide">
                  <tbody>
                    <tr>
                      <th>Livrabil</th>
                      <th>Conținut orientativ</th>
                      <th>Format</th>
                    </tr>
                    {form.frameworkDeliverables.map((item, index) => (
                      <tr key={index}>
                        {(['name', 'content', 'format'] as const).map((field) => (
                          <td key={field}>
                            <input
                              value={item[field]}
                              onChange={(e) => {
                                const next = [...form.frameworkDeliverables];
                                next[index] = { ...item, [field]: e.target.value };
                                set('frameworkDeliverables', next);
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() =>
                    set('frameworkDeliverables', [
                      ...form.frameworkDeliverables,
                      { name: '', content: '', format: '' },
                    ])
                  }
                >
                  ＋ Adaugă livrabil
                </button>
              </div>
              <Field label="Notă privind lipsa machetelor">
                <textarea
                  rows={2}
                  value={form.noVisualsNote}
                  onChange={(e) => set('noVisualsNote', e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="form-field">
                <span className="form-label">Headline-uri</span>
                <table className="table wide">
                  <tbody>
                    <tr>
                      <th>Headline</th>
                      <th>Text suport</th>
                      <th>CTA</th>
                    </tr>
                    {form.headlines.map((item, index) => (
                      <tr key={index}>
                        {(['headline', 'support', 'cta'] as const).map((field) => (
                          <td key={field}>
                            <input
                              value={item[field]}
                              onChange={(e) => {
                                const next = [...form.headlines];
                                next[index] = { ...item, [field]: e.target.value };
                                set('headlines', next);
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => set('headlines', [...form.headlines, { headline: '', support: '', cta: '' }])}
                >
                  ＋ Adaugă headline
                </button>
              </div>

              <div className="form-field">
                <span className="form-label">
                  Direcții de machetă<small>Vizualurile se încarcă după salvare</small>
                </span>
                <table className="table wide">
                  <tbody>
                    <tr>
                      <th>Denumire</th>
                      <th>Formate</th>
                      <th>Structură</th>
                    </tr>
                    {form.mockups.map((item, index) => (
                      <tr key={index}>
                        {(['name', 'formats', 'structure'] as const).map((field) => (
                          <td key={field}>
                            <input
                              value={item[field]}
                              onChange={(e) => {
                                const next = [...form.mockups];
                                next[index] = { ...item, [field]: e.target.value };
                                set('mockups', next);
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() =>
                    set('mockups', [...form.mockups, { name: '', formats: '', structure: '', canvaUrl: '' }])
                  }
                >
                  ＋ Adaugă machetă
                </button>
              </div>
            </>
          )
        ) : null}

        {step === 8 ? (
          <div className="form-field">
            <span className="form-label">
              Exemple orientative de activări<small>Cel puțin un exemplu cu denumire și scop</small>
            </span>
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Denumire</th>
                  <th>Scop și public</th>
                  <th>Canale / materiale</th>
                  <th>Indicatori</th>
                </tr>
                {form.activationDirections.map((item, index) => (
                  <tr key={index}>
                    {(['name', 'purpose', 'channels', 'metrics'] as const).map((field) => (
                      <td key={field}>
                        <input
                          value={item[field]}
                          onChange={(e) => {
                            const next = [...form.activationDirections];
                            next[index] = { ...item, [field]: e.target.value };
                            set('activationDirections', next);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                set('activationDirections', [
                  ...form.activationDirections,
                  { name: '', purpose: '', channels: '', metrics: '' },
                ])
              }
            >
              ＋ Adaugă exemplu
            </button>
          </div>
        ) : null}
      </div>

      <div className="wizard-actions">
        <button
          className="btn secondary"
          type="button"
          disabled={step === 1}
          onClick={() => {
            setMessage(null);
            setStep((current) => Math.max(1, current - 1));
          }}
        >
          ← Înapoi
        </button>

        {step < STEPS.length ? (
          <button className="btn primary" type="button" onClick={goNext}>
            Continuă →
          </button>
        ) : (
          <button className="btn primary" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Se salvează…' : isEdit ? 'Salvează modificările' : 'Salvează campania'}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Detail DTO -> wizard state.
 *
 * Binds to CODES, never to labels. The API returns both; the label is only for
 * display and an Admin may rename it, so matching on it would silently lose the
 * selection. Every editable collection is restored, so opening an existing
 * campaign never asks the user to re-pick what is already stored.
 */
function mapDetailToForm(detail: Record<string, any>): Partial<CampaignFormState> {
  const arr = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');

  return {
    title: str(detail.title),
    campaignTypeCode: str(detail.typeCode),
    statusCode: str(detail.statusCode) || 'DRAFT',
    pillarCode: str(detail.pillarCode),
    seasonalityTypeCode: str(detail.seasonalityTypeCode),
    seasonalityMonths: arr<number>(detail.seasonalityMonths),
    seasonalityNote: str(detail.seasonalityNote),
    responsible: str(detail.responsible),
    accent: str(detail.accent) || 'umbrella',
    version: str(detail.version),
    parentCampaignExternalKey: detail.parentCampaignId ?? null,

    // Selections that previously had to be re-picked by hand.
    programPrimaryCode: str(detail.programPrimaryCode),
    programSecondaryCodes: arr<string>(detail.programSecondaryCodes),
    objectivePrimaryCode: str(detail.objectivePrimaryCode),
    objectiveSecondaryCodes: arr<string>(detail.objectiveSecondaryCodes),
    primaryAudienceCode: str(detail.primaryAudienceCode),
    secondaryAudienceCodes: arr<string>(detail.secondaryAudienceCodes),
    ctaCodes: arr<string>(detail.ctaCodes),

    marketingObjective: str(detail.marketingObjective),
    directResult: str(detail.directResult),
    strategicContribution: arr<string>(detail.strategicContribution),
    primaryAudienceDescription: str(detail.primaryAudienceDescription),
    insight: str(detail.insight),
    valueProposition: str(detail.valueProposition),
    centralIdea: str(detail.centralIdea),
    promise: str(detail.promise),
    mainMessage: str(detail.mainMessage),
    secondaryMessages: arr<string>(detail.secondaryMessages),
    storytellingDirections: arr<string>(detail.storytellingDirections),
    tone: str(detail.tone),
    products: arr<string>(detail.products),
    productsIntro: str(detail.productsIntro),
    productCondition: str(detail.productCondition),
    channels: arr<string>(detail.channels),
    prPartnerships: str(detail.prPartnerships),
    fixedElements: arr<string>(detail.fixedElements),
    adaptableElements: arr<string>(detail.adaptableElements),
    adaptationLimits: arr<string>(detail.adaptationLimits),
    deliverableIntro: str(detail.deliverableIntro),
    noVisualsNote: str(detail.noVisualsNote),

    // Repeatable tables. An empty row is appended so there is always somewhere
    // to type, matching the prototype's behaviour.
    kpiDefinitions: [
      ...arr<any>(detail.kpiDefinitions).map((k) => ({
        name: str(k.name), baseline: str(k.baseline), target: str(k.target), source: str(k.source),
      })),
      { name: '', baseline: '', target: '', source: '' },
    ],
    applicationExamples: [
      ...arr<any>(detail.applicationExamples).map((x) => ({
        context: str(x.context), adaptation: str(x.adaptation), fixed: str(x.fixed),
      })),
      { context: '', adaptation: '', fixed: '' },
    ],
    headlines: [
      ...arr<any>(detail.headlines).map((h) => ({
        headline: str(h.headline), support: str(h.support), cta: str(h.cta),
      })),
      { headline: '', support: '', cta: '' },
    ],
    frameworkDeliverables: [
      ...arr<any>(detail.frameworkDeliverables).map((d) => ({
        name: str(d.name), content: str(d.content), format: str(d.format),
      })),
      { name: '', content: '', format: '' },
    ],
    posts: arr<any>(detail.posts).map((x) => ({
      title: str(x.title), body: str(x.body), cta: str(x.cta),
    })),
    videoConcepts: arr<any>(detail.videoConcepts).map((x) => ({
      name: str(x.name), duration: str(x.duration), narrative: str(x.narrative), closing: str(x.closing),
    })),
    mockups: [
      ...arr<any>(detail.mockups).map((m) => ({
        name: str(m.name), formats: str(m.formats), structure: str(m.structure), canvaUrl: str(m.canvaUrl),
      })),
      { name: '', formats: '', structure: '', canvaUrl: '' },
    ],
    activationDirections: [
      ...arr<any>(detail.activationExamples?.directions).map((d) => ({
        name: str(d.name), purpose: str(d.purpose), channels: str(d.channels), metrics: str(d.metrics),
      })),
      { name: '', purpose: '', channels: '', metrics: '' },
    ],
  };
}
