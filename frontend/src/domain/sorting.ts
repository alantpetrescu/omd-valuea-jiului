/**
 * Ordering rules, kept out of the components that use them.
 *
 * Here rather than in a component for the same reason `services.ts` exists: how
 * `P5.10` orders against `P5.2` is a property of the codes, not of the table
 * drawing them, and two tables must not be free to disagree about it.
 */

/**
 * Natural order over strategic codes (SPEC_ADMIN_STRATEGIE §4.5).
 *
 * A plain comparison puts `P5.10` between `P5.1` and `P5.2`: it reads the "1",
 * then the "0", and never sees a number. Splitting on digit runs and comparing
 * those numerically is the whole fix, and it holds for any prefix the
 * beneficiary's matrix happens to use — `D6.2` before `D6.10` just the same.
 *
 * Mirrors `StrategyService::naturalCompare` in the backend. The two exist
 * separately because sorting here is display-only: `sort_order` is never sent
 * back, so the server has no reason to reorder anything on our behalf.
 */
export function naturalCompare(a: string, b: string): number {
  const left = a.split(/(\d+)/).filter(Boolean);
  const right = b.split(/(\d+)/).filter(Boolean);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const l = left[index];
    const r = right[index];

    // The shorter code is a prefix of the longer one, so it sorts first.
    if (l === undefined) return -1;
    if (r === undefined) return 1;

    const bothNumeric = /^\d+$/.test(l) && /^\d+$/.test(r);

    const comparison = bothNumeric ? Number(l) - Number(r) : (l < r ? -1 : l > r ? 1 : 0);
    if (comparison !== 0) return comparison < 0 ? -1 : 1;
  }

  // Every segment tied — `P05` against `P5`. Fall back to the raw strings so the
  // order is total and stable rather than swapping between sorts.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numbers sort as numbers; a column of counts is not a column of words. */
export function numericCompare(a: number, b: number): number {
  return a - b;
}
