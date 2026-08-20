/**
 * Monitorizare activări — ported from the prototype's `monitoring.js`.
 *
 * One block with the prototype's shape: coverage line, filters, nine KPI cards
 * with a comparison against the preceding window, an evolution chart, campaign
 * contribution, and three tables — channels (with drill-down), activations, and
 * top materials.
 *
 * Everything is computed from the latest snapshot per material. Nothing here is
 * stored: engagement, CTR, CPC and the aggregates are derived at display time,
 * and a metric that was never supplied stays an em dash rather than becoming 0.
 * That distinction survives from the JSON contract through the database to here.
 *
 * The comparison window is real, not simulated. The prototype invents a previous
 * period; here the snapshots carry `observedAt`, so the preceding window of the
 * same length is a genuine slice of the same data. When it is empty the cards
 * say so instead of showing a number.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import {
  calculateCPC,
  calculateCTR,
  calculateEngagementRate,
  calculateInteractions,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPeriod,
  formatPercent,
  getTemporalSituation,
} from '../../domain/services';
import { useCatalogs } from '../campaigns/useCampaigns';
import { ActivationDrawer } from '../activations/ActivationDrawer';
import { CampaignDrawer } from '../campaigns/CampaignDrawer';

interface SnapshotRow {
  id: string;
  observedAt: string;
  channelCode: string;
  measurementType: string;
  provider: string;
  currency: string;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  spend: number | null;
  materialId: string;
  materialTitle: string;
  materialFormat: string;
  activationId: string;
  activationTitle: string;
  campaignId: string | null;
  campaignTitle: string | null;
}

interface ActivationRef {
  id: string;
  title: string;
  status: string;
  statusCode: string;
  startDate: string | null;
  endDate: string | null;
  campaignId: string | null;
  campaignTitle: string | null;
  campaignPillar: string | null;
  activationPillar: string | null;
}

interface Metrics {
  impressions: number | null;
  reach: number | null;
  views: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  spend: number | null;
  interactions: number | null;
  engagementRate: number | null;
  ctr: number | null;
  cpc: number | null;
}

const METRIC_KEYS = [
  'impressions', 'reach', 'views', 'reactions', 'comments', 'shares', 'saves', 'clicks', 'spend',
] as const;

/**
 * Sums a metric, keeping "never supplied" distinct from zero.
 *
 * A column where no row carried a value stays null and renders as an em dash.
 * Summing to 0 would claim a measurement nobody made.
 */
function sumMetric(rows: SnapshotRow[], key: (typeof METRIC_KEYS)[number]): number | null {
  const values = rows.map((row) => row[key]).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function aggregate(rows: SnapshotRow[]): Metrics {
  const totals = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, sumMetric(rows, key)]),
  ) as Pick<Metrics, (typeof METRIC_KEYS)[number]>;

  return {
    ...totals,
    interactions: calculateInteractions(totals),
    engagementRate: calculateEngagementRate(totals),
    ctr: calculateCTR(totals),
    cpc: calculateCPC(totals),
  };
}

/** Percentage change, or percentage-point change for metrics that are already rates. */
function delta(current: number | null, previous: number | null, mode: 'percent' | 'pp'): number | null {
  if (current === null || previous === null) return null;
  if (mode === 'pp') return current - previous;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function Delta({
  current,
  previous,
  mode = 'percent',
  lowerBetter = false,
  neutral = false,
}: {
  current: number | null;
  previous: number | null;
  mode?: 'percent' | 'pp';
  lowerBetter?: boolean;
  neutral?: boolean;
}) {
  const value = delta(current, previous, mode);
  if (value === null || !Number.isFinite(value)) {
    return <span className="performance-delta neutral">— vs. perioada anterioară</span>;
  }

  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  const favorable = lowerBetter ? value < 0 : value > 0;
  const tone = neutral || value === 0 ? 'neutral' : favorable ? 'good' : 'bad';
  const sign = value > 0 ? '+' : '';
  const text = mode === 'pp'
    ? `${sign}${value.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} pp`
    : `${sign}${value.toLocaleString('ro-RO', { maximumFractionDigits: 1 })}%`;

  return (
    <span className={`performance-delta ${tone}`}>
      {arrow} {text} vs. perioada anterioară
    </span>
  );
}

/** The month an observation falls in, as `2026-09`. */
function monthKey(observedAt: string): string {
  return (observedAt ?? '').slice(0, 7);
}

const MONTH_SHORT = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'];

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const index = Number(month) - 1;
  return index >= 0 && index < 12 ? `${MONTH_SHORT[index]} ${year}` : key;
}

