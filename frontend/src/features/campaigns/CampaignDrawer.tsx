/**
 * Campaign drawer — the prototype's `OMD.campaigns.open()`.
 *
 * A right-hand overlay panel, not a route: markup and class names are the
 * prototype's (`.drawer.wide-drawer`, `.hero`, `.campaign-view-switch`,
 * `.tabs`, `.drawer-content`, `.drawer-foot`), so the lifted stylesheet applies
 * unchanged and no second visual language enters the product.
 *
 * Two reading modes, exactly as the prototype offers them:
 *
 *   Cu taburi   one section at a time, the tab strip visible
 *   Cap-coadă   every section stacked, tab strip hidden, print actions shown
 *
 * Both render the same `CampaignBlocks`; the mode only decides whether a tab
 * filter is supplied. See CampaignDetailPage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { printCampaign } from './campaignPrint';
import { downloadCampaignPackage } from './campaignExport';
import {
  CAMPAIGN_TABS,
  CampaignBlocks,
  CampaignTabContext,
  type CampaignActivation,
  type CampaignDetail,
  type CampaignTabId,
} from './CampaignDetailPage';
import { ActivationDrawer } from '../activations/ActivationDrawer';

type ViewMode = 'tabs' | 'full';

function truncate(value: string, max: number): string {
  const text = (value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function CampaignDrawer({
  externalKey,
  onClose,
}: {
  externalKey: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [activations, setActivations] = useState<CampaignActivation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>('tabs');
  const [tab, setTab] = useState<CampaignTabId>('overview');
  const [popupBlocked, setPopupBlocked] = useState(false);

  /*
   * An activation from the "Activări create" list, stacked over this drawer.
   *
   * The prototype does the same: opening an activation from a campaign does not
   * dismiss the campaign. You check the execution and come back to the frame it
   * belongs to, which is the whole reason the two are shown together.
   */
  const [openActivation, setOpenActivation] = useState<string | null>(null);

  // The print document is built from the rendered DOM rather than re-rendered,
  // so what gets printed is exactly what is on screen. Safe because both
  // actions are only reachable in Cap-coadă mode, where all eight sections are
  // mounted.
  const contentRef = useRef<HTMLDivElement>(null);

  const printCurrent = useCallback(() => {
    if (!campaign) return;
    const node = contentRef.current?.querySelector('.campaign-full-view');
    if (!node) return;

    const ok = printCampaign({
      title: campaign.title,
      meta: [campaign.type, campaign.pillar, campaign.status].filter(Boolean).join(' · '),
      bodyHtml: node.outerHTML,
    });
    setPopupBlocked(!ok);
  }, [campaign]);

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const exportJson = useCallback(async () => {
    if (!campaign) return;
    setExporting(true);
    setExportNote(null);
    try {
      const meta = await downloadCampaignPackage(campaign.id);

      // Say what actually travelled. The package carries the campaign's parent
      // chain too, and a visual whose file is missing exports with an empty
      // src - both are things the user should hear about, not discover later.
      const parts = [`${meta.assetCount} vizual(e)`];
      const extra = (meta.campaignKeys?.length ?? 1) - 1;
      if (extra > 0) parts.push(`${extra} campanie/campanii din linie`);
      if (meta.missingAssets.length > 0) {
        parts.push(`${meta.missingAssets.length} fișier(e) lipsă din stocare`);
      }
      setExportNote(`Pachet exportat (${parts.join(', ')}).`);
    } catch (caught) {
      setExportNote(
        caught instanceof ApiError ? caught.message : 'Exportul nu a putut fi generat.',
      );
    } finally {
      setExporting(false);
    }
  }, [campaign]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.get<CampaignDetail>(`/campaigns/${encodeURIComponent(externalKey)}`),
      api.get<CampaignActivation[]>(`/campaigns/${encodeURIComponent(externalKey)}/activations`),
    ])
      .then(([detail, list]) => {
        if (cancelled) return;
        setCampaign(detail.data);
        setActivations(list.data);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Campania nu a putut fi încărcată.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [externalKey]);

  // Escape closes, and the page behind must not scroll while the drawer is open.
  const close = useCallback(() => onClose(), [onClose]);

  /*
   * The scroll lock is tied to this drawer existing, and to nothing else.
   *
   * It used to share an effect with the Escape handler. Once that handler had to
   * know whether an activation was stacked on top, the shared effect re-ran on
   * every stack change — and each re-run saved the *current* overflow as the one
   * to restore. By the time both drawers closed, the value saved was `hidden`,
   * so the page behind stayed unscrollable with nothing on screen to explain it.
   */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not while an activation is stacked on top: both drawers listen on
      // `document`, so one keypress would dismiss the pair — you would ask to
      // close the activation and lose the campaign underneath it too.
      if (event.key === 'Escape' && openActivation === null) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, openActivation]);

  const summary = campaign
    ? truncate(campaign.mainMessage || campaign.marketingObjective || '', 270)
    : '';

  return (
    <>
      <div className="drawer-bg" onClick={close} />

      <aside className="drawer wide-drawer" role="dialog" aria-modal="true" aria-label="Detalii campanie">
        <header className="hero">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div className="badges">
              {campaign ? (
                <>
                  <span className="badge">{campaign.type}</span>
                  <span className="badge">{campaign.pillar}</span>
                </>
              ) : null}
            </div>
            <button className="x" type="button" onClick={close} aria-label="Închide">
              ×
            </button>
          </div>

          <h2>{campaign ? campaign.title : 'Se încarcă…'}</h2>
          {summary ? <p>{summary}</p> : null}

          <div className="campaign-view-switch">
            <span>Alege modul de consultare a campaniei</span>
            <div className="toggle">
              <button
                type="button"
                className={view === 'tabs' ? 'active' : ''}
                onClick={() => setView('tabs')}
              >
                ▤ Cu taburi
              </button>
              <button
                type="button"
                className={view === 'full' ? 'active' : ''}
                onClick={() => setView('full')}
              >
                ☷ Cap-coadă
              </button>
            </div>
          </div>
        </header>

        {/* Hidden rather than unmounted in Cap-coadă mode, exactly as the
            prototype does — the drawer's grid row collapses either way. */}
        <nav className="tabs" hidden={view === 'full'}>
          {CAMPAIGN_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tab === entry.id ? 'active' : ''}
              onClick={() => setTab(entry.id)}
            >
              {entry.id === 'acts' ? `${entry.label} (${activations.length})` : entry.label}
            </button>
          ))}
        </nav>

        <div className="drawer-content" ref={contentRef}>
          {loading ? <div className="state-note">Se încarcă campania…</div> : null}
          {error ? (
            <div className="state-note error" role="alert">
              {error}
            </div>
          ) : null}
          {exportNote ? (
            <div className="state-note" role="status">
              {exportNote}
            </div>
          ) : null}
          {popupBlocked ? (
            <div className="state-note error" role="alert">
              Browserul a blocat fereastra de print. Permite ferestrele pop-up pentru acest site și
              încearcă din nou.
            </div>
          ) : null}
          {!loading && !error && campaign ? (
            <CampaignTabContext.Provider value={view === 'full' ? null : tab}>
              <CampaignBlocks
                campaign={campaign}
                activations={activations}
                onOpenActivation={setOpenActivation}
              />
            </CampaignTabContext.Provider>
          ) : null}
        </div>

        <footer className="drawer-foot">
          {view === 'full' ? (
            <span className="print-hint">
              Campania completă poate fi imprimată sau salvată ca PDF.
            </span>
          ) : null}
          <button className="btn secondary" type="button" onClick={close}>
            Închide
          </button>
          {view === 'full' ? (
            <button className="btn secondary" type="button" onClick={printCurrent}>
              ⎙ Print
            </button>
          ) : null}
          {/* Available in both modes: the file holds the whole campaign either
              way, so there is no reason to gate it on the reading mode. */}
          <button
            className="btn secondary"
            type="button"
            onClick={() => void exportJson()}
            disabled={!campaign || exporting}
          >
            {exporting ? 'Se exportă…' : '⇩ Export JSON'}
          </button>
          {canEdit && campaign ? (
            <button
              className="btn primary"
              type="button"
              onClick={() => navigate(`/campaigns/${campaign.id}/edit`)}
            >
              Editează campania
            </button>
          ) : null}
        </footer>
      </aside>

      {/*
        Stacked over this drawer. Its "Vezi campania" button simply closes it —
        the campaign it would open is the one already underneath, so opening a
        third drawer for it would be showing you where you already are.
      */}
      {openActivation ? (
        <ActivationDrawer
          externalKey={openActivation}
          onClose={() => setOpenActivation(null)}
          onOpenCampaign={() => setOpenActivation(null)}
        />
      ) : null}
    </>
  );
}
