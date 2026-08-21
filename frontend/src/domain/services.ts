/**
 * Shared business calculations, ported from the prototype's `OMD.services`.
 *
 * Spec section 27 classifies these as DERIVED: they are computed for display
 * and never persisted. Keeping them here — pure, dependency-free — means the
 * same formula serves Activări, Plan anual, Calendar and Monitorizare, exactly
 * as the prototype centralised them.
 */

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type TemporalSituation = 'Urmează' | 'În desfășurare' | 'Perioadă trecută' | '';

/**
 * Calendar situation.
 *
 * Deliberately only for ACTIVE activations — the prototype shows "—" for Draft
 * and Încheiată, and the list header states this explicitly.
 */
export function getTemporalSituation(
  item: { statusCode?: string; startDate?: string | null; endDate?: string | null },
  now = new Date(),
): TemporalSituation {
  if (item.statusCode !== 'ACTIVE' || !item.startDate || !item.endDate) return '';

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const start = parseDate(item.startDate);
  const end = parseDate(item.endDate);
  if (!start || !end) return '';
  end.setHours(23, 59, 59, 999);

  if (today < start) return 'Urmează';
  if (today > end) return 'Perioadă trecută';
  return 'În desfășurare';
}

export function getTemporalSituationClass(value: TemporalSituation): string {
  if (value === 'În desfășurare') return 'current';
  if (value === 'Perioadă trecută') return 'past';
  if (value === 'Urmează') return 'upcoming';
  return '';
}

export function formatMoney(value: unknown, empty = '—', digits = 0): string {
  const number = toNumberOrNull(value);
  if (number === null) return empty;
  return `${new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number)} lei`;
}

