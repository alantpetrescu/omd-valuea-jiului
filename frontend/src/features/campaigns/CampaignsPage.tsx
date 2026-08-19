/**
 * Campanii — page 2, and the landing page after login (spec 11.7).
 *
 * Rebuilt as JSX from the prototype's `campaigns.js`, keeping its markup
 * structure and class names: stats strip, toolbar with search and three
 * filters, then either a card grid or the split list. The prototype composed
 * HTML strings and escaped manually; React escapes by default, so the escaping
 * helper is not carried over.
 *
 * Two views, as `drawBody()` had them:
 *
 *   Carduri   a `.grid` of `.card` articles
 *   Listă     `.split` — a `.list-pane` of rows beside a sticky `.preview-pane`
 *
 * The list is not a denser card grid: selecting a row previews that campaign
 * without leaving the page, which is why the counter line reads "Selectează un
 * rând pentru previzualizare".
 *
 * The data is live from MySQL rather than localStorage — that is the only
 * functional difference from v13.3.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../../api/client';
import { seasonalityPeriodLabel } from '../../domain/services';
import { useAuth } from '../auth/AuthContext';
import { CampaignDrawer } from './CampaignDrawer';
import { Lightbox, type CampaignActivation, type CampaignDetail } from './CampaignDetailPage';

import {
  EMPTY_FILTERS,
  useCampaigns,
  useCatalogs,
  type CampaignFilters,
  type CampaignListItem,
} from './useCampaigns';

type ViewMode = 'cards' | 'list';

/**
 * The chosen view survives leaving the page.
 *
 * Opening a wizard or an activation unmounts this component, so plain state
 * would drop the reader back into Carduri every time they came back from a task
 * they started here. Session storage rather than local: it is a property of the
 * current sitting, not a preference to carry across days. A failure to read or
 * write it is never worth an error - the view simply falls back to Carduri.
 */
const VIEW_KEY = 'omd.campaigns.view';

