/**
 * Campaign wizard state and validation.
 *
 * Pure logic, deliberately separate from the component so the step rules can be
 * unit-tested. The messages are the prototype's, word for word — they are part
 * of the functional contract the spec says not to reinterpret.
 */
import type { CatalogEntry } from './useCampaigns';

export interface KpiDefinition {
  name: string;
  baseline: string;
  target: string;
  source: string;
}

export interface ApplicationExample {
  context: string;
  adaptation: string;
  fixed: string;
}

export interface Headline {
  headline: string;
  support: string;
  cta: string;
}

export interface Mockup {
  name: string;
  formats: string;
  structure: string;
  canvaUrl: string;
}

export interface ActivationDirection {
  name: string;
  purpose: string;
  channels: string;
  metrics: string;
}

export interface CampaignFormState {
  title: string;
  campaignTypeCode: string;
  pillarCode: string;
  seasonalityTypeCode: string;
  seasonalityMonths: number[];
  seasonalityNote: string;
  statusCode: string;
  responsible: string;
  accent: string;
  version: string;
  parentCampaignExternalKey: string | null;

  programPrimaryCode: string;
  programSecondaryCodes: string[];
  objectivePrimaryCode: string;
  objectiveSecondaryCodes: string[];
  marketingObjective: string;
  directResult: string;
  strategicContribution: string[];

  primaryAudienceCode: string;
  secondaryAudienceCodes: string[];
  primaryAudienceDescription: string;
  insight: string;
  valueProposition: string;

  centralIdea: string;
  promise: string;
  mainMessage: string;
  secondaryMessages: string[];
  storytellingDirections: string[];
  tone: string;
  ctaCodes: string[];

  products: string[];
  productsIntro: string;
  productCondition: string;
  channels: string[];
  prPartnerships: string;
  kpiDefinitions: KpiDefinition[];

  fixedElements: string[];
  adaptableElements: string[];
  adaptationLimits: string[];
  applicationExamples: ApplicationExample[];

  deliverableIntro: string;
  frameworkDeliverables: Array<{ name: string; content: string; format: string }>;
  headlines: Headline[];
  posts: Array<{ title: string; body: string; cta: string }>;
  videoConcepts: Array<{ name: string; duration: string; narrative: string; closing: string }>;
  noVisualsNote: string;
  mockups: Mockup[];

  activationDirections: ActivationDirection[];
}

export const STEPS = [
  { title: 'Identificare', hint: 'Tip, pilon, sezon, responsabil' },
  { title: 'Încadrare strategică', hint: 'Programe, obiective, rezultate' },
  { title: 'Publicuri', hint: 'Segmente, insight, valoare' },
  { title: 'Concept', hint: 'Idee, mesaje, storytelling, CTA' },
  { title: 'Produse și măsurare', hint: 'Produse, canale, PR, indicatori' },
  { title: 'Reguli de adaptare', hint: 'Elemente fixe, limite și exemple' },
  { title: 'Livrabile & template-uri', hint: 'Headline-uri, machete, postări, video' },
  { title: 'Exemple de activări', hint: 'Idei orientative de execuție' },
] as const;

export const MONTH_LABELS = [
  'Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec',
];

/**
 * Common adaptable elements, from the prototype's `config.adaptableOptions`.
 *
 * Not a database catalogue: `adaptable_elements` is a free-text column on the
 * campaign, and these are only the suggestions the picker offers. An author can
 * type anything else alongside them.
 */
export const ADAPTABLE_OPTIONS: Array<{ value: string; hint: string }> = [
  { value: 'Sezonul și perioada', hint: 'Momentul din an sau fereastra concretă de activare.' },
  { value: 'Publicul și nivelul de detaliu', hint: 'Mesajele și utilitatea se adaptează segmentului.' },
  { value: 'Produsul sau experiența', hint: 'Se selectează numai produse validate și disponibile.' },
  { value: 'Canalul și formatul', hint: 'Postare, video, articol, itinerar, eveniment sau material B2B.' },
  { value: 'Localitatea, zona sau traseul', hint: 'Accentul geografic se poate schimba fără fragmentarea brandului.' },
  { value: 'Partenerii implicați', hint: 'Operatori, UAT-uri, ONG-uri, ghizi, comunități și organizatori.' },
  { value: 'CTA-ul', hint: 'Acțiunea cerută se adaptează etapei și canalului.' },
  { value: 'Bugetul și intensitatea media', hint: 'Scara activării poate varia fără schimbarea conceptului.' },
  { value: 'Mesajele secundare', hint: 'Pot varia dacă păstrează ideea centrală și promisiunea.' },
  { value: 'Contextul concret al activării', hint: 'Eveniment, weekend, lansare, produs sau piață specifică.' },
];

export function emptyForm(defaults: {
  typeCode?: string;
  statusCode?: string;
  seasonalityCode?: string;
}): CampaignFormState {
  return {
    title: '',
    campaignTypeCode: defaults.typeCode ?? '',
    pillarCode: '',
    seasonalityTypeCode: defaults.seasonalityCode ?? '',
    seasonalityMonths: [],
    seasonalityNote: '',
    statusCode: defaults.statusCode ?? 'DRAFT',
    responsible: '',
    accent: 'umbrella',
    version: '',
    parentCampaignExternalKey: null,
    programPrimaryCode: '',
    programSecondaryCodes: [],
    objectivePrimaryCode: '',
    objectiveSecondaryCodes: [],
    marketingObjective: '',
    directResult: '',
    strategicContribution: [],
    primaryAudienceCode: '',
    secondaryAudienceCodes: [],
    primaryAudienceDescription: '',
    insight: '',
    valueProposition: '',
    centralIdea: '',
    promise: '',
    mainMessage: '',
    secondaryMessages: [],
    storytellingDirections: [],
    tone: '',
    ctaCodes: [],
    products: [],
    productsIntro: '',
    productCondition: '',
    channels: [],
    prPartnerships: '',
    kpiDefinitions: [{ name: '', baseline: '', target: '', source: '' }],
    fixedElements: [],
    adaptableElements: [],
    adaptationLimits: [],
    applicationExamples: [{ context: '', adaptation: '', fixed: '' }],
    deliverableIntro: '',
    frameworkDeliverables: [],
    headlines: [{ headline: '', support: '', cta: '' }],
    posts: [],
    videoConcepts: [],
    noVisualsNote: '',
    mockups: [{ name: '', formats: '', structure: '', canvaUrl: '' }],
    activationDirections: [{ name: '', purpose: '', channels: '', metrics: '' }],
  };
}

