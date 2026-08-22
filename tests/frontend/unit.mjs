/**
 * F-U-01…U16 — the pure functions in `src/domain/`.
 *
 *   node tests/frontend/unit.mjs
 *
 * No browser, no server, no mock: these are functions, and functions can be
 * called. They hold all the arithmetic the user actually reads — rates, costs,
 * periods, grammatical agreement — and until now nothing checked any of it.
 *
 * The source is imported as `.ts` directly. Node strips the types itself from
 * version 22.18 on, so there is no build step and no transpiler dependency; the
 * file under test is the file that ships, not a copy of it.
 */

import assert from 'node:assert/strict';

import {
  calculateCPC,
  calculateCPM,
  calculateCTR,
  calculateEngagementRate,
  calculateInteractions,
  countLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPeriod,
  getTemporalSituation,
  overlapsYear,
  parseDate,
  seasonalityBands,
  seasonalityMonthsLabel,
  seasonalityPeriodLabel,
} from '../../frontend/src/domain/services.ts';
import { naturalCompare } from '../../frontend/src/domain/sorting.ts';

let passed = 0;
const failures = [];

function check(id, what, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${id.padEnd(10)} ${what}\n`);
  } catch (error) {
    const message = String(error.message).split('\n').filter(Boolean).slice(0, 3).join(' ');
    failures.push({ id, message: `${what} — ${message}` });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${id.padEnd(10)} ${what} — ${message}\n`);
  }
}

process.stdout.write('\n\x1b[1mFuncții pure — src/domain\x1b[0m\n');

// --- Acordul numeralelor -----------------------------------------------------

check('F-U-01', 'countLabel alege forma corectă pentru 1, 4, 19, 20, 1284', () => {
  assert.equal(countLabel(1, 'campanie', 'campanii'), '1 campanie');
  assert.equal(countLabel(4, 'campanie', 'campanii'), '4 campanii');
  assert.equal(countLabel(19, 'campanie', 'campanii'), '19 campanii');
  assert.equal(countLabel(20, 'campanie', 'campanii'), '20 de campanii');
  assert.equal(countLabel(1284, 'mențiune', 'mențiuni'), '1.284 de mențiuni');
});

/*
 * The thresholds, because the rule is not "over twenty".
 *
 * Romanian takes „de" when the last two digits are 00 or 20–99, so 101 has none
 * and 120 does. A `value >= 20` test gets 101 wrong and nobody notices, because
 * the numbers on a demo screen are all small.
 */
check('F-U-02', 'countLabel: 101 fără „de"; 0, 100 și 120 cu „de"', () => {
  assert.equal(countLabel(101, 'campanie', 'campanii'), '101 campanii');
  assert.equal(countLabel(120, 'campanie', 'campanii'), '120 de campanii');
  assert.equal(countLabel(100, 'campanie', 'campanii'), '100 de campanii');
  assert.equal(countLabel(0, 'campanie', 'campanii'), '0 de campanii');
});

// --- Ordinea naturală --------------------------------------------------------

/*
 * The same vectors as `AS-B-U01…U04` in the PHP suite, deliberately.
 *
 * The ordering rule has two implementations, one per language. If they drift,
 * the list in Administrare comes out in a different order than the one the API
 * returns, and neither looks wrong on its own.
 */
check('F-U-03', 'naturalCompare — aceiași vectori ca în PHP', () => {
  assert.ok(naturalCompare('P5.2', 'P5.10') < 0);
  assert.ok(naturalCompare('D6.10', 'D6.9') > 0);
  assert.ok(naturalCompare('PILLAR_1', 'PILLAR_2') < 0);
  assert.ok(naturalCompare('AB', 'AA') > 0);
});

check('F-U-04', 'naturalCompare sortează lista întreagă corect', () => {
  const sorted = ['P5.10', 'P5.2', 'P5.20', 'P5.1', 'P5.3'].sort(naturalCompare);
  assert.deepEqual(sorted, ['P5.1', 'P5.2', 'P5.3', 'P5.10', 'P5.20']);
});

// --- Perioade ----------------------------------------------------------------

const situation = (startDate, endDate, today, statusCode = 'ACTIVE') =>
  getTemporalSituation({ statusCode, startDate, endDate }, new Date(today));

