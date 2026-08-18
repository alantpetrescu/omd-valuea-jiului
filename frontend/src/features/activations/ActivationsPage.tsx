/**
 * Activări — ported from the prototype's `activation-list.js`.
 *
 * Same six stat cards, the same filter panel (including the collapsible
 * "Mai multe filtre"), and the same ten-column table. Class names are the
 * prototype's so the lifted stylesheet applies unchanged.
 *
 * "Situația în calendar" is computed at display time from status + dates — it
 * is derived data and is never stored (spec section 27).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  formatDateTime,
  formatMoney,
  formatPeriod,
  getTemporalSituation,
  getTemporalSituationClass,
} from '../../domain/services';
import { useCampaigns, useCatalogs, EMPTY_FILTERS } from '../campaigns/useCampaigns';
import { useAuth } from '../auth/AuthContext';
import {
  EMPTY_ACTIVATION_FILTERS,
  useActivationStats,
  useActivations,
  type ActivationFilters,
  type ActivationListItem,
} from './useActivations';
import { ActivationCalendar } from './ActivationCalendar';

function statusClass(code: string): string {
  if (code === 'ACTIVE') return 'active';
  if (code === 'CLOSED') return 'done';
  return 'prep';
}

function ResultState({ item }: { item: ActivationListItem }) {
  if (!item.lastResultsAt) {
    return (
      <span className="result-state pending">
        <b>De actualizat</b>
        <small>Fără import</small>
      </span>
    );
  }
  return (
    <span className="result-state updated">
      <b>Actualizate</b>
      <small>{formatDateTime(item.lastResultsAt)}</small>
    </span>
  );
}

function ActivationRow({ item }: { item: ActivationListItem }) {
  const situation = getTemporalSituation(item);

  return (
    <tr>
      <td>
        <Link className="activation-title-link" to={`/activations/${item.id}`}>
          {item.title}
        </Link>
      </td>

      <td>
        <div className="activation-campaign-cell">
          {item.campaignId ? (
            <>
              <Link className="table-link" to={`/campaigns/${item.campaignId}`}>
                {item.campaignTitle}
              </Link>
              <div className="activation-campaign-meta">
                <span>{item.campaignPillar}</span>
                <span>{item.campaignType}</span>
              </div>
            </>
          ) : (
            <>
              <strong>Activare independentă</strong>
              <div className="activation-campaign-meta">
                <span>{item.activationPillar ?? 'Transversal'}</span>
                <span>Fără campanie</span>
              </div>
            </>
          )}
        </div>
      </td>

      <td>{formatPeriod(item)}</td>

      <td>
        <span className={`activation-status ${statusClass(item.statusCode)}`}>{item.status}</span>
      </td>

      <td>
        {situation ? (
          <span className={`calendar-situation-pill ${getTemporalSituationClass(situation)}`}>
            {situation}
          </span>
        ) : (
          <span className="muted-copy">—</span>
        )}
      </td>

      <td>
        <strong>{formatMoney(item.plannedBudget)}</strong>
        {item.actualSpend ? <small>Cheltuit: {formatMoney(item.actualSpend)}</small> : null}
      </td>

      <td>
        <strong>
          {item.materialConfiguredCount}/{item.materialCount}
        </strong>
        <small>cu canal + perioadă</small>
      </td>

      <td>
        <ResultState item={item} />
      </td>

      <td>
        {item.includeAnnualPlan ? (
          <span className="annual-mini included">✓ Inclusă</span>
        ) : (
          <span className="annual-mini">—</span>
        )}
      </td>
    </tr>
  );
}

export function ActivationsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';
  const [filters, setFilters] = useState<ActivationFilters>(EMPTY_ACTIVATION_FILTERS);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [year, setYear] = useState(new Date().getFullYear());
  const { items, meta, loading, error } = useActivations(filters);
  const stats = useActivationStats();
  const catalogs = useCatalogs();
  // Campaign list feeds the campaign filter; codes come from the database.
  const { items: campaigns } = useCampaigns(EMPTY_FILTERS);

  const years = useMemo(() => {
    const set = new Set<number>([2026, 2027, 2028]);
    items.forEach((item) => {
      if (item.startDate) set.add(Number(item.startDate.slice(0, 4)));
      if (item.endDate) set.add(Number(item.endDate.slice(0, 4)));
    });
    return [...set].filter(Boolean).sort((a, b) => a - b);
  }, [items]);

  const update = (patch: Partial<ActivationFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  const hasMoreFilters = Boolean(filters.annualPlan || filters.needsResults || filters.unpublished);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Activări</h1>
          <p>
            Fișele operaționale ale campaniilor: perioadă, buget, materiale, indicatori și includerea
            în Planul anual.
          </p>
        </div>
        {canEdit ? (
          <div className="actions">
            <Link className="btn primary" to="/activations/new">
              ＋ Activare nouă
            </Link>
          </div>
        ) : null}
      </header>

      <section className="activation-stats">
        <article>
          <small>Total activări</small>
          <b>{stats?.total ?? '—'}</b>
          <span>în portofoliu</span>
        </article>
        <article>
          <small>Draft</small>
          <b>{stats?.draft ?? '—'}</b>
          <span>fișe încă în lucru</span>
        </article>
        <article>
          <small>Active</small>
          <b>{stats?.active ?? '—'}</b>
          <span>fișe validate pentru execuție</span>
        </article>
        <article>
          <small>Încheiate</small>
          <b>{stats?.closed ?? '—'}</b>
          <span>păstrate pentru istoric</span>
        </article>
        <article>
          <small>Buget planificat</small>
          <b>{stats ? formatMoney(stats.plannedBudget, '0 lei') : '—'}</b>
          <span>total activări</span>
        </article>
        <article>
          <small>Rezultate neactualizate</small>
          <b>{stats?.needResults ?? '—'}</b>
          <span>necesită atenție</span>
        </article>
      </section>

      <section className="activation-filter-panel">
        <div className="activation-filter-main">
          <label className="search">
            <i>⌕</i>
            <input
              value={filters.q}
              onChange={(event) => update({ q: event.target.value })}
              placeholder="Caută activare, campanie, public sau produs"
            />
          </label>

          <select
            aria-label="Campanie"
            value={filters.campaign}
            onChange={(event) => update({ campaign: event.target.value })}
          >
            <option value="">Toate campaniile</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.title}
              </option>
            ))}
          </select>

          <select
            aria-label="Stadiu"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">Toate stadiile</option>
            {(catalogs?.campaign_statuses ?? []).map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Perioadă"
            value={filters.period}
            onChange={(event) => update({ period: event.target.value })}
          >
            <option value="">Orice perioadă</option>
            <option value="current">În desfășurare acum</option>
            <option value="upcoming">Încep în următoarele 30 zile</option>
            <option value="ended">Încheiate</option>
            <option value="missing">Perioadă incompletă</option>
          </select>

          <div className="toggle">
            <button
              type="button"
              className={view === 'list' ? 'active' : ''}
              title="Listă"
              onClick={() => setView('list')}
            >
              ☷ Listă
            </button>
            <button
              type="button"
              className={view === 'calendar' ? 'active' : ''}
              title="Calendar"
              onClick={() => setView('calendar')}
            >
              ▦ Calendar
            </button>
          </div>
        </div>

        <details className="activation-more-filters" open={hasMoreFilters}>
          <summary>Mai multe filtre</summary>
          <div>
            <select
              aria-label="Plan anual"
              value={filters.annualPlan}
              onChange={(event) => update({ annualPlan: event.target.value })}
            >
              <option value="">Plan anual: toate</option>
              <option value="yes">Incluse în Planul anual</option>
              <option value="no">Neincluse în Planul anual</option>
            </select>

            <label className="quick-filter">
              <input
                type="checkbox"
                checked={filters.needsResults}
                onChange={(event) => update({ needsResults: event.target.checked })}
              />
              <span>Necesită actualizarea rezultatelor</span>
            </label>

            <label className="quick-filter">
              <input
                type="checkbox"
                checked={filters.unpublished}
                onChange={(event) => update({ unpublished: event.target.checked })}
              />
              <span>Are materiale fără link public</span>
            </label>

            <button
              className="btn ghost"
              type="button"
              onClick={() => setFilters(EMPTY_ACTIVATION_FILTERS)}
            >
              Resetează filtrele
            </button>
          </div>
        </details>
      </section>

      {loading ? <div className="state-note">Se încarcă activările…</div> : null}
      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <section className="activation-empty">
          <div>▶</div>
          <h3>Nu există activări pentru filtrele selectate</h3>
          <p>Creează o activare dintr-o campanie sau resetează filtrele.</p>
        </section>
      ) : null}

      {!loading && !error && items.length > 0 && view === 'calendar' ? (
        <ActivationCalendar items={items} year={year} years={years} onYearChange={setYear} />
      ) : null}

      {!loading && !error && items.length > 0 && view === 'list' ? (
        <section className="activation-list-card">
          <div className="activation-list-count">
            <strong>
              {items.length} din {meta?.totalUnfiltered ?? items.length} activări
            </strong>
            <span>
              „Situația în calendar” este calculată automat doar pentru activările cu stadiul Activă.
            </span>
          </div>

          <div className="activation-table-scroll">
            <table className="activation-list-table">
              <thead>
                <tr>
                  <th>Activare</th>
                  <th>Campanie</th>
                  <th>Perioadă</th>
                  <th>Stadiu</th>
                  <th>Situație în calendar</th>
                  <th>Buget</th>
                  <th>Materiale</th>
                  <th>Rezultate</th>
                  <th>Plan anual</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ActivationRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
