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
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { seasonalityMonthsLabel, seasonalityPeriodLabel } from '../../domain/services';
import { EMPTY_FILTERS, useCampaigns, useCatalogs, type CatalogEntry } from './useCampaigns';
import { ContextImportPanel, type ContextSection } from './campaignContextImport';
import type { CampaignDetail } from './CampaignDetailPage';
import {
  AudiencePicker,
  ChipPicker,
  CtaPicker,
  ListTextarea,
  MultiPicker,
  ObjectivePicker,
  RowTable,
} from './campaignPickers';
import {
  ADAPTABLE_OPTIONS,
  MONTH_LABELS,
  STEPS,
  emptyForm,
  toApiPayload,
  validateStep,
  type CampaignFormState,
} from './campaignForm';

type Setter = <K extends keyof CampaignFormState>(key: K, value: CampaignFormState[K]) => void;

/** Every field the prototype marks with an `info()` bubble. */
type HelpKey =
  | 'type' | 'pillar'
  | 'program' | 'objective' | 'marketing' | 'result' | 'contribution'
  | 'public' | 'insight' | 'value'
  | 'centralIdea' | 'promise' | 'mainMessage' | 'secondaryMessages' | 'storytelling' | 'tone' | 'cta'
  | 'products' | 'productCondition' | 'channels' | 'pr' | 'kpiDefinitions'
  | 'fixed' | 'adaptable' | 'limits' | 'examples'
  | 'headlines' | 'mockups' | 'posts' | 'videos'
  | 'activationExamples';

/**
 * Field-level explanations, copied verbatim from `OMD_DATA.config.help`.
 *
 * The prototype assembles this map in four places: a seven-key literal inside
 * the JSON config, then three `Object.assign(OMD_DATA.config.help, {...})` calls
 * further down the file that add the remaining 24. Reading only the literal
 * gives a misleading picture of which fields are documented.
 *
 * One key is renamed here. The prototype renders `info('kpiDefinitions')` but
 * stored that text under `metrics`, so the lookup misses and the bubble opens
 * empty — the only field where the original genuinely has no help. The text is
 * unmistakably about indicators, so it is mapped onto the key that asks for it.
 *
 * Static rather than catalogue data because these describe what the *field*
 * means; per-option text lives on the catalogue row's `hint` and is rendered
 * inside each `.choice`.
 */
const HELP: Record<HelpKey, string> = {
  type:
    'Campania-umbrelă stabilește cadrul comun. Campania tematică dezvoltă un pilon. Campania tactică răspunde unui sezon sau context.',
  pillar:
    'Alege pilonul principal. Folosește Transversal doar când campania integrează explicit mai mulți piloni.',
  program:
    'Selectează un singur program principal și maximum două programe secundare.',
  objective:
    'Alege obiectivul la care campania contribuie cel mai direct; maximum două obiective secundare.',
  marketing:
    'Formulează schimbarea de marketing urmărită: notorietate, interes, trafic, planificare, revenire sau recomandare.',
  result:
    'Descrie un rezultat măsurabil direct: trafic, salvări, clickuri, solicitări sau participări.',
  contribution:
    'Leagă rezultatul direct de obiective mai ample, fără a atribui campaniei singure întreaga creștere turistică.',
  public:
    'Alege un singur public principal. Publicurile secundare trebuie să fie relevante, nu o listă completă a tuturor segmentelor.',
  insight:
    'Descrie pe scurt nevoia, motivația sau bariera publicului și comportamentul pe care campania vrea să îl stimuleze.',
  value:
    'Formulează beneficiul distinct pe care Valea Jiului îl oferă publicului ales prin această campanie.',
  centralIdea:
    'Ideea centrală explică mecanismul creativ al campaniei, nu este doar un slogan.',
  promise:
    'Promisiunea este beneficiul esențial pe care campania îl poate susține prin experiențe reale.',
  mainMessage:
    'Mesajul principal trebuie să poată fi folosit ca formulare de referință în toate activările derivate.',
  secondaryMessages:
    'Adaugă mesaje care susțin ideea centrală din perspective diferite. Scrie câte un mesaj pe rând.',
  storytelling:
    'Direcțiile de storytelling sunt teme recurente pentru conținut, nu titluri de postări. Scrie câte una pe rând.',
  tone:
    'Tonul definește cum vorbește campania și ce trebuie evitat.',
  cta:
    'Selectează doar acțiunile relevante pentru campanie. CTA-urile pot fi adaptate ulterior pe canal și activare.',
  products:
    'Selectează produsele sau categoriile de experiențe pe care campania le poate promova. Lista finală trebuie validată și actualizată de OMD.',
  productCondition:
    'Precizează condițiile care trebuie verificate înainte de comunicare: disponibilitate, acces, program, siguranță, drepturi și sursa informației.',
  channels:
    'Alege numai canalele care au un rol clar în campanie. Detalierea planului editorial se face ulterior, la nivel de activare.',
  pr:
    'Rezumatul trebuie să indice unghiurile de PR, partenerii relevanți și informațiile sau resursele pe care aceștia trebuie să le furnizeze.',
  kpiDefinitions:
    'Indicatorii trebuie să poată fi măsurați prin surse disponibile. Baseline-ul și țintele finale se stabilesc după Auditul Zero și în funcție de buget.',
  fixed:
    'Elementele fixe nu se modifică în activările derivate: ideea, promisiunea, mesajul central, relația cu brandul și regulile esențiale.',
  adaptable:
    'Selectează elementele care pot varia în funcție de public, sezon, produs, canal, partener și context.',
  limits:
    'Formulează clar ce nu este permis: promisiuni neverificate, acces nesigur, reprezentări inadecvate sau utilizări care afectează brandul.',
  examples:
    'Exemplele arată cum se adaptează campania într-un context concret și ce elemente trebuie să rămână neschimbate.',
  headlines:
    'Adaugă exemple de headline, text suport și CTA. Acestea sunt repere reutilizabile, nu un plan editorial complet.',
  mockups:
    'Descrie direcțiile de machete și formatele recomandate. În prototip, linkurile Canva sunt simulate.',
  posts:
    'Adaugă exemple scurte de postări care arată cum se aplică mesajele campaniei.',
  videos:
    'Definește conceptul, durata, structura narativă și închiderea/CTA-ul.',
  activationExamples:
    'Exemplele orientative arată posibile direcții de execuție ale campaniei. Ele nu clasifică activările și nu sunt preluate ca tip în activarea concretă.',
};