check('F-U-05', 'getTemporalSituation: trecut, curent, viitor; gol pentru ce nu e Activ', () => {
  assert.equal(situation('2026-01-01', '2026-01-31', '2026-06-15'), 'Perioadă trecută');
  assert.equal(situation('2026-06-01', '2026-06-30', '2026-06-15'), 'În desfășurare');
  assert.equal(situation('2026-09-01', '2026-09-30', '2026-06-15'), 'Urmează');

  /*
   * Empty, not a label, for anything that is not ACTIVE — and for a period with
   * a hole in it.
   *
   * The prototype shows „—" for Draft and Încheiată, and the column header says
   * so. A Draft activation whose dates happen to include today is not „În
   * desfășurare": it is not running at all.
   */
  assert.equal(situation('2026-06-01', '2026-06-30', '2026-06-15', 'DRAFT'), '');
  assert.equal(situation('2026-06-01', '2026-06-30', '2026-06-15', 'CLOSED'), '');
  assert.equal(situation('2026-01-01', null, '2026-06-15'), '');
});

/*
 * An off-by-one here makes an activation „past" on its own closing day, which is
 * the day someone is most likely to be looking at it.
 */
check('F-U-06', 'ziua de început și cea de final sunt incluse', () => {
  assert.equal(situation('2026-06-15', '2026-06-30', '2026-06-15'), 'În desfășurare');
  assert.equal(situation('2026-06-01', '2026-06-15', '2026-06-15'), 'În desfășurare');
  assert.equal(situation('2026-06-16', '2026-06-30', '2026-06-15'), 'Urmează');
  assert.equal(situation('2026-06-01', '2026-06-14', '2026-06-15'), 'Perioadă trecută');
});

const period = (startDate, endDate) => ({ startDate, endDate });

check('F-U-07', 'overlapsYear: intră, iese, cuprinde anul, îl ratează', () => {
  assert.equal(overlapsYear(period('2026-03-01', '2026-04-01'), 2026), true);
  assert.equal(overlapsYear(period('2025-12-01', '2026-01-15'), 2026), true);
  assert.equal(overlapsYear(period('2025-01-01', '2027-01-01'), 2026), true);
  assert.equal(overlapsYear(period('2025-01-01', '2025-12-31'), 2026), false);
  assert.equal(overlapsYear(period('2027-01-01', '2027-12-31'), 2026), false);
  // An incomplete period belongs to no year: it cannot be placed on a calendar.
  assert.equal(overlapsYear(period('2026-01-01', null), 2026), false);
});

// --- Aritmetica de KPI -------------------------------------------------------

/*
 * The section that justifies the file.
 *
 * Every one of these divides, and every denominator can be zero. `0/0` is `NaN`
 * and `1/0` is `Infinity`, and both render as something — „NaN%", „∞ lei" —
 * that looks like a number to anyone skimming a report. `null` is the only
 * honest answer, and it renders as „—".
 */
check('F-U-08', 'calculateEngagementRate se raportează la reach; reach zero → null', () => {
  // Reach, not impressions: the same person seeing a post five times is one
  // person who might engage, not five.
  assert.equal(calculateEngagementRate({ reach: 1000, reactions: 20, comments: 5, shares: 5 }), 3);
  assert.equal(calculateEngagementRate({ reach: 0, reactions: 20 }), null);
  assert.equal(calculateEngagementRate({ reactions: 20 }), null);
  assert.equal(calculateEngagementRate({ reach: 1000 }), null);
});

check('F-U-09', 'CTR, CPC și CPM: numitor zero → null, nu Infinity', () => {
  assert.equal(calculateCTR({ impressions: 1000, clicks: 50 }), 5);
  assert.equal(calculateCTR({ impressions: 0, clicks: 50 }), null);

  assert.equal(calculateCPC({ spend: 100, clicks: 50 }), 2);
  assert.equal(calculateCPC({ spend: 100, clicks: 0 }), null);

  assert.equal(calculateCPM({ spend: 100, impressions: 50000 }), 2);
  assert.equal(calculateCPM({ spend: 100, impressions: 0 }), null);
});

/*
 * „Nothing measured" and „measured zero" are different answers.
 *
 * A sum that starts at 0 and adds nothing returns 0, which claims the post got
 * no reactions. It did not: nobody counted.
 */
