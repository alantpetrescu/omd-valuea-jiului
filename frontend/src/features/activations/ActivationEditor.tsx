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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import {
  calculateCTR,
  calculateEngagementRate,
  calculateInteractions,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  overlapsYear,
} from '../../domain/services';
import { useCampaigns, useCatalogs, EMPTY_FILTERS } from '../campaigns/useCampaigns';
import {
  CampaignBlocks,
  type CampaignActivation,
  type CampaignDetail,
} from '../campaigns/CampaignDetailPage';

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
  otherChannel: string;
  publicUrl: string;
  copy: string;
  visualName: string;
  visualCanvaUrl: string;
  platformExternalId: string;
  /**
   * The stored image, when the material has one — read-only here.
   *
   * Resolved server-side from the material's own asset or the campaign template
   * asset it reuses. It is shown, never edited: there is no upload endpoint in
   * either backend. Carrying it in the form is harmless because the write path
   * picks its keys explicitly and ignores anything else.
   */
  visualUrl: string | null;
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
  products: string[];
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
  products: [],
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

/**
 * The prototype's `tabs` array, verbatim — id, title, hint. The hints are shown
 * under each step in the left nav, so they are part of the layout, not
 * decoration.
 */
const TABS = [
  ['plan', 'Planificare', 'Perioadă, resurse și plan anual'],
  ['custom', 'Particularizare', 'Publicuri, produse și mesaj'],
  ['materials', 'Materiale și canale', 'Vizualuri finale, Canva și linkuri'],
  ['results', 'KPI și rezultate', 'Rezultate social + KPI manuali'],
  ['conclusions', 'Concluzii', 'Lecții și recomandare'],
] as const;

/**
 * The five steps plus `campaign`, a hidden sixth reachable only from the
 * header's "Vezi campania cap-coadă". The prototype does the same: it is a
 * reading mode inside the form, not a step of the flow, so it stays out of the
 * left nav and out of the numbering.
 */
type TabId = (typeof TABS)[number][0] | 'campaign';

/** Free-text in the DB; the prototype offers exactly these five. */
/** The context panel's six rows, in the prototype's order. */
const CONTEXT_FIELDS: Array<[string, string]> = [
  ['Pilon', 'pillar'],
  ['Obiectiv strategic', 'objectivePrimary'],
  ['Ideea centrală', 'centralIdea'],
  ['Promisiunea', 'promise'],
  ['Mesaj principal', 'mainMessage'],
  ['Ton', 'tone'],
];

/** A blank material, as `addMaterial` in the prototype creates it. */
const EMPTY_MATERIAL: MaterialRow = {
  title: '',
  channel: '',
  otherChannel: '',
  format: '',
  budgetAllocated: '',
  runStartDate: '',
  runEndDate: '',
  publicUrl: '',
  copy: '',
  visualName: '',
  visualCanvaUrl: '',
  platformExternalId: '',
  visualUrl: null,
};

const RECOMMENDATIONS = ['De stabilit', 'Repetare', 'Optimizare', 'Testare suplimentară', 'Oprire'];

