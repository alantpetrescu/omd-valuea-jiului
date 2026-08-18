/**
 * Monitorizare activări.
 *
 * Shows the latest snapshot per material. Engagement, CTR, CPC and CPM are
 * computed here from the raw counters — they are derived and never stored.
 *
 * A metric that was never supplied renders as an em dash, not as 0. That
 * distinction survives from the JSON contract through the database to here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import {
  calculateCPC,
  calculateCPM,
  calculateCTR,
  calculateEngagementRate,
  calculateInteractions,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
} from '../../domain/services';
import { useCampaigns, useCatalogs, EMPTY_FILTERS } from '../campaigns/useCampaigns';

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

interface Summary {
  materials: number;
  impressions: number;
  reach: number;
  clicks: number;
  reactions: number;
  comments: number;
  shares: number;
  saves: number;
  spend: number;
  lastObservedAt: string | null;
  byChannel: Array<{
    channelCode: string;
    materials: number;
    impressions: number;
    clicks: number;
    spend: number;
  }>;
}

export function MonitoringActivationsPage() {
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState('');
  const [channel, setChannel] = useState('');

  const catalogs = useCatalogs();
  const { items: campaigns } = useCampaigns(EMPTY_FILTERS);

  useEffect(() => {
    api
      .get<Summary>('/monitoring/activations/summary')
      .then((response) => setSummary(response.data))
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (campaign) params.set('campaign', campaign);
    if (channel) params.set('channel', channel);
    params.set('pageSize', '200');

    api
      .get<SnapshotRow[]>(`/monitoring/activations/latest?${params.toString()}`)
      .then((response) => setRows(response.data))
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Rezultatele nu au putut fi încărcate.');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [campaign, channel]);

  // Aggregate engagement across the filtered set, from summed counters rather
  // than an average of ratios.
  const aggregate = useMemo(() => {
    const totals = rows.reduce(
      (acc, row) => ({
        impressions: acc.impressions + (row.impressions ?? 0),
        reach: acc.reach + (row.reach ?? 0),
        clicks: acc.clicks + (row.clicks ?? 0),
        reactions: acc.reactions + (row.reactions ?? 0),
        comments: acc.comments + (row.comments ?? 0),
        shares: acc.shares + (row.shares ?? 0),
        saves: acc.saves + (row.saves ?? 0),
        spend: acc.spend + (row.spend ?? 0),
      }),
      { impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, saves: 0, spend: 0 },
    );
    return {
      ...totals,
      interactions: calculateInteractions(totals),
      engagementRate: calculateEngagementRate(totals),
      ctr: calculateCTR(totals),
      cpc: calculateCPC(totals),
      cpm: calculateCPM(totals),
    };
  }, [rows]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Monitorizare activări</h1>
          <p>
            Cele mai recente rezultate pentru fiecare material. Datele provin din importuri
            periodice; indicatorii derivați sunt calculați la afișare.
          </p>
        </div>
      </header>

      <section className="activation-stats">
        <article>
          <small>Materiale monitorizate</small>
          <b>{summary ? formatNumber(summary.materials) : '—'}</b>
          <span>cu cel puțin un import</span>
        </article>
        <article>
          <small>Impresii</small>
          <b>{formatNumber(aggregate.impressions)}</b>
          <span>în selecția curentă</span>
        </article>
        <article>
          <small>Interacțiuni</small>
          <b>{formatNumber(aggregate.interactions)}</b>
          <span>reacții, comentarii, distribuiri, salvări</span>
        </article>
        <article>
          <small>Engagement</small>
          <b>{formatPercent(aggregate.engagementRate)}</b>
          <span>interacțiuni / reach</span>
        </article>
        <article>
          <small>CTR</small>
          <b>{formatPercent(aggregate.ctr, 2)}</b>
          <span>clicuri / impresii</span>
        </article>
        <article>
          <small>Cheltuit</small>
          <b>{formatMoney(aggregate.spend, '0 lei')}</b>
          <span>
            CPC {aggregate.cpc === null ? '—' : formatMoney(aggregate.cpc, '—', 2)} · CPM{' '}
            {aggregate.cpm === null ? '—' : formatMoney(aggregate.cpm, '—', 2)}
          </span>
        </article>
      </section>

      <section className="activation-filter-panel">
        <div className="activation-filter-main">
          <select
            aria-label="Campanie"
            value={campaign}
            onChange={(event) => setCampaign(event.target.value)}
          >
            <option value="">Toate campaniile</option>
            {campaigns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
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

          {summary?.lastObservedAt ? (
            <span className="muted-copy">
              Ultimul import: {formatDateTime(summary.lastObservedAt)}
            </span>
          ) : null}
        </div>
      </section>

      {loading ? <div className="state-note">Se încarcă rezultatele…</div> : null}
      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <section className="activation-list-card">
          <div className="activation-list-count">
            <strong>{rows.length} materiale</strong>
            <span>Se afișează cel mai recent snapshot pentru fiecare material.</span>
          </div>

          <div className="activation-table-scroll">
            <table className="activation-list-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Activare</th>
                  <th>Canal</th>
                  <th>Impresii</th>
                  <th>Reach</th>
                  <th>Interacțiuni</th>
                  <th>Engagement</th>
                  <th>Clicuri</th>
                  <th>CTR</th>
                  <th>Spend</th>
                  <th>Observat</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.materialTitle}</strong>
                        <small>{row.materialFormat}</small>
                      </td>
                      <td>
                        <Link className="table-link" to={`/activations/${row.activationId}`}>
                          {row.activationTitle}
                        </Link>
                        {row.campaignTitle ? (
                          <div className="activation-campaign-meta">
                            <span>{row.campaignTitle}</span>
                          </div>
                        ) : null}
                      </td>
                      <td>{row.channelCode}</td>
                      <td>{formatNumber(row.impressions)}</td>
                      <td>{formatNumber(row.reach)}</td>
                      <td>{formatNumber(calculateInteractions(row))}</td>
                      <td>{formatPercent(calculateEngagementRate(row))}</td>
                      <td>{formatNumber(row.clicks)}</td>
                      <td>{formatPercent(calculateCTR(row), 2)}</td>
                      <td>{row.spend === null ? '—' : formatMoney(row.spend)}</td>
                      <td>{formatDateTime(row.observedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11}>Nu există rezultate pentru filtrele selectate.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {summary?.byChannel?.length ? (
        <section className="campaign-full-section">
          <header>
            <b>▦</b>
            <h3>Rezultate pe canal</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Canal</th>
                    <th>Materiale</th>
                    <th>Impresii</th>
                    <th>Clicuri</th>
                    <th>CTR</th>
                    <th>Spend</th>
                  </tr>
                  {summary.byChannel.map((row) => (
                    <tr key={row.channelCode}>
                      <td>{row.channelCode}</td>
                      <td>{formatNumber(row.materials)}</td>
                      <td>{formatNumber(row.impressions)}</td>
                      <td>{formatNumber(row.clicks)}</td>
                      <td>{formatPercent(calculateCTR(row), 2)}</td>
                      <td>{formatMoney(row.spend, '0 lei')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
