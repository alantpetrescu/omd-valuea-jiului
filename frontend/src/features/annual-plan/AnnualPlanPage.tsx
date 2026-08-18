/**
 * Plan anual.
 *
 * The screen makes the two-source model visible, because it is the part people
 * get wrong: a campaign appears either because someone selected it by hand, or
 * because one of its activations falls in the year. The badge on each campaign
 * says which, and only the manual half is editable.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  formatMoney,
  formatPercent,
  formatPeriod,
  getTemporalSituation,
  getTemporalSituationClass,
} from '../../domain/services';
import { useCampaigns, EMPTY_FILTERS } from '../campaigns/useCampaigns';

interface PlanSummary {
  id: string;
  year: number;
  activationCount: number;
  campaignCount: number;
  plannedBudget: number;
  actualSpend: number;
}

interface PlanDetail {
  year: number;
  activations: Array<{
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    statusCode: string;
    status: string;
    plannedBudget: number | null;
    actualSpend: number | null;
    implementationMode: string | null;
    campaignId: string | null;
    campaignTitle: string | null;
    fundingTotal: number;
  }>;
  campaigns: Array<{
    id: string;
    title: string;
    type: string;
    pillar: string;
    status: string;
    manual: number;
  }>;
  manualCampaignExternalKeys: string[];
  totals: { plannedBudget: number; actualSpend: number; fundingTotal: number };
}

export function AnnualPlanPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';

  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { items: allCampaigns } = useCampaigns(EMPTY_FILTERS);

  useEffect(() => {
    api
      .get<PlanSummary[]>('/annual-plans')
      .then((response) => {
        setPlans(response.data);
        const current = new Date().getFullYear();
        const preferred =
          response.data.find((plan) => plan.year === current) ?? response.data[0] ?? null;
        setYear(preferred ? preferred.year : null);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : 'Planurile nu au putut fi încărcate.'),
      )
      .finally(() => setLoading(false));
  }, []);

  const loadDetail = useCallback(async (target: number) => {
    setError(null);
    try {
      const response = await api.get<PlanDetail>(`/annual-plans/${target}`);
      setDetail(response.data);
      setSelection(response.data.manualCampaignExternalKeys);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Planul nu a putut fi încărcat.');
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (year !== null) void loadDetail(year);
  }, [year, loadDetail]);

  async function saveSelection() {
    if (year === null) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/annual-plans/${year}/campaigns`, {
        selectedCampaignExternalKeys: selection,
      });
      setEditing(false);
      await loadDetail(year);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Selecția nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="state-note">Se încarcă planurile anuale…</div>;

  const execution =
    detail && detail.totals.plannedBudget > 0
      ? (detail.totals.actualSpend / detail.totals.plannedBudget) * 100
      : null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Plan anual</h1>
          <p>
            Campaniile și activările planificate pe an. O campanie apare fie prin selecție manuală,
            fie automat, printr-o activare care se desfășoară în acel an.
          </p>
        </div>
      </header>

      <div className="calendar-year-switch">
        {plans.map((plan) => (
          <button
            key={plan.year}
            type="button"
            className={plan.year === year ? 'btn primary' : 'btn secondary'}
            onClick={() => {
              setEditing(false);
              setYear(plan.year);
            }}
          >
            {plan.year}
          </button>
        ))}
      </div>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      {detail ? (
        <>
          <section className="activation-stats">
            <article>
              <small>Campanii efective</small>
              <b>{detail.campaigns.length}</b>
              <span>manual + prin activări</span>
            </article>
            <article>
              <small>Activări în plan</small>
              <b>{detail.activations.length}</b>
              <span>incluse în {detail.year}</span>
            </article>
            <article>
              <small>Buget planificat</small>
              <b>{formatMoney(detail.totals.plannedBudget, '0 lei')}</b>
              <span>total activări</span>
            </article>
            <article>
              <small>Finanțare</small>
              <b>{formatMoney(detail.totals.fundingTotal, '0 lei')}</b>
              <span>surse înregistrate</span>
            </article>
            <article>
              <small>Cheltuială</small>
              <b>{formatMoney(detail.totals.actualSpend, '0 lei')}</b>
              <span>raportată</span>
            </article>
            <article>
              <small>Execuție</small>
              <b>{formatPercent(execution)}</b>
              <span>cheltuit din planificat</span>
            </article>
          </section>

          <section className="campaign-full-section">
            <header>
              <b>1</b>
              <h3>Campanii efective</h3>
            </header>
            <div className="campaign-full-section-body">
              <div className="view-note">
                Campaniile marcate <strong>automat</strong> apar prin activările incluse în plan și
                nu pot fi eliminate din această listă — se schimbă doar prin activarea respectivă.
              </div>

              {!editing ? (
                <>
                  <div className="drawer-table-scroll">
                    <table className="table wide">
                      <tbody>
                        <tr>
                          <th>Campanie</th>
                          <th>Tip</th>
                          <th>Pilon</th>
                          <th>Stadiu</th>
                          <th>Sursă</th>
                        </tr>
                        {detail.campaigns.length ? (
                          detail.campaigns.map((campaign) => (
                            <tr key={campaign.id}>
                              <td>
                                <Link className="table-link" to={`/campaigns/${campaign.id}`}>
                                  {campaign.title}
                                </Link>
                              </td>
                              <td>{campaign.type}</td>
                              <td>{campaign.pillar}</td>
                              <td>{campaign.status}</td>
                              <td>
                                <span className={campaign.manual ? 'badge status' : 'badge'}>
                                  {campaign.manual ? 'manual' : 'automat'}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5}>Nicio campanie în plan.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {canEdit ? (
                    <button className="btn secondary" type="button" onClick={() => setEditing(true)}>
                      Editează selecția manuală
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="form-field">
                    <span className="form-label">
                      Selecție manuală<small>Apasă pentru a include sau exclude o campanie</small>
                    </span>
                    <div className="badges picker">
                      {allCampaigns.map((campaign) => {
                        const selected = selection.includes(campaign.id);
                        return (
                          <button
                            key={campaign.id}
                            type="button"
                            className={selected ? 'badge status' : 'badge'}
                            onClick={() =>
                              setSelection(
                                selected
                                  ? selection.filter((id) => id !== campaign.id)
                                  : [...selection, campaign.id],
                              )
                            }
                          >
                            {campaign.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="wizard-actions">
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => {
                        setSelection(detail.manualCampaignExternalKeys);
                        setEditing(false);
                      }}
                    >
                      Renunță
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => void saveSelection()}
                      disabled={saving}
                    >
                      {saving ? 'Se salvează…' : 'Salvează selecția'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="campaign-full-section">
            <header>
              <b>2</b>
              <h3>Activări incluse</h3>
            </header>
            <div className="campaign-full-section-body">
              <div className="drawer-table-scroll">
                <table className="table wide">
                  <tbody>
                    <tr>
                      <th>Activare</th>
                      <th>Campanie</th>
                      <th>Perioadă</th>
                      <th>Stadiu</th>
                      <th>Situație</th>
                      <th>Buget</th>
                      <th>Finanțare</th>
                      <th>Cheltuit</th>
                    </tr>
                    {detail.activations.length ? (
                      detail.activations.map((activation) => {
                        const situation = getTemporalSituation(activation);
                        return (
                          <tr key={activation.id}>
                            <td>
                              <Link className="table-link" to={`/activations/${activation.id}`}>
                                {activation.title}
                              </Link>
                            </td>
                            <td>
                              {activation.campaignId ? (
                                <Link className="table-link" to={`/campaigns/${activation.campaignId}`}>
                                  {activation.campaignTitle}
                                </Link>
                              ) : (
                                <span className="muted-copy">Independentă</span>
                              )}
                            </td>
                            <td>{formatPeriod(activation)}</td>
                            <td>{activation.status}</td>
                            <td>
                              {situation ? (
                                <span
                                  className={`calendar-situation-pill ${getTemporalSituationClass(situation)}`}
                                >
                                  {situation}
                                </span>
                              ) : (
                                <span className="muted-copy">—</span>
                              )}
                            </td>
                            <td>{formatMoney(activation.plannedBudget)}</td>
                            <td>{formatMoney(activation.fundingTotal, '0 lei')}</td>
                            <td>{formatMoney(activation.actualSpend)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8}>Nicio activare inclusă în acest an.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
