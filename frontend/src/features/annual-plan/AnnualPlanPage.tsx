/**
 * Plan anual — ported from the prototype's `annual.js`.
 *
 * Two views over the same plan, as the prototype frames them: **Plan
 * operațional**, a hierarchy of campaigns with their activations and the money
 * beside each, and **Calendar**, where a campaign's strategic window and its
 * activations' real dates sit on the same twelve months.
 *
 * Nothing here is a second copy of the data. A campaign appears in the plan for
 * one of two reasons and the distinction matters: someone selected it by hand,
 * or one of its activations is ticked into the plan and drags it in. The second
 * kind cannot be unselected, which is why the selection dialog disables it and
 * says why.
 *
 * Class names are the prototype's, so the lifted stylesheet applies unchanged.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import {
  formatMoney,
  formatPeriod,
  getTemporalSituation,
  seasonalityBands,
  seasonalityPeriodLabel,
} from '../../domain/services';
import { useAuth } from '../auth/AuthContext';
import { useCampaigns, EMPTY_FILTERS } from '../campaigns/useCampaigns';
import { ActivationDrawer } from '../activations/ActivationDrawer';
import { CampaignDrawer } from '../campaigns/CampaignDrawer';

const MONTHS = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];

/* The prototype's row-action glyphs, reused here so the plan and the Activări
   table speak the same visual language. `.activation-icon-btn` styles them. */
const ICON_EYE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

const ICON_PENCIL = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14 8 3 3" />
  </svg>
);

const ICON_BARS = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 19V9" />
    <path d="M10 19V5" />
    <path d="M16 19v-7" />
    <path d="M22 19V3" />
  </svg>
);

interface PlanSummary {
  id: string;
  year: number;
  activationCount: number;
  campaignCount: number;
  plannedBudget: number;
  actualSpend: number;
}

interface PlanActivation {
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
  /** Distinct funding source labels behind `fundingTotal`, for the filter. */
  fundingTypes: string[];
}

interface PlanCampaign {
  id: string;
  title: string;
  type: string;
  pillar: string;
  status: string;
  /** 1 when a person put it in the plan, 0 when an activation pulled it in. */
  manual: number;
}

interface PlanDetail {
  year: number;
  activations: PlanActivation[];
  campaigns: PlanCampaign[];
  manualCampaignExternalKeys: string[];
  totals: { plannedBudget: number; actualSpend: number; fundingTotal: number };
}

type View = 'operational' | 'calendar';

function statusClass(code: string): string {
  if (code === 'ACTIVE') return 'active';
  if (code === 'CLOSED') return 'done';
  return '';
}

/** "ian.–feb. 2026" — the prototype's operational period, coarser than the exact one. */
function operationalPeriod(item: PlanActivation): string {
  const short = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'];
  const parse = (value: string | null) => {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : { month: date.getMonth(), year: date.getFullYear() };
  };

  const start = parse(item.startDate);
  const end = parse(item.endDate);

  if (start && end) {
    if (start.year === end.year && start.month === end.month) return `${short[start.month]} ${start.year}`;
    if (start.year === end.year) return `${short[start.month]}–${short[end.month]} ${start.year}`;
    return `${short[start.month]} ${start.year} – ${short[end.month]} ${end.year}`;
  }
  const only = start ?? end;
  return only ? `${short[only.month]} ${only.year}` : '—';
}

/** `+1.200 lei` / `−800 lei`, so the sign reads without relying on the colour. */
function signedMoney(value: number): string {
  const text = formatMoney(Math.abs(value), '0 lei');
  return value === 0 ? text : `${value > 0 ? '+' : '−'}${text}`;
}