check('F-U-10', 'calculateInteractions: sumă corectă; toate lipsă → null, nu 0', () => {
  assert.equal(calculateInteractions({ reactions: 10, comments: 3, shares: 2, saves: 1 }), 16);
  assert.equal(calculateInteractions({ reactions: 0, comments: 0 }), 0);
  assert.equal(calculateInteractions({}), null);
});

// --- Formatări ---------------------------------------------------------------

check('F-U-11', 'formatNumber și formatMoney: separatorul românesc, null → —', () => {
  assert.equal(formatNumber(1284), '1.284');
  assert.equal(formatNumber(null), '—');
  assert.ok(formatMoney(12500).includes('12.500'));
  assert.equal(formatMoney(null), '—');
});

check('F-U-12', 'formatPercent: zecimalele cerute, null → —', () => {
  assert.equal(formatPercent(3.456, 1), '3,5%');
  assert.equal(formatPercent(3.456, 0), '3%');
  assert.equal(formatPercent(null), '—');
});

/*
 * A date the parser cannot read has to come out as „—".
 *
 * `new Date('nu-o-dată')` is an Invalid Date, and any formatter that does not
 * check prints the words „Invalid Date" straight into the table.
 */
check('F-U-13', 'formatDate, formatDateTime, formatPeriod: dată invalidă → —', () => {
  assert.ok(formatDate('2026-03-15').includes('2026'));
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('nu-o-dată'), '—');
  assert.equal(formatDateTime('nu-o-dată'), '—');

  assert.ok(
    !formatPeriod({ startDate: 'nu-o-dată', endDate: 'nici-asta' }).toLowerCase().includes('invalid'),
  );
  assert.equal(formatPeriod({ startDate: null, endDate: null }, 'GOL'), 'GOL');
});

check('F-U-14', 'parseDate: null, gol și un șir aiurea → null', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('nu-o-dată'), null);
  assert.ok(parseDate('2026-03-15') instanceof Date);
});

// --- Sezonalitate ------------------------------------------------------------

check('F-U-15', 'seasonalityPeriodLabel: interval, enumerare, tot anul, neconfigurat', () => {
  assert.match(seasonalityPeriodLabel([6, 7, 8]), /–/);
  assert.match(seasonalityPeriodLabel([1, 6, 12]), / · /);
  assert.equal(seasonalityPeriodLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'Tot anul');
  assert.equal(seasonalityPeriodLabel([]), 'Luni neconfigurate');

  /*
   * A winter that wraps the year end reads as one window, not two.
   *
   * Months 11, 12, 1, 2 are two runs on the calendar — the bands stay separate,
   * because that is what a year looks like — but the label has to name the window
   * the way a person would say it, not list both ends of the year.
   */
  assert.match(seasonalityPeriodLabel([1, 2, 11, 12]), /^Noiembrie–februarie$/);
});

check('F-U-16', 'seasonalityMonthsLabel enumeră; lista goală are text, nu șir gol', () => {
  assert.equal(seasonalityMonthsLabel([]), 'Nicio lună selectată');
  assert.equal(seasonalityMonthsLabel(null), 'Nicio lună selectată');
  assert.match(seasonalityMonthsLabel([6, 7]), / · /);
  // Duplicates and out-of-range values are dropped rather than printed.
  assert.equal(seasonalityMonthsLabel([6, 6, 13, 0]), seasonalityMonthsLabel([6]));

  // Bands are zero-based, because the calendar grid is.
  assert.deepEqual(seasonalityBands([6, 7, 8]), [{ from: 5, to: 7 }]);
  assert.equal(seasonalityBands([1, 2, 11, 12]).length, 2);
});

// --- Raport ------------------------------------------------------------------

if (failures.length === 0) {
  process.stdout.write(`\n\x1b[32m${passed} verificări trecute\x1b[0m\n`);
  process.exit(0);
}

process.stdout.write(`\n\x1b[31m${failures.length} eșecuri\x1b[0m din ${passed + failures.length} verificări\n`);
for (const failure of failures) {
  process.stdout.write(`  ${failure.id.padEnd(10)} ${failure.message}\n`);
}
process.exit(1);
