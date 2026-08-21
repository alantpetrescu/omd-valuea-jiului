/**
 * The body of an activation fiche, in the prototype's five tabs.
 *
 * The markup is the prototype's, element for element — `activation-summary-grid`
 * and `detail-grid` rather than tables, `activation-material-view` articles
 * rather than a materials row, `channel-results-table` for the per-post numbers.
 * An earlier version put all of this in `.table` blocks, which rendered without
 * error and looked nothing like the design; the stylesheet is lifted verbatim,
 * so matching its class names is the whole job.
 *
 * Shared by the drawer and the standalone page so both show the same fiche.
 *
 * Budget balance and calendar situation are computed for display and never
 * persisted (spec 27).
 */
import { useEffect, useRef } from 'react';

import {
  calculateEngagementRate,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPeriod,
  getTemporalSituation,
  getTemporalSituationClass,
} from '../../domain/services';
import type { ActivationListItem } from './useActivations';

export interface ActivationMaterial {
  id: string;
  title: string;
  channel: string;
  otherChannel: string;
  format: string;
  budgetAllocated: number | null;
  runStartDate: string | null;
  runEndDate: string | null;
  publicUrl: string;
  copy: string;
  visualName: string;
  visualCanvaUrl: string;
  platformExternalId: string;
  visualUrl: string | null;
}

export interface ActivationDetail extends ActivationListItem {
  objective: string;
  zone: string;
  message: string;
  landingUrl: string;
  implementationPartners: string;
  resultSummary: string;
  whatWorked: string;
  recommendation: string;
  products: unknown[];
  materials: ActivationMaterial[];
  kpis: Array<{
    id: string;
    enabled: number;
    name: string;
    target: string;
    result: string;
    source: string;
    collection: string;
  }>;
  fundingSources: Array<{ type: string; label: string; amount: number }>;
  audiences: Array<{ label: string; code: string | null }>;
}

/** One material's latest measured numbers, from the monitoring endpoint. */
export interface MaterialResult {
  materialId: string;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  spend: number | null;
}

export const ACTIVATION_TABS = [
  ['plan', 'Planificare'],
  ['custom', 'Particularizare'],
  ['materials', 'Materiale și canale'],
  ['results', 'KPI și rezultate'],
  ['conclusions', 'Concluzii'],
] as const;

export type ActivationTab = (typeof ACTIVATION_TABS)[number][0];

/** A product entry may be a plain code or an object carrying a label. */
function productLabel(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    for (const key of ['label', 'name', 'code']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
    }
  }
  return '';
}

function channelLabel(material: ActivationMaterial): string {
  return material.channel || material.otherChannel || 'Canal nespecificat';
}

function runPeriod(material: ActivationMaterial): string {
  if (!material.runStartDate && !material.runEndDate) return 'Perioadă nespecificată';
  return `${formatDate(material.runStartDate)} – ${formatDate(material.runEndDate)}`;
}

/* ------------------------------------------------------------------ Plan */