function balanceClass(value: number): string {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

/** The months of `year` an activation covers, or null when it misses the year. */
function activationBand(item: PlanActivation, year: number): [number, number] | null {
  if (!item.startDate || !item.endDate) return null;
  const start = new Date(`${item.startDate}T00:00:00`);
  const end = new Date(`${item.endDate}T00:00:00`);
  if (start.getFullYear() > year || end.getFullYear() < year) return null;
  return [
    start.getFullYear() < year ? 0 : start.getMonth(),
    end.getFullYear() > year ? 11 : end.getMonth(),
  ];
}

export function AnnualPlanPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';

  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>('operational');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [campaignFilter, setCampaignFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [situationFilter, setSituationFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [fundingFilter, setFundingFilter] = useState('');

  const [calCampaign, setCalCampaign] = useState('');
  const [showWindows, setShowWindows] = useState(true);
  const [showActivations, setShowActivations] = useState(true);
  const [calStatus, setCalStatus] = useState('');
  const [calSituation, setCalSituation] = useState('');

  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [openActivation, setOpenActivation] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { items: allCampaigns } = useCampaigns(EMPTY_FILTERS);

  useEffect(() => {
    api
      .get<PlanSummary[]>('/annual-plans')
      .then((response) => {
        setPlans(response.data);
        setYear((current) => current ?? response.data[0]?.year ?? new Date().getFullYear());
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : 'Planurile nu au putut fi încărcate.'),
      );
  }, []);

  const loadDetail = useCallback(() => {
    if (year === null) return;
    setLoading(true);
    api
      .get<PlanDetail>(`/annual-plans/${year}`)
      .then((response) => {
        setDetail(response.data);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Planul nu a putut fi încărcat.');
        setDetail(null);
      })
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // The toast clears itself, as on the Strategy page.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const activations = useMemo(() => detail?.activations ?? [], [detail]);
  const campaigns = useMemo(() => detail?.campaigns ?? [], [detail]);

  /* Six figures over the whole plan, not the filtered slice — the summary
     answers "what did we commit to this year", which a filter must not change. */
  const summary = useMemo(() => {
    const planned = activations.reduce((sum, item) => sum + (item.plannedBudget ?? 0), 0);
    const funding = activations.reduce((sum, item) => sum + (item.fundingTotal ?? 0), 0);
    const reported = activations.filter((item) => item.actualSpend !== null);
    const actual = reported.reduce((sum, item) => sum + (item.actualSpend ?? 0), 0);
    return {
      planned,
      funding,
      actual,
      hasActual: reported.length > 0,
      execution: planned > 0 && reported.length ? (actual / planned) * 100 : null,
    };
  }, [activations]);

  const matchesOperational = useCallback(
    (item: PlanActivation) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (modeFilter && item.implementationMode !== modeFilter) return false;
      if (situationFilter && getTemporalSituation(item) !== situationFilter) return false;
      if (fundingFilter && !(item.fundingTypes ?? []).includes(fundingFilter)) return false;
      return true;
    },
    [statusFilter, modeFilter, situationFilter, fundingFilter],
  );

  const filtersActive = Boolean(statusFilter || modeFilter || situationFilter || fundingFilter);

  const implementationModes = useMemo(
    () => [...new Set(activations.map((item) => item.implementationMode).filter(Boolean))] as string[],
    [activations],
  );

  const statuses = useMemo(
    () => [...new Set(activations.map((item) => item.status).filter(Boolean))],
    [activations],
  );

  const fundingTypes = useMemo(
    () => [...new Set(activations.flatMap((item) => item.fundingTypes ?? []))].sort(),
    [activations],
  );

  /** Campaigns an activation dragged in — these cannot be unselected. */
  const automatic = useMemo(
    () => new Set(activations.map((item) => item.campaignId).filter(Boolean) as string[]),
    [activations],
  );

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveSelection = async () => {
    if (year === null) return;
    setSaving(true);
    try {
      await api.put(`/annual-plans/${year}/campaigns`, { campaignExternalKeys: selection });
      setSelecting(false);
      loadDetail();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Selecția nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  };

  const visibleCampaigns = campaigns.filter((item) => !campaignFilter || item.id === campaignFilter);

  const groups = visibleCampaigns
    .map((campaign) => ({
      campaign,
      items: activations
        .filter((item) => item.campaignId === campaign.id && matchesOperational(item))
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))),
    }))
    .filter((group) => !filtersActive || group.items.length > 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Plan anual</h1>
          <p>
            Două perspective asupra aceluiași plan: execuția managerială în Plan operațional și
            relația dintre ferestrele strategice și perioadele reale în Calendar.
          </p>
        </div>
      </header>

      <section className="annual-toolbar">
        <div className="annual-toolbar-left">
          <select
            aria-label="Anul planului"
            value={year ?? ''}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {plans.map((plan) => (
              <option key={plan.year} value={plan.year}>
                Anul {plan.year}
              </option>
            ))}
          </select>
        </div>
        {canEdit ? (
          <div className="annual-toolbar-right">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setSelection(detail?.manualCampaignExternalKeys ?? []);
                setSelecting(true);
              }}
            >
              ＋ Selectează campanii pentru {year}
            </button>
          </div>
        ) : null}
        {/* The prototype's second toolbar button. Same toast pattern the
            Strategy page already uses, with the prototype's own wording. */}
        <div className="annual-toolbar-right">
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              setToast(
                'Planul operațional urmărește execuția managerială. Calendarul suprapune ferestrele '
                  + 'strategice ale campaniilor peste perioadele reale ale activărilor.',
              )
            }
          >
            ⓘ Cum se construiește
          </button>
        </div>
      </section>

      <nav className="annual-tabs" aria-label="Vederile Planului anual">
        <button
          type="button"
          className={view === 'operational' ? 'active' : ''}
          onClick={() => setView('operational')}
        >
          Plan operațional
        </button>
        <button
          type="button"
          className={view === 'calendar' ? 'active' : ''}
          onClick={() => setView('calendar')}
        >
          Calendar
        </button>
      </nav>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? <div className="state-note">Se încarcă planul…</div> : null}

      {!loading && detail ? (
        <>
          {view === 'operational' ? (
            <>
              <section className="annual-summary">
                <article>
                  <small>Campanii selectate</small>
                  <b>{campaigns.length}</b>
                  <span>Direcții asumate pentru {year}</span>
                </article>
                <article>
                  <small>Activări în plan</small>
                  <b>{activations.length}</b>
                  <span>Incluse și cu perioadă în {year}</span>
                </article>
                <article>
                  <small>Buget planificat</small>
                  <b>{formatMoney(summary.planned, '0 lei')}</b>
                  <span>Suma activărilor</span>
                </article>
                <article>
                  <small>Finanțare identificată</small>
                  <b>{formatMoney(summary.funding, '0 lei')}</b>
                  <span>Surse declarate în activări</span>
                </article>
                <article>
                  <small>Cheltuială efectivă</small>
                  <b>{summary.hasActual ? formatMoney(summary.actual) : '—'}</b>
                  <span>Completată în activări</span>
                </article>
                <article>
                  <small>Execuție bugetară</small>
                  <b>
                    {summary.execution === null
                      ? '—'
                      : `${summary.execution.toLocaleString('ro-RO', { maximumFractionDigits: 1 })}%`}
                  </b>
                  <span>Cheltuit / planificat</span>
                </article>
              </section>

              <section className="annual-filters">
                <select
                  aria-label="Campanie"
                  value={campaignFilter}
                  onChange={(event) => setCampaignFilter(event.target.value)}
                >
                  <option value="">Toate campaniile</option>
                  {campaigns.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Stadiu"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">Toate stadiile</option>
                  {statuses.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  aria-label="Situație în calendar"
                  value={situationFilter}
                  onChange={(event) => setSituationFilter(event.target.value)}
                >
                  <option value="">Toate situațiile calendar</option>
                  {['Urmează', 'În desfășurare', 'Perioadă trecută'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  aria-label="Mod de implementare"
                  value={modeFilter}
                  onChange={(event) => setModeFilter(event.target.value)}
                >
                  <option value="">Toate modurile de implementare</option>
                  {implementationModes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  aria-label="Sursă de finanțare"
                  value={fundingFilter}
                  onChange={(event) => setFundingFilter(event.target.value)}
                >
                  <option value="">Toate sursele de finanțare</option>
                  {fundingTypes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setCampaignFilter('');
                    setStatusFilter('');
                    setSituationFilter('');
                    setModeFilter('');
                    setFundingFilter('');
                  }}
                >
                  Resetează filtrele
                </button>
              </section>

              <main className="annual-operational">
                <div className="annual-operational-controls">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setExpanded(new Set(campaigns.map((item) => item.id)))}
                  >
                    Extinde toate
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setExpanded(new Set())}>
                    Restrânge toate
                  </button>
                </div>

                <section className="annual-operation-shell">
                  <div className="annual-operation-scroll">
                    <table className="annual-operation-table annual-hierarchy-table">
                      <thead>
                        <tr>
                          <th>Campanie / activare</th>
                          <th>Perioadă</th>
                          <th>Stadiu</th>
                          <th>Implementare</th>
                          <th>Buget planificat</th>
                          <th>Finanțare</th>
                          <th>Cheltuit</th>
                          <th>Sold bugetar</th>
                          <th>Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.length === 0 ? (
                          <tr>
                            <td colSpan={9}>
                              <div className="annual-op-empty">
                                {visibleCampaigns.length
                                  ? 'Nicio campanie nu are activări care corespund filtrelor curente.'
                                  : 'Nu există campanii selectate pentru anul curent.'}
                              </div>
                            </td>
                          </tr>
                        ) : (
                          groups.flatMap(({ campaign, items }) => {
                            const planned = items.reduce((sum, i) => sum + (i.plannedBudget ?? 0), 0);
                            const funding = items.reduce((sum, i) => sum + (i.fundingTotal ?? 0), 0);
                            const reported = items.filter((i) => i.actualSpend !== null);
                            const actual = reported.length
                              ? reported.reduce((sum, i) => sum + (i.actualSpend ?? 0), 0)
                              : null;
                            const isOpen = expanded.has(campaign.id);

                            const rows = [
                              <tr className="annual-plan-campaign-row" key={campaign.id}>
                                <td className="annual-hierarchy-cell">
                                  <div className="annual-hierarchy-wrap">
                                    {items.length ? (
                                      <button
                                        type="button"
                                        className="annual-campaign-toggle"
                                        aria-label={`${isOpen ? 'Restrânge' : 'Extinde'} activările campaniei`}
                                        onClick={() => toggle(campaign.id)}
                                      >
                                        {isOpen ? '▾' : '▸'}
                                      </button>
                                    ) : (
                                      <span className="annual-campaign-toggle empty" aria-hidden="true">
                                        •
                                      </span>
                                    )}
                                    <div className="annual-hierarchy-text">
                                      <button
                                        type="button"
                                        className="annual-campaign-title"
                                        title={`${campaign.type} · ${campaign.pillar}`}
                                        onClick={() => setOpenCampaign(campaign.id)}
                                      >
                                        {campaign.title}
                                      </button>
                                    </div>
                                  </div>
                                </td>
                                <td>—</td>
                                <td>
                                  <span className="activation-status">{campaign.status || '—'}</span>
                                </td>
                                <td>
                                  <span className="muted-copy">—</span>
                                </td>
                                <td className="annual-num annual-campaign-total">
                                  {formatMoney(planned, '0 lei')}
                                </td>
                                <td className="annual-num">
                                  {funding > 0 ? (
                                    formatMoney(funding, '0 lei')
                                  ) : (
                                    <span className="muted-copy">—</span>
                                  )}
                                </td>
                                <td className="annual-num annual-campaign-total">
                                  {actual === null ? '—' : formatMoney(actual, '0 lei')}
                                </td>
                                <td className="annual-num">
                                  {actual === null ? (
                                    <span className="muted-copy">—</span>
                                  ) : (
                                    <span
                                      className={`annual-balance-value ${balanceClass(planned - actual)}`}
                                    >
                                      {signedMoney(planned - actual)}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <div className="annual-actions">
                                    <button
                                      type="button"
                                      className="activation-icon-btn"
                                      data-tooltip="Vezi campania"
                                      title="Vezi campania"
                                      aria-label={`Vezi campania ${campaign.title}`}
                                      onClick={() => setOpenCampaign(campaign.id)}
                                    >
                                      {ICON_EYE}
                                    </button>
                                    {/* The prototype offers this only on an active
                                        campaign: a closed one should not be
                                        gaining new activations. */}
                                    {canEdit && campaign.status === 'Activă' ? (
                                      <button
                                        type="button"
                                        className="activation-icon-btn annual-add-action"
                                        data-tooltip="Creează activare"
                                        title="Creează activare din această campanie"
                                        aria-label={`Creează activare din campania ${campaign.title}`}
                                        onClick={() =>
                                          navigate(
                                            `/activations/new?campaign=${encodeURIComponent(campaign.id)}`,
                                            { state: { from: '/annual' } },
                                          )
                                        }
                                      >
                                        ＋
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>,
                            ];

                            if (!isOpen) return rows;

                            for (const item of items) {
                              const situation = getTemporalSituation(item);
                              const balance =
                                item.plannedBudget !== null && item.actualSpend !== null
                                  ? item.plannedBudget - item.actualSpend
                                  : null;

                              rows.push(
                                <tr className="annual-plan-activation-row" key={item.id}>
                                  <td className="annual-hierarchy-cell annual-activation-indent">
                                    <div className="annual-hierarchy-wrap">
                                      <div className="annual-hierarchy-text">
                                        <button
                                          type="button"
                                          className="annual-activation-title"
                                          onClick={() => setOpenActivation(item.id)}
                                        >
                                          {item.title}
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                  <td title={`Perioadă exactă: ${formatPeriod(item)}`}>
                                    {operationalPeriod(item)}
                                  </td>
                                  <td>
                                    <div className="annual-status-compact">
                                      <span className={`activation-status ${statusClass(item.statusCode)}`}>
                                        {item.status || '—'}
                                      </span>
                                      {item.statusCode === 'ACTIVE' && situation ? (
                                        <small>{situation}</small>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td>
                                    {item.implementationMode ? (
                                      <span className="annual-implementation">
                                        {item.implementationMode}
                                      </span>
                                    ) : (
                                      <span className="muted-copy">—</span>
                                    )}
                                  </td>
                                  <td className="annual-num">{formatMoney(item.plannedBudget)}</td>
                                  <td className="annual-num">
                                    {item.fundingTotal > 0 ? (
                                      formatMoney(item.fundingTotal, '0 lei')
                                    ) : (
                                      <span className="muted-copy">—</span>
                                    )}
                                  </td>
                                  <td className="annual-num">{formatMoney(item.actualSpend)}</td>
                                  <td className="annual-num">
                                    {balance === null ? (
                                      <span className="muted-copy">—</span>
                                    ) : (
                                      <span className={`annual-balance-value ${balanceClass(balance)}`}>
                                        {signedMoney(balance)}
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <div className="annual-actions">
                                      <button
                                        type="button"
                                        className="activation-icon-btn"
                                        data-tooltip="Vezi activarea"
                                        title="Vezi activarea"
                                        aria-label={`Vezi activarea ${item.title}`}
                                        onClick={() => setOpenActivation(item.id)}
                                      >
                                        {ICON_EYE}
                                      </button>
                                      {canEdit ? (
                                        <button
                                          type="button"
                                          className="activation-icon-btn"
                                          data-tooltip="Editează activarea"
                                          title="Editează activarea"
                                          aria-label={`Editează activarea ${item.title}`}
                                          onClick={() =>
                                            navigate(`/activations/${item.id}/edit`, {
                                              state: { from: '/annual' },
                                            })
                                          }
                                        >
                                          {ICON_PENCIL}
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="activation-icon-btn results"
                                        data-tooltip="KPI și rezultate"
                                        title="Deschide KPI și rezultate"
                                        aria-label={`Deschide KPI și rezultate pentru ${item.title}`}
                                        onClick={() =>
                                          navigate(
                                            `/monitoring-activations?activation=${encodeURIComponent(item.id)}`,
                                          )
                                        }
                                      >
                                        {ICON_BARS}
                                      </button>
                                    </div>
                                  </td>
                                </tr>,
                              );
                            }

                            return rows;
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </main>

              <details className="annual-budget-section">
                <summary>
                  Situație bugetară a Planului <span>{year}</span>
                </summary>
                <div className="annual-operation-scroll">
                  <table className="annual-budget-table">
                    <thead>
                      <tr>
                        <th>Campanie</th>
                        <th>Activări</th>
                        <th>Buget planificat</th>
                        <th>Finanțare identificată</th>
                        <th>Cheltuit</th>
                        <th>Sold bugetar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.length ? (
                        campaigns.map((campaign) => {
                          const items = activations.filter((item) => item.campaignId === campaign.id);
                          const planned = items.reduce((sum, i) => sum + (i.plannedBudget ?? 0), 0);
                          const funding = items.reduce((sum, i) => sum + (i.fundingTotal ?? 0), 0);
                          const reported = items.filter((i) => i.actualSpend !== null);
                          const actual =
                            items.length === 0
                              ? 0
                              : reported.length
                                ? reported.reduce((sum, i) => sum + (i.actualSpend ?? 0), 0)
                                : null;

                          return (
                            <tr key={campaign.id}>
                              <td>{campaign.title}</td>
                              <td>{items.length}</td>
                              <td>{formatMoney(planned, '0 lei')}</td>
                              <td>{funding > 0 ? formatMoney(funding, '0 lei') : '—'}</td>
                              <td>{actual === null ? '—' : formatMoney(actual, '0 lei')}</td>
                              <td>
                                {actual === null ? (
                                  '—'
                                ) : (
                                  <span
                                    className={`annual-balance-value ${balanceClass(planned - actual)}`}
                                  >
                                    {signedMoney(planned - actual)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6}>Nu există date bugetare pentru anul selectat.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>TOTAL {year}</td>
                        <td>{activations.length}</td>
                        <td>{formatMoney(summary.planned, '0 lei')}</td>
                        <td>{summary.funding > 0 ? formatMoney(summary.funding, '0 lei') : '—'}</td>
                        <td>{summary.hasActual ? formatMoney(summary.actual, '0 lei') : '—'}</td>
                        <td>
                          {summary.hasActual ? (
                            <span
                              className={`annual-balance-value ${balanceClass(summary.planned - summary.actual)}`}
                            >
                              {signedMoney(summary.planned - summary.actual)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <>
              <section className="annual-calendar-filters">
                <select
                  aria-label="Campanie"
                  value={calCampaign}
                  onChange={(event) => setCalCampaign(event.target.value)}
                >
                  <option value="">Toate campaniile</option>
                  {campaigns.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <span className="calendar-filter-label">Afișează</span>
                <label className="quick-filter">
                  <input
                    type="checkbox"
                    checked={showWindows}
                    onChange={(event) => setShowWindows(event.target.checked)}
                  />
                  <span>Ferestre strategice ale campaniilor</span>
                </label>
                <label className="quick-filter">
                  <input
                    type="checkbox"
                    checked={showActivations}
                    onChange={(event) => setShowActivations(event.target.checked)}
                  />
                  <span>Activări</span>
                </label>
                <select
                  aria-label="Stadiu activări"
                  value={calStatus}
                  onChange={(event) => setCalStatus(event.target.value)}
                >
                  <option value="">Toate stadiile activărilor</option>
                  {statuses.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <select
                  aria-label="Situație în calendar"
                  value={calSituation}
                  onChange={(event) => setCalSituation(event.target.value)}
                >
                  <option value="">Toate situațiile în calendar</option>
                  {['Urmează', 'În desfășurare', 'Perioadă trecută'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setCalCampaign('');
                    setShowWindows(true);
                    setShowActivations(true);
                    setCalStatus('');
                    setCalSituation('');
                  }}
                >
                  Resetează filtrele
                </button>
              </section>

              <div className="plan-scroll annual-calendar-compact">
                <div className="plan-table">
                  <div className="plan-row head">
                    <div>Campanie / activare</div>
                    <div className="plan-months">
                      {MONTHS.map((month) => (
                        <span key={month}>{month}</span>
                      ))}
                    </div>
                  </div>

                  {!showWindows && !showActivations ? (
                    <div className="calendar-empty-state">
                      Nicio categorie afișată. Bifează „Ferestre strategice ale campaniilor” și/sau
                      „Activări”.
                    </div>
                  ) : (
                    campaigns
                      .filter((item) => !calCampaign || item.id === calCampaign)
                      .flatMap((campaign) => {
                        /* The strategic window comes from the campaign's own
                           seasonality months, which the plan payload does not
                           carry — the campaign list does. */
                        const source = allCampaigns.find((item) => item.id === campaign.id);
                        const windowLabel = seasonalityPeriodLabel(source?.seasonalityMonths);
                        const bands = showWindows ? seasonalityBands(source?.seasonalityMonths) : [];

                        const all = activations.filter((item) => item.campaignId === campaign.id);
                        const child = showActivations
                          ? all
                              .filter((item) => {
                                if (calStatus && item.status !== calStatus) return false;
                                if (calSituation && getTemporalSituation(item) !== calSituation) {
                                  return false;
                                }
                                return true;
                              })
                              .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
                          : [];

                        const rows = [
                          <div className="plan-row calendar-campaign-row" key={campaign.id}>
                            <div>
                              <div className="annual-calendar-name-wrap">
                                <button
                                  type="button"
                                  className="annual-calendar-name"
                                  title={`${campaign.type} · Fereastră strategică: ${windowLabel}`}
                                  onClick={() => setOpenCampaign(campaign.id)}
                                >
                                  {campaign.title}
                                </button>
                              </div>
                            </div>
                            <div className="plan-months">
                              {bands.map((band, index) => (
                                <button
                                  key={index}
                                  type="button"
                                  className="plan-band calendar-strategic-window"
                                  style={{ gridColumn: `${band.from + 1}/${band.to + 2}` }}
                                  onClick={() => setOpenCampaign(campaign.id)}
                                  aria-label={`${campaign.title}, fereastră strategică: ${windowLabel}`}
                                />
                              ))}
                            </div>
                          </div>,
                        ];

                        for (const item of child) {
                          const band = year === null ? null : activationBand(item, year);
                          if (!band) continue;
                          rows.push(
                            <div className="plan-row calendar-activation-row" key={item.id}>
                              <div>
                                <button
                                  type="button"
                                  className="annual-calendar-name"
                                  title={`${item.status} · ${formatPeriod(item)}`}
                                  onClick={() => setOpenActivation(item.id)}
                                >
                                  {item.title}
                                </button>
                              </div>
                              <div className="plan-months">
                                <button
                                  type="button"
                                  className={`plan-band calendar-activation-bar ${statusClass(item.statusCode) || 'draft'}`}
                                  style={{ gridColumn: `${band[0] + 1}/${band[1] + 2}` }}
                                  onClick={() => setOpenActivation(item.id)}
                                  aria-label={`${item.title}, stadiu ${item.status}, ${formatPeriod(item)}`}
                                />
                              </div>
                            </div>,
                          );
                        }

                        if (showActivations && all.length && !child.length && (calStatus || calSituation)) {
                          rows.push(
                            <div className="plan-row calendar-filtered-empty" key={`${campaign.id}-empty`}>
                              <div>Nicio activare nu corespunde filtrelor curente.</div>
                              <div className="plan-months" />
                            </div>,
                          );
                        }

                        return rows;
                      })
                  )}
                </div>
              </div>

              <div className="plan-legend">
                <div>
                  <span>
                    <i className="calendar-legend-swatch strategic" />
                    Fereastră strategică
                  </span>
                  <span>
                    <i className="calendar-legend-swatch draft" />
                    Activare Draft
                  </span>
                  <span>
                    <i className="calendar-legend-swatch active" />
                    Activare Activă
                  </span>
                  <span>
                    <i className="calendar-legend-swatch done" />
                    Activare Încheiată
                  </span>
                </div>
              </div>

              <div className="annual-calendar-explanation">
                <strong>Fereastra strategică</strong> indică lunile în care campania este relevantă
                pentru comunicarea destinației și nu reprezintă o perioadă de execuție. Implementarea
                efectivă este reprezentată prin activările planificate și datele acestora.
              </div>
            </>
          )}

          <div className="module-foot">
            Campaniile sunt cadre reutilizabile. Planul operațional citește datele manageriale din
            activări; Calendarul folosește lunile structurate ale campaniilor și datele reale ale
            activărilor.
          </div>
        </>
      ) : null}

      {selecting ? (
        <div
          className="modal-bg"
          onClick={(event) => event.target === event.currentTarget && setSelecting(false)}
        >
          <section className="modal annual-selection-modal">
            <header className="modal-head">
              <div>
                <small className="modal-kicker">PLAN ANUAL {year}</small>
                <h2>Selectează campanii pentru {year}</h2>
                <p>
                  Selecția păstrează doar relația dintre an și campanie. Campaniile nu sunt copiate.
                </p>
              </div>
              <button type="button" className="x" onClick={() => setSelecting(false)}>
                ×
              </button>
            </header>

            <div className="annual-selection-list">
              {allCampaigns.map((campaign) => {
                const auto = automatic.has(campaign.id);
                const checked = auto || selection.includes(campaign.id);
                return (
                  <label className="annual-selection-item" key={campaign.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={auto}
                      onChange={(event) =>
                        setSelection((current) =>
                          event.target.checked
                            ? [...new Set([...current, campaign.id])]
                            : current.filter((id) => id !== campaign.id),
                        )
                      }
                    />
                    <span>
                      <strong>{campaign.title}</strong>
                      <small>
                        {campaign.type} · {campaign.pillar} ·{' '}
                        {seasonalityPeriodLabel(campaign.seasonalityMonths)}
                      </small>
                      {auto ? (
                        <small className="annual-auto-note">
                          Inclusă automat: are o activare bifată în Plan pentru acest an.
                        </small>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>

            <footer className="annual-selection-foot">
              <button type="button" className="btn secondary" onClick={() => setSelecting(false)}>
                Renunță
              </button>
              <button type="button" className="btn primary" onClick={saveSelection} disabled={saving}>
                {saving ? 'Se salvează…' : 'Salvează selecția'}
              </button>
            </footer>
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

      {toast ? (
        <div className="toastbox">
          <div className="toast">{toast}</div>
        </div>
      ) : null}
    </>
  );
}