export function formatDate(value: string | null | undefined, withYear = true): string {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(
    'ro-RO',
    withYear ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' },
  ).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatPeriod(
  item: { startDate?: string | null; endDate?: string | null },
  empty = 'Perioadă necompletată',
): string {
  if (!item.startDate && !item.endDate) return empty;
  return `${formatDate(item.startDate)} – ${formatDate(item.endDate)}`;
}

/** True when the activation's period touches the given calendar year. */
export function overlapsYear(
  item: { startDate?: string | null; endDate?: string | null },
  year: number,
): boolean {
  if (!item.startDate || !item.endDate) return false;
  return Number(item.startDate.slice(0, 4)) <= year && Number(item.endDate.slice(0, 4)) >= year;
}

/* ---- Performance metrics (spec section 27: derived, never stored) ----
 *
 * Each returns null rather than 0 when the inputs are unavailable. That
 * distinction is the whole point: "0% engagement" and "we have no data" are
 * different statements, and the DB deliberately keeps NULL apart from 0.
 */

export interface Metrics {
  impressions?: number | null;
  reach?: number | null;
  views?: number | null;
  reactions?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  spend?: number | null;
}

/** Sum of reactions, comments, shares and saves; null when none were supplied. */
export function calculateInteractions(metrics: Metrics): number | null {
  const values = (['reactions', 'comments', 'shares', 'saves'] as const)
    .map((key) => toNumberOrNull(metrics[key]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

export function calculateEngagementRate(metrics: Metrics): number | null {
  const interactions = calculateInteractions(metrics);
  const reach = toNumberOrNull(metrics.reach);
  return interactions !== null && reach !== null && reach > 0 ? (interactions / reach) * 100 : null;
}

export function calculateCTR(metrics: Metrics): number | null {
  const clicks = toNumberOrNull(metrics.clicks);
  const impressions = toNumberOrNull(metrics.impressions);
  return clicks !== null && impressions !== null && impressions > 0
    ? (clicks / impressions) * 100
    : null;
}

export function calculateCPC(metrics: Metrics): number | null {
  const spend = toNumberOrNull(metrics.spend);
  const clicks = toNumberOrNull(metrics.clicks);
  return spend !== null && spend > 0 && clicks !== null && clicks > 0 ? spend / clicks : null;
}

export function calculateCPM(metrics: Metrics): number | null {
  const spend = toNumberOrNull(metrics.spend);
  const impressions = toNumberOrNull(metrics.impressions);
  return spend !== null && spend > 0 && impressions !== null && impressions > 0
    ? (spend / impressions) * 1000
    : null;
}

/** Thousands separator, Romanian. `null` renders as an em dash, never as 0. */
export function formatNumber(value: number | null | undefined, empty = '—'): string {
  const number = toNumberOrNull(value);
  return number === null ? empty : new Intl.NumberFormat('ro-RO').format(number);
}

export function formatPercent(value: number | null | undefined, digits = 1, empty = '—'): string {
  const number = toNumberOrNull(value);
  return number === null
    ? empty
    : `${new Intl.NumberFormat('ro-RO', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(number)}%`;
}

const MONTHS_LONG = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

const monthName = (month: number): string => MONTHS_LONG[month - 1] ?? '';

/** Consecutive months collapsed into `[from, to]` runs. */
function monthRuns(months: number[] | null | undefined): Array<[number, number]> {
  const clean = [...new Set((months ?? []).map(Number).filter((m) => m >= 1 && m <= 12))].sort(
    (a, b) => a - b,
  );

  const runs: Array<[number, number]> = [];
  for (const month of clean) {
    const current = runs[runs.length - 1];
    if (current && month === current[1] + 1) {
      current[1] = month;
      continue;
    }
    runs.push([month, month]);
  }
  return runs;
}

/**
 * The strategic window a campaign's months describe — the prototype's
 * `OMD.seasonality.periodLabel()`.
 *
 * Months are stored as an unordered set, so a winter campaign arrives as
 * 1,2,3,11,12: two runs at opposite ends of the year. Rendering that literally
 * would read "Ianuarie–martie · Noiembrie–decembrie", which describes two
 * seasons rather than the one that wraps. The special case below joins them the
 * way a reader means it: "Noiembrie–martie".
 */
/**
 * The seasonality months as contiguous bands, zero-based — `OMD.seasonality.bands()`.
 *
 * The annual calendar places each band with `grid-column: from+1 / to+2`, so it
 * needs the runs rather than the month list. Zero-based because that is what a
 * grid column index wants; `monthRuns` keeps the 1–12 form the database stores.
 *
 * A wrapping winter stays two bands here on purpose: the calendar draws January
 * and November as separate stretches of the same year, which is what they are.
 * Only the label joins them.
 */
export function seasonalityBands(
  months: number[] | null | undefined,
): Array<{ from: number; to: number }> {
  return monthRuns(months).map(([from, to]) => ({ from: from - 1, to: to - 1 }));
}

export function seasonalityPeriodLabel(months: number[] | null | undefined): string {
  const runs = monthRuns(months);
  const total = runs.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
  if (total === 12) return 'Tot anul';
  if (total === 0) return 'Luni neconfigurate';

  const first = runs[0];
  const second = runs[1];
  if (runs.length === 2 && first && second && first[0] === 1 && second[1] === 12) {
    return `${monthName(second[0])}–${monthName(first[1]).toLowerCase()}`;
  }

  return runs
    .map(([from, to]) =>
      from === to ? monthName(from) : `${monthName(from)}–${monthName(to).toLowerCase()}`,
    )
    .join(' · ');
}

/**
 * Every selected month spelled out — the prototype's
 * `OMD.seasonality.monthsLabel()`.
 *
 * Deliberately not the same as `seasonalityPeriodLabel`: that one names the
 * window, this one enumerates the months the annual calendar will actually use.
 * The seasonality editor shows both, because a window like "Noiembrie–martie"
 * does not tell you which months are ticked.
 */
export function seasonalityMonthsLabel(months: number[] | null | undefined): string {
  const clean = [...new Set((months ?? []).map(Number).filter((m) => m >= 1 && m <= 12))].sort(
    (a, b) => a - b,
  );
  return clean.length > 0 ? clean.map(monthName).join(' · ') : 'Nicio lună selectată';
}

/**
 * A count with its noun, agreeing in Romanian.
 *
 * Romanian inflects a counted noun three ways, and the rule is on the last two
 * digits: 1 takes the singular, 2–19 take the bare plural, and 0 or 20–99 take
 * "de". `n === 1 ? one : many` therefore prints "1 campanii" and "20 campanii",
 * both of which read as typos in an application the beneficiary uses daily.
 *
 *   countLabel(1, 'campanie', 'campanii')    -> "1 campanie"
 *   countLabel(4, 'campanie', 'campanii')    -> "4 campanii"
 *   countLabel(34, 'campanie', 'campanii')   -> "34 de campanii"
 */
export function countLabel(value: number, one: string, many: string): string {
  if (value === 1) return `1 ${one}`;
  const tail = value % 100;
  const plural = tail === 0 || tail >= 20 ? `de ${many}` : many;
  return `${formatNumber(value)} ${plural}`;
}

