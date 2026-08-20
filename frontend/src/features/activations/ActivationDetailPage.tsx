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
  ACTIVATION_TABS,
  ActivationSummary,
  type ActivationDetail,
  type ActivationTab,
} from './ActivationSummary';
import { useMaterialResults } from './useMaterialResults';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPeriod,
  getTemporalSituation,
  getTemporalSituationClass,
} from '../../domain/services';
import type { ActivationListItem } from './useActivations';

export function ActivationDetailPage() {
  const { externalKey = '' } = useParams();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';
  const [activation, setActivation] = useState<ActivationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ActivationTab>('plan');
  const { results, refreshing, refresh } = useMaterialResults(externalKey);

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

      {/* The same tabs the drawer uses, so the fiche reads identically whether
          it was opened over the list or on its own URL. */}
      <nav className="tabs">
        {ACTIVATION_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={id === tab ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="drawer-content">
        <ActivationSummary
          activation={activation}
          tab={tab}
          results={results}
          onRefreshResults={refresh}
          refreshingResults={refreshing}
        />
      </div>
    </>
  );
}