/** The evolution chart: reach on the left axis, interactions and clicks on the right. */
function EvolutionChart({ rows }: { rows: SnapshotRow[] }) {
  const points = useMemo(() => {
    const byMonth = new Map<string, SnapshotRow[]>();
    for (const row of rows) {
      const key = monthKey(row.observedAt);
      if (!key) continue;
      byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => ({ key, label: monthLabel(key), metrics: aggregate(group) }));
  }, [rows]);

  if (points.length === 0) {
    return (
      <div className="performance-empty">
        Nu există rezultate datate pentru perioada și filtrele selectate.
      </div>
    );
  }

  const W = 760;
  const H = 280;
  const L = 62;
  const R = 58;
  const T = 32;
  const B = 48;
  const plotW = W - L - R;
  const plotH = H - T - B;

  const reachMax = Math.max(...points.map((p) => p.metrics.reach ?? 0), 1);
  const secondaryMax = Math.max(
    ...points.flatMap((p) => [p.metrics.interactions ?? 0, p.metrics.clicks ?? 0]),
    1,
  );

  const x = (index: number) =>
    points.length === 1 ? L + plotW / 2 : L + (index / (points.length - 1)) * plotW;
  const yReach = (value: number | null) => T + plotH - ((value ?? 0) / reachMax) * plotH;
  const ySecondary = (value: number | null) => T + plotH - ((value ?? 0) / secondaryMax) * plotH;

  const line = (key: 'reach' | 'interactions' | 'clicks', scale: (v: number | null) => number) =>
    points.map((p, index) => `${x(index).toFixed(1)},${scale(p.metrics[key]).toFixed(1)}`).join(' ');

  const step = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evoluția reach, interacțiuni și clickuri">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = T + plotH - ratio * plotH;
        return (
          <g key={ratio}>
            <line x1={L} y1={y} x2={W - R} y2={y} className="perf-grid-line" />
            <text x={L - 10} y={y + 4} textAnchor="end" className="perf-axis-label">
              {formatNumber(Math.round(reachMax * ratio))}
            </text>
          </g>
        );
      })}

      {[0, 0.5, 1].map((ratio) => {
        const y = T + plotH - ratio * plotH;
        return (
          <text key={ratio} x={W - R + 10} y={y + 4} className="perf-axis-label">
            {formatNumber(Math.round(secondaryMax * ratio))}
          </text>
        );
      })}

      {points.map((p, index) =>
        index % step === 0 || index === points.length - 1 ? (
          <text key={p.key} x={x(index)} y={H - 18} textAnchor="middle" className="perf-axis-label">
            {p.label}
          </text>
        ) : null,
      )}

      <polyline className="perf-line reach" points={line('reach', yReach)} />
      <polyline className="perf-line interactions" points={line('interactions', ySecondary)} />
      <polyline className="perf-line clicks" points={line('clicks', ySecondary)} />

      {points.map((p, index) => (
        <circle key={`r-${p.key}`} className="perf-dot reach" cx={x(index)} cy={yReach(p.metrics.reach)} r={3.5} />
      ))}
      {points.map((p, index) => (
        <circle
          key={`i-${p.key}`}
          className="perf-dot interactions"
          cx={x(index)}
          cy={ySecondary(p.metrics.interactions)}
          r={3.5}
        />
      ))}
      {points.map((p, index) => (
        <circle
          key={`c-${p.key}`}
          className="perf-dot clicks"
          cx={x(index)}
          cy={ySecondary(p.metrics.clicks)}
          r={3.5}
        />
      ))}
    </svg>
  );
}

