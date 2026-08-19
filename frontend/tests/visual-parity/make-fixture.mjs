/**
 * Builds the `GET /api/v1/strategy` payload from the DEMO_SEED package, using
 * the same JSON -> DB -> DTO mapping the backend performs.
 *
 * This is the state an empty staging database reaches after importing the
 * Campaign package, so the React screen under test sees what it would see
 * against MySQL — without needing MySQL to run the comparison.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CAMPAIGN_SEED, FIXTURE } from './config.mjs';

const seed = JSON.parse(readFileSync(CAMPAIGN_SEED, 'utf8'));
const sv = seed.strategicData.strategyVersion;

const version = {
  id: sv.externalKey,
  label: sv.label,
  // The first version imported into an empty DB becomes ACTIVE (spec 33.4).
  status: 'ACTIVE',
  periodStartYear: sv.periodStartYear,
  periodEndYear: sv.periodEndYear,
};

// campaign_programs / campaign_objectives / campaign_audiences, as rows.
const programLinks = [];
const objectiveLinks = [];
for (const c of seed.campaigns) {
  if (c.programPrimaryCode) programLinks.push([c.externalKey, c.programPrimaryCode]);
  for (const code of c.programSecondaryCodes ?? []) programLinks.push([c.externalKey, code]);
  if (c.objectivePrimaryCode) objectiveLinks.push([c.externalKey, c.objectivePrimaryCode]);
  for (const code of c.objectiveSecondaryCodes ?? []) objectiveLinks.push([c.externalKey, code]);
}

// strategic_pillars. Not shown on the Repere strategice screen (the prototype
// has no place for them), but Administrare → Strategie edits them.
const pillars = seed.strategicData.pillars.map((p) => ({
  code: p.code,
  label: p.label,
  displayLabel: p.displayLabel,
  hint: p.hint,
  isActive: 1,
  // campaigns.pillar_id — the label may differ from the nomenclature's; the
  // code is the identity, exactly as the importer resolves it.
  usageCount: seed.campaigns.filter((c) => c.pillar?.code === p.code).length,
}));

const programs = seed.strategicData.programs.map((p) => ({
  code: p.code,
  name: p.name,
  label: p.label,
  result: p.result,
  marketingObjective: p.marketingObjective,
  approach: p.approach,
  // DB column is horizon_result_text; the v1 contract still carries result2028.
  horizonResult: p.result2028,
  targetGroups: p.targetGroupsText,
  kpiText: p.kpiText,
  sources: p.sourcesText,
  annualActions: p.annualActions,
  validationStatus: p.validationStatus,
  isActive: 1,
  usageCount: programLinks.filter((l) => l[1] === p.code).length,
}));

const objectives = seed.strategicData.objectives.map((o) => ({
  code: o.code,
  name: o.name,
  label: o.label,
  source: o.source,
  isActive: 1,
  usageCount: objectiveLinks.filter((l) => l[1] === o.code).length,
}));

const programObjectives = seed.strategicData.programs.flatMap((p) =>
  (p.objectiveCodes ?? []).map((objectiveCode) => ({ programCode: p.code, objectiveCode })),
);

const audiences = seed.catalogs.audiences.map((a) => ({ code: a.code, label: a.label, isActive: 1 }));

// ORDER BY c.external_key, matching the API.
const campaigns = [...seed.campaigns]
  .sort((a, b) => a.externalKey.localeCompare(b.externalKey))
  .map((c) => ({
    id: c.externalKey,
    title: c.title,
    statusCode: c.status?.code ?? '',
    status: c.status?.label ?? '',
    insight: c.insight ?? '',
    valueProposition: c.valueProposition ?? '',
    productCondition: c.productCondition ?? '',
    products: c.products ?? [],
    kpiDefinitions: c.kpiDefinitions ?? [],
    programPrimaryCode: c.programPrimaryCode ?? '',
    programSecondaryCodes: c.programSecondaryCodes ?? [],
    objectivePrimaryCode: c.objectivePrimaryCode ?? '',
    objectiveSecondaryCodes: c.objectiveSecondaryCodes ?? [],
    primaryAudienceSegment: c.primaryAudienceSegment?.label ?? '',
    secondaryAudienceSegments: (c.secondaryAudienceSegments ?? []).map((a) => a.label),
  }));

mkdirSync(dirname(FIXTURE), { recursive: true });
writeFileSync(
  FIXTURE,
  JSON.stringify({ version, pillars, programs, objectives, programObjectives, audiences, campaigns }, null, 1),
);

console.log(
  `fixture: ${pillars.length} pillars, ${programs.length} programs, ${objectives.length} objectives, ${audiences.length} audiences, ${campaigns.length} campaigns, ${programObjectives.length} links`,
);
