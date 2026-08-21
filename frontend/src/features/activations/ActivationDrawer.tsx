/**
 * Activation drawer — the prototype's right-side overlay.
 *
 * The calendar opens this instead of navigating away, which is the whole point:
 * you are looking at a year, you check one activation, you carry on looking at
 * the year. A page navigation loses the month you were reading and the year you
 * had selected.
 *
 * Markup follows the prototype's `openView`: a `.drawer-bg` scrim, an
 * `aside.drawer.wide-drawer` in the grid the stylesheet expects (hero, content,
 * footer), and the same footer actions. The body is `ActivationSummary`, so the
 * drawer and the standalone page cannot disagree about what a fiche contains.
 *
 * The stylesheet already animates it in from the right (`@keyframes slide`).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, api } from '../../api/client';
import {
  formatPeriod,
  getTemporalSituation,
  getTemporalSituationClass,
} from '../../domain/services';
import { useAuth } from '../auth/AuthContext';
import {
  ACTIVATION_TABS,
  ActivationSummary,
  type ActivationDetail,
  type ActivationTab,
} from './ActivationSummary';
import { useMaterialResults } from './useMaterialResults';

export function ActivationDrawer({
  externalKey,
  onClose,
  onOpenCampaign,
  escapeEnabled = true,
  initialTab = 'plan',
  focusMaterialId = null,
}: {
  externalKey: string;
  onClose: () => void;
  /** Opens the campaign over this drawer, as the prototype does. */
  onOpenCampaign?: (campaignKey: string) => void;
  /**
   * False while a campaign drawer is stacked on top.
   *
   * Both drawers listen for Escape on `document`, so without this one keypress
   * would dismiss the pair — you would ask to close the campaign and lose the
   * activation underneath it too.
   */
  escapeEnabled?: boolean;
  /**
   * Which tab to land on — the prototype's `openView(id, initialTab)`.
   *
   * Monitorizare opens a fiche because of one material, so it asks for
   * "Materiale și canale" rather than dropping you on Planificare to find your
   * own way there.
   */
  initialTab?: ActivationTab;
  /** Material to single out and scroll to on that tab. */
  focusMaterialId?: string | null;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';

  const [activation, setActivation] = useState<ActivationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ActivationTab>(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { results, refreshing, refresh } = useMaterialResults(externalKey);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<ActivationDetail>(`/activations/${encodeURIComponent(externalKey)}`)
      .then((response) => {
        if (!cancelled) setActivation(response.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof ApiError ? caught.message : 'Activarea nu a putut fi încărcată.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [externalKey]);

  /*
   * The page behind stops scrolling while the drawer is up — otherwise the
   * calendar drifts under the overlay when the wheel is used, which reads as the
   * page having broken.
   *
   * Deliberately its own effect, with no dependencies: it belongs to this drawer
   * existing, not to any prop. Sharing it with the Escape handler below meant
   * re-running on every `escapeEnabled` change, and each re-run saved the
   * already-locked value as the one to restore — leaving the page frozen after
   * the last drawer closed.
   */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  /*
   * Re-open on a different row, start from the tab that row asked for.
   *
   * The drawer is not always remounted between opens — the campaign drawer
   * swaps `externalKey` under a live one — so without this it would keep
   * whichever tab happened to be clicked last, and a Monitorizare row asking
   * for its material would land somewhere else entirely.
   */
  useEffect(() => {
    setTab(initialTab);
  }, [externalKey, initialTab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && escapeEnabled) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, escapeEnabled]);

  const situation = activation ? getTemporalSituation(activation) : null;

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />

      <aside
        className="drawer wide-drawer activation-view"
        role="dialog"
        aria-modal="true"
        aria-label={activation ? `Activarea ${activation.title}` : 'Activare'}
      >
        <header className="hero">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="badges">
              {activation ? (
                <span className="badge">
                  {activation.includeAnnualPlan ? 'Plan anual' : 'În afara planului'}
                </span>
              ) : null}
            </div>
            <button ref={closeRef} type="button" className="x" onClick={onClose} aria-label="Închide">
              ×
            </button>
          </div>

          <h2>{activation?.title ?? 'Se încarcă…'}</h2>

          {activation ? (
            <p>
              {activation.campaignId ? `Campania ${activation.campaignTitle}` : 'Activare independentă'}
              {' · '}
              {formatPeriod(activation)}
              {' · '}
              {activation.status}
              {situation ? (
                <>
                  {' · '}
                  <span className={`calendar-situation-pill ${getTemporalSituationClass(situation)}`}>
                    {situation}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
        </header>

        {/* The second row of `.drawer`'s grid. */}
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
          {loading ? <div className="state-note">Se încarcă activarea…</div> : null}
          {error ? (
            <div className="state-note error" role="alert">
              {error}
            </div>
          ) : null}
          {activation ? (
            <ActivationSummary
              activation={activation}
              tab={tab}
              results={results}
              onRefreshResults={refresh}
              refreshingResults={refreshing}
              focusMaterialId={focusMaterialId}
            />
          ) : null}
        </div>

        <footer className="drawer-foot">
          {activation?.campaignId ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                onOpenCampaign
                  ? onOpenCampaign(activation.campaignId as string)
                  : navigate(`/campaigns/${activation.campaignId}`)
              }
            >
              Vezi campania
            </button>
          ) : null}
          <button type="button" className="btn secondary" onClick={onClose}>
            Închide
          </button>
          {activation && canEdit ? (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                navigate(`/activations/${activation.id}/edit`, { state: { from: '/activations' } })
              }
            >
              Editează activarea
            </button>
          ) : null}
        </footer>
      </aside>
    </>
  );
}
