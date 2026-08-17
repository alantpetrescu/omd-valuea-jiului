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