const isUmbrella = (typeLabel: string) => typeLabel.includes('umbrelă');
const isTactical = (typeLabel: string) => typeLabel.includes('tactică');

/**
 * Per-step validation, mirroring the prototype's `validateStep()`.
 * Returns null when the step is complete, otherwise the exact message shown.
 */
export function validateStep(
  step: number,
  form: CampaignFormState,
  types: CatalogEntry[],
): string | null {
  const typeLabel = types.find((entry) => entry.code === form.campaignTypeCode)?.label ?? '';
  const tactical = isTactical(typeLabel);

  if (step === 1) {
    if (!form.title.trim() || !form.pillarCode || form.seasonalityMonths.length === 0 ||
        (tactical && !form.parentCampaignExternalKey)) {
      return tactical
        ? 'Completează denumirea, pilonul, lunile de relevanță și selectează campania tematică părinte.'
        : 'Completează denumirea, pilonul și cel puțin o lună de relevanță.';
    }
  }

  if (step === 2 && (!form.programPrimaryCode || !form.objectivePrimaryCode ||
      !form.marketingObjective.trim() || !form.directResult.trim())) {
    return 'Selectează programul și obiectivul principal și completează rezultatele.';
  }

  if (step === 3 && (!form.primaryAudienceCode || !form.insight.trim() || !form.valueProposition.trim())) {
    return 'Selectează publicul principal și completează insight-ul și propunerea de valoare.';
  }

  if (step === 4 && (!form.centralIdea.trim() || !form.promise.trim() || !form.mainMessage.trim())) {
    return 'Completează ideea centrală, promisiunea și mesajul principal.';
  }

  if (step === 5) {
    const validMetrics = form.kpiDefinitions.filter((m) => m.name.trim() && m.source.trim());
    if (!form.products.length || !form.channels.length || !validMetrics.length) {
      return 'Selectează produse și canale și completează cel puțin un indicator cu sursă.';
    }
  }

  if (step === 6) {
    const validExamples = form.applicationExamples.filter((x) => x.context.trim() && x.adaptation.trim());
    if (!form.fixedElements.length || !form.adaptableElements.length ||
        !form.adaptationLimits.length || !validExamples.length) {
      return 'Completează elementele fixe, adaptabile, limitele și cel puțin un exemplu.';
    }
  }

  if (step === 7) {
    if (isUmbrella(typeLabel)) {
      if (!form.deliverableIntro.trim() || !form.frameworkDeliverables.some((x) => x.name.trim())) {
        return 'Completează introducerea și cel puțin un livrabil de cadru.';
      }
    } else {
      const validHeadlines = form.headlines.filter((x) => x.headline.trim());
      const validMockups = form.mockups.filter((x) => x.name.trim() && x.formats.trim());
      if (!validHeadlines.length || !validMockups.length) {
        return 'Completează cel puțin un headline și o direcție de machetă.';
      }
    }
  }

  if (step === 8) {
    const validTypes = form.activationDirections.filter((x) => x.name.trim() && x.purpose.trim());
    if (!validTypes.length) return 'Completează cel puțin un exemplu orientativ de activare.';
  }

  return null;
}

/** Maps wizard state onto the API contract. */
/**
 * Blank-free, trimmed lines.
 *
 * The list textareas report raw lines while the author is typing - that is what
 * lets a space be typed at all - and tidy up on blur. Blur fires before the
 * click that saves, so this is belt and braces rather than the main path.
 */
const lines = (values: string[]): string[] => values.map((value) => value.trim()).filter(Boolean);

export function toApiPayload(form: CampaignFormState): Record<string, unknown> {
  return {
    ...form,
    strategicContribution: lines(form.strategicContribution),
    secondaryMessages: lines(form.secondaryMessages),
    storytellingDirections: lines(form.storytellingDirections),
    kpiDefinitions: form.kpiDefinitions.filter((m) => m.name.trim()),
    applicationExamples: form.applicationExamples.filter((x) => x.context.trim()),
    headlines: form.headlines.filter((x) => x.headline.trim()),
    /*
     * The editor appends one blank row to every repeatable table so there is
     * always somewhere to type, and each has to be dropped again on save. This
     * one was missed — the only one of the six — so every save added another
     * empty deliverable; a campaign edited seven times carried seven of them.
     *
     * That is worse than clutter. `hasFramework` in CampaignDetailPage decides
     * from this array's length whether a campaign is an umbrella one, and an
     * umbrella campaign renders its deliverables instead of its templates. Blank
     * rows therefore hid every mockup and visual the campaign had.
     */
    frameworkDeliverables: form.frameworkDeliverables.filter(
      (x) => x.name.trim() || x.content.trim() || x.format.trim(),
    ),
    mockups: undefined,
    activationDirections: undefined,
    activationExamples: {
      directions: form.activationDirections.filter((x) => x.name.trim()),
      simulatedRows: [],
    },
  };
}
