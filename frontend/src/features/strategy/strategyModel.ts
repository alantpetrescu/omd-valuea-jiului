/**
 * The Repere strategice model, ported from the prototype's `OMD.strategic`.
 *
 * Kept pure and free of React so the aggregation rules can be unit-tested on
 * their own (spec rule 3.4/3: the prototype's global modules become testable
 * TS modules rather than a re-created `OMD.*` singleton).
 *
 * The shape is deliberately the prototype's: strategic repere come from the
 * nomenclature, while their *coverage* is derived from the campaign fiches.
 * Publicuri, produse, KPI and surse have no strategic table at all — they only
 * exist as a projection of what the campaigns declare.
 */

export interface StrategyCampaign {
  id: string;
  title: string;
  statusCode: string;
  status: string;
  insight: string;
  valueProposition: string;
  productCondition: string;
  products: string[];
  kpiDefinitions: KpiDefinition[];
  programPrimaryCode: string;
  programSecondaryCodes: string[];
  objectivePrimaryCode: string;
  objectiveSecondaryCodes: string[];
  primaryAudienceSegment: string;
  secondaryAudienceSegments: string[];
}

export interface KpiDefinition {
  name?: string;
  baseline?: string;
  target?: string;
  source?: string;
}

export interface ApiProgram {
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

export interface ApiObjective {
  code: string;
  name: string;
  label: string;
  source: string;
  isActive: number;
  usageCount: number;
}

export interface StrategyPayload {
  version: {
    id: string;
    label: string;
    status: string;
    periodStartYear: number;
    periodEndYear: number;
  };
  programs: ApiProgram[];
  objectives: ApiObjective[];
  programObjectives: Array<{ programCode: string; objectiveCode: string }>;
  audiences: Array<{ code: string; label: string; isActive: number }>;
  campaigns: StrategyCampaign[];
}

export type EntityType = 'program' | 'objective' | 'audience' | 'product' | 'kpi' | 'source';
export type RelationRole = 'primary' | 'secondary' | 'used' | '';

export interface Usage {
  campaign: StrategyCampaign;
  role: RelationRole;
  insight?: string;
  value?: string;
  condition?: string;
  metric?: KpiDefinition;
}

interface BaseEntity {
  type: EntityType;
  name: string;
  usages: Usage[];
}

export interface ProgramEntity extends BaseEntity, ApiProgram {
  type: 'program';
  objectiveCodes: string[];
  coveredObjectives: string[];
}

export interface ObjectiveEntity extends BaseEntity, ApiObjective {
  type: 'objective';
  programs: ProgramEntity[];
}

export interface DerivedEntity extends BaseEntity {
  type: 'audience' | 'product' | 'kpi' | 'source';
  id: string;
}

export type StrategyEntity = ProgramEntity | ObjectiveEntity | DerivedEntity;

export interface StrategyModel {
  all: StrategyCampaign[];
  programs: ProgramEntity[];
  objectives: ObjectiveEntity[];
  audiences: DerivedEntity[];
  products: DerivedEntity[];
  kpis: DerivedEntity[];
  sources: DerivedEntity[];
}

/* ---- helpers, identical to `OMD.u` ---- */

/** Diacritic-insensitive lowercase, with runs of whitespace collapsed. */
export function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncates with an ellipsis, counting the ellipsis inside the budget. */
export function cut(value: unknown, n = 150): string {
  const text = String(value ?? '');
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

export const campaignLabel = (campaign: StrategyCampaign): string => cut(campaign.title, 29);
export const relationLabel = (role: RelationRole): string =>
  role === 'primary' ? 'P' : role === 'secondary' ? 'S' : '•';
export const relationTitle = (role: RelationRole): string =>
  role === 'primary' ? 'Asociere principală' : role === 'secondary' ? 'Asociere secundară' : 'Asociere';

export function programRole(campaign: StrategyCampaign, code: string): RelationRole {
  if (campaign.programPrimaryCode === code) return 'primary';
  if ((campaign.programSecondaryCodes || []).includes(code)) return 'secondary';
  return '';
}

export function objectiveRole(campaign: StrategyCampaign, code: string): RelationRole {
  if (campaign.objectivePrimaryCode === code) return 'primary';
  if ((campaign.objectiveSecondaryCodes || []).includes(code)) return 'secondary';
  return '';
}

/** Most-used first, then alphabetical in Romanian collation. */
function byUsageThenName(a: BaseEntity, b: BaseEntity): number {
  return b.usages.length - a.usages.length || a.name.localeCompare(b.name, 'ro');
}

/**
 * True when the payload carries the campaign-side relations this screen was
 * built around. An API older than the screen answers 200 without them.
 *
 * Absent is not the same as empty: `[]` is a real answer — a strategy with no
 * campaigns yet — and must render as zero coverage. `undefined` means the
 * server never spoke about campaigns at all, which is an integration fault and
 * has to be said out loud rather than drawn as zeros.
 */
export function hasCampaignRelations(payload: StrategyPayload): boolean {
  return Array.isArray(payload?.campaigns) && Array.isArray(payload?.audiences);
}

/**
 * Total by construction: every collection is guarded.
 *
 * A screen that white-screens on a partial payload tells the operator nothing.
 * Building an empty-but-valid model lets the page render and explain itself.
 */
export function buildModel(payload: StrategyPayload): StrategyModel {
  const all = payload?.campaigns ?? [];

  const objectiveCodesByProgram = new Map<string, string[]>();
  for (const link of payload?.programObjectives ?? []) {
    const list = objectiveCodesByProgram.get(link.programCode);
    if (list) list.push(link.objectiveCode);
    else objectiveCodesByProgram.set(link.programCode, [link.objectiveCode]);
  }

  const programs: ProgramEntity[] = (payload?.programs ?? []).map((program) => {
    const objectiveCodes = objectiveCodesByProgram.get(program.code) ?? [];
    return {
      ...program,
      type: 'program',
      objectiveCodes,
      usages: all
        .map((campaign) => ({ campaign, role: programRole(campaign, program.code) }))
        .filter((usage) => usage.role),
      coveredObjectives: objectiveCodes.filter((code) =>
        all.some((campaign) => objectiveRole(campaign, code)),
      ),
    };
  });

  const objectives: ObjectiveEntity[] = (payload?.objectives ?? []).map((objective) => ({
    ...objective,
    type: 'objective',
    usages: all
      .map((campaign) => ({ campaign, role: objectiveRole(campaign, objective.code) }))
      .filter((usage) => usage.role),
    programs: programs.filter((program) => program.objectiveCodes.includes(objective.code)),
  }));

  /**
   * Seeded from the nomenclature first, so a public nobody has used yet still
   * appears — that gap is the point of the coverage panel.
   */
  const audienceMap = new Map<string, DerivedEntity>();
  for (const entry of payload?.audiences ?? []) {
    const key = norm(entry.label);
    if (key) audienceMap.set(key, { id: key, name: entry.label, type: 'audience', usages: [] });
  }
  for (const campaign of all) {
    const primary = campaign.primaryAudienceSegment || '';
    if (primary) {
      const key = norm(primary);
      if (!audienceMap.has(key)) {
        audienceMap.set(key, { id: key, name: primary, type: 'audience', usages: [] });
      }
      audienceMap.get(key)!.usages.push({
        campaign,
        role: 'primary',
        insight: campaign.insight,
        value: campaign.valueProposition,
      });
    }
    for (const name of campaign.secondaryAudienceSegments || []) {
      if (!name) continue;
      const key = norm(name);
      if (!audienceMap.has(key)) {
        audienceMap.set(key, { id: key, name, type: 'audience', usages: [] });
      }
      const entry = audienceMap.get(key)!;
      // A campaign that lists the same public twice counts once.
      if (!entry.usages.some((usage) => usage.campaign.id === campaign.id)) {
        entry.usages.push({
          campaign,
          role: 'secondary',
          insight: campaign.insight,
          value: campaign.valueProposition,
        });
      }
    }
  }
  const audiences = [...audienceMap.values()].sort(byUsageThenName);

  const productMap = new Map<string, DerivedEntity>();
  for (const campaign of all) {
    for (const name of campaign.products || []) {
      const key = norm(name);
      if (!key) continue;
      if (!productMap.has(key)) {
        productMap.set(key, { id: key, name, type: 'product', usages: [] });
      }
      productMap.get(key)!.usages.push({
        campaign,
        role: 'used',
        condition: campaign.productCondition,
      });
    }
  }
  const products = [...productMap.values()].sort(byUsageThenName);

  const kpiMap = new Map<string, DerivedEntity>();
  const sourceMap = new Map<string, DerivedEntity>();
  for (const campaign of all) {
    for (const metric of campaign.kpiDefinitions || []) {
      const key = norm(metric.name);
      if (key) {
        if (!kpiMap.has(key)) {
          kpiMap.set(key, { id: key, name: metric.name ?? '', type: 'kpi', usages: [] });
        }
        kpiMap.get(key)!.usages.push({ campaign, role: 'used', metric });
      }
      const sourceKey = norm(metric.source);
      if (sourceKey) {
        if (!sourceMap.has(sourceKey)) {
          sourceMap.set(sourceKey, { id: sourceKey, name: metric.source ?? '', type: 'source', usages: [] });
        }
        sourceMap.get(sourceKey)!.usages.push({ campaign, role: 'used', metric });
      }
    }
  }

  return {
    all,
    programs,
    objectives,
    audiences,
    products,
    kpis: [...kpiMap.values()].sort(byUsageThenName),
    sources: [...sourceMap.values()].sort(byUsageThenName),
  };
}

export const entityKey = (item: StrategyEntity): string =>
  'code' in item && item.code ? item.code : (item as DerivedEntity).id;

/**
 * Free-text filter over everything the fiche can show, including the titles of
 * the campaigns that reference the reper — searching for a campaign name has
 * to surface the repere it operationalises.
 */
export function filterItems<T extends StrategyEntity>(items: T[], query: string): T[] {
  const q = norm(query);
  if (!q) return items;
  return items.filter((item) => {
    const program = item as Partial<ProgramEntity>;
    const objective = item as Partial<ObjectiveEntity>;
    const text = [
      program.code,
      item.name,
      program.result,
      program.marketingObjective,
      program.approach,
      program.horizonResult,
      program.kpiText,
      program.sources,
      ...(item.usages || []).map((usage) => usage.campaign?.title),
      ...(objective.programs || []).map((entry) => entry.name),
    ].join(' ');
    return norm(text).includes(q);
  });
}
