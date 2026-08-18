/**
 * Activation detail.
 *
 * Shows the stored fiche plus its children: materials, KPIs, funding sources
 * and audiences. Budget balance and calendar situation are computed here for
 * display — never persisted (spec section 27).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { DeleteButton } from '../../components/DeleteButton';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPeriod,
  getTemporalSituation,
  getTemporalSituationClass,
} from '../../domain/services';
import type { ActivationListItem } from './useActivations';

interface ActivationDetail extends ActivationListItem {
  materials: Array<{
    id: string;
    title: string;
    channel: string;
    format: string;
    budgetAllocated: number | null;
    runStartDate: string | null;
    runEndDate: string | null;
    publicUrl: string;
    copy: string;
    visualName: string;
  }>;
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

export function ActivationDetailPage() {
  const { externalKey = '' } = useParams();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';
  const [activation, setActivation] = useState<ActivationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<ActivationDetail>(`/activations/${encodeURIComponent(externalKey)}`)
      .then((response) => setActivation(response.data))
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : 'Activarea nu a putut fi încărcată.'),
      )
      .finally(() => setLoading(false));
  }, [externalKey]);

  if (loading) return <div className="state-note">Se încarcă activarea…</div>;
  if (error) return <div className="state-note error">{error}</div>;
  if (!activation) return null;

  const situation = getTemporalSituation(activation);
  // Derived: planned budget minus what funding covers.
  const balance = (activation.plannedBudget ?? 0) - (activation.fundingTotal ?? 0);

  return (
    <>
      <header className="page-head">
        <div>
          <Link to="/activations" className="btn secondary">
            ← Înapoi la activări
          </Link>
          <h1>{activation.title}</h1>
          <p>
            {activation.campaignId ? (
              <>
                Campania <Link to={`/campaigns/${activation.campaignId}`}>{activation.campaignTitle}</Link>
              </>
            ) : (
              'Activare independentă'
            )}{' '}
            · {formatPeriod(activation)} · {activation.status}
            {situation ? (
              <>
                {' '}
                ·{' '}
                <span className={`calendar-situation-pill ${getTemporalSituationClass(situation)}`}>
                  {situation}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {canEdit ? (
          <div className="actions">
            <Link className="btn primary" to={`/activations/${activation.id}/edit`}>
              Editează activarea
            </Link>
            <DeleteButton
              resource="activations"
              externalKey={activation.id}
              label={activation.title}
              redirectTo="/activations"
            />
          </div>
        ) : null}
      </header>

      <section className="activation-stats">
        <article>
          <small>Buget planificat</small>
          <b>{formatMoney(activation.plannedBudget)}</b>
          <span>alocat activării</span>
        </article>
        <article>
          <small>Cheltuit</small>
          <b>{formatMoney(activation.actualSpend)}</b>
          <span>raportat până acum</span>
        </article>
        <article>
          <small>Finanțare</small>
          <b>{formatMoney(activation.fundingTotal, '0 lei')}</b>
          <span>{activation.fundingSources.length} surse</span>
        </article>
        <article>
          <small>Sold bugetar</small>
          <b>{formatMoney(balance, '0 lei')}</b>
          <span>planificat − finanțare</span>
        </article>
        <article>
          <small>Materiale</small>
          <b>
            {activation.materialConfiguredCount}/{activation.materialCount}
          </b>
          <span>cu canal + perioadă</span>
        </article>
        <article>
          <small>Rezultate</small>
          <b>{activation.lastResultsAt ? 'Actualizate' : '—'}</b>
          <span>
            {activation.lastResultsAt ? formatDateTime(activation.lastResultsAt) : 'fără import'}
          </span>
        </article>
      </section>

      <div className="campaign-full-view">
        <section className="campaign-full-section">
          <header>
            <b>1</b>
            <h3>Plan</h3>
          </header>
          <div className="campaign-full-section-body">
            <table className="table">
              <tbody>
                <tr>
                  <th>Responsabil</th>
                  <td>{activation.responsible || '—'}</td>
                </tr>
                <tr>
                  <th>Mod de implementare</th>
                  <td>{activation.implementationMode ?? '—'}</td>
                </tr>
                <tr>
                  <th>Publicuri</th>
                  <td>
                    <div className="badges">
                      {activation.audiences.length ? (
                        activation.audiences.map((audience, index) => (
                          <span
                            key={index}
                            className={audience.code ? 'badge' : 'badge season'}
                            title={audience.code ? undefined : 'Public personalizat, fără cod'}
                          >
                            {audience.label}
                          </span>
                        ))
                      ) : (
                        <span className="muted-copy">—</span>
                      )}
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>Plan anual</th>
                  <td>{activation.includeAnnualPlan ? 'Inclusă' : 'Neinclusă'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="campaign-full-section">
          <header>
            <b>2</b>
            <h3>Materiale</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Material</th>
                    <th>Canal</th>
                    <th>Format</th>
                    <th>Perioadă</th>
                    <th>Buget</th>
                    <th>Link public</th>
                  </tr>
                  {activation.materials.length ? (
                    activation.materials.map((material) => (
                      <tr key={material.id}>
                        <td>
                          <strong>{material.title}</strong>
                        </td>
                        <td>{material.channel || '—'}</td>
                        <td>{material.format || '—'}</td>
                        <td>
                          {formatDate(material.runStartDate)} – {formatDate(material.runEndDate)}
                        </td>
                        <td>{formatMoney(material.budgetAllocated)}</td>
                        <td>
                          {material.publicUrl ? (
                            <a href={material.publicUrl} target="_blank" rel="noreferrer">
                              deschide ↗
                            </a>
                          ) : (
                            <span className="muted-copy">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>Nu există materiale.</td>
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
            <h3>Indicatori</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Indicator</th>
                    <th>Țintă</th>
                    <th>Rezultat</th>
                    <th>Sursă</th>
                    <th>Colectare</th>
                  </tr>
                  {activation.kpis.length ? (
                    activation.kpis.map((kpi) => (
                      <tr key={kpi.id}>
                        <td>{kpi.name}</td>
                        <td>{kpi.target || '—'}</td>
                        <td>{kpi.result || '—'}</td>
                        <td>{kpi.source || '—'}</td>
                        <td>{kpi.collection || '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>Nu există indicatori.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="campaign-full-section">
          <header>
            <b>4</b>
            <h3>Finanțare</h3>
          </header>
          <div className="campaign-full-section-body">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Tip</th>
                    <th>Denumire</th>
                    <th>Sumă</th>
                  </tr>
                  {activation.fundingSources.length ? (
                    activation.fundingSources.map((source, index) => (
                      <tr key={index}>
                        <td>{source.type}</td>
                        <td>{source.label || '—'}</td>
                        <td>{formatMoney(source.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>Nu există surse de finanțare înregistrate.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