function readView(): ViewMode {
  try {
    return window.sessionStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function rememberView(view: ViewMode): void {
  try {
    window.sessionStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode, or storage disabled - not worth surfacing.
  }
}

/** Shortened type label, as `OMD.u.type()` did in the prototype. */
function shortType(type: string): string {
  if (type.includes('umbrelă')) return 'Campanie-umbrelă';
  if (type.includes('tactică')) return 'Campanie tactică';
  return 'Campanie tematică';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function CampaignCard({
  item,
  canEdit,
  onOpen,
}: {
  item: CampaignListItem;
  canEdit: boolean;
  onOpen: (externalKey: string) => void;
}) {
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
        <button className="btn secondary" type="button" onClick={() => onOpen(item.id)}>
          Deschide campania
        </button>
        {canEdit ? (
          <Link
            className="btn primary"
            to={`/activations/new?campaign=${item.id}`}
            state={{ from: '/campaigns' }}
          >
            ＋ Activare
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** One row of the list pane — the prototype's `listRow()`. */
function CampaignRow({
  item,
  selected,
  onSelect,
}: {
  item: CampaignListItem;
  selected: boolean;
  onSelect: (externalKey: string) => void;
}) {
  const summary = item.mainMessage || item.marketingObjective || '';

  return (
    <button
      type="button"
      className={selected ? 'row sel' : 'row'}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(item.id)}
    >
      <div>
        <h3>{item.title}</h3>
        <p>{truncate(summary, 92)}</p>
      </div>
      <span className="row-cell">{item.pillarShort || item.pillar}</span>
      <span className="row-cell">{shortType(item.type)}</span>
    </button>
  );
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <span>{value || '—'}</span>
    </div>
  );
}

/**
 * The right-hand pane — the prototype's `preview()`.
 *
 * The prototype held every campaign in memory and could render this
 * synchronously. Here the fields beyond the list projection (program,
 * responsible, product and KPI counts, mockups, created activations) need the
 * detail endpoint, so they arrive a moment later.
 *
 * The heading, lead and three of the six definition rows come straight from the
 * list item, so they paint on the first frame and the pane never collapses or
 * jumps while the request is in flight. Absent values render as an em dash,
 * which is what `def()` did for empty fields anyway.
 */
function CampaignPreviewPane({
  item,
  canEdit,
  onOpen,
}: {
  item: CampaignListItem | null;
  canEdit: boolean;
  onOpen: (externalKey: string) => void;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [activations, setActivations] = useState<CampaignActivation[] | null>(null);
  const [image, setImage] = useState<{ src: string; caption: string } | null>(null);

  const selectedKey = item?.id ?? null;

  useEffect(() => {
    setDetail(null);
    setActivations(null);
    if (!selectedKey) return undefined;

    let cancelled = false;
    Promise.all([
      api.get<CampaignDetail>(`/campaigns/${encodeURIComponent(selectedKey)}`),
      api.get<CampaignActivation[]>(`/campaigns/${encodeURIComponent(selectedKey)}/activations`),
    ])
      .then(([loadedDetail, loadedActivations]) => {
        if (cancelled) return;
        setDetail(loadedDetail.data);
        setActivations(loadedActivations.data);
      })
      // A failure here degrades the pane to what the list already knows rather
      // than replacing the whole page with an error: the rows still work.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  if (!item) {
    return (
      <aside className="preview-pane">
        <div className="preview-empty">
          Selectează o campanie din listă pentru a vedea campania pe scurt.
        </div>
      </aside>
    );
  }

  // The prototype showed the first asset of each mockup that has one, capped at
  // three. Flattened to (id, name, src) here so the render has no optional
  // chaining in it.
  const thumbs = (detail?.mockups ?? [])
    .flatMap((mockup) => {
      const asset = mockup.assets?.[0];
      return asset ? [{ id: mockup.id, name: mockup.name, src: asset.src }] : [];
    })
    .slice(0, 3);

  const created = activations ?? [];
  const examples = detail?.activationExamples?.simulatedRows ?? [];
  const lines = created.length
    ? created.map((activation) => ({
        key: activation.id,
        title: truncate(activation.title, 30),
        note: activation.status,
      }))
    : examples.slice(0, 4).map((example, index) => ({
        key: `example-${index}`,
        title: truncate(example.name, 30),
        note: example.period || '',
      }));

  return (
    <aside className="preview-pane">
      <div>
        <div className="kicker">
          {shortType(item.type)} · {item.pillarShort || item.pillar}
        </div>
        <h2>{item.title}</h2>
        <p className="lead">{truncate(item.mainMessage || item.marketingObjective || '', 200)}</p>
      </div>

      <div className="preview-actions">
        <button className="btn primary" type="button" onClick={() => onOpen(item.id)}>
          Deschide campania
        </button>
        {canEdit ? (
          <Link
            className="btn secondary"
            to={`/activations/new?campaign=${item.id}`}
            state={{ from: '/campaigns' }}
          >
            ＋ Activare
          </Link>
        ) : null}
      </div>

      {canEdit ? (
        <button
          className="btn secondary"
          type="button"
          style={{ width: '100%' }}
          onClick={() => navigate(`/campaigns/${item.id}/edit`)}
        >
          Editează campania
        </button>
      ) : null}

      <div className="def">
        <DefRow
          label="Sezonalitate"
          value={`${item.seasonalityLabel} · ${seasonalityPeriodLabel(item.seasonalityMonths)}`}
        />
        <DefRow label="Program" value={truncate(detail?.programPrimary ?? '', 44)} />
        <DefRow
          label="Public principal"
          value={truncate(item.primaryAudienceSegment || item.primaryAudienceDescription || '', 44)}
        />
        <DefRow label="Mesaj principal" value={truncate(item.mainMessage || '', 80)} />
        <DefRow label="Responsabil" value={detail?.responsible ?? ''} />
        <DefRow
          label="Produse / KPI"
          value={detail ? `${detail.products.length} / ${detail.kpiDefinitions.length}` : ''}
        />
      </div>

      {thumbs.length > 0 && detail ? (
        <div>
          <div className="block-label">
            Machete cu vizualuri · {thumbs.length} din {detail.mockups.length}
          </div>
          <div className="thumbs">
            {thumbs.map((thumb) => (
              <button
                key={thumb.id}
                type="button"
                onClick={() => setImage({ src: thumb.src, caption: thumb.name })}
              >
                <img src={thumb.src} alt={thumb.name} />
                <span>{truncate(thumb.name, 18)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Held back until the activations call resolves: rendering it early
          would flash "Exemple din campania-sursă · 0" for every campaign. */}
      {activations ? (
        <div className="mini-card">
          <div className="block-label">
            {created.length
              ? `Activări create · ${created.length}`
              : `Exemple din campania-sursă · ${examples.length}`}
          </div>
          <div className="mini-list">
            {lines.length > 0 ? (
              lines.map((line) => (
                <div key={line.key}>
                  <strong>{line.title}</strong>
                  <em>{line.note}</em>
                </div>
              ))
            ) : (
              <div>
                <em>Nu există activări.</em>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Lightbox image={image} onClose={() => setImage(null)} />
    </aside>
  );
}

export function CampaignsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';
  const [filters, setFilters] = useState<CampaignFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<ViewMode>(readView);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const { items, meta, loading, error } = useCampaigns(filters);

  useEffect(() => rememberView(view), [view]);
  const catalogs = useCatalogs();

  // Derived rather than stored, so a filter change that hides the selected row
  // falls back to the first result on the same render — the prototype did the
  // same reconciliation at the top of `drawBody()`.
  const selected = items.find((item) => item.id === selectedKey) ?? items[0] ?? null;

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

  const total = meta?.totalUnfiltered ?? items.length;

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
        {canEdit ? (
          <div className="actions">
            <Link className="btn primary" to="/campaigns/new">
              ＋ Campanie nouă
            </Link>
          </div>
        ) : null}
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
          {items.length} din {total} campanii
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

      {!loading && !error && view === 'cards' ? (
        <section className="grid">
          {items.length > 0 ? (
            items.map((item) => (
              <CampaignCard key={item.id} item={item} canEdit={canEdit} onOpen={setOpenKey} />
            ))
          ) : (
            <div className="empty">
              <b>Nu am găsit campanii</b>
              Modifică filtrele sau adaugă una nouă.
            </div>
          )}
        </section>
      ) : null}

      {!loading && !error && view === 'list' ? (
        <div className="split">
          <div className="list-pane">
            <div className="list-head">
              <span>Campanie</span>
              <span>Pilon</span>
              <span>Tip</span>
            </div>

            {items.length > 0 ? (
              items.map((item) => (
                <CampaignRow
                  key={item.id}
                  item={item}
                  selected={selected?.id === item.id}
                  onSelect={setSelectedKey}
                />
              ))
            ) : (
              <div className="empty" style={{ margin: 20 }}>
                <b>Nu am găsit campanii</b>
                Modifică filtrele sau adaugă una nouă.
              </div>
            )}

            <div className="list-foot">
              {items.length} din {total} campanii
            </div>
          </div>

          <CampaignPreviewPane item={selected} canEdit={canEdit} onOpen={setOpenKey} />
        </div>
      ) : null}

      {openKey ? <CampaignDrawer externalKey={openKey} onClose={() => setOpenKey(null)} /> : null}
    </>
  );
}
