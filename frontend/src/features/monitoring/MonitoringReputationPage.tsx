/**
 * Monitorizare reputație.
 *
 * Independent of campaigns and activations — it measures the destination, not a
 * piece of work. Deltas against the previous snapshot appear only when one
 * exists; with a single snapshot the comparison is honestly absent rather than
 * shown as zero change.
 */
import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { formatDateTime, formatNumber, formatPercent } from '../../domain/services';

interface ReputationSnapshot {
  externalKey: string;
  scopeLabel: string;
  observedAt: string;
  provider: string;
  mentionsCount: number | null;
  reviewsCount: number | null;
  averageRating: number | null;
  positiveSharePct: number | null;
  neutralSharePct: number | null;
  negativeSharePct: number | null;
  sentimentAnalyzedCount: number | null;
  themes: Array<{
    code: string;
    label: string;
    mentionsCount: number | null;
    sharePct: number | null;
    score: number | null;
  }>;
  sources: Array<{
    code: string;
    label: string;
    mentionsCount: number | null;
    sharePct: number | null;
    reviewsCount: number | null;
    averageRating: number | null;
    positiveSharePct: number | null;
  }>;
  previous: {
    observedAt: string;
    mentionsCount: number | null;
    reviewsCount: number | null;
    averageRating: number | null;
    positiveSharePct: number | null;
  } | null;
}

interface HistoryRow {
  id: string;
  scopeLabel: string;
  observedAt: string;
  provider: string;
  mentionsCount: number | null;
  reviewsCount: number | null;
  averageRating: number | null;
  positiveSharePct: number | null;
}

/** Signed change against the previous snapshot, or null when incomparable. */
function delta(current: number | null, previous: number | null | undefined): string | null {
  if (current === null || previous === null || previous === undefined) return null;
  const difference = current - previous;
  if (difference === 0) return 'fără schimbare';
  const formatted = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(
    Math.abs(difference),
  );
  return `${difference > 0 ? '+' : '−'}${formatted} față de anterior`;
}

/** Ratings use two decimals with a comma, as in the prototype. */
function formatRating(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function MonitoringReputationPage() {
  const [snapshot, setSnapshot] = useState<ReputationSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ReputationSnapshot | null>('/monitoring/reputation/latest'),
      api.get<HistoryRow[]>('/monitoring/reputation/history?pageSize=50'),
    ])
      .then(([latest, rows]) => {
        setSnapshot(latest.data);
        setHistory(rows.data);
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof ApiError ? caught.message : 'Datele reputaționale nu au putut fi încărcate.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="state-note">Se încarcă datele reputaționale…</div>;
  if (error) return <div className="state-note error">{error}</div>;

  if (!snapshot) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Monitorizare reputație</h1>
          </div>
        </header>
        <div className="state-note">
          Nu există încă date reputaționale. Importă un pachet
          <code> OMD_REPUTATION_MONITORING_PACKAGE</code> din Administrare → Importuri.
        </div>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Monitorizare reputație</h1>
          <p>
            {snapshot.scopeLabel} · {snapshot.provider} · observat{' '}
            {formatDateTime(snapshot.observedAt)}
          </p>
        </div>
      </header>

      <section className="activation-stats">
        <article>
          <small>Mențiuni</small>
          <b>{formatNumber(snapshot.mentionsCount)}</b>
          <span>{delta(snapshot.mentionsCount, snapshot.previous?.mentionsCount) ?? 'primul snapshot'}</span>
        </article>
        <article>
          <small>Review-uri</small>
          <b>{formatNumber(snapshot.reviewsCount)}</b>
          <span>{delta(snapshot.reviewsCount, snapshot.previous?.reviewsCount) ?? 'primul snapshot'}</span>
        </article>
        <article>
          <small>Rating mediu</small>
          <b>{formatRating(snapshot.averageRating)}</b>
          <span>{delta(snapshot.averageRating, snapshot.previous?.averageRating) ?? 'din 5 posibile'}</span>
        </article>
        <article>
          <small>Sentiment pozitiv</small>
          <b>{formatPercent(snapshot.positiveSharePct, 0)}</b>
          <span>
            {delta(snapshot.positiveSharePct, snapshot.previous?.positiveSharePct) ??
              'din mențiunile analizate'}
          </span>
        </article>
        <article>
          <small>Neutru</small>
          <b>{formatPercent(snapshot.neutralSharePct, 0)}</b>
          <span>mențiuni neutre</span>
        </article>
        <article>
          <small>Negativ</small>
          <b>{formatPercent(snapshot.negativeSharePct, 0)}</b>
          <span>mențiuni negative</span>
        </article>
      </section>

      <div className="campaign-full-view">
        <section className="campaign-full-section">
          <header>
            <b>1</b>
            <h3>Teme</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Temă</th>
                    <th>Mențiuni</th>
                    <th>Pondere</th>
                    <th>Scor</th>
                  </tr>
                  {snapshot.themes.length ? (
                    snapshot.themes.map((theme) => (
                      <tr key={theme.code}>
                        <td>{theme.label}</td>
                        <td>{formatNumber(theme.mentionsCount)}</td>
                        <td>{formatPercent(theme.sharePct)}</td>
                        <td>{theme.score === null ? '—' : formatNumber(theme.score)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>Nu există teme în acest snapshot.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="campaign-full-section">
          <header>
            <b>2</b>
            <h3>Surse</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Sursă</th>
                    <th>Mențiuni</th>
                    <th>Review-uri</th>
                    <th>Rating</th>
                    <th>Pozitiv</th>
                  </tr>
                  {snapshot.sources.length ? (
                    snapshot.sources.map((source) => (
                      <tr key={source.code}>
                        <td>{source.label}</td>
                        <td>{formatNumber(source.mentionsCount)}</td>
                        <td>{formatNumber(source.reviewsCount)}</td>
                        <td>{formatRating(source.averageRating)}</td>
                        <td>{formatPercent(source.positiveSharePct, 0)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>Nu există surse în acest snapshot.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="campaign-full-section">
          <header>
            <b>3</b>
            <h3>Istoric</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="view-note">
              Fiecare import adaugă un snapshot nou; cele anterioare rămân neatinse, ca să poată fi
              comparate în timp.
            </div>
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Observat</th>
                    <th>Sursă date</th>
                    <th>Mențiuni</th>
                    <th>Review-uri</th>
                    <th>Rating</th>
                    <th>Pozitiv</th>
                  </tr>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.observedAt)}</td>
                      <td>{row.provider}</td>
                      <td>{formatNumber(row.mentionsCount)}</td>
                      <td>{formatNumber(row.reviewsCount)}</td>
                      <td>{formatRating(row.averageRating)}</td>
                      <td>{formatPercent(row.positiveSharePct, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