function PlanTab({ activation }: { activation: ActivationDetail }) {
  const planned = activation.plannedBudget;
  const actual = activation.actualSpend;
  const funding = activation.fundingTotal ?? 0;
  const diff = planned !== null && actual !== null ? planned - actual : null;
  const situation = getTemporalSituation(activation);

  return (
    <>
      <div className="activation-summary-grid">
        <section>
          <small>Perioadă</small>
          <strong>{formatPeriod(activation)}</strong>
        </section>
        <section>
          <small>Stadiu</small>
          <strong>{activation.status}</strong>
          {situation ? (
            <span className={`summary-situation ${getTemporalSituationClass(situation)}`}>
              Situație în calendar: {situation}
            </span>
          ) : null}
        </section>
        <section>
          <small>Buget planificat</small>
          <strong>{formatMoney(planned)}</strong>
        </section>
        <section>
          <small>Cheltuială efectivă</small>
          <strong>{formatMoney(actual)}</strong>
        </section>
      </div>

      <div className="detail-grid">
        <section>
          <h3>Responsabil</h3>
          <p>{activation.responsible || 'De desemnat'}</p>
        </section>
        <section>
          <h3>Mod de implementare</h3>
          <p>{activation.implementationMode ?? 'De stabilit'}</p>
          {activation.implementationPartners ? (
            <small className="muted-copy">{activation.implementationPartners}</small>
          ) : null}
        </section>
        <section>
          <h3>Finanțare identificată</h3>
          <p>{formatMoney(funding, '0 lei')}</p>
          {planned !== null && funding < planned ? (
            <small className="muted-copy">De acoperit: {formatMoney(planned - funding, '0 lei')}</small>
          ) : null}
        </section>
        <section>
          <h3>Diferență buget / cheltuit</h3>
          <p>
            {diff === null
              ? '—'
              : diff >= 0
                ? `${formatMoney(diff, '0 lei')} necheltuiți`
                : `${formatMoney(Math.abs(diff), '0 lei')} depășire`}
          </p>
        </section>
      </div>

      <section className="section">
        <h3>Surse de finanțare</h3>
        {activation.fundingSources.length ? (
          <div className="drawer-table-scroll">
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Tip sursă</th>
                  <th>Denumire / detalii</th>
                  <th>Valoare</th>
                </tr>
                {activation.fundingSources.map((source, index) => (
                  <tr key={index}>
                    <td>{source.type || '—'}</td>
                    <td>{source.label || '—'}</td>
                    <td>{formatMoney(source.amount, '0 lei')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-detail">Nu au fost identificate încă surse de finanțare.</div>
        )}
      </section>

      <div className={`annual-plan-state ${activation.includeAnnualPlan ? 'included' : ''}`}>
        <b>
          {activation.includeAnnualPlan ? '✓ Inclusă în Planul anual' : 'Neinclusă în Planul anual'}
        </b>
        <span>
          {activation.includeAnnualPlan
            ? 'Planul anual citește direct perioada, resursele și rezultatele din această activare.'
            : 'Poate fi inclusă ulterior prin editare.'}
        </span>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- Particularizare */

function CustomTab({ activation }: { activation: ActivationDetail }) {
  const audiences = activation.audiences.map((entry) => entry.label).filter(Boolean);
  const products = activation.products.map(productLabel).filter(Boolean);

  return (
    <>
      {activation.campaignId ? (
        <div className="activation-kpi-source-note">
          <b>Relația cu campania.</b> Regulile și cadrul strategic rămân în „{activation.campaignTitle}”;
          publicurile și produsele au fost selectate din opțiunile campaniei, iar obiectivul concret
          și mesajul sunt particularizări ale acestei activări.
        </div>
      ) : null}

      <div className="detail-grid">
        <section>
          <h3>Obiectiv concret</h3>
          <p>{activation.objective || 'De completat'}</p>
        </section>
        <section>
          <h3>Publicuri</h3>
          <p>{audiences.length ? audiences.join(', ') : 'De completat'}</p>
        </section>
        <section>
          <h3>Produse / experiențe</h3>
          <p>{products.length ? products.join(', ') : 'De completat'}</p>
        </section>
        <section>
          <h3>Zonă / localitate</h3>
          <p>{activation.zone || 'Nespecificată'}</p>
        </section>
        <section>
          <h3>Headline / mesaj</h3>
          <p>{activation.message || 'De completat'}</p>
        </section>
      </div>

      {activation.landingUrl ? (
        <section className="section">
          <h3>Landing page</h3>
          <p>
            <a
              className="text-link"
              href={activation.landingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {activation.landingUrl} ↗
            </a>
          </p>
        </section>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- Materiale */

function MaterialView({
  material,
  focused = false,
}: {
  material: ActivationMaterial;
  /** Arrived here from a Monitorizare row that named this material. */
  focused?: boolean;
}) {
  return (
    <article
      className={`activation-material-view${focused ? ' material-focus' : ''}`}
      data-activation-material-id={material.id}
      aria-current={focused ? 'true' : undefined}
    >
      <header>
        <div>
          <small>
            {channelLabel(material)} · {material.format || 'Format nespecificat'}
          </small>
          <h4>{material.title}</h4>
          <span className="material-run-meta">
            {runPeriod(material)} · Buget alocat: {formatMoney(material.budgetAllocated, '0 lei')}
          </span>
        </div>
      </header>

      <div className="activation-material-view-body">
        {material.visualUrl ? (
          <a
            className="activation-visual-preview"
            href={material.visualUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={material.title}
          >
            <img src={material.visualUrl} alt={material.visualName || material.title} />
          </a>
        ) : (
          <div className="generic-visual compact">
            <strong>Vizual final neîncărcat</strong>
          </div>
        )}

        <div>
          <p>{material.copy || 'Copy necompletat.'}</p>

          <div className="material-links">
            {/* The prototype's Canva button is a <button> that opens the stored
                URL; an anchor does the same thing and keeps middle-click and
                "open in new tab" working. Disabled state when there is no URL,
                because a button that silently does nothing is worse. */}
            {material.visualCanvaUrl ? (
              <a
                className="btn canva-btn"
                href={material.visualCanvaUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="canva-mark">C</span> Canva ↗
              </a>
            ) : (
              <span className="muted-copy">Fără link Canva</span>
            )}

            {material.publicUrl ? (
              <a
                className="btn secondary"
                href={material.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Vezi publicarea ↗
              </a>
            ) : (
              <span className="muted-copy">URL public necompletat</span>
            )}
          </div>

          {material.platformExternalId ? (
            <small className="external-id">ID extern: {material.platformExternalId}</small>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function MaterialsTab({
  activation,
  focusMaterialId = null,
}: {
  activation: ActivationDetail;
  focusMaterialId?: string | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /*
   * Bring the named material into view, as the prototype's
   * `focusViewedMaterial()` does.
   *
   * An activation can carry a dozen materials, so landing on the right tab is
   * only half the answer — you would still be hunting the list for the card the
   * Monitorizare row was about. The marker alone is not enough either when the
   * card sits below the fold.
   *
   * The cards are a fixed 160px-tall visual over text, so nothing reflows after
   * a late image load and the scroll target stays where it was measured.
   *
   * Instant rather than the prototype's `behavior: 'smooth'`. A smooth scroll is
   * animated, so it needs frames to run — measured here landing at 0 instead of
   * 643 when the page was not painting. There is nothing to animate away from
   * either: the drawer has only just slid in, so the reader has no position in
   * this list to be carried from. Arriving already at the card is the point.
   */
  useEffect(() => {
    if (!focusMaterialId) return;
    const target = listRef.current?.querySelector(
      `[data-activation-material-id="${CSS.escape(focusMaterialId)}"]`,
    );
    target?.scrollIntoView({ block: 'center' });
  }, [focusMaterialId, activation.id]);

  return (
    <div className="activation-material-list" ref={listRef}>
      {activation.materials.length ? (
        activation.materials.map((material) => (
          <MaterialView
            key={material.id}
            material={material}
            focused={material.id === focusMaterialId}
          />
        ))
      ) : (
        <div className="empty-detail">Nu există materiale asociate.</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- KPI și rezultate */

function ChannelResultsTable({
  activation,
  results,
}: {
  activation: ActivationDetail;
  results: Map<string, MaterialResult>;
}) {
  const num = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : formatNumber(value);

  return (
    <div className="channel-results-wrap">
      <table className="channel-results-table">
        <thead>
          <tr>
            <th>Postare / material</th>
            <th>Canal</th>
            <th>Perioadă rulare</th>
            <th>Buget alocat</th>
            <th>Impresii</th>
            <th>Reach / utilizatori</th>
            <th>Vizualizări</th>
            <th>Engagement</th>
            <th>Reacții</th>
            <th>Comentarii</th>
            <th>Distribuiri</th>
            <th>Salvări</th>
            <th>Clickuri</th>
            <th>Cheltuială media</th>
          </tr>
        </thead>
        <tbody>
          {activation.materials.length ? (
            activation.materials.map((material, index) => {
              const result = results.get(material.id);
              const reach = result?.reach ?? null;
              /*
                Engagement comes from the shared helper, not from arithmetic
                here. It returns a percentage — `(interactions / reach) * 100` —
                and `formatPercent` expects one. Computing the plain ratio and
                handing it over rendered every row as "0,0%": correct-looking,
                silently wrong, and inconsistent with the Monitorizare screen,
                which has always used this function.
              */
              const engagement = result ? calculateEngagementRate(result) : null;

              return (
                <tr key={material.id}>
                  <td>
                    <div className="channel-result-material">
                      {material.visualUrl ? (
                        <img src={material.visualUrl} alt={material.title} />
                      ) : (
                        <span className="channel-result-placeholder">▧</span>
                      )}
                      <div>
                        <strong>{material.title || `Material ${index + 1}`}</strong>
                        <small>{material.format || 'Format nespecificat'}</small>
                        {material.publicUrl ? (
                          <a
                            className="text-link channel-result-link"
                            href={material.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Vezi postarea ↗
                          </a>
                        ) : (
                          <span className="muted-copy">Fără link public</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge">{channelLabel(material)}</span>
                  </td>
                  <td>{runPeriod(material)}</td>
                  <td className="channel-result-number">
                    {formatMoney(material.budgetAllocated)}
                  </td>
                  <td className="channel-result-number">{num(result?.impressions)}</td>
                  <td className="channel-result-number">{num(reach)}</td>
                  <td className="channel-result-number">{num(result?.views)}</td>
                  <td className="channel-result-number">
                    {engagement === null ? '—' : formatPercent(engagement, 1)}
                  </td>
                  <td className="channel-result-number">{num(result?.reactions)}</td>
                  <td className="channel-result-number">{num(result?.comments)}</td>
                  <td className="channel-result-number">{num(result?.shares)}</td>
                  <td className="channel-result-number">{num(result?.saves)}</td>
                  <td className="channel-result-number">{num(result?.clicks)}</td>
                  <td className="channel-result-number">
                    {result?.spend === null || result?.spend === undefined
                      ? '—'
                      : formatMoney(result.spend)}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={14}>Nu există materiale asociate activării.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTab({
  activation,
  results,
  onRefresh,
  refreshing,
}: {
  activation: ActivationDetail;
  results: Map<string, MaterialResult>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const active = activation.kpis.filter((kpi) => kpi.name.trim());

  return (
    <>
      <div className="results-view-head">
        <div>
          <strong>
            {activation.lastResultsAt
              ? `Actualizat ${formatDateTime(activation.lastResultsAt)}`
              : 'Fără rezultate social actualizate'}
          </strong>
          {/*
            The prototype's button calls `simulateResults()` and invents numbers.
            Here it re-reads the latest snapshot per material from the monitoring
            store, which is where measured results actually come from — same
            button, same place, and it never writes.
          */}
          <small>
            Datele pe postare vin din importul de monitorizare, separat pentru fiecare canal. KPI
            agregați de mai jos sunt introduși manual.
          </small>
        </div>
        <button type="button" className="btn primary" onClick={onRefresh} disabled={refreshing}>
          ↻ {refreshing ? 'Se actualizează…' : 'Actualizează rezultate social'}
        </button>
      </div>

      <section className="section">
        <h3>Rezultate pe postare și canal</h3>
        <ChannelResultsTable activation={activation} results={results} />
      </section>

      <section className="section">
        <h3>KPI agregați ai activării · introducere manuală</h3>
        <div className="matrix-scroll">
          <table className="table wide">
            <tbody>
              <tr>
                <th>Indicator</th>
                <th>Țintă</th>
                <th>Rezultat</th>
                <th>Sursă / observație</th>
              </tr>
              {active.length ? (
                active.map((kpi) => (
                  <tr key={kpi.id}>
                    <td>
                      <strong>{kpi.name}</strong>
                    </td>
                    <td>{kpi.target || '—'}</td>
                    <td>{kpi.result || '—'}</td>
                    <td>{kpi.source || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>Nu au fost introduși KPI agregați.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------- Concluzii */

function ConclusionsTab({ activation }: { activation: ActivationDetail }) {
  return (
    <>
      <section className="section">
        <h3>Rezultatul general</h3>
        <p>{activation.resultSummary || 'Se completează după încheierea activării.'}</p>
      </section>

      <section className="section">
        <h3>Ce a funcționat / ce trebuie ajustat</h3>
        <p>{activation.whatWorked || 'Nu există încă o concluzie.'}</p>
      </section>

      <section className="section">
        <h3>Recomandare</h3>
        <p>
          <span className="recommendation-pill">{activation.recommendation || 'De stabilit'}</span>
        </p>
      </section>
    </>
  );
}

export function ActivationSummary({
  activation,
  tab,
  results,
  onRefreshResults,
  refreshingResults = false,
  focusMaterialId = null,
}: {
  activation: ActivationDetail;
  tab: ActivationTab;
  results: Map<string, MaterialResult>;
  onRefreshResults: () => void;
  refreshingResults?: boolean;
  /** Material to single out on the "Materiale și canale" tab, if any. */
  focusMaterialId?: string | null;
}) {
  if (tab === 'custom') return <CustomTab activation={activation} />;
  if (tab === 'materials') {
    return <MaterialsTab activation={activation} focusMaterialId={focusMaterialId} />;
  }
  if (tab === 'results') {
    return (
      <ResultsTab
        activation={activation}
        results={results}
        onRefresh={onRefreshResults}
        refreshing={refreshingResults}
      />
    );
  }
  if (tab === 'conclusions') return <ConclusionsTab activation={activation} />;
  return <PlanTab activation={activation} />;
}
