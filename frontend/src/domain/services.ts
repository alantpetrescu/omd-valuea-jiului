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
