/**
 * Calendar view for Activări.
 *
 * A twelve-month grid per year; each activation occupies the months its period
 * touches. Only activations included in the Annual Plan appear, matching the
 * prototype — the calendar answers "what is planned this year", not "every
 * fiche that exists".
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { formatMoney, formatPeriod } from '../../domain/services';
import type { ActivationListItem } from './useActivations';

const MONTHS = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

const SHORT = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];

/** True when the activation's period covers any day of the given month. */
function overlapsMonth(item: ActivationListItem, year: number, month: number): boolean {
  if (!item.startDate || !item.endDate) return false;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const start = new Date(`${item.startDate}T00:00:00`);
  const end = new Date(`${item.endDate}T23:59:59`);
  return start <= monthEnd && end >= monthStart;
}

export function ActivationCalendar({
  items,
  year,
  years,
  onYearChange,
}: {
  items: ActivationListItem[];
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
}) {
  const included = useMemo(() => items.filter((item) => item.includeAnnualPlan), [items]);

  const inYear = useMemo(
    () =>
      included.filter(
        (item) =>
          item.startDate &&
          item.endDate &&
          Number(item.startDate.slice(0, 4)) <= year &&
          Number(item.endDate.slice(0, 4)) >= year,
      ),
    [included, year],
  );

  return (
    <section className="activation-list-card">
      <div className="activation-list-count">
        <strong>
          {inYear.length} activări în calendarul {year}
        </strong>
        <span>Sunt afișate doar activările incluse în Planul anual.</span>
      </div>

      <div className="calendar-year-switch">
        {years.map((value) => (
          <button
            key={value}
            type="button"
            className={value === year ? 'btn primary' : 'btn secondary'}
            onClick={() => onYearChange(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {inYear.length === 0 ? (
        <div className="state-note">Nicio activare inclusă în Planul anual pentru {year}.</div>
      ) : (
        <div className="activation-table-scroll">
          <table className="activation-list-table calendar-table">
            <thead>
              <tr>
                <th>Activare</th>
                {SHORT.map((month, index) => (
                  <th key={month} title={MONTHS[index]}>
                    {month}
                  </th>
                ))}
                <th>Buget</th>
              </tr>
            </thead>
            <tbody>
              {inYear.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="activation-title-link" to={`/activations/${item.id}`}>
                      {item.title}
                    </Link>
                    <small className="muted-copy">{formatPeriod(item)}</small>
                  </td>
                  {MONTHS.map((month, index) => (
                    <td key={month} className="calendar-cell">
                      {overlapsMonth(item, year, index) ? (
                        <span
                          className={`calendar-mark ${item.statusCode.toLowerCase()}`}
                          title={`${item.title} · ${month} ${year}`}
                        />
                      ) : null}
                    </td>
                  ))}
                  <td>{formatMoney(item.plannedBudget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