export function MonitoringActivationsPage() {
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [activations, setActivations] = useState<ActivationRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [campaign, setCampaign] = useState('');
  const [pillar, setPillar] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [campaignMetric, setCampaignMetric] = useState<'reach' | 'clicks' | 'interactions'>('reach');
  const [topSort, setTopSort] = useState<'engagementRate' | 'reach' | 'clicks' | 'ctr' | 'saves' | 'shares'>(
    'engagementRate',
  );
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [openActivation, setOpenActivation] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

  const catalogs = useCatalogs();

  /*
   * `?activation=` narrows the page to one activation. The row-action icon on
   * Activări links here, so the link has to arrive somewhere useful. Read from
   * the URL rather than held in state, so the view is shareable and survives a
   * reload.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const activationFilter = searchParams.get('activation') ?? '';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<SnapshotRow[]>('/monitoring/activations/latest?pageSize=200'),
      api.get<ActivationRef[]>('/activations?pageSize=200'),
    ])
      .then(([snapshots, list]) => {
        setRows(snapshots.data);
        setActivations(list.data);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Rezultatele nu au putut fi încărcate.');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const activationById = useMemo(
    () => new Map(activations.map((item) => [item.id, item])),
    [activations],
  );

  const channelLabel = useMemo(() => {
    const map = new Map((catalogs?.activation_channels ?? []).map((c) => [c.code, c.label]));
    return (code: string) => map.get(code) ?? code;
  }, [catalogs]);

  /** Filters that are not about dates — the comparison window shares them. */
  const matchesNonDate = useMemo(
    () => (row: SnapshotRow) => {
      if (activationFilter && row.activationId !== activationFilter) return false;
      if (campaign === '__independent__' && row.campaignId) return false;
      if (campaign && campaign !== '__independent__' && row.campaignId !== campaign) return false;
      if (channel && row.channelCode !== channel) return false;

      const activation = activationById.get(row.activationId);
      if (status && activation?.status !== status) return false;
      if (pillar) {
        const value = activation?.campaignPillar ?? activation?.activationPillar ?? '';
        if (value !== pillar) return false;
      }
      return true;
    },
    [activationFilter, campaign, channel, status, pillar, activationById],
  );

  const inRange = (row: SnapshotRow, from: string, to: string) => {
    const day = (row.observedAt ?? '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };

  const current = useMemo(
    () => rows.filter((row) => matchesNonDate(row) && inRange(row, dateFrom, dateTo)),
    [rows, matchesNonDate, dateFrom, dateTo],
  );

  /*
   * The window immediately before the selected one, of the same length.
   *
   * Only computed when both ends are set — without a range there is no
   * "previous", and inventing one would be the thing the prototype does that
   * this deliberately does not.
   */
  const previous = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    const from = new Date(`${dateFrom}T00:00:00`);
    const to = new Date(`${dateTo}T00:00:00`);
    const span = to.getTime() - from.getTime();
    if (!Number.isFinite(span) || span < 0) return [];

    const prevTo = new Date(from.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - span);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    return rows.filter((row) => matchesNonDate(row) && inRange(row, iso(prevFrom), iso(prevTo)));
  }, [rows, matchesNonDate, dateFrom, dateTo]);

  const metrics = useMemo(() => aggregate(current), [current]);
  const previousMetrics = useMemo(() => aggregate(previous), [previous]);

  const byChannel = useMemo(() => {
    const groups = new Map<string, SnapshotRow[]>();
    for (const row of current) {
      groups.set(row.channelCode, [...(groups.get(row.channelCode) ?? []), row]);
    }
    return [...groups.entries()]
      .map(([code, group]) => ({ code, label: channelLabel(code), rows: group, metrics: aggregate(group) }))
      .sort((a, b) => (b.metrics.reach ?? 0) - (a.metrics.reach ?? 0));
  }, [current, channelLabel]);

  const byCampaign = useMemo(() => {
    const groups = new Map<string, { label: string; rows: SnapshotRow[] }>();
    for (const row of current) {
      const key = row.campaignId ?? '__independent__';
      const label = row.campaignTitle ?? 'Activări independente';
      const existing = groups.get(key);
      groups.set(key, { label, rows: [...(existing?.rows ?? []), row] });
    }
    return [...groups.entries()]
      .map(([key, group]) => ({ key, label: group.label, metrics: aggregate(group.rows) }))
      .filter((group) => group.metrics[campaignMetric] !== null)
      .sort((a, b) => (b.metrics[campaignMetric] ?? 0) - (a.metrics[campaignMetric] ?? 0));
  }, [current, campaignMetric]);

  const byActivation = useMemo(() => {
    const groups = new Map<string, SnapshotRow[]>();
    for (const row of current) {
      groups.set(row.activationId, [...(groups.get(row.activationId) ?? []), row]);
    }
    return [...groups.entries()]
      .map(([id, group]) => ({
        id,
        title: group[0]?.activationTitle ?? id,
        campaignTitle: group[0]?.campaignTitle ?? null,
        campaignId: group[0]?.campaignId ?? null,
        activation: activationById.get(id),
        lastObservedAt: group.map((r) => r.observedAt).sort().at(-1) ?? '',
        metrics: aggregate(group),
      }))
      .sort((a, b) => (b.metrics.reach ?? 0) - (a.metrics.reach ?? 0));
  }, [current, activationById]);

  const topMaterials = useMemo(() => {
    return current
      .map((row) => ({ row, metrics: aggregate([row]) }))
      .filter((entry) => entry.metrics[topSort] !== null)
      .sort((a, b) => (b.metrics[topSort] ?? 0) - (a.metrics[topSort] ?? 0))
      .slice(0, 10);
  }, [current, topSort]);

  const pillars = useMemo(
    () =>
      [...new Set(
        activations.map((item) => item.campaignPillar ?? item.activationPillar).filter(Boolean),
      )] as string[],
    [activations],
  );

  const campaignOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.campaignId && row.campaignTitle) map.set(row.campaignId, row.campaignTitle);
    }
    return [...map.entries()];
  }, [rows]);

  /* Only activations that actually have snapshots — offering the rest would be
     offering a filter that empties the page. */
  const activationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.activationId, row.activationTitle);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ro'));
  }, [rows]);

  const contributionTotal = byCampaign.reduce(
    (sum, group) => sum + (group.metrics[campaignMetric] ?? 0),
    0,
  );
  const contributionMax = Math.max(...byCampaign.map((g) => g.metrics[campaignMetric] ?? 0), 1);

  const publishedWithData = current.length;
  const coverage = `${byActivation.length} activări · ${publishedWithData} materiale publicate cu rezultate actualizate`;

  const contributionLabel = { reach: 'Reach', clicks: 'Clickuri', interactions: 'Interacțiuni' }[
    campaignMetric
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Monitorizare activări</h1>
          <p>
            Urmărește performanța materialelor, canalelor, activărilor și contribuția directă a
            campaniilor.
          </p>
        </div>
      </header>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <div className="state-note">Se încarcă rezultatele…</div> : null}

      {!loading && !error ? (
        <div className="monitoring-stack">
          <section className="monitoring-block performance-monitoring-block">
            <header className="monitoring-block-head performance-main-head">
              <div>
                <small>Performanță</small>
                <h2>Performanța activărilor</h2>
                <p>
                  Rezultatele sunt agregate din materialele activărilor, cu atribuire directă către
                  campanie și raportarea separată a activărilor independente.
                </p>
                <span className="performance-coverage">{coverage}</span>
              </div>
              <div className="performance-block-head-actions">
                {/*
                  The prototype's export is a print: the stylesheet carries 13
                  rules behind `body.print-performance` that strip the shell and
                  lay the block out for paper. The class is removed on
                  `afterprint`, and on a timer as well — a cancelled dialog does
                  not always fire that event, and the page would stay in print
                  layout on screen.
                */}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    document.body.classList.add('print-performance');
                    const cleanup = () => document.body.classList.remove('print-performance');
                    window.addEventListener('afterprint', cleanup, { once: true });
                    window.print();
                    setTimeout(cleanup, 1000);
                  }}
                >
                  ⇩ Exportă raport
                </button>
                <span className="badge status">Date agregate</span>
              </div>
            </header>

            <div className="performance-filters">
              <div className="performance-date-range" aria-label="Perioadă">
                <span>Perioadă</span>
                <input
                  type="date"
                  aria-label="De la"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
                <i>–</i>
                <input
                  type="date"
                  aria-label="Până la"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>

              <select
                aria-label="Campanie"
                value={campaign}
                onChange={(event) => setCampaign(event.target.value)}
              >
                <option value="">Toate campaniile</option>
                <option value="__independent__">Activări independente</option>
                {campaignOptions.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>

              <select aria-label="Pilon" value={pillar} onChange={(event) => setPillar(event.target.value)}>
                <option value="">Toți pilonii</option>
                {pillars.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>

              {/*
                The activation filter lives in the URL rather than in state, so
                the dropdown and the link from Activări are the same control.
                Two sources for one filter would let them disagree, and the one
                you could see would be the wrong one.
              */}
              <select
                aria-label="Activare"
                value={activationFilter}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams);
                  if (event.target.value) next.set('activation', event.target.value);
                  else next.delete('activation');
                  setSearchParams(next, { replace: true });
                }}
              >
                <option value="">Toate activările</option>
                {activationOptions.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>

              <select aria-label="Canal" value={channel} onChange={(event) => setChannel(event.target.value)}>
                <option value="">Toate canalele</option>
                {(catalogs?.activation_channels ?? []).map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>

              <select aria-label="Stadiu" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Toate stadiile</option>
                {[...new Set(activations.map((item) => item.status))].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>

              {activationFilter ? (
                <span className="quick-filter">
                  <span>
                    Activare:{' '}
                    <strong>{activationById.get(activationFilter)?.title ?? activationFilter}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.delete('activation');
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    Renunță
                  </button>
                </span>
              ) : null}

              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setCampaign('');
                  setPillar('');
                  setChannel('');
                  setStatus('');
                  setDateFrom('');
                  setDateTo('');
                  // The activation filter lives in the URL, so it has to be
                  // cleared there too — a reset that leaves one filter standing
                  // is a reset that lies.
                  const next = new URLSearchParams(searchParams);
                  next.delete('activation');
                  setSearchParams(next, { replace: true });
                }}
              >
                Resetează filtrele
              </button>
            </div>

            {current.length === 0 ? (
              <div className="performance-empty-banner">
                Nu există rezultate de activare pentru campania și perioada selectate.
              </div>
            ) : null}

            <div className="performance-kpis">
              <article title="Reach cumulat din materialele selectate; poate include aceeași persoană în mai multe publicări.">
                <small>Reach</small>
                <b>{formatNumber(metrics.reach)}</b>
                <Delta current={metrics.reach} previous={previousMetrics.reach} />
              </article>
              <article>
                <small>Impresii</small>
                <b>{formatNumber(metrics.impressions)}</b>
                <Delta current={metrics.impressions} previous={previousMetrics.impressions} />
              </article>
              <article>
                <small>Vizualizări</small>
                <b>{formatNumber(metrics.views)}</b>
                <Delta current={metrics.views} previous={previousMetrics.views} />
              </article>
              <article>
                <small>Interacțiuni</small>
                <b>{formatNumber(metrics.interactions)}</b>
                <Delta current={metrics.interactions} previous={previousMetrics.interactions} />
              </article>
              <article title="Interacțiuni / Reach × 100.">
                <small>Engagement rate</small>
                <b>{formatPercent(metrics.engagementRate)}</b>
                <Delta current={metrics.engagementRate} previous={previousMetrics.engagementRate} mode="pp" />
              </article>
              <article>
                <small>Clickuri</small>
                <b>{formatNumber(metrics.clicks)}</b>
                <Delta current={metrics.clicks} previous={previousMetrics.clicks} />
              </article>
              <article title="Clickuri / Impresii × 100.">
                <small>CTR</small>
                <b>{formatPercent(metrics.ctr, 2)}</b>
                <Delta current={metrics.ctr} previous={previousMetrics.ctr} mode="pp" />
              </article>
              <article>
                <small>Buget media utilizat</small>
                <b>{formatMoney(metrics.spend)}</b>
                <Delta current={metrics.spend} previous={previousMetrics.spend} neutral />
              </article>
              <article title="Buget media raportat / Clickuri.">
                <small>Cost / click</small>
                <b>{metrics.cpc === null ? '—' : formatMoney(metrics.cpc, '—', 2)}</b>
                <Delta current={metrics.cpc} previous={previousMetrics.cpc} lowerBetter />
              </article>
            </div>

            <div className="performance-body">
              <section className="performance-panel">
                <header>
                  <h3>Evoluție în timp</h3>
                  <span>Reach, interacțiuni și clickuri</span>
                </header>
                <EvolutionChart rows={current} />
              </section>

              <section className="performance-panel">
                <header>
                  <div>
                    <h3>Contribuția campaniilor</h3>
                    <span>Activările fără campanie sunt raportate separat</span>
                  </div>
                  <select
                    className="performance-mini-select"
                    aria-label="Metrică pentru contribuția campaniilor"
                    value={campaignMetric}
                    onChange={(event) =>
                      setCampaignMetric(event.target.value as 'reach' | 'clicks' | 'interactions')
                    }
                  >
                    <option value="reach">Reach</option>
                    <option value="clicks">Clickuri</option>
                    <option value="interactions">Interacțiuni</option>
                  </select>
                </header>

                {byCampaign.length === 0 ? (
                  <div className="performance-empty">
                    Nu există contribuții de campanie pentru selecția curentă.
                  </div>
                ) : (
                  <div className="campaign-contribution">
                    <div className="contribution-head">
                      <span>Campanie / categorie</span>
                      <span>{contributionLabel}</span>
                      <span>% din total</span>
                    </div>
                    {byCampaign.map((group) => {
                      const value = group.metrics[campaignMetric] ?? 0;
                      const share = contributionTotal > 0 ? (value / contributionTotal) * 100 : 0;
                      return (
                        <div className="contribution-row" key={group.key}>
                          <span>{group.label}</span>
                          <div className="contribution-bar">
                            <span style={{ width: `${(value / contributionMax) * 100}%` }} />
                          </div>
                          <b>{formatNumber(value)}</b>
                          <small>{share.toLocaleString('ro-RO', { maximumFractionDigits: 1 })}%</small>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="performance-panel full">
                <header>
                  <h3>Performanță pe canale</h3>
                  <span>
                    Click pe canal pentru a vedea materialele și valorile care compun totalul agregat
                  </span>
                </header>
                <div className="performance-table-scroll">
                  <table className="performance-table performance-channel-table">
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th>Materiale</th>
                        <th>Impresii</th>
                        <th>Reach</th>
                        <th>Vizualizări</th>
                        <th>Interacțiuni</th>
                        <th>Eng. rate</th>
                        <th>Clickuri</th>
                        <th>CTR</th>
                        <th>Spend</th>
                        <th>Cost / click</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byChannel.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="performance-empty">
                            Niciun canal cu rezultate în selecția curentă.
                          </td>
                        </tr>
                      ) : (
                        byChannel.flatMap((group) => {
                          const open = expandedChannel === group.code;
                          const rowsOut = [
                            <tr className={open ? 'channel-expanded' : ''} key={group.code}>
                              <td>
                                <button
                                  type="button"
                                  className="table-link channel-drilldown-toggle"
                                  aria-expanded={open}
                                  onClick={() => setExpandedChannel(open ? null : group.code)}
                                >
                                  <span>{open ? '▾' : '▸'}</span> {group.label}
                                </button>
                              </td>
                              <td className="num">{group.rows.length}</td>
                              <td className="num">{formatNumber(group.metrics.impressions)}</td>
                              <td className="num">{formatNumber(group.metrics.reach)}</td>
                              <td className="num">{formatNumber(group.metrics.views)}</td>
                              <td className="num">{formatNumber(group.metrics.interactions)}</td>
                              <td className="num">{formatPercent(group.metrics.engagementRate)}</td>
                              <td className="num">{formatNumber(group.metrics.clicks)}</td>
                              <td className="num">{formatPercent(group.metrics.ctr, 2)}</td>
                              <td className="num">{formatMoney(group.metrics.spend)}</td>
                              <td className="num">
                                {group.metrics.cpc === null ? '—' : formatMoney(group.metrics.cpc, '—', 2)}
                              </td>
                            </tr>,
                          ];

                          if (open) {
                            for (const row of group.rows) {
                              const m = aggregate([row]);
                              rowsOut.push(
                                <tr className="channel-drill" key={`${group.code}-${row.materialId}`}>
                                  <td>
                                    <strong>{row.materialTitle}</strong>
                                    <small>{row.activationTitle}</small>
                                  </td>
                                  <td className="num">1</td>
                                  <td className="num">{formatNumber(m.impressions)}</td>
                                  <td className="num">{formatNumber(m.reach)}</td>
                                  <td className="num">{formatNumber(m.views)}</td>
                                  <td className="num">{formatNumber(m.interactions)}</td>
                                  <td className="num">{formatPercent(m.engagementRate)}</td>
                                  <td className="num">{formatNumber(m.clicks)}</td>
                                  <td className="num">{formatPercent(m.ctr, 2)}</td>
                                  <td className="num">{formatMoney(m.spend)}</td>
                                  <td className="num">
                                    {m.cpc === null ? '—' : formatMoney(m.cpc, '—', 2)}
                                  </td>
                                </tr>,
                              );
                            }
                          }

                          return rowsOut;
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="performance-panel full">
                <header>
                  <h3>Activări – performanță pe scurt</h3>
                  <span>Acces direct la KPI și rezultate</span>
                </header>
                <div className="performance-table-scroll">
                  <table className="performance-table performance-activation-table">
                    <thead>
                      <tr>
                        <th>Activare</th>
                        <th>Campanie</th>
                        <th>Stadiu</th>
                        <th>Perioadă</th>
                        <th>Buget media</th>
                        <th>Reach</th>
                        <th>Interacțiuni</th>
                        <th>Eng. rate</th>
                        <th>Clickuri</th>
                        <th>CTR</th>
                        <th>Actualizare</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {byActivation.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="performance-empty">
                            Nicio activare pentru filtrele selectate.
                          </td>
                        </tr>
                      ) : (
                        byActivation.map((group) => {
                          const situation = group.activation
                            ? getTemporalSituation(group.activation)
                            : null;
                          return (
                            <tr key={group.id}>
                              <td>
                                <strong>{group.title}</strong>
                              </td>
                              <td>
                                {group.campaignId ? (
                                  <button
                                    type="button"
                                    className="table-link"
                                    onClick={() => setOpenCampaign(group.campaignId as string)}
                                  >
                                    {group.campaignTitle}
                                  </button>
                                ) : (
                                  'Activare independentă'
                                )}
                              </td>
                              <td>
                                {group.activation?.status ?? '—'}
                                {situation ? <small>Situație: {situation}</small> : null}
                              </td>
                              <td>{group.activation ? formatPeriod(group.activation) : '—'}</td>
                              <td className="num">{formatMoney(group.metrics.spend)}</td>
                              <td className="num">{formatNumber(group.metrics.reach)}</td>
                              <td className="num">{formatNumber(group.metrics.interactions)}</td>
                              <td className="num">{formatPercent(group.metrics.engagementRate)}</td>
                              <td className="num">{formatNumber(group.metrics.clicks)}</td>
                              <td className="num">{formatPercent(group.metrics.ctr, 2)}</td>
                              <td>{formatDateTime(group.lastObservedAt)}</td>
                              <td className="open-cell">
                                <button
                                  type="button"
                                  className="activation-icon-btn"
                                  data-tooltip="Deschide KPI și rezultate"
                                  title="Deschide KPI și rezultate"
                                  aria-label={`Deschide KPI și rezultate pentru ${group.title}`}
                                  onClick={() => setOpenActivation(group.id)}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                                    <circle cx="12" cy="12" r="2.6" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="performance-panel full">
                <header>
                  <div>
                    <h3>Top materiale</h3>
                    <span>
                      Identifică materialele cu performanță ridicată și potențial de replicare
                    </span>
                  </div>
                  <label className="top-sort-label">
                    Ordonează după{' '}
                    <select
                      className="performance-mini-select"
                      value={topSort}
                      onChange={(event) => setTopSort(event.target.value as typeof topSort)}
                    >
                      <option value="engagementRate">Engagement Rate</option>
                      <option value="reach">Reach</option>
                      <option value="clicks">Clickuri</option>
                      <option value="ctr">CTR</option>
                      <option value="saves">Salvări</option>
                      <option value="shares">Distribuiri</option>
                    </select>
                  </label>
                </header>
                <div className="performance-table-scroll">
                  <table className="performance-table performance-top-table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Activare</th>
                        <th>Canal</th>
                        <th>Format</th>
                        <th>Reach</th>
                        <th>Salvări</th>
                        <th>Distribuiri</th>
                        <th>Eng. rate</th>
                        <th>CTR</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {topMaterials.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="performance-empty">
                            Nu există materiale cu rezultate pentru clasamentul curent.
                          </td>
                        </tr>
                      ) : (
                        topMaterials.map(({ row, metrics: m }) => (
                          <tr key={row.id}>
                            <td>
                              <button
                                type="button"
                                className="monitoring-material-link"
                                onClick={() => setOpenActivation(row.activationId)}
                              >
                                {row.materialTitle || 'Material'}
                              </button>
                              <small>{row.observedAt ? formatDate(row.observedAt.slice(0, 10)) : '—'}</small>
                            </td>
                            <td>{row.activationTitle}</td>
                            <td>{channelLabel(row.channelCode)}</td>
                            <td>{row.materialFormat || '—'}</td>
                            <td className="num">{formatNumber(m.reach)}</td>
                            <td className="num">{formatNumber(m.saves)}</td>
                            <td className="num">{formatNumber(m.shares)}</td>
                            <td className="num">{formatPercent(m.engagementRate)}</td>
                            <td className="num">{formatPercent(m.ctr, 2)}</td>
                            <td className="open-cell">
                              <button
                                type="button"
                                className="activation-icon-btn"
                                data-tooltip="Deschide materialul"
                                title="Deschide materialul"
                                aria-label={`Deschide activarea ${row.activationTitle}`}
                                onClick={() => setOpenActivation(row.activationId)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 12h14" />
                                  <path d="m13 6 6 6-6 6" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="performance-source-note">
              Sursa datelor: fișele activărilor și rezultatele materialelor importate prin pachetele
              de monitorizare. Reach-ul este cumulat și nu este deduplicat între publicări.
            </div>
          </section>
        </div>
      ) : null}

      {openActivation ? (
        <ActivationDrawer
          externalKey={openActivation}
          onClose={() => setOpenActivation(null)}
          onOpenCampaign={setOpenCampaign}
          escapeEnabled={openCampaign === null}
        />
      ) : null}

      {openCampaign ? (
        <CampaignDrawer externalKey={openCampaign} onClose={() => setOpenCampaign(null)} />
      ) : null}
    </>
  );
}