/**
 * The prototype's `.info` bubble and its floating tooltip.
 *
 * The panel is portalled to `document.body`, which is where `OMD.tip` appended
 * it, and that placement is load-bearing twice over:
 *
 *   - `.label` sets `text-transform:uppercase`, so a tooltip nested inside the
 *     label inherits it and renders the help text shouting in capitals.
 *   - `.tooltip` is `position:fixed` precisely so `max-width:300px` resolves
 *     against the viewport. Nested in the label's small inline-flex span it
 *     shrink-to-fits that box instead and wraps into a one-word column.
 *
 * Coordinates are the prototype's own arithmetic, clamped to keep the panel on
 * screen. It opens on hover and on focus, so the text is reachable by keyboard.
 */
function InfoTip({ helpKey }: { helpKey: HelpKey }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const text = HELP[helpKey];

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      left: Math.max(12, Math.min(window.innerWidth - 312, rect.left - 15)),
      top: Math.min(window.innerHeight - 100, rect.bottom + 8),
    });
  };
  const hide = () => setAt(null);

  // The prototype rendered the bubble regardless and opened an empty tooltip.
  if (!text) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={at ? 'info open' : 'info'}
        aria-label="Explicație"
        aria-expanded={at !== null}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => (at ? hide() : show())}
      >
        i
      </button>
      {at
        ? createPortal(
            <span className="tooltip" role="tooltip" style={{ left: at.left, top: at.top }}>
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
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
  const isTactical = typeLabel.includes('tactică');

  const close = () => navigate(isEdit ? `/campaigns/${externalKey}` : '/campaigns');

  /**
   * Which sections were seeded from another campaign, and what they held before
   * the *first* such import.
   *
   * Re-importing over an existing import keeps the original snapshot, so "Șterge
   * ce a fost preluat" always returns to what you actually typed rather than to
   * the previous import. That is the prototype's `contextImports[kind].before`.
   */
  const [imports, setImports] = useState<
    Partial<Record<ContextSection, { title: string; before: CampaignFormState }>>
  >({});

  /** Catalogue code for a stored label; falls back to the label itself. */
  const codeFor = (options: CatalogEntry[], label: string | null): string => {
    if (!label) return '';
    return options.find((entry) => entry.label === label || entry.displayLabel === label)?.code ?? label;
  };

  const applyContext = (section: ContextSection, source: CampaignDetail) => {
    // Built from `form` rather than inside a setState updater: the snapshot must
    // be taken exactly once, and an updater can run twice under StrictMode.
    const current = form;
    const next: CampaignFormState = (() => {
      const audiences = catalogs?.audience_segments ?? [];
      const ctas = catalogs?.cta_types ?? [];
      const next: CampaignFormState = { ...current };

      if (section === 'public') {
        next.primaryAudienceCode = codeFor(audiences, source.primaryAudienceSegment);
        next.secondaryAudienceCodes = (source.secondaryAudienceSegments ?? [])
          .slice(0, 6)
          .map((label) => codeFor(audiences, label));
        next.primaryAudienceDescription = source.primaryAudienceDescription ?? '';
        next.insight = source.insight ?? '';
        next.valueProposition = source.valueProposition ?? '';
      }

      if (section === 'concept') {
        // The tactical core stays the author's own; only the supporting layer
        // travels.
        if (!isTactical) {
          next.centralIdea = source.centralIdea ?? '';
          next.promise = source.promise ?? '';
          next.mainMessage = source.mainMessage ?? '';
        }
        next.secondaryMessages = [...(source.secondaryMessages ?? [])];
        next.storytellingDirections = [...(source.storytellingDirections ?? [])];
        next.tone = source.tone ?? '';
        next.ctaCodes = (source.ctas ?? []).slice(0, 5).map((label) => codeFor(ctas, label));
      }

      if (section === 'products') {
        next.products = [...(source.products ?? [])].slice(0, 15);
        next.productCondition = source.productCondition ?? '';
        next.channels = [...(source.channels ?? [])].slice(0, 12);
        next.prPartnerships = source.prPartnerships ?? '';
        next.kpiDefinitions = (source.kpiDefinitions ?? []).map((kpi) => ({ ...kpi }));
      }

      if (section === 'rules') {
        // Fixed elements of a tactical campaign are a live link to the parent,
        // so they are never copied down.
        if (!isTactical) next.fixedElements = [...(source.fixedElements ?? [])];
        next.adaptableElements = [...(source.adaptableElements ?? [])].slice(0, 12);
        next.adaptationLimits = [...(source.adaptationLimits ?? [])];
        next.applicationExamples = (source.applicationExamples ?? []).map((x) => ({ ...x }));
      }

      if (section === 'deliverables') {
        if (isUmbrella) {
          next.deliverableIntro = source.deliverableIntro ?? '';
          next.noVisualsNote = source.noVisualsNote ?? '';
          next.frameworkDeliverables = (source.frameworkDeliverables ?? []).map((x) => ({ ...x }));
        } else {
          next.headlines = (source.headlines ?? []).map((x) => ({ ...x }));
          next.mockups = (source.mockups ?? []).map((mockup) => ({
            name: mockup.name,
            formats: mockup.formats,
            structure: mockup.structure,
            canvaUrl: mockup.canvaUrl,
          }));
          next.posts = (source.posts ?? []).map((x) => ({ ...x }));
          next.videoConcepts = (source.videoConcepts ?? []).map((x) => ({ ...x }));
        }
      }

      if (section === 'activationExamples') {
        next.activationDirections = (source.activationExamples?.directions ?? []).map((x) => ({
          ...x,
        }));
      }

      return next;
    })();

    setForm(next);
    // Snapshot only on the first import into this section, so Clear returns to
    // what the author typed rather than to the previous import.
    setImports((state) => ({
      ...state,
      [section]: { title: source.title, before: state[section]?.before ?? current },
    }));
    setMessage(null);
  };

  const clearContext = (section: ContextSection) => {
    const entry = imports[section];
    if (!entry) return;
    setForm(entry.before);
    setImports((state) => {
      const next = { ...state };
      delete next[section];
      return next;
    });
  };

  const contextPanel = (section: ContextSection) => (
    <ContextImportPanel
      section={section}
      campaigns={allCampaigns.filter((campaign) => campaign.id !== externalKey)}
      isTactical={isTactical}
      importedFrom={imports[section]?.title ?? null}
      onApply={(source) => applyContext(section, source)}
      onClear={() => clearContext(section)}
    />
  );

  // Lineage is typed, so the parent list is not "every campaign": an umbrella
  // has no parent, a tactical one derives from a thematic campaign, and a
  // thematic one from the umbrella. Same rule as the prototype's
  // `parentCandidates()`.
  const { items: allCampaigns } = useCampaigns(EMPTY_FILTERS);
  const parentCandidates = useMemo(() => {
    if (isUmbrella) return [];
    const others = allCampaigns.filter((campaign) => campaign.id !== externalKey);
    return isTactical
      ? others.filter(
          (campaign) => campaign.type.includes('tematică') && !campaign.type.includes('tactică'),
        )
      : others.filter((campaign) => campaign.type.includes('umbrelă'));
  }, [allCampaigns, externalKey, isUmbrella, isTactical]);

  const parentCampaign =
    allCampaigns.find((campaign) => campaign.id === form.parentCampaignExternalKey) ?? null;

  const parentHint = isTactical
    ? 'Campania tactică preia elementele fixe prin legătură vie din campania tematică părinte. În secțiunile următoare poți copia și adapta publicurile, produsele, canalele, mesajele secundare, KPI-urile și template-urile.'
    : 'Campania tematică derivă din campania-umbrelă.';

  // The prototype's `ensureParentSelection()`: a non-umbrella campaign always
  // has a parent selected, and switching type re-points it at a valid one
  // rather than leaving a dangling key from the previous type's list.
  useEffect(() => {
    if (isUmbrella) {
      setForm((current) =>
        current.parentCampaignExternalKey === null
          ? current
          : { ...current, parentCampaignExternalKey: null },
      );
      return;
    }
    const first = parentCandidates[0];
    if (!first) return;
    setForm((current) => {
      if (parentCandidates.some((c) => c.id === current.parentCampaignExternalKey)) return current;
      // A tactical campaign inherits its parent's pillar when none is chosen
      // yet. `pillar` is the catalogue label the list projection selected from
      // the same column, so matching on it is exact rather than fuzzy.
      const inherited =
        isTactical && !current.pillarCode
          ? ((catalogs?.pillars ?? []).find((p) => p.label === first.pillar)?.code ?? '')
          : '';
      return {
        ...current,
        parentCampaignExternalKey: first.id,
        pillarCode: inherited || current.pillarCode,
      };
    });
  }, [isUmbrella, isTactical, parentCandidates, catalogs]);

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

  // Completion drives the left nav's ✓ marks and the "Completare" gauge — the
  // prototype's `sectionChecks()`. A step counts as done when the validator it
  // already has raises nothing, so there is no second definition of "complete"
  // to drift out of sync with what Continuă enforces.
  const done = STEPS.map((_, index) => validateStep(index + 1, form, types) === null);
  const doneCount = done.filter(Boolean).length;
  const pct = Math.round((doneCount / STEPS.length) * 100);

  if (loading) return <div className="state-note">Se încarcă campania…</div>;

  return (
    <div className="modal-bg">
      <section className="modal campaign-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <div className="form-mode-label">{isEdit ? 'MOD EDITARE' : 'CAMPANIE NOUĂ'}</div>
            <h2>{isEdit ? `Editează campania – ${form.title}` : 'Adaugă o campanie'}</h2>
            <p>
              {isEdit
                ? 'Poți deschide direct orice secțiune din meniul din stânga. Modificările se salvează în aceeași fișă.'
                : 'Formular modular cu selecții rapide, exemple și sugestii editabile.'}
            </p>
          </div>
          <button className="x" type="button" onClick={close} aria-label="Închide">
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="wizard">
            <aside className="steps">
              {STEPS.map((entry, index) => {
                const number = index + 1;
                const classes = ['step', 'navigable'];
                if (step === number) classes.push('active');
                if (done[index]) classes.push('complete');
                return (
                  <button
                    key={entry.title}
                    type="button"
                    className={classes.join(' ')}
                    aria-current={step === number ? 'step' : 'false'}
                    onClick={() => {
                      setMessage(null);
                      setStep(number);
                    }}
                  >
                    <b>{done[index] ? '✓' : number}</b>
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.hint}</small>
                    </span>
                  </button>
                );
              })}

              <div className="toc-progress">
                <div>
                  <span>Completare</span>
                  <b>{pct}%</b>
                </div>
                <div className="toc-track">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p>
                  {doneCount} din {STEPS.length} secțiuni complete. Poți sări la orice secțiune.
                </p>
              </div>

              <div className="future">
                <strong>{isEdit ? 'Navigare directă' : 'Structură modulară'}</strong>
                <br />
                {isEdit
                  ? 'Apasă pe orice secțiune. Datele introduse în secțiunea curentă sunt păstrate când schimbi pagina.'
                  : 'Resursele generale și Planul anual vor fi conectate ca module separate.'}
              </div>
            </aside>

            <main className="form-area" id="formArea">
              {message ? (
                <div className="state-note error" role="alert">
                  {message}
                </div>
              ) : null}

              {step === 1 ? (
                <>
                  <h3>0. Identificare</h3>
                  <p className="intro">
                    Câmpurile principale sunt selecții simple și pot fi ajustate ulterior.
                  </p>

                  <div className="form-grid">
                    <div className="field full">
                      <label className="label" htmlFor="campaignTitle">
                        Denumirea campaniei <span className="req">*</span>
                      </label>
                      <input
                        id="campaignTitle"
                        className="control"
                        value={form.title}
                        onChange={(event) => set('title', event.target.value)}
                        placeholder="Ex.: Primăvara pe trasee"
                      />
                      <div className="hint">
                        Folosește un nume scurt și diferit de poziționarea generală.
                      </div>
                    </div>

                    <div className="field full">
                      <div className="label">
                        Tipul campaniei <InfoTip helpKey="type" />
                      </div>
                      <div className="choices">
                        {types.map((entry) => (
                          <button
                            key={entry.code}
                            type="button"
                            className={
                              entry.code === form.campaignTypeCode ? 'choice selected' : 'choice'
                            }
                            onClick={() => set('campaignTypeCode', entry.code)}
                          >
                            <strong>{entry.displayLabel ?? entry.label}</strong>
                            <span>{entry.hint ?? ''}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="parentCampaignId">
                        Campania din care derivă {isTactical ? <span className="req">*</span> : null}
                      </label>
                      <select
                        id="parentCampaignId"
                        className="control"
                        disabled={isUmbrella}
                        value={form.parentCampaignExternalKey ?? ''}
                        onChange={(event) =>
                          set('parentCampaignExternalKey', event.target.value || null)
                        }
                      >
                        {isUmbrella ? (
                          <option value="">Nu este cazul</option>
                        ) : (
                          parentCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.title} · {candidate.pillarShort || candidate.pillar}
                            </option>
                          ))
                        )}
                      </select>
                      {!isUmbrella ? <div className="hint">{parentHint}</div> : null}
                    </div>

                    <div className="field full">
                      <div className="seasonality-editor">
                        <div className="seasonality-editor-head">
                          <div>
                            <strong>Sezonalitate</strong>
                            <span>
                              Tipul este descriptiv. Lunile selectate sunt informația operativă
                              folosită în Calendarul Planului anual.
                            </span>
                          </div>
                        </div>

                        <div className="form-grid">
                          <div className="field">
                            <label className="label" htmlFor="seasonalityType">
                              Tip sezonalitate
                            </label>
                            <select
                              id="seasonalityType"
                              className="control"
                              value={form.seasonalityTypeCode}
                              onChange={(event) => set('seasonalityTypeCode', event.target.value)}
                            >
                              {(catalogs?.seasonality_types ?? []).map((entry) => (
                                <option key={entry.code} value={entry.code}>
                                  {entry.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="field">
                            <label className="label">Fereastră strategică rezultată</label>
                            {/* Read-only echo of the month picker below, styled as a
                                control so the pair reads as one row. */}
                            <div
                              className="control"
                              style={{ background: 'var(--soft)', cursor: 'default' }}
                            >
                              {seasonalityPeriodLabel(form.seasonalityMonths)}
                            </div>
                          </div>

                          <div className="field full">
                            <label className="label">
                              Luni de relevanță <span className="req">*</span>
                            </label>
                            <div className="seasonality-months">
                              {MONTH_LABELS.map((month, index) => {
                                const value = index + 1;
                                const selected = form.seasonalityMonths.includes(value);
                                return (
                                  <button
                                    key={month}
                                    type="button"
                                    className={selected ? 'season-month selected' : 'season-month'}
                                    aria-pressed={selected}
                                    onClick={() =>
                                      set(
                                        'seasonalityMonths',
                                        selected
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
                            <div className="seasonality-summary">
                              Calendarul va folosi exclusiv aceste luni.{' '}
                              <b>{seasonalityMonthsLabel(form.seasonalityMonths)}</b>
                            </div>
                          </div>

                          <div className="field full">
                            <label className="label" htmlFor="seasonalityNote">
                              Observații privind sezonalitatea
                            </label>
                            <textarea
                              id="seasonalityNote"
                              className="control compact-textarea"
                              value={form.seasonalityNote}
                              onChange={(event) => set('seasonalityNote', event.target.value)}
                              placeholder="Ex.: Cu extensii posibile în funcție de produsele disponibile."
                            />
                            <div className="hint">
                              Text explicativ; nu este folosit pentru calcularea calendarului.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="field full">
                      <div className="label">
                        Pilon tematic <span className="req">*</span> <InfoTip helpKey="pillar" />
                      </div>
                      <div className="choices">
                        {(catalogs?.pillars ?? []).map((entry) => (
                          <button
                            key={entry.code}
                            type="button"
                            className={entry.code === form.pillarCode ? 'choice selected' : 'choice'}
                            onClick={() => set('pillarCode', entry.code)}
                          >
                            <strong>{entry.displayLabel ?? entry.label}</strong>
                            <span>{entry.hint ?? ''}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="field">
                      <label className="label" htmlFor="campaignStatus">
                        Stadiu
                      </label>
                      <select
                        id="campaignStatus"
                        className="control"
                        value={form.statusCode}
                        onChange={(event) => set('statusCode', event.target.value)}
                      >
                        {(catalogs?.campaign_statuses ?? []).map((entry) => (
                          <option key={entry.code} value={entry.code}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label className="label" htmlFor="campaignVersion">
                        Versiune
                      </label>
                      <input
                        id="campaignVersion"
                        className="control"
                        value={form.version}
                        onChange={(event) => set('version', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="campaignResponsible">
                        Responsabil OMD
                      </label>
                      <input
                        id="campaignResponsible"
                        className="control"
                        value={form.responsible}
                        onChange={(event) => set('responsible', event.target.value)}
                        placeholder="Coordonator marketing și comunicare"
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <h3>1. Încadrare strategică</h3>
                  <p className="intro">
                    Alege relațiile strategice și formulează numai rezultate pe care campania le
                    poate influența realist.
                  </p>

                  <div className="form-grid">
                    <div className="field full">
                      <div className="label">
                        Programe strategice <InfoTip helpKey="program" />
                      </div>
                      <ChipPicker
                        options={catalogs?.programs ?? []}
                        primary={form.programPrimaryCode}
                        secondary={form.programSecondaryCodes}
                        max={2}
                        title="Programe disponibile"
                        primaryTitle="Program principal"
                        secondaryTitle="Programe secundare"
                        onChange={(primary, secondary) =>
                          setForm((current) => ({
                            ...current,
                            programPrimaryCode: primary,
                            programSecondaryCodes: secondary,
                          }))
                        }
                      />
                    </div>

                    <div className="field full">
                      <div className="label">
                        Obiective SMART <InfoTip helpKey="objective" />
                      </div>
                      <ObjectivePicker
                        options={catalogs?.objectives ?? []}
                        primary={form.objectivePrimaryCode}
                        secondary={form.objectiveSecondaryCodes}
                        onChange={(primary, secondary) =>
                          setForm((current) => ({
                            ...current,
                            objectivePrimaryCode: primary,
                            objectiveSecondaryCodes: secondary,
                          }))
                        }
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="marketingObjective">
                        Obiectivul de marketing <span className="req">*</span>{' '}
                        <InfoTip helpKey="marketing" />
                      </label>
                      <textarea
                        id="marketingObjective"
                        className="control"
                        value={form.marketingObjective}
                        onChange={(event) => set('marketingObjective', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="directResult">
                        Rezultatul direct urmărit <span className="req">*</span>{' '}
                        <InfoTip helpKey="result" />
                      </label>
                      <textarea
                        id="directResult"
                        className="control"
                        value={form.directResult}
                        onChange={(event) => set('directResult', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="strategicContribution">
                        Contribuția strategică <InfoTip helpKey="contribution" />
                      </label>
                      {/* Stored as an array here, unlike the prototype's single
                          text field, so one contribution per line. */}
                      <ListTextarea
                        value={form.strategicContribution}
                        onChange={(next) => set('strategicContribution', next)}
                        placeholder="Câte o contribuție pe rând"
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <h3>2. Publicuri, insight și valoare</h3>
                  <p className="intro">
                    Selectează rapid segmentele, apoi descrie pe scurt motivația publicului și
                    beneficiul distinct al campaniei.
                  </p>

                  {contextPanel('public')}

                  <div className="form-grid">
                    <div className="field full">
                      <div className="label">
                        Public principal și publicuri secundare <span className="req">*</span>{' '}
                        <InfoTip helpKey="public" />
                      </div>
                      <AudiencePicker
                        options={catalogs?.audience_segments ?? []}
                        primary={form.primaryAudienceCode}
                        secondary={form.secondaryAudienceCodes}
                        onChange={(primary, secondary) =>
                          setForm((current) => ({
                            ...current,
                            primaryAudienceCode: primary,
                            secondaryAudienceCodes: secondary,
                          }))
                        }
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="publicDetail">
                        Detalierea publicului principal
                      </label>
                      <textarea
                        id="publicDetail"
                        className="control compact-textarea"
                        value={form.primaryAudienceDescription}
                        onChange={(event) => set('primaryAudienceDescription', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="insight">
                        Insight și motivație <span className="req">*</span>{' '}
                        <InfoTip helpKey="insight" />
                      </label>
                      <textarea
                        id="insight"
                        className="control tall-textarea"
                        value={form.insight}
                        onChange={(event) => set('insight', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="valueProposition">
                        Propunerea de valoare <span className="req">*</span>{' '}
                        <InfoTip helpKey="value" />
                      </label>
                      <textarea
                        id="valueProposition"
                        className="control"
                        value={form.valueProposition}
                        onChange={(event) => set('valueProposition', event.target.value)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <h3>2. Conceptul campaniei</h3>
                  <p className="intro">
                    Construiește nucleul creativ. Poți porni de la exemplul cel mai apropiat și apoi
                    adapta formulările.
                  </p>

                  {contextPanel('concept')}

                  <div className="form-grid">
                    <div className="field full">
                      <label className="label" htmlFor="centralIdea">
                        Ideea centrală <span className="req">*</span>{' '}
                        <InfoTip helpKey="centralIdea" />
                      </label>
                      <textarea
                        id="centralIdea"
                        className="control tall-textarea"
                        value={form.centralIdea}
                        onChange={(event) => set('centralIdea', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="promise">
                        Promisiunea campaniei <span className="req">*</span>{' '}
                        <InfoTip helpKey="promise" />
                      </label>
                      <textarea
                        id="promise"
                        className="control compact-textarea"
                        value={form.promise}
                        onChange={(event) => set('promise', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="mainMessage">
                        Mesajul principal <span className="req">*</span>{' '}
                        <InfoTip helpKey="mainMessage" />
                      </label>
                      <textarea
                        id="mainMessage"
                        className="control compact-textarea"
                        value={form.mainMessage}
                        onChange={(event) => set('mainMessage', event.target.value)}
                      />
                    </div>

                    <div className="field">
                      <div className="label">Mesaje secundare <InfoTip helpKey="secondaryMessages" /></div>
                      <ListTextarea
                        value={form.secondaryMessages}
                        onChange={(next) => set('secondaryMessages', next)}
                        placeholder="Câte un mesaj pe rând"
                      />
                    </div>

                    <div className="field">
                      <div className="label">Direcții de storytelling <InfoTip helpKey="storytelling" /></div>
                      <ListTextarea
                        value={form.storytellingDirections}
                        onChange={(next) => set('storytellingDirections', next)}
                        placeholder="Câte o direcție pe rând"
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="tone">
                        Tonul comunicării{' '}
                        <InfoTip helpKey="tone" />
                      </label>
                      <textarea
                        id="tone"
                        className="control"
                        value={form.tone}
                        onChange={(event) => set('tone', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <div className="label">CTA-uri <InfoTip helpKey="cta" /></div>
                      <CtaPicker
                        options={catalogs?.cta_types ?? []}
                        selected={form.ctaCodes}
                        onChange={(next) => set('ctaCodes', next)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 5 ? (
                <>
                  <h3>3. Produse, canale și măsurare</h3>
                  <p className="intro">
                    Selectează componentele relevante. Planul editorial și utilizarea concretă se
                    vor detalia ulterior, la nivel de activare.
                  </p>

                  {contextPanel('products')}

                  <div className="form-grid">
                    <div className="field full">
                      <div className="label">
                        Produse și experiențe promovate <span className="req">*</span>{' '}
                        <InfoTip helpKey="products" />
                      </div>
                      <MultiPicker
                        options={(catalogs?.product_catalog ?? []).map((entry) => ({
                          value: entry.displayLabel ?? entry.label,
                          hint: entry.hint,
                        }))}
                        selected={form.products}
                        title="Categorii disponibile"
                        selectedTitle="Produse selectate"
                        placeholder="Adaugă un produs sau o experiență"
                        max={15}
                        onChange={(next) => set('products', next)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="productCondition">
                        Condiții și informații relevante{' '}
                        <InfoTip helpKey="productCondition" />
                      </label>
                      <textarea
                        id="productCondition"
                        className="control tall-textarea"
                        value={form.productCondition}
                        onChange={(event) => set('productCondition', event.target.value)}
                        placeholder="Disponibilitate, program, acces, siguranță, drepturi, sursa și linkul actualizat."
                      />
                    </div>

                    <div className="field full">
                      <div className="label">
                        Canale recomandate <span className="req">*</span>{' '}
                        <InfoTip helpKey="channels" />
                      </div>
                      <MultiPicker
                        options={(catalogs?.channel_catalog ?? []).map((entry) => ({
                          value: entry.displayLabel ?? entry.label,
                          hint: entry.hint,
                        }))}
                        selected={form.channels}
                        title="Canale disponibile"
                        selectedTitle="Canale selectate"
                        placeholder="Adaugă un canal"
                        max={12}
                        onChange={(next) => set('channels', next)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="prPartnerships">
                        Componenta de PR și parteneriate{' '}
                        <InfoTip helpKey="pr" />
                      </label>
                      <textarea
                        id="prPartnerships"
                        className="control tall-textarea"
                        value={form.prPartnerships}
                        onChange={(event) => set('prPartnerships', event.target.value)}
                        placeholder="Unghiuri de PR, media relevante, parteneri și resurse necesare."
                      />
                    </div>

                    <div className="field full">
                      <div className="label">
                        Indicatori și surse de date <span className="req">*</span>{' '}
                        <InfoTip helpKey="kpiDefinitions" />
                      </div>
                      <div className="note-box">
                        Țintele sunt orientative. Valorile finale se stabilesc după Auditul Zero, în
                        funcție de buget și accesul la date.
                      </div>
                      <RowTable
                        rows={form.kpiDefinitions}
                        wrapClass="metric-wrap"
                        tableClass="edit-table"
                        columns={[
                          {
                            key: 'name',
                            header: 'Indicator',
                            placeholder: 'Ex.: Trafic landing page',
                          },
                          {
                            key: 'baseline',
                            header: 'Valoare de referință',
                            placeholder: 'T0 / sezon anterior',
                          },
                          { key: 'target', header: 'Țintă orientativă', placeholder: 'Ex.: +20%' },
                          {
                            key: 'source',
                            header: 'Sursa de date',
                            placeholder: 'Analytics / raportări',
                          },
                        ]}
                        addLabel="＋ Adaugă indicator"
                        empty={() => ({ name: '', baseline: '', target: '', source: '' })}
                        onChange={(next) => set('kpiDefinitions', next)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 6 ? (
                <>
                  <h3>4. Reguli de utilizare și adaptare</h3>
                  <p className="intro">
                    Regulile protejează ideea campaniei și fac posibilă adaptarea ei fără
                    reconstruirea conceptului.
                  </p>

                  {contextPanel('rules')}

                  <div className="form-grid">
                    <div className="field full">
                      {/* A tactical campaign does not own its fixed elements: they
                          stay live-linked to the thematic parent, so the prototype
                          shows them read-only rather than copying them down. */}
                      {isTactical && parentCampaign ? (
                        <div className="linked-fixed-box">
                          <header>
                            <div>
                              <small>Legătură vie cu fișa părinte</small>
                              <strong>{parentCampaign.title}</strong>
                            </div>
                            <span className="badge status">Sincronizat</span>
                          </header>
                          <p>
                            Aceste elemente nu se copiază și nu se editează aici. Orice modificare
                            validată în campania tematică părinte se reflectă automat în această
                            campanie tactică.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="label">
                            Elemente fixe <span className="req">*</span>{' '}
                            <InfoTip helpKey="fixed" />
                          </div>
                          <MultiPicker
                            options={[]}
                            selected={form.fixedElements}
                            title=""
                            selectedTitle="Elemente fixe"
                            placeholder="Adaugă un element fix"
                            max={12}
                            onChange={(next) => set('fixedElements', next)}
                          />
                        </>
                      )}
                    </div>

                    <div className="field full">
                      <div className="label">
                        Elemente adaptabile <span className="req">*</span>{' '}
                        <InfoTip helpKey="adaptable" />
                      </div>
                      <MultiPicker
                        options={ADAPTABLE_OPTIONS}
                        selected={form.adaptableElements}
                        title="Opțiuni frecvente"
                        selectedTitle="Elemente adaptabile selectate"
                        placeholder="Adaugă o regulă de adaptare"
                        max={12}
                        onChange={(next) => set('adaptableElements', next)}
                      />
                    </div>

                    <div className="field full">
                      <div className="label">
                        Limite de adaptare <span className="req">*</span>{' '}
                        <InfoTip helpKey="limits" />
                      </div>
                      <MultiPicker
                        options={[]}
                        selected={form.adaptationLimits}
                        title=""
                        selectedTitle="Limite de adaptare"
                        placeholder="Adaugă o limită de adaptare"
                        max={12}
                        onChange={(next) => set('adaptationLimits', next)}
                      />
                    </div>

                    <div className="field full">
                      <div className="label">
                        Exemple de aplicare <span className="req">*</span>{' '}
                        <InfoTip helpKey="examples" />
                      </div>
                      <RowTable
                        rows={form.applicationExamples}
                        wrapClass="example-wrap"
                        tableClass="edit-table examples"
                        columns={[
                          {
                            key: 'context',
                            header: 'Context',
                            placeholder: 'Ex.: Familie – 3 zile',
                            multiline: true,
                          },
                          {
                            key: 'adaptation',
                            header: 'Adaptare recomandată',
                            placeholder: 'Cum se adaptează campania',
                            multiline: true,
                          },
                          {
                            key: 'fixed',
                            header: 'Elemente care rămân fixe',
                            placeholder: 'Ce nu se schimbă',
                            multiline: true,
                          },
                        ]}
                        addLabel="＋ Adaugă exemplu"
                        empty={() => ({ context: '', adaptation: '', fixed: '' })}
                        onChange={(next) => set('applicationExamples', next)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 7 && isUmbrella ? (
                <>
                  <h3>5. Livrabile de cadru ale campaniei-umbrelă</h3>
                  <p className="intro">
                    Campania-umbrelă stabilește arhitectura strategică și verbală comună. Toate
                    câmpurile afișate în fișa de vizualizare pot fi actualizate aici.
                  </p>

                  <div className="form-grid">
                    <div className="field full">
                      <label className="label" htmlFor="deliverableIntro">
                        Introducerea secțiunii de livrabile
                      </label>
                      <textarea
                        id="deliverableIntro"
                        className="control tall-textarea"
                        value={form.deliverableIntro}
                        onChange={(event) => set('deliverableIntro', event.target.value)}
                      />
                    </div>

                    <div className="field full">
                      <div className="label">Livrabile de cadru</div>
                      <RowTable
                        rows={form.frameworkDeliverables}
                        columns={[
                          { key: 'name', header: 'Livrabil', placeholder: 'Denumirea livrabilului' },
                          {
                            key: 'content',
                            header: 'Conținut orientativ',
                            placeholder: 'Conținut orientativ',
                            multiline: true,
                          },
                          {
                            key: 'format',
                            header: 'Format',
                            placeholder: 'Document editabil / PDF',
                          },
                        ]}
                        addLabel="＋ Adaugă livrabil de cadru"
                        empty={() => ({ name: '', content: '', format: '' })}
                        onChange={(next) => set('frameworkDeliverables', next)}
                      />
                    </div>

                    <div className="field full">
                      <label className="label" htmlFor="noVisualsNote">
                        Notă privind absența vizualurilor distincte
                      </label>
                      <textarea
                        id="noVisualsNote"
                        className="control"
                        value={form.noVisualsNote}
                        onChange={(event) => set('noVisualsNote', event.target.value)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 7 && !isUmbrella ? (
                <>
                  <h3>5. Livrabile și template-uri specifice campaniei</h3>
                  <p className="intro">
                    Configurează reperele reutilizabile. În modul de editare poți modifica și
                    vizualurile asociate fiecărei machete.
                  </p>

                  {contextPanel('deliverables')}

                  <div className="form-grid">
                    <div className="field full">
                      <div className="label">5.1. Headline-uri și texte <InfoTip helpKey="headlines" /></div>
                      <RowTable
                        rows={form.headlines}
                        columns={[
                          {
                            key: 'headline',
                            header: 'Headline',
                            placeholder: 'Headline',
                            multiline: true,
                          },
                          {
                            key: 'support',
                            header: 'Text suport',
                            placeholder: 'Text suport',
                            multiline: true,
                          },
                          { key: 'cta', header: 'CTA', placeholder: 'CTA' },
                        ]}
                        addLabel="＋ Adaugă headline"
                        empty={() => ({ headline: '', support: '', cta: '' })}
                        onChange={(next) => set('headlines', next)}
                      />
                    </div>

                    <div className="field full">
                      <div className="label">5.2. Direcții de machete digitale <InfoTip helpKey="mockups" /></div>
                      <div className="mockup-edit-list">
                        {form.mockups.map((mockup, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <article className="mockup-edit-card" key={index}>
                            <div className="mockup-edit-head">
                              <div>
                                <small>MACHETĂ {index + 1}</small>
                                <strong>{mockup.name || 'Machetă fără denumire'}</strong>
                              </div>
                              <button
                                type="button"
                                className="row-remove"
                                title="Elimină macheta"
                                onClick={() =>
                                  set(
                                    'mockups',
                                    form.mockups.filter((_, i) => i !== index),
                                  )
                                }
                              >
                                ×
                              </button>
                            </div>

                            <div className="mockup-edit-fields">
                              <label>
                                Denumire machetă
                                <input
                                  value={mockup.name}
                                  placeholder="Ex.: Calendarul verii"
                                  onChange={(event) =>
                                    set(
                                      'mockups',
                                      form.mockups.map((m, i) =>
                                        i === index ? { ...m, name: event.target.value } : m,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                Formate recomandate
                                <textarea
                                  value={mockup.formats}
                                  placeholder="Post; story; banner"
                                  onChange={(event) =>
                                    set(
                                      'mockups',
                                      form.mockups.map((m, i) =>
                                        i === index ? { ...m, formats: event.target.value } : m,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label className="full">
                                Structură orientativă
                                <textarea
                                  value={mockup.structure}
                                  placeholder="Conținutul și ordinea elementelor"
                                  onChange={(event) =>
                                    set(
                                      'mockups',
                                      form.mockups.map((m, i) =>
                                        i === index ? { ...m, structure: event.target.value } : m,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label className="full">
                                Link Canva
                                <input
                                  value={mockup.canvaUrl}
                                  placeholder="Link Canva (simulat sau real)"
                                  onChange={(event) =>
                                    set(
                                      'mockups',
                                      form.mockups.map((m, i) =>
                                        i === index ? { ...m, canvaUrl: event.target.value } : m,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            </div>

                            {/* The prototype shows this note whenever visuals cannot
                                be attached from the form. This app has no upload
                                endpoint yet, so it shows in both modes. */}
                            <div className="visual-edit-note">
                              <b>Vizualuri</b>
                              <span>
                                Vizualurile intră deocamdată prin import; încărcarea din formular nu
                                este încă disponibilă.
                              </span>
                            </div>
                          </article>
                        ))}

                        <div className="note-box">
                          Linkul Canva poate fi înlocuit cu URL-ul template-ului real.
                        </div>
                        <button
                          type="button"
                          className="btn ghost add-row"
                          onClick={() =>
                            set('mockups', [
                              ...form.mockups,
                              { name: '', formats: '', structure: '', canvaUrl: '' },
                            ])
                          }
                        >
                          ＋ Adaugă machetă
                        </button>
                      </div>
                    </div>

                    <div className="field full">
                      <div className="label">5.3. Exemple de postări <InfoTip helpKey="posts" /></div>
                      <RowTable
                        rows={form.posts}
                        columns={[
                          {
                            key: 'title',
                            header: 'Titlu / unghi',
                            placeholder: 'Titlul exemplului',
                            multiline: true,
                          },
                          {
                            key: 'body',
                            header: 'Textul postării',
                            placeholder: 'Text orientativ',
                            multiline: true,
                          },
                          { key: 'cta', header: 'CTA', placeholder: 'CTA' },
                        ]}
                        addLabel="＋ Adaugă exemplu de postare"
                        empty={() => ({ title: '', body: '', cta: '' })}
                        onChange={(next) => set('posts', next)}
                      />
                    </div>

                    <div className="field full">
                      <div className="label">5.4. Concepte / scenarii video <InfoTip helpKey="videos" /></div>
                      <RowTable
                        rows={form.videoConcepts}
                        columns={[
                          { key: 'name', header: 'Concept', placeholder: 'Numele conceptului' },
                          { key: 'duration', header: 'Durată', placeholder: '30–60 sec.' },
                          {
                            key: 'narrative',
                            header: 'Structură narativă',
                            placeholder: 'Structură narativă',
                            multiline: true,
                          },
                          {
                            key: 'closing',
                            header: 'Închidere / CTA',
                            placeholder: 'Închidere / CTA',
                            multiline: true,
                          },
                        ]}
                        addLabel="＋ Adaugă concept video"
                        empty={() => ({ name: '', duration: '', narrative: '', closing: '' })}
                        onChange={(next) => set('videoConcepts', next)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {step === 8 ? (
                <>
                  <h3>6. Exemple orientative de activări</h3>
                  <p className="intro">
                    Listează exemple de acțiuni care pot inspira implementarea campaniei. Nu sunt
                    tipuri obligatorii și nu sunt preluate în fișa activării.
                  </p>

                  {contextPanel('activationExamples')}

                  <div className="form-grid">
                    <div className="field full">
                      <div className="label">
                        Exemple de activări <span className="req">*</span>{' '}
                        <InfoTip helpKey="activationExamples" />
                      </div>
                      <div className="note-box">
                        Acestea sunt exemple orientative de execuție. Activarea concretă se
                        definește separat prin denumire, perioadă, buget, materiale și rezultate.
                      </div>
                      <RowTable
                        rows={form.activationDirections}
                        columns={[
                          { key: 'name', header: 'Denumire', placeholder: 'Denumire' },
                          {
                            key: 'purpose',
                            header: 'Scop și public',
                            placeholder: 'Scop și public',
                            multiline: true,
                          },
                          {
                            key: 'channels',
                            header: 'Canale / materiale',
                            placeholder: 'Canale și materiale',
                            multiline: true,
                          },
                          {
                            key: 'metrics',
                            header: 'Indicatori relevanți',
                            placeholder: 'Indicatori',
                            multiline: true,
                          },
                        ]}
                        addLabel="＋ Adaugă exemplu de activare"
                        empty={() => ({ name: '', purpose: '', channels: '', metrics: '' })}
                        onChange={(next) => set('activationDirections', next)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

            </main>
          </div>
        </div>

        <footer className="modal-foot">
          <div className="progress">
            {isEdit
              ? `Secțiunea ${step} din ${STEPS.length} · navigare liberă`
              : `Pasul ${step} din ${STEPS.length}`}
            <span className="track">
              <span className="bar" style={{ width: `${(step / STEPS.length) * 100}%` }} />
            </span>
          </div>

          {/* In edit mode the left nav is the navigation, so the prototype drops
              back/next entirely and offers close + save. In create mode it walks
              the eight steps and only saves at the end. */}
          <div>
            {!isEdit && step > 1 ? (
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setMessage(null);
                  setStep((current) => Math.max(1, current - 1));
                }}
              >
                ← Înapoi
              </button>
            ) : null}

            {isEdit ? (
              <>
                <button className="btn secondary" type="button" onClick={close}>
                  Închide
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? 'Se salvează…' : 'Salvează modificările'}
                </button>
              </>
            ) : step < STEPS.length ? (
              <button className="btn primary" type="button" onClick={goNext}>
                Continuă →
              </button>
            ) : (
              <button
                className="btn primary"
                type="button"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? 'Se salvează…' : 'Salvează campania'}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
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
