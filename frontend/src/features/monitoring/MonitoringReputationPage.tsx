/**
 * Monitorizare reputație — ported from the prototype's `reputationBlock()`.
 *
 * One block with the prototype's shape: the block head, four stat cards, and the
 * reputational dashboard with dominant themes as bars and monitored sources as a
 * list.
 *
 * Independent of campaigns and activations — it measures the destination, not a
 * piece of work. Deltas against the previous snapshot appear only when one
 * exists; with a single snapshot the comparison is honestly absent rather than
 * shown as zero change.
 *
 * The prototype's "Browse fișier / Actualizează" upload panel is not reproduced.
 * There it writes to browser storage; here reputation data arrives through the
 * OMD_REPUTATION_MONITORING_PACKAGE import, and a Browse button that cannot
 * upload anything is worse than none. The block says where the data comes from
 * instead.
 */
import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { formatDateTime, formatNumber, formatPercent } from '../../domain/services';

interface ThemeRow {
  code: string;
  label: string;
  mentionsCount: number | null;
  sharePct: number | null;
  score: number | null;
}

interface SourceRow {
  code: string;
  label: string;
  mentionsCount: number | null;
  sharePct: number | null;
  reviewsCount: number | null;
  averageRating: number | null;
  positiveSharePct: number | null;
}

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
  themes: ThemeRow[];
  sources: SourceRow[];
  previous: {
    observedAt: string;
    mentionsCount: number | null;
    reviewsCount: number | null;
    averageRating: number | null;
    positiveSharePct: number | null;
  } | null;
}

/** Change against the previous snapshot, or null when there is nothing to compare. */
function change(current: number | null, previous: number | null | undefined): string | null {
  if (current === null || previous === null || previous === undefined) return null;
  const diff = current - previous;
  if (diff === 0) return '→ neschimbat';
  const sign = diff > 0 ? '+' : '−';
  return `${diff > 0 ? '↑' : '↓'} ${sign}${formatNumber(Math.abs(diff))}`;
}

/**
 * The value a theme bar is drawn from, and what that value actually is.
 *
 * The contract allows either a share of mentions or a score, and they are not
 * the same claim: 78 as a share means "78% of everything said", 78 as a score
 * means "78 on whatever scale the provider used". The imported data carries only
 * `score`, so printing a percent sign after it — which is what the prototype
 * does, because its fixture is a share — would assert something the data never
 * said. The unit is carried alongside the number instead.
 */
function themeValue(theme: ThemeRow): { value: number | null; unit: '%' | '' } {
  if (theme.sharePct !== null) return { value: theme.sharePct, unit: '%' };
  return { value: theme.score, unit: '' };
}

