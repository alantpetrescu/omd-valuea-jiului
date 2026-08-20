/**
 * Calendar view for Activări — the prototype's layout.
 *
 * Twelve month cards in a grid, each listing the activations whose period
 * touches that month, with a count in the heading. An activation spanning three
 * months appears in all three: the grid answers "what is running in March", not
 * "when does each activation start".
 *
 * Only activations included in the Annual Plan appear, and the header says why —
 * it is a view of the same activations, not a separate copy.
 *
 * This replaced a Gantt-style table (activations as rows, months as columns
 * with marks). That read as a schedule of individual fiches; the grid reads as
 * a year at a glance, which is what the page is for — and it is what the
 * prototype does.
 *
 * Every class name here comes from the lifted stylesheet, so nothing had to be
 * added to make it look right.
 */
import { useMemo } from 'react';

import type { ActivationListItem } from './useActivations';

const MONTHS = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

/** True when the activation's period covers any day of the given month. */
function overlapsMonth(item: ActivationListItem, year: number, month: number): boolean {
  if (!item.startDate || !item.endDate) return false;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const start = new Date(`${item.startDate}T00:00:00`);
  const end = new Date(`${item.endDate}T23:59:59`);
  return start <= monthEnd && end >= monthStart;
}

/** Drives the left border colour of each pill, as in the prototype. */
function statusClass(code: string): string {
  if (code === 'ACTIVE') return 'active';
  if (code === 'CLOSED') return 'done';
  if (code === 'PAUSED') return 'paused';
  return 'prep';
}

export function ActivationCalendar({
  items,
  year,
  years,
  onYearChange,
  onOpen,
}: {
  items: ActivationListItem[];
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
  /** Opens the fiche in a drawer — the calendar stays where it was. */
  onOpen: (item: ActivationListItem) => void;
}) {
  const included = useMemo(() => items.filter((item) => item.includeAnnualPlan), [items]);

  const byMonth = useMemo(
    () => MONTHS.map((_, index) => included.filter((item) => overlapsMonth(item, year, index))),
    [included, year],
  );

  return (
    <section className="activation-calendar-card">
      <header>
        <div>
          <strong>Calendarul activărilor incluse în Planul anual</strong>
          <span>Este o vedere a acelorași activări, nu o copie separată.</span>
        </div>
        <label>
          An{' '}
          <select value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="activation-calendar-grid">
        {MONTHS.map((month, index) => {
          const monthItems = byMonth[index] ?? [];
          return (
            <article key={month}>
              <h4>
                {month}
                <span>{monthItems.length}</span>
              </h4>
              <div>
                {monthItems.length === 0 ? (
                  <p>Nicio activare</p>
                ) : (
                  monthItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`calendar-activation ${statusClass(item.statusCode)}`}
                      onClick={() => onOpen(item)}
                      title={`${item.title} — ${item.status}`}
                    >
                      <strong>{item.title}</strong>
                      <small>{item.campaignTitle ?? 'Activare independentă'}</small>
                    </button>
                  ))
                )}
              </div>
            </article>
          );
        })}
      </div>

      {included.length === 0 ? (
        <div className="calendar-empty-note">
          Nicio activare filtrată nu este inclusă în Planul anual.
        </div>
      ) : null}
    </section>
  );
}