export function ActivationEditor() {
  const { externalKey } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Where to return when the editor closes.
   *
   * An activation started from the campaigns page belongs to that errand, so
   * it hands back there rather than dropping the reader into Activari, which
   * is a page they never asked for. Callers mark the origin with router state;
   * without it the editor behaves as before.
   */
  const returnTo = (location.state as { from?: string } | null)?.from ?? null;

  const isEdit = Boolean(externalKey);

  const catalogs = useCatalogs();
  const { items: campaigns } = useCampaigns(EMPTY_FILTERS);

  const [form, setForm] = useState<EditorState>(() => ({
    ...EMPTY,
    // "＋ Activare" on a campaign card pre-selects that campaign.
    campaignExternalKey: searchParams.get('campaign'),
  }));
  const [tab, setTab] = useState<TabId>('plan');
  /** The step to return to from the campaign reader. */
  const [returnTab, setReturnTab] = useState<TabId>('custom');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number | null>(null);

  /**
   * The source campaign in full.
   *
   * The campaigns list carries only what the Campanii screen renders; the
   * Particularizare step needs the campaign's rules (central idea, promise,
   * tone, fixed elements, adaptation limits) and the audience and product
   * options it defines. Those only exist on the detail record.
   */
  const [sourceDetail, setSourceDetail] = useState<Record<string, any> | null>(null);
  const [sourceActivations, setSourceActivations] = useState<CampaignActivation[]>([]);

  const [loading, setLoading] = useState(isEdit);
  const [customAudience, setCustomAudience] = useState('');

  useEffect(() => {
    const key = form.campaignExternalKey;
    if (!key) {
      setSourceDetail(null);
      return;
    }
    let cancelled = false;
    api
      .get<CampaignActivation[]>(`/campaigns/${encodeURIComponent(key)}/activations`)
      .then((r) => {
        if (!cancelled) setSourceActivations(r.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setSourceActivations([]);
      });
    api
      .get<Record<string, any>>(`/campaigns/${encodeURIComponent(key)}`)
      .then((r) => {
        if (!cancelled) setSourceDetail(r.data);
      })
      // A failed context fetch must not block editing; the step degrades to the
      // independent-activation form.
      .catch(() => {
        if (!cancelled) setSourceDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.campaignExternalKey]);

  /**
   * On create, the campaign's primary audience starts selected — the prototype
   * seeds `audiences` from `campaign.primaryAudienceSegment`, and the chip's own
   * caption promises it ("prebifat la creare").
   *
   * Only when creating, and only while nothing has been chosen yet: editing an
   * existing activation must never have its saved selection rewritten, and a
   * user who deliberately cleared the list must not have it reappear.
   */
  const [audiencesSeeded, setAudiencesSeeded] = useState(false);
  useEffect(() => {
    if (isEdit || audiencesSeeded) return;
    const primary = sourceDetail?.primaryAudienceCode;
    if (!primary) return;
    setAudiencesSeeded(true);
    setForm((current) =>
      current.audiences.length > 0
        ? current
        : { ...current, audiences: [{ code: primary, customLabel: null }] },
    );
  }, [sourceDetail, isEdit, audiencesSeeded]);

  /**
   * Latest snapshot per material for this activation.
   *
   * The prototype's equivalent button simulated a social-API call and invented
   * numbers. Ours has no such integration: performance data arrives through the
   * monitoring import, so the honest action is to re-read it from the server.
   */
  const [results, setResults] = useState<Array<Record<string, any>>>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  const loadResults = useCallback(async () => {
    if (!externalKey) return;
    setResultsLoading(true);
    try {
      const r = await api.get<Array<Record<string, any>>>(
        `/monitoring/activations/latest?activation=${encodeURIComponent(externalKey)}&pageSize=200`,
      );
      setResults(r.data ?? []);
    } catch {
      setResults([]);
    } finally {
      setResultsLoading(false);
    }
  }, [externalKey]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  /** Most recent observation across all materials, for the update note. */
  const latestObservedAt = results.reduce<string | null>(
    (latest, row) => (!latest || String(row.observedAt) > latest ? String(row.observedAt) : latest),
    null,
  );

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
          products: Array.isArray(data.products) ? data.products : [],
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
            otherChannel: m.otherChannel ?? '',
            format: m.format ?? '',
            budgetAllocated: m.budgetAllocated == null ? '' : String(m.budgetAllocated),
            runStartDate: m.runStartDate ?? '',
            runEndDate: m.runEndDate ?? '',
            publicUrl: m.publicUrl ?? '',
            copy: m.copy ?? '',
            visualName: m.visualName ?? '',
            visualCanvaUrl: m.visualCanvaUrl ?? '',
            platformExternalId: m.platformExternalId ?? '',
            visualUrl: m.visualUrl ?? null,
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

  /**
   * Audience options offered by the source campaign: its primary segment first,
   * then the secondaries. The DTO returns labels and codes as two positionally
   * parallel arrays (see the campaign detail endpoint), so they are zipped here
   * rather than trusted to line up further downstream.
   */
  const audienceOptions = useMemo(() => {
    if (!sourceDetail) return [] as Array<{ code: string; label: string; primary: boolean }>;
    const out: Array<{ code: string; label: string; primary: boolean }> = [];
    if (sourceDetail.primaryAudienceCode) {
      out.push({
        code: sourceDetail.primaryAudienceCode,
        label: sourceDetail.primaryAudienceSegment ?? sourceDetail.primaryAudienceCode,
        primary: true,
      });
    }
    const codes: string[] = sourceDetail.secondaryAudienceCodes ?? [];
    const labels: string[] = sourceDetail.secondaryAudienceSegments ?? [];
    codes.forEach((code, i) => {
      if (!out.some((o) => o.code === code)) {
        out.push({ code, label: labels[i] ?? code, primary: false });
      }
    });
    return out;
  }, [sourceDetail]);

  /** Products the campaign defines. Plain strings on both sides. */
  const productOptions = useMemo<string[]>(
    () => (Array.isArray(sourceDetail?.products) ? sourceDetail!.products : []),
    [sourceDetail],
  );

  const fundingTotal = form.fundingSources.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
  // What the declared sources still leave uncovered. Never negative: over-funding
  // is not a gap, and the prototype does not report it as one.
  const fundingGap = Math.max(0, (Number(form.plannedBudget) || 0) - fundingTotal);

  async function save() {
    if (!form.title.trim()) {
      setTab('plan');
      setMessage('Completează denumirea activării.');
      return;
    }
    if (!form.startDate || !form.endDate) {
      setTab('plan');
      setMessage('Completează perioada activării.');
      return;
    }
    if (form.endDate < form.startDate) {
      setTab('plan');
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
        navigate(returnTo ?? `/activations/${externalKey}`);
      } else {
        const created = await api.post<{ id: string }>('/activations', payload);
        navigate(returnTo ?? `/activations/${created.data.id}`);
      }
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Activarea nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="state-note">Se încarcă activarea…</div>;

  const activeCampaigns = campaigns.filter((c) => c.statusCode === 'ACTIVE');

  const sourceCampaign = campaigns.find((c) => c.id === form.campaignExternalKey) ?? null;

  return (
    <div className="modal-bg">
      <section className="modal activation-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <small className="modal-kicker">{isEdit ? 'EDITARE ACTIVARE' : 'ACTIVARE NOUĂ'}</small>
            <h2>{form.title || 'Activare nouă'}</h2>
            <p>
              {sourceCampaign
                ? `Campanie-sursă: ${sourceCampaign.title}`
                : 'Activare independentă · fără campanie asociată'}
            </p>
            {sourceCampaign ? (
              <div className="activation-source-summary">
                <span>Regulile se moștenesc · opțiunile se selectează · execuția se adaptează</span>
              </div>
            ) : null}
          </div>
          <div className="activation-head-actions">
            {sourceCampaign ? (
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  // Remember the step in progress, unless we are already reading.
                  setReturnTab((current) => (tab === 'campaign' ? current : tab));
                  setTab('campaign');
                }}
              >
                Vezi campania cap-coadă
              </button>
            ) : null}
            <button
              className="x"
              type="button"
              onClick={() => navigate(returnTo ?? '/activations')}
              aria-label="Închide"
            >
              ×
            </button>
          </div>
        </header>

        <div className="activation-editor-body">
          <aside className="activation-nav">
            <div className="activation-workflow-label" style={{ borderTop: 0, paddingTop: 0 }}>
              Fluxul activării
            </div>
            {TABS.map(([id, title, hint], index) => (
              <button
                key={id}
                type="button"
                className={id === tab ? 'active' : ''}
                onClick={() => setTab(id)}
              >
                <b>{index + 1}</b>
                <span>
                  <strong>{title}</strong>
                  <small>{hint}</small>
                </span>
              </button>
            ))}
          </aside>

          <main id="activationEditorContent">
      {message ? (
        <div className="state-note error" role="alert">
          {message}
        </div>
      ) : null}

        {/* campaignReaderEditor(): the source campaign read cap-coada without
            leaving the form. Same CampaignBlocks the campaign drawer renders, so
            the two can never show different content; prototype.css makes every
            control inside it inert, which is what keeps it a reading view. */}
        {tab === 'campaign' ? (
          sourceDetail ? (
            <section className="activation-campaign-reader">
              <div className="activation-campaign-reader-head">
                <div>
                  <small>Campania-sursă &middot; consultare</small>
                  <h3>{sourceDetail.title}</h3>
                  <p>
                    Vizualizare cap-coadă, în interiorul formularului. Conținutul este doar pentru
                    consultare; activarea se editează în taburile sale.
                  </p>
                </div>
                <button className="btn primary" type="button" onClick={() => setTab(returnTab)}>
                  &larr; Înapoi la activare
                </button>
              </div>
              <div className="activation-campaign-fullview">
                <CampaignBlocks
                  campaign={sourceDetail as unknown as CampaignDetail}
                  activations={sourceActivations}
                />
              </div>
            </section>
          ) : (
            <section className="activation-section">
              <div className="activation-section-head">
                <div>
                  <small>Campania-sursă</small>
                  <h3>Activarea nu este asociată unei campanii</h3>
                </div>
                <button className="btn secondary" type="button" onClick={() => setTab(returnTab)}>
                  Înapoi la activare
                </button>
              </div>
            </section>
          )
        ) : null}

        {tab === 'plan' ? (
          <section className="activation-section">
            <div className="activation-section-head">
              <div>
                <small>1. Planificare</small>
                <h3>Datele esențiale ale activării</h3>
              </div>
              <span className="inherit-pill">{form.campaignExternalKey
                    ? `Derivată din ${sourceCampaign?.title ?? 'campanie'}`
                    : 'Activare independentă'}</span>
            </div>

            {/* The prototype's sourceGuide(): how a campaign becomes an activation.
                Read-only, and the first thing on the step, because it frames every
                field below it. */}
            {form.campaignExternalKey ? (
              <section className="activation-source-guide">
                <header>
                  <strong>Cum folosești campania pentru a construi activarea</strong>
                  <span>
                    Campania este cadrul. Activarea este execuția concretă pentru o perioadă, un
                    public și un set de materiale.
                  </span>
                </header>
                <div className="activation-logic-grid">
                  <article className="activation-logic-card inherited">
                    <small>1 · Se moștenesc</small>
                    <h4>Regulile</h4>
                    <p>
                      Ideea centrală, promisiunea, tonul, elementele fixe și limitele rămân
                      referința campaniei și nu trebuie rescrise în activare.
                    </p>
                  </article>
                  <article className="activation-logic-card selected">
                    <small>2 · Se selectează</small>
                    <h4>Opțiunile</h4>
                    <p>
                      Publicurile și produsele se aleg dintre opțiunile definite în campanie. Pentru
                      materiale poți utiliza template-urile campaniei sau poți porni de la zero.
                    </p>
                  </article>
                  <article className="activation-logic-card">
                    <small>3 · Se adaptează</small>
                    <h4>Execuția</h4>
                    <p>
                      Perioada, bugetul, obiectivul concret, zona, mesajul, copy-ul și materialele
                      finale se particularizează pentru activarea curentă.
                    </p>
                  </article>
                </div>
              </section>
            ) : (
              <div className="activation-independent-note">
                <b>Activare independentă.</b> Nu există o campanie-sursă din care să fie moștenite
                reguli sau selectate opțiuni. Câmpurile acestei activări se completează direct.
              </div>
            )}
            <div className="compact-form-grid">
            <label className="field">
              <span className="label">Denumirea activării</span>
              <input className="control" value={form.title} onChange={(e) => set('title', e.target.value)} />
            </label>
              <label className="field">
                <span className="label">Stadiu</span>
                <select className="control" value={form.statusCode} onChange={(e) => set('statusCode', e.target.value)}>
                  {(catalogs?.campaign_statuses ?? []).map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

            <label className="field full">
              <span className="label">
                Campanie<small>Doar campaniile Active pot genera activări noi</small>
              </span>
              <select className="control"
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
              <label className="field">
                <span className="label">Pilon (activare independentă)</span>
                <select className="control"
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

              <label className="field">
                <span className="label">Început</span>
                <input className="control"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Final</span>
                <input className="control" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
              </label>

              <label className="field full">
                <span className="label">Responsabil</span>
                <input className="control" value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
              </label>




            <label className="annual-check full">
              <input
                type="checkbox"
                checked={form.includeAnnualPlan}
                onChange={(e) => set('includeAnnualPlan', e.target.checked)}
              />
              <span>
                <strong>Include în Planul anual</strong>
                <small>
                  Activarea va apărea automat în anul sau anii acoperiți de perioada sa.
                  {planYears.length ? ` Se va adăuga la ${planYears.join(', ')}.` : ''}
                </small>
              </span>
            </label>
            </div>
          </section>
        ) : null}

        {tab === 'custom' ? (
          <section className="activation-section">
            <div className="activation-section-head">
              <div>
                <small>2. Particularizare</small>
                <h3>Ce se schimbă pentru această execuție</h3>
              </div>
              <span className="inherit-pill">
                {form.campaignExternalKey ? 'Regulile campaniei rămân referința' : 'Completare directă'}
              </span>
            </div>

            {/* campaignContextPanel(): the campaign's rules, read-only. This is
                the "se mostenesc" half of the source guide made concrete. */}
            {sourceDetail ? (
              <section className="activation-context-box">
                <div className="activation-context-head">
                  <div>
                    <small>Context moștenit &middot; referință vie</small>
                    <h4>{sourceDetail.title}</h4>
                    <p>
                      Aceste elemente definesc cadrul activării. Campania completă poate fi
                      consultată din butonul din dreapta sus.
                    </p>
                  </div>
                </div>
                <div className="activation-context-grid">
                  {CONTEXT_FIELDS.map(([label, key]) => (
                    <div className="activation-context-item" key={key}>
                      <small>{label}</small>
                      <strong>{sourceDetail?.[key] || 'De completat'}</strong>
                    </div>
                  ))}
                </div>
                <div className="activation-context-rules">
                  {(sourceDetail.fixedElements ?? []).length > 0 ? (
                    <details>
                      <summary>Elemente fixe ({sourceDetail.fixedElements.length})</summary>
                      <ul>
                        {sourceDetail.fixedElements.slice(0, 6).map((x: string, i: number) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {(sourceDetail.adaptationLimits ?? []).length > 0 ? (
                    <details>
                      <summary>Limite de adaptare ({sourceDetail.adaptationLimits.length})</summary>
                      <ul>
                        {sourceDetail.adaptationLimits.slice(0, 6).map((x: string, i: number) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </section>
            ) : null}

            <div className="compact-form-grid">
              <label className="field full">
                <span className="label">Obiectivul concret al activării</span>
                <textarea
                  className="control"
                  value={form.objective}
                  onChange={(e) => set('objective', e.target.value)}
                />
                <span className="activation-field-source">
                  {form.campaignExternalKey ? (
                    <>
                      <b>Punct de pornire:</b> preluat la creare din rezultatul / obiectivul
                      campaniei; aici devine editabil pentru execuția concretă.
                    </>
                  ) : (
                    'Definește rezultatul concret urmărit de activare.'
                  )}
                </span>
              </label>

              <div className="field full">
                <span className="label">Publicuri selectate</span>
                {audienceOptions.length > 0 ? (
                  <>
                    <div className="activation-multi-choice">
                      {audienceOptions.map((option) => {
                        const chosen = form.audiences.some((a) => a.code === option.code);
                        return (
                          <button
                            key={option.code}
                            type="button"
                            className={chosen ? 'activation-choice selected' : 'activation-choice'}
                            onClick={() =>
                              set(
                                'audiences',
                                chosen
                                  ? form.audiences.filter((a) => a.code !== option.code)
                                  : [...form.audiences, { code: option.code, customLabel: null }],
                              )
                            }
                          >
                            <span className="activation-choice-check">{chosen ? '✓' : '+'}</span>
                            <span>
                              <strong>{option.label}</strong>
                              <small>
                                {option.primary
                                  ? 'Public principal în campanie · prebifat la creare'
                                  : 'Public secundar disponibil'}
                              </small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <span className="activation-field-source">
                      <b>Din campanie:</b> publicul principal este prebifat la crearea activării;
                      publicurile secundare rămân disponibile și pot fi selectate multiplu.
                    </span>
                  </>
                ) : form.campaignExternalKey ? (
                  <div className="empty-detail">Nu există opțiuni definite în campania-sursă.</div>
                ) : (
                  <>
                    <textarea
                      className="control"
                      placeholder="Câte un public pe rând"
                      value={form.audiences.map((a) => a.customLabel ?? a.code ?? '').join('\n')}
                      onChange={(e) =>
                        set(
                          'audiences',
                          e.target.value
                            .split('\n')
                            .map((x) => x.trim())
                            .filter(Boolean)
                            .map((label) => ({ code: null, customLabel: label })),
                        )
                      }
                    />
                    <span className="activation-field-source">
                      Activare independentă: publicurile se introduc direct, câte unul pe rând.
                    </span>
                  </>
                )}
              </div>

              <div className="field full">
                <span className="label">Produse / experiențe selectate</span>
                {productOptions.length > 0 ? (
                  <>
                    <div className="activation-multi-choice">
                      {productOptions.map((value) => {
                        const chosen = form.products.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            className={chosen ? 'activation-choice selected' : 'activation-choice'}
                            onClick={() =>
                              set(
                                'products',
                                chosen
                                  ? form.products.filter((x) => x !== value)
                                  : [...form.products, value],
                              )
                            }
                          >
                            <span className="activation-choice-check">{chosen ? '✓' : '+'}</span>
                            <span>
                              <strong>{value}</strong>
                              <small>Disponibil în campanie</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <span className="activation-field-source">
                      <b>Din campanie:</b> produsele / experiențele sunt doar disponibile; nu este
                      selectat automat niciunul. Poți alege mai multe.
                    </span>
                  </>
                ) : form.campaignExternalKey ? (
                  <div className="empty-detail">Nu există opțiuni definite în campania-sursă.</div>
                ) : (
                  <>
                    <textarea
                      className="control"
                      placeholder="Câte un produs / experiență pe rând"
                      value={form.products.join('\n')}
                      onChange={(e) =>
                        set('products', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))
                      }
                    />
                    <span className="activation-field-source">
                      Activare independentă: produsele se introduc direct, câte unul pe rând.
                    </span>
                  </>
                )}
              </div>

              <label className="field">
                <span className="label">Zonă / localitate</span>
                <input
                  className="control"
                  value={form.zone}
                  placeholder="Opțional"
                  onChange={(e) => set('zone', e.target.value)}
                />
                <span className="activation-field-source">
                  Se particularizează pentru contextul concret al activării.
                </span>
              </label>

              <label className="field full">
                <span className="label">Headline / mesaj particularizat</span>
                <textarea
                  className="control"
                  value={form.message}
                  onChange={(e) => set('message', e.target.value)}
                />
                <span className="activation-field-source">
                  {form.campaignExternalKey ? (
                    <>
                      <b>Punct de pornire:</b> mesajul / headline-ul campaniei este copiat la
                      creare, apoi poate fi adaptat fără a modifica sursa.
                    </>
                  ) : (
                    'Mesaj editabil pentru această activare.'
                  )}
                </span>
              </label>

              <label className="field full">
                <span className="label">Landing page / destinația clickului</span>
                <input
                  className="control"
                  value={form.landingUrl}
                  placeholder="https://..."
                  onChange={(e) => set('landingUrl', e.target.value)}
                />
                <span className="activation-field-source">
                  <b>Element de execuție:</b> se completează pentru activarea curentă.
                </span>
              </label>
            </div>
          </section>
        ) : null}

        {tab === 'plan' ? (
          <section className="activation-section">
            <div className="activation-section-head">
              <div>
                <small>Planificare și resurse</small>
                <h3>Buget, implementare și finanțare</h3>
              </div>
              <span className="inherit-pill">{`Total: ${formatMoney(fundingTotal, '0 lei')}`}</span>
            </div>
            <div className="compact-form-grid">
              <label className="field">
                <span className="label">Buget planificat (lei)</span>
                <input className="control"
                  type="number"
                  value={form.plannedBudget}
                  onChange={(e) => set('plannedBudget', e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Cheltuit (lei)</span>
                <input className="control"
                  type="number"
                  value={form.actualSpend}
                  onChange={(e) => set('actualSpend', e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Mod de implementare</span>
                <select className="control"
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
              <label className="field">
                <span className="label">Parteneri / furnizori implicați</span>
                <textarea
                  className="control"
                  value={form.implementationPartners}
                  onChange={(e) => set('implementationPartners', e.target.value)}
                  placeholder="Ex.: Salvamont Valea Jiului; operatori locali; agenție media"
                />
                <span className="activation-field-source">
                  Relevant mai ales pentru implementare cu parteneri, externalizată sau mixtă.
                </span>
              </label>
            </div>
            {/* The prototype's fundingEditor(): its own card with a header,
                an add button, a scrollable table and a total strip that shows
                what is still uncovered against the planned budget. */}
            <div className="annual-finance-editor">
              <header>
                <div>
                  <h4>Surse de finanțare</h4>
                  <p>
                    Poți combina mai multe surse. Finanțarea incompletă nu blochează salvarea
                    activării.
                  </p>
                </div>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() =>
                    set('fundingSources', [
                      ...form.fundingSources,
                      { typeCode: '', label: '', amount: '' },
                    ])
                  }
                >
                  ＋ Adaugă sursă
                </button>
              </header>

              <div className="funding-editor-scroll">
                <table className="funding-editor-table">
                  <thead>
                    <tr>
                      <th>Tip sursă</th>
                      <th>Denumire / detalii</th>
                      <th>Valoare (lei)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.fundingSources.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <div className="performance-empty">
                            Nu au fost adăugate încă surse de finanțare.
                          </div>
                        </td>
                      </tr>
                    ) : (
                      form.fundingSources.map((source, index) => (
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
                              <option value="">Selectează tipul</option>
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
                              placeholder="Denumire / detalii"
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
                              min="0"
                              step="100"
                              placeholder="0"
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
                              className="row-remove"
                              type="button"
                              title="Elimină sursa"
                              onClick={() =>
                                set(
                                  'fundingSources',
                                  form.fundingSources.filter((_, i) => i !== index),
                                )
                              }
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="funding-editor-total">
                <span>
                  Total finanțare identificată: <strong>{formatMoney(fundingTotal, '0 lei')}</strong>
                </span>
                {fundingGap > 0 ? (
                  <span className="funding-gap">De acoperit: {formatMoney(fundingGap, '0 lei')}</span>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'materials' ? (
          <section className="activation-section">
            <div className="activation-section-head">
              <div>
                <small>3. Materiale și canale</small>
                <h3>Construiește execuțiile finale</h3>
              </div>
              <button
                className="btn secondary"
                type="button"
                onClick={() => set('materials', [...form.materials, { ...EMPTY_MATERIAL }])}
              >
                ＋ Material nou de la zero
              </button>
            </div>

            <div className="view-note">
              {form.campaignExternalKey ? (
                <>
                  <b>Regula:</b> poți porni dintr-un template al campaniei sau poți crea un material
                  nou. Template-ul, formatul și linkul Canva se copiază în activare; modificările
                  ulterioare nu schimbă campania-sursă.
                </>
              ) : (
                <>
                  <b>Activare independentă:</b> materialele se creează direct, fără template-uri
                  moștenite dintr-o campanie.
                </>
              )}
            </div>

            <div className="activation-materials">
              {form.materials.length === 0 ? (
                <div className="empty-detail">
                  Nu există încă materiale. Adaugă unul cu butonul din dreapta sus.
                </div>
              ) : null}

              {form.materials.map((material, index) => {
                const patch = (changes: Partial<MaterialRow>) => {
                  const next = [...form.materials];
                  next[index] = { ...material, ...changes };
                  set('materials', next);
                };
                return (
                  <article className="activation-material-card" key={material.id ?? index}>
                    <header>
                      <div>
                        <small>Material {index + 1}</small>
                        <span className="material-origin">
                          {material.id
                            ? 'Material salvat în activare'
                            : 'Material creat direct în activare'}
                        </span>
                        <input
                          value={material.title}
                          aria-label="Titlu material"
                          placeholder="Titlul materialului"
                          onChange={(ev) => patch({ title: ev.target.value })}
                        />
                      </div>
                      <button
                        className="row-remove"
                        type="button"
                        title="Elimină materialul"
                        onClick={() =>
                          set('materials', form.materials.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </button>
                    </header>

                    <div className="material-editor-grid">
                      <div className="material-visual-editor">
                        {/* The prototype renders the image when there is one and
                            the ▧ box when there is not. This showed the box
                            unconditionally, so a material that had a visual —
                            its own, or one inherited from a campaign template —
                            still looked empty while editing it.

                            The stylesheet already sizes the image (150px tall,
                            object-fit: cover, bordered), so nothing was needed
                            beyond rendering the element. */}
                        {material.visualUrl ? (
                          <a
                            href={material.visualUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Deschide vizualul la dimensiune completă"
                          >
                            <img
                              src={material.visualUrl}
                              alt={material.visualName || material.title || 'Vizual material'}
                            />
                          </a>
                        ) : (
                          <div className="empty-material-visual">
                            <b>▧</b>
                            <span>{material.visualName || 'Fără vizual atașat'}</span>
                          </div>
                        )}
                        <label className="label" style={{ marginTop: 10 }}>
                          Denumirea vizualului
                        </label>
                        <input
                          className="control"
                          value={material.visualName}
                          placeholder="Ex.: reel-primavara-01.mp4"
                          onChange={(ev) => patch({ visualName: ev.target.value })}
                        />
                        <small>
                          Încărcarea fișierului nu este încă disponibilă; se notează denumirea și
                          linkul Canva.
                        </small>
                      </div>

                      <div className="material-fields">
                        <div className="mini-grid">
                          <label>
                            <span>Canal</span>
                            <select
                              value={material.channel}
                              onChange={(ev) => patch({ channel: ev.target.value })}
                            >
                              <option value="">Selectează canalul</option>
                              {(catalogs?.activation_channels ?? []).map((entry) => (
                                <option key={entry.code} value={entry.label}>
                                  {entry.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Format</span>
                            <input
                              value={material.format}
                              placeholder="Ex.: Reel, carusel, video"
                              onChange={(ev) => patch({ format: ev.target.value })}
                            />
                          </label>
                        </div>

                        {/* The prototype reveals this only for the "Altele" channel. */}
                        {material.channel.toLowerCase().includes('alt') ? (
                          <label>
                            <span>Precizează canalul</span>
                            <input
                              value={material.otherChannel}
                              placeholder="Ex.: newsletter, website, PR, partener"
                              onChange={(ev) => patch({ otherChannel: ev.target.value })}
                            />
                            <small>
                              Canalele din categoria „Altele” nu primesc rezultate prin actualizarea
                              API social.
                            </small>
                          </label>
                        ) : null}

                        <label>
                          <span>Buget alocat materialului pe acest canal (lei)</span>
                          <input
                            type="number"
                            min="0"
                            step="50"
                            value={material.budgetAllocated}
                            placeholder="0 pentru publicare organică"
                            onChange={(ev) => patch({ budgetAllocated: ev.target.value })}
                          />
                          <small>
                            Buget planificat/alocat. Cheltuiala media efectivă este preluată separat
                            în zona de rezultate.
                          </small>
                        </label>

                        <div className="mini-grid">
                          <label>
                            <span>Rulare de la</span>
                            <input
                              type="date"
                              value={material.runStartDate}
                              onChange={(ev) => patch({ runStartDate: ev.target.value })}
                            />
                            <small>Pentru o postare organică poate fi chiar data publicării.</small>
                          </label>
                          <label>
                            <span>Rulare până la</span>
                            <input
                              type="date"
                              value={material.runEndDate}
                              onChange={(ev) => patch({ runEndDate: ev.target.value })}
                            />
                            <small>Pentru o publicare punctuală poate fi aceeași dată.</small>
                          </label>
                        </div>

                        <label>
                          <span>Link Canva editabil</span>
                          <div className="link-field">
                            <input
                              value={material.visualCanvaUrl}
                              placeholder="https://canva.com/..."
                              onChange={(ev) => patch({ visualCanvaUrl: ev.target.value })}
                            />
                            <button
                              type="button"
                              disabled={!material.visualCanvaUrl}
                              onClick={() =>
                                window.open(material.visualCanvaUrl, '_blank', 'noopener')
                              }
                            >
                              Deschide ↗
                            </button>
                          </div>
                        </label>

                        <label>
                          <span>Copy final</span>
                          <textarea
                            value={material.copy}
                            onChange={(ev) => patch({ copy: ev.target.value })}
                          />
                        </label>

                        <details
                          className="tracking-details"
                          open={Boolean(material.publicUrl || material.platformExternalId)}
                        >
                          <summary>Date pentru monitorizare</summary>
                          <div className="mini-grid">
                            <label>
                              <span>URL public</span>
                              <input
                                value={material.publicUrl}
                                placeholder="Linkul postării / paginii"
                                onChange={(ev) => patch({ publicUrl: ev.target.value })}
                              />
                            </label>
                            <label>
                              <span>ID extern</span>
                              <input
                                value={material.platformExternalId}
                                placeholder="Post ID / Ad ID"
                                onChange={(ev) => patch({ platformExternalId: ev.target.value })}
                              />
                            </label>
                          </div>
                        </details>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {tab === 'results' ? (
          <section className="activation-section">
            <div className="activation-section-head">
              <div>
                <small>4. KPI și rezultate</small>
                <h3>Rezultate automate pe postare · KPI agregați introduși manual</h3>
              </div>
              <button
                className="btn primary"
                type="button"
                disabled={!isEdit || resultsLoading}
                onClick={() => void loadResults()}
                title={
                  isEdit
                    ? 'Reciteşte rezultatele importate pentru materialele acestei activări'
                    : 'Disponibil după salvarea activării'
                }
              >
                {resultsLoading ? 'Se încarcă…' : '↻ Actualizează rezultate'}
              </button>
            </div>

            <div className="results-update-note">
              <span>
                {latestObservedAt
                  ? `Ultima măsurătoare înregistrată: ${formatDateTime(latestObservedAt)}`
                  : 'Nu există încă rezultate înregistrate pentru materialele acestei activări.'}
              </span>
              <small>
                Rezultatele provin din pachetele de monitorizare importate, nu dintr-o conexiune
                directă cu platformele sociale. Materialele pe canalul „Altele” nu primesc
                rezultate automat.
              </small>
            </div>

            <h4 style={{ margin: '0 0 10px' }}>Rezultate pe postare și canal</h4>
            <div className="matrix-scroll">
              <table className="activation-kpi-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Canal</th>
                    <th>Afișări</th>
                    <th>Reach</th>
                    <th>Interacțiuni</th>
                    <th>Engagement</th>
                    <th>Clickuri</th>
                    <th>CTR</th>
                    <th>Cheltuit</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="performance-empty">
                          {isEdit
                            ? 'Nu există rezultate importate pentru materialele acestei activări.'
                            : 'Rezultatele devin disponibile după salvarea activării și importul măsurătorilor.'}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    results.map((row) => (
                      <tr key={String(row.id)}>
                        <td>
                          <strong>{row.materialTitle}</strong>
                          {row.materialFormat ? <small> · {row.materialFormat}</small> : null}
                        </td>
                        <td>{row.channelCode}</td>
                        <td className="num">{formatNumber(row.impressions)}</td>
                        <td className="num">{formatNumber(row.reach)}</td>
                        <td className="num">{formatNumber(calculateInteractions(row))}</td>
                        <td className="num">{formatPercent(calculateEngagementRate(row))}</td>
                        <td className="num">{formatNumber(row.clicks)}</td>
                        <td className="num">{formatPercent(calculateCTR(row))}</td>
                        <td className="num">{formatMoney(row.spend)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="activation-manual-kpi-head">
              <div>
                <h4>KPI agregați ai activării</h4>
                <p>
                  Introduci manual indicatorii pe care vrei să îi urmărești, indiferent de sursă.
                  Poți consulta rezultatele de mai sus și copia aici valorile relevante, dar
                  sistemul nu modifică automat acest tabel.
                </p>
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
                ＋ Adaugă KPI
              </button>
            </div>

            <div className="matrix-scroll">
              <table className="activation-kpi-table activation-kpi-manual-table">
                <thead>
                  <tr>
                    <th>Indicator</th>
                    <th>Țintă</th>
                    <th>Rezultat</th>
                    <th>Sursă / observație</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {form.kpis.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="performance-empty">
                          Nu ai introdus încă KPI agregați pentru această activare.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    form.kpis.map((kpi, index) => {
                      const patch = (changes: Partial<KpiRow>) => {
                        const next = [...form.kpis];
                        next[index] = { ...kpi, ...changes };
                        set('kpis', next);
                      };
                      return (
                        <tr key={kpi.id ?? index}>
                          <td>
                            <input
                              value={kpi.name}
                              placeholder="Ex.: Reach total, participanți, solicitări"
                              onChange={(ev) => patch({ name: ev.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              value={kpi.target}
                              placeholder="Țintă"
                              onChange={(ev) => patch({ target: ev.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              value={kpi.result}
                              placeholder="Rezultat"
                              onChange={(ev) => patch({ result: ev.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              value={kpi.source}
                              placeholder="Ex.: dashboard social, raport organizator"
                              onChange={(ev) => patch({ source: ev.target.value })}
                            />
                          </td>
                          <td>
                            <button
                              className="row-remove"
                              type="button"
                              title="Elimină KPI"
                              onClick={() => set('kpis', form.kpis.filter((_, i) => i !== index))}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* Concluzii — these three columns were already loaded and saved by this
            editor but had no fields anywhere, so they could only ever be set by
            an import. The prototype's fifth step is where they belong. */}
        {tab === 'conclusions' ? (
          <section className="activation-section">
            <div className="activation-section-head">
              <div>
                <small>5. Concluzii</small>
                <h3>Lecții și recomandare</h3>
              </div>
              <span className="inherit-pill">Se completează după încheiere</span>
            </div>
            <div className="compact-form-grid">
            <label className="field full">
              <span className="label">
                Rezultatul pe scurt
                <small>Ce s-a obținut, în una-două fraze</small>
              </span>
              <textarea className="control"
                rows={4}
                value={form.resultSummary}
                onChange={(e) => set('resultSummary', e.target.value)}
              />
            </label>

            <label className="field full">
              <span className="label">
                Ce a funcționat
                <small>Lecții de păstrat pentru activările următoare</small>
              </span>
              <textarea className="control"
                rows={4}
                value={form.whatWorked}
                onChange={(e) => set('whatWorked', e.target.value)}
              />
            </label>

            <label className="field">
              <span className="label">Recomandare</span>
              <select className="control"
                value={form.recommendation || 'De stabilit'}
                onChange={(e) => set('recommendation', e.target.value)}
              >
                {RECOMMENDATIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            </div>
          </section>
        ) : null}
          </main>
        </div>

        <footer className="modal-foot">
          <div className="save-state">
            <span className="status-dot" />
            Datele sunt păstrate când navighezi între taburi
          </div>
          <div>
            <button className="btn secondary" type="button" onClick={() => navigate(returnTo ?? '/activations')}>
              Renunță
            </button>{' '}
            <button
              className="btn primary"
              type="button"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Se salvează…' : isEdit ? 'Salvează modificările' : 'Salvează activarea'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