export function MonitoringReputationPage() {
  const [snapshot, setSnapshot] = useState<ReputationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ReputationSnapshot | null>('/monitoring/reputation/latest')
      .then((response) => {
        setSnapshot(response.data);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiError ? caught.message : 'Datele reputaționale nu au putut fi încărcate.',
        );
        setSnapshot(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const themes = snapshot?.themes ?? [];
  const sources = snapshot?.sources ?? [];
  const themeMax = Math.max(...themes.map((theme) => themeValue(theme).value ?? 0), 1);
  /* Say which measure the bars show, so "78" is not read as a percentage. */
  const themeUnitNote = themes.some((theme) => theme.sharePct !== null)
    ? 'Cotă din mențiuni'
    : 'Scor raportat de sursă';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Monitorizare reputație</h1>
          <p>
            Urmărește mențiunile, review-urile, sentimentul, temele și sursele care descriu reputația
            generală a destinației.
          </p>
        </div>
      </header>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <div className="state-note">Se încarcă datele reputaționale…</div> : null}

      {!loading && !error ? (
        <div className="monitoring-stack">
          <section className="monitoring-block">
            <header className="monitoring-block-head">
              <div>
                <small>Reputație</small>
                <h2>Reputația destinației</h2>
                <p>
                  Rezultatele de monitorizare reputațională sunt încărcate separat, printr-un pachet
                  propriu, și alimentează dashboardul de mențiuni, review-uri, sentiment, teme și
                  surse. Nu se amestecă cu rezultatele activărilor.
                </p>
              </div>
              <span className="badge">Import periodic</span>
            </header>

            {!snapshot ? (
              <div className="performance-empty-banner">
                Nu există încă date reputaționale importate.
              </div>
            ) : (
              <>
                <section className="stats">
                  <div className="stat">
                    <small>Mențiuni analizate</small>
                    <b>{formatNumber(snapshot.mentionsCount)}</b>
                    <span>
                      {change(snapshot.mentionsCount, snapshot.previous?.mentionsCount)
                        ?? 'Presa, social media și web'}
                    </span>
                  </div>
                  <div className="stat">
                    <small>Sentiment pozitiv</small>
                    <b>{formatPercent(snapshot.positiveSharePct, 0)}</b>
                    <span>
                      {snapshot.sentimentAnalyzedCount !== null
                        ? `Din ${formatNumber(snapshot.sentimentAnalyzedCount)} analizate`
                        : 'Clasificare orientativă'}
                    </span>
                  </div>
                  <div className="stat">
                    <small>Recenzii noi</small>
                    <b>{formatNumber(snapshot.reviewsCount)}</b>
                    <span>
                      {change(snapshot.reviewsCount, snapshot.previous?.reviewsCount)
                        ?? 'În perioada analizată'}
                    </span>
                  </div>
                  <div className="stat">
                    <small>Scor mediu review-uri</small>
                    <b>
                      {snapshot.averageRating === null
                        ? '—'
                        : snapshot.averageRating.toLocaleString('ro-RO', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </b>
                    <span>Surse agregate</span>
                  </div>
                </section>

                <section className="reputation-dashboard">
                  <header>
                    <div>
                      <h3>Dashboard reputațional</h3>
                      <span>
                        {snapshot.scopeLabel} · sursa: {snapshot.provider}
                      </span>
                    </div>
                    <span>
                      {snapshot.observedAt
                        ? `Observat ${formatDateTime(snapshot.observedAt)}`
                        : 'Fără dată de observare'}
                    </span>
                  </header>

                  <div className="reputation-panels">
                    <section>
                      <h3>Teme dominante</h3>
                      {themes.length === 0 ? (
                        <p className="muted-copy">Nu au fost importate teme.</p>
                      ) : (
                        <>
                          <p className="muted-copy">{themeUnitNote}</p>
                          <div className="reputation-bars">
                            {themes.map((theme) => {
                              const { value, unit } = themeValue(theme);
                              return (
                                <div className="reputation-bar" key={theme.code}>
                                  <div>
                                    <span>{theme.label}</span>
                                    <b>{value === null ? '—' : `${formatNumber(value)}${unit}`}</b>
                                  </div>
                                  <div className="reputation-bar-track">
                                    <span style={{ width: `${((value ?? 0) / themeMax) * 100}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </section>

                    <section>
                      <h3>Surse monitorizate</h3>
                      {sources.length === 0 ? (
                        <p className="muted-copy">Nu au fost importate surse.</p>
                      ) : (
                        <div className="reputation-source-list">
                          {sources.map((source) => (
                            <div key={source.code}>
                              <span>{source.label}</span>
                              <b>
                                {source.sharePct === null
                                  ? formatNumber(source.mentionsCount)
                                  : `${formatNumber(source.sharePct)}%`}
                              </b>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </section>

                {snapshot.previous ? (
                  <div className="module-foot">
                    Comparația este față de observația precedentă, din{' '}
                    {formatDateTime(snapshot.previous.observedAt)}.
                  </div>
                ) : (
                  <div className="module-foot">
                    Există o singură observație importată, deci nu se poate calcula o comparație.
                    Următorul import va face posibilă evoluția.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
