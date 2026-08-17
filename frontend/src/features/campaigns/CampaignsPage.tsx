/**
 * Campanii — page 2, and the landing page after login (spec 11.7).
 *
 * Rebuilt as JSX from the prototype's `campaigns.js`, keeping its markup
 * structure and class names: stats strip, toolbar with search and three
 * filters, then a card grid. The prototype composed HTML strings and escaped
 * manually; React escapes by default, so the escaping helper is not carried
 * over.
 *
 * The data is live from MySQL rather than localStorage — that is the only
 * functional difference from v13.3.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  EMPTY_FILTERS,
  useCampaigns,
  useCatalogs,
  type CampaignFilters,
  type CampaignListItem,
} from './useCampaigns';

/** Shortened type label, as `OMD.u.type()` did in the prototype. */
function shortType(type: string): string {
  if (type.includes('umbrelă')) return 'Campanie-umbrelă';
  if (type.includes('tactică')) return 'Campanie tactică';
  return 'Campanie tematică';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function CampaignCard({ item }: { item: CampaignListItem }) {
  const summary = item.mainMessage || item.marketingObjective || '';
  const audience = item.primaryAudienceSegment || item.primaryAudienceDescription || 'De completat';

  return (
    <article className="card" data-accent={item.accent}>
      <div>
        <div className="kicker">{shortType(item.type)}</div>
        <h3>{item.title}</h3>
      </div>

      <p className="summary">{truncate(summary, 190)}</p>

      <div className="card-bottom">
        <div className="badges">
          <span className="badge">{item.pillarShort || item.pillar}</span>
          <span className="badge season">{item.seasonalityLabel}</span>
          <span className="badge status">{item.status}</span>
        </div>
        <div className="meta">
          <div>
            <small>Public principal</small>
            <span>{truncate(audience, 65)}</span>
          </div>
        </div>
      </div>

      <div className="card-actions">
        <Link className="btn secondary" to={`/campaigns/${item.id}`}>
          Deschide campania
        </Link>
        <Link className="btn primary" to={`/activations/new?campaign=${item.id}`}>
          ＋ Activare
        </Link>
      </div>
    </article>
  );
}

export function CampaignsPage() {
  const [filters, setFilters] = useState<CampaignFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const { items, meta, loading, error } = useCampaigns(filters);
  const catalogs = useCatalogs();

  const stats = useMemo(() => {
    const thematic = items.filter(
      (item) => item.type.includes('tematică') && !item.type.includes('tactică'),
    ).length;
    const tactical = items.filter((item) => item.type.includes('tactică')).length;
    const umbrella = items.filter((item) => item.type.includes('umbrelă')).length;
    return {
      total: items.length,
      breakdown: `${umbrella} umbrelă · ${thematic} tematice · ${tactical} tactice`,
      pillars: new Set(items.map((item) => item.pillarShort || item.pillar)).size,
      examples: items.reduce((sum, item) => sum + (item.activationExampleCount ?? 0), 0),
      active: items.filter((item) => item.statusCode === 'ACTIVE').length,
    };
  }, [items]);

  const update = (patch: Partial<CampaignFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Campanii</h1>
          <p>
            Portofoliul comun al destinației: o campanie-umbrelă, trei campanii tematice și două
            campanii tactice sezoniere.
          </p>
        </div>
        <div className="actions">
          <Link className="btn primary" to="/campaigns/new">
            ＋ Campanie nouă
          </Link>
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <small>Campanii în sistem</small>
          <b>{stats.total}</b>
          <span>{stats.breakdown}</span>
        </div>
        <div className="stat">
          <small>Piloni acoperiți</small>
          <b>{stats.pillars}</b>
          <span>Outdoor, comunități, patrimoniu</span>
        </div>
        <div className="stat">
          <small>Activări exemplu</small>
          <b>{stats.examples}</b>
          <span>Preluate din campaniile-sursă</span>
        </div>
        <div className="stat">
          <small>Campanii active</small>
          <b>{stats.active}</b>
          <span>campanii validate pentru utilizare</span>
        </div>
      </section>

      <section className="toolbar">
        <label className="search">
          <i>⌕</i>
          <input
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
            placeholder="Caută după nume, pilon, public, produs sau mesaj"
          />
        </label>

        <select
          aria-label="Tipul campaniei"
          value={filters.type}
          onChange={(event) => update({ type: event.target.value })}
        >
          <option value="">Toate tipurile</option>
          {(catalogs?.campaign_types ?? []).map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.displayLabel ?? entry.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Pilon"
          value={filters.pillar}
          onChange={(event) => update({ pillar: event.target.value })}
        >
          <option value="">Toți pilonii</option>
          {(catalogs?.pillars ?? []).map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.displayLabel ?? entry.label}
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

        <div className="toggle">
          <button
            type="button"
            className={view === 'cards' ? 'active' : ''}
            onClick={() => setView('cards')}
          >
            ▦ Carduri
          </button>
          <button
            type="button"
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            ☷ Listă
          </button>
        </div>
      </section>

      <div className="count">
        <span>
          {items.length} din {meta?.totalUnfiltered ?? items.length} campanii
        </span>
        <span>
          {view === 'cards'
            ? 'Deschide o campanie sau creează o activare direct din card.'
            : 'Selectează un rând pentru previzualizare.'}
        </span>
      </div>

      {/* Explicit loading / error / empty states — spec section 37. */}
      {loading ? <div className="state-note">Se încarcă campaniile…</div> : null}

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      {/* `.grid` is the prototype's card container; `.grid.list` is its row variant. */}
      {!loading && !error ? (
        <section className={view === 'list' ? 'grid list' : 'grid'}>
          {items.length > 0 ? (
            items.map((item) => <CampaignCard key={item.id} item={item} />)
          ) : (
            <div className="empty">
              <b>Nu am găsit campanii</b>
              Modifică filtrele sau adaugă una nouă.
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
