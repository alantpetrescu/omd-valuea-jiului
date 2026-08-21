/**
 * Repere strategice — the v13.3 screen, rebuilt in React.
 *
 * The markup and class names are the prototype's, so the lifted stylesheet
 * applies unchanged and the live screen is the prototype screen (spec 3.4:
 * migrate the rules, not the `OMD.*` globals; UI direction does not change).
 *
 * Three tabs, three view modes. Sinteză answers "how much of the strategy is
 * operationalised"; the other two drill into the repere themselves. The
 * matrices are the reason the screen exists — they are the only place a gap in
 * coverage is visible at a glance.
 *
 * Read-only for every role, including ADMIN, so the live screen is the
 * prototype screen with no exceptions. Editing the strategic repere lives in
 * Administrare → Strategie (departure D-002 from README_PROGRAMMER §5.1,
 * recorded in KNOWN_DEVIATIONS.md); what the campaigns contribute — publicuri,
 * produse, KPI — is edited on the campaign fiche that declares it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { CampaignDrawer } from '../campaigns/CampaignDrawer';
import {
  buildModel,
  campaignLabel,
  cut,
  entityKey,
  filterItems,
  hasCampaignRelations,
  objectiveRole,
  programRole,
  relationLabel,
  relationTitle,
} from './strategyModel';
import type {
  DerivedEntity,
  EntityType,
  ObjectiveEntity,
  ProgramEntity,
  RelationRole,
  StrategyEntity,
  StrategyModel,
  StrategyPayload,
} from './strategyModel';

type Tab = 'summary' | 'programs' | 'audiences';
type View = 'matrix' | 'cards' | 'detail';
type ProgramKind = 'programs' | 'objectives';
type AudienceKind = 'audiences' | 'products';

const TABS: Array<[Tab, string]> = [
  ['summary', 'Sinteză'],
  ['programs', 'Programe și obiective'],
  ['audiences', 'Publicuri și produse'],
];

const VIEWS: Array<[View, string, string]> = [
  ['matrix', '▦', 'Matrice'],
  ['cards', '▦', 'Carduri'],
  ['detail', '▤', 'Fișă'],
];

export function StrategyPage() {
  /*
   * The campaign opens over this page, not instead of it.
   *
   * "Deschide campania" used to navigate to `/campaigns/:key`, which threw away
   * everything that had been set up to reach that button — the tab, the Fișă
   * view, the chosen reper, the scroll position — and closing the campaign left
   * you on the Campanii list rather than back where you were. A drawer keeps the
   * URL and the page underneath, which is what every other screen already does.
   */
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

  const [payload, setPayload] = useState<StrategyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('summary');
  const [view, setView] = useState<View>('matrix');
  const [query, setQuery] = useState('');
  const [programKind, setProgramKind] = useState<ProgramKind>('programs');
  const [audienceKind, setAudienceKind] = useState<AudienceKind>('audiences');
  // The prototype opens on P5.2, the program the portfolio leans on hardest.
  const [selected, setSelected] = useState<{ type: EntityType; id: string }>({
    type: 'program',
    id: 'P5.2',
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.get<StrategyPayload>('/strategy');
      setPayload(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Strategia nu a putut fi încărcată.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const model = useMemo(() => (payload ? buildModel(payload) : null), [payload]);

  if (loading) return <div className="state-note">Se încarcă reperele strategice…</div>;
  if (!model || !payload) {
    return <div className="state-note error">{error ?? 'Strategia nu este disponibilă.'}</div>;
  }

  /**
   * The screen is built on the campaign-side relations `GET /strategy` grew for
   * it. An API that predates them answers 200 without them, and every coverage
   * figure would then render as zero — a wrong answer presented as a fact.
   * Better to say what is actually wrong.
   */
  if (!hasCampaignRelations(payload)) {
    return (
      <div className="state-note error" role="alert">
        <strong>API-ul răspunde fără relațiile cu campaniile.</strong>
        <p>
          Ecranul are nevoie de câmpurile <code>campaigns</code> și <code>audiences</code> din{' '}
          <code>GET /api/v1/strategy</code>. Serverul care răspunde acum nu le trimite, deci rulează o
          versiune mai veche decât acest ecran — cel mai probabil un build compilat vechi. Repornește
          backendul (<code>npm run dev</code>) sau reconstruiește-l (<code>npm run build</code>) și
          reîncarcă pagina.
        </p>
      </div>
    );
  }

  function openEntity(type: EntityType, id: string) {
    setSelected({ type, id });
    setView('detail');
  }

  function switchTab(next: Tab) {
    setTab(next);
    // Sinteză has no fiche of its own; the prototype falls back to cards.
    if (next === 'summary' && view === 'detail') setView('cards');
  }

  function jump(target: Tab, kind: string) {
    setTab(target);
    if (kind === 'objectives') setProgramKind('objectives');
    if (kind === 'programs') setProgramKind('programs');
    if (kind === 'audiences') setAudienceKind('audiences');
    setView('cards');
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Repere strategice</h1>
          <p>Vedere de ansamblu asupra programelor, obiectivelor SMART, publicurilor și produselor.</p>
        </div>
        <div className="actions">
          <button
            className="btn secondary"
            type="button"
            onClick={() =>
              setToast(
                'Nomenclatoarele provin din matricea strategică Excel. Relațiile și acoperirea sunt generate din fișele campaniilor.',
              )
            }
          >
            ⓘ Sursa datelor
          </button>
        </div>
      </header>

      <Stats model={model} />

      <nav className="strategic-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => switchTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <section className="strategic-toolbar">
        <label className="search">
          <i>⌕</i>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Caută reper, obiectiv, public, produs sau campanie"
          />
        </label>
        <div className="view-switch" aria-label="Mod de vizualizare">
          {VIEWS.map(([id, glyph, label]) => (
            <button
              key={id}
              type="button"
              className={view === id ? 'active' : ''}
              title={label}
              onClick={() => setView(id)}
            >
              {glyph} <span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section id="strategicContent">
        <TabContent
          model={model}
          payload={payload}
          tab={tab}
          view={view}
          query={query}
          programKind={programKind}
          audienceKind={audienceKind}
          selected={selected}
          onOpenEntity={openEntity}
          onOpenCampaign={setOpenCampaign}
          onJump={jump}
          onSelect={setSelected}
          onProgramKind={(kind) => {
            setProgramKind(kind);
            setSelected({ type: kind === 'programs' ? 'program' : 'objective', id: '' });
          }}
          onAudienceKind={(kind) => {
            setAudienceKind(kind);
            setSelected({ type: kind === 'audiences' ? 'audience' : 'product', id: '' });
          }}
        />
      </section>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      {toast ? (
        <div className="toastbox">
          <div className="toast">{toast}</div>
        </div>
      ) : null}

      {openCampaign ? (
        <CampaignDrawer externalKey={openCampaign} onClose={() => setOpenCampaign(null)} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ stats */

function Stats({ model }: { model: StrategyModel }) {
  const coveredObjectives = model.objectives.filter((item) => item.usages.length).length;
  const coveredPrograms = model.programs.filter((item) => item.usages.length).length;
  const usedAudiences = model.audiences.filter((item) => item.usages.length).length;

  /**
   * Every interpolated line is emitted as ONE text node.
   *
   * `{n} utilizate de campanii` would be two adjacent text nodes, and the
   * browser shapes a split run with slightly different sub-pixel kerning than
   * the prototype's single node — visible as a handful of differing pixels on
   * the closing glyphs. Template literals keep the run intact.
   */
  return (
    <section className="stats strategic-stats">
      <div className="stat">
        <small>Programe strategice</small>
        <b>{model.programs.length}</b>
        <span>{`${coveredPrograms} utilizate de campanii`}</span>
      </div>
      <div className="stat">
        <small>Obiective SMART</small>
        <b>{model.objectives.length}</b>
        <span>{`${coveredObjectives} acoperite direct`}</span>
      </div>
      <div className="stat">
        <small>Publicuri în nomenclator</small>
        <b>{model.audiences.length}</b>
        <span>{`${usedAudiences} utilizate`}</span>
      </div>
      <div className="stat">
        <small>KPI utilizați</small>
        <b>{model.kpis.length}</b>
        <span>{`${model.sources.length} surse distincte`}</span>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- tab content */

interface ContentProps {
  model: StrategyModel;
  payload: StrategyPayload;
  tab: Tab;
  view: View;
  query: string;
  programKind: ProgramKind;
  audienceKind: AudienceKind;
  selected: { type: EntityType; id: string };
  onOpenEntity: (type: EntityType, id: string) => void;
  onOpenCampaign: (id: string) => void;
  onJump: (tab: Tab, kind: string) => void;
  onSelect: (value: { type: EntityType; id: string }) => void;
  onProgramKind: (kind: ProgramKind) => void;
  onAudienceKind: (kind: AudienceKind) => void;
}

function TabContent(props: ContentProps) {
  const { model, tab, view } = props;

  if (view === 'detail') return <DetailView {...props} />;
  if (tab === 'summary') return view === 'matrix' ? <SummaryMatrix {...props} /> : <SummaryCards {...props} />;
  if (tab === 'programs') {
    return view === 'matrix' ? <ProgramObjectiveMatrix {...props} /> : <ProgramObjectiveCards {...props} />;
  }
  return view === 'matrix' ? <AudienceProductMatrix {...props} /> : <AudienceProductCards {...props} />;
}

/* --------------------------------------------------------------- sinteză */

function CoverageBar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="coverage-line">
      <div>
        <span>{label}</span>
        <b>{`${value}/${total}`}</b>
      </div>
      <div className="coverage-track">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SummaryCards({ model, onJump }: ContentProps) {
  const objectiveGaps = model.objectives.filter((item) => !item.usages.length);
  const programGaps = model.programs.filter((item) => !item.usages.length);
  const thinAudiences = model.audiences.filter((item) => item.usages.length === 1);

  return (
    <div className="strategic-summary-grid">
      <section className="summary-panel">
        <header>
          <div>
            <small>Acoperire strategică</small>
            <h3>Cât din strategie este operaționalizat</h3>
          </div>
          <span className="status-dot ok" />
        </header>
        <CoverageBar
          value={model.programs.filter((item) => item.usages.length).length}
          total={model.programs.length}
          label="Programe asociate campaniilor"
        />
        <CoverageBar
          value={model.objectives.filter((item) => item.usages.length).length}
          total={model.objectives.length}
          label="Obiective SMART acoperite"
        />
        <CoverageBar
          value={model.audiences.filter((item) => item.usages.length).length}
          total={model.audiences.length}
          label="Publicuri utilizate"
        />
      </section>

      <section className="summary-panel">
        <header>
          <div>
            <small>Semnale de completare</small>
            <h3>Repere care necesită atenție</h3>
          </div>
        </header>
        <button className="diagnostic-row" type="button" onClick={() => onJump('programs', 'objectives')}>
          <span>Obiective fără campanie asociată</span>
          <b>{objectiveGaps.length}</b>
        </button>
        <button className="diagnostic-row" type="button" onClick={() => onJump('programs', 'programs')}>
          <span>Programe neutilizate în portofoliu</span>
          <b>{programGaps.length}</b>
        </button>
        <button className="diagnostic-row" type="button" onClick={() => onJump('audiences', 'audiences')}>
          <span>Publicuri prezente într-o singură campanie</span>
          <b>{thinAudiences.length}</b>
        </button>
      </section>
    </div>
  );
}

function SummaryMatrix({ model, onOpenEntity }: ContentProps) {
  const { objectives } = model;

  return (
    <section className="matrix-card">
      <header>
        <div>
          <small>Matrice de sinteză</small>
          <h3>Programe strategice × obiective SMART</h3>
        </div>
        <span>● obiectiv prevăzut în program · ✓ obiectiv acoperit de campanii</span>
      </header>
      <div className="matrix-scroll">
        <table className="relation-matrix summary-matrix">
          <thead>
            <tr>
              <th>Program</th>
              {objectives.map((objective) => (
                <th key={objective.code} title={objective.name}>
                  {objective.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.programs.map((program) => (
              <tr key={program.code}>
                <th>
                  <button type="button" onClick={() => onOpenEntity('program', program.code)}>
                    <b>{program.code}</b>
                    <span>{program.name.replace('Programul pentru ', '')}</span>
                  </button>
                </th>
                {objectives.map((objective) => {
                  const belongs = program.objectiveCodes.includes(objective.code);
                  const covered = objective.usages.length > 0;
                  return (
                    <td
                      key={objective.code}
                      className={`${belongs ? 'linked' : ''} ${belongs && covered ? 'covered' : ''}`}
                      title={
                        belongs
                          ? covered
                            ? 'Prevăzut și acoperit prin campanii'
                            : 'Prevăzut, dar neacoperit'
                          : 'Fără relație în matrice'
                      }
                    >
                      {belongs ? (covered ? '✓' : '●') : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- cards */

function SubToggle({
  options,
  current,
  onChange,
}: {
  options: Array<[string, string]>;
  current: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="sub-toggle">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={current === id ? 'active' : ''}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function EntityCard({ item, onOpen }: { item: StrategyEntity; onOpen: () => void }) {
  const isOfficial = item.type === 'program' || item.type === 'objective';
  const code = 'code' in item ? item.code : '';
  const description = (item as ProgramEntity).result || item.name;
  const usage = item.usages?.length || 0;

  const footnote =
    item.type === 'program'
      ? `${(item as ProgramEntity).objectiveCodes.length} obiective SMART`
      : item.type === 'objective'
        ? `${(item as ObjectiveEntity).programs.length} programe`
        : `${usage} asocieri`;

  return (
    <article className="strategic-card" onClick={onOpen}>
      <header>
        {code ? <span className="entity-code">{code}</span> : null}
        <span className={`coverage-badge ${usage ? 'covered' : 'gap'}`}>
          {usage ? `${usage} campanii` : 'neacoperit'}
        </span>
      </header>
      <h3>{item.name}</h3>
      {isOfficial ? <p>{cut(description, 180)}</p> : null}
      <footer>
        <span>{footnote}</span>
        <button type="button">Vezi fișa →</button>
      </footer>
    </article>
  );
}

function CardGrid({
  items,
  dense,
  onOpen,
}: {
  items: StrategyEntity[];
  dense?: boolean;
  onOpen: (item: StrategyEntity) => void;
}) {
  return (
    <div className={dense ? 'strategic-card-grid dense' : 'strategic-card-grid'}>
      {items.length ? (
        items.map((item) => (
          <EntityCard key={`${item.type}::${entityKey(item)}`} item={item} onOpen={() => onOpen(item)} />
        ))
      ) : (
        <div className="empty">Nu există rezultate pentru filtrul curent.</div>
      )}
    </div>
  );
}

function ProgramObjectiveCards({ model, query, programKind, onProgramKind, onOpenEntity }: ContentProps) {
  const items = filterItems<StrategyEntity>(
    programKind === 'programs' ? model.programs : model.objectives,
    query,
  );
  return (
    <>
      <SubToggle
        options={[
          ['programs', 'Programe'],
          ['objectives', 'Obiective SMART'],
        ]}
        current={programKind}
        onChange={(value) => onProgramKind(value as ProgramKind)}
      />
      <CardGrid items={items} onOpen={(item) => onOpenEntity(item.type, entityKey(item))} />
    </>
  );
}

function AudienceProductCards({ model, query, audienceKind, onAudienceKind, onOpenEntity }: ContentProps) {
  const items = filterItems<StrategyEntity>(
    audienceKind === 'audiences' ? model.audiences : model.products,
    query,
  );
  return (
    <>
      <SubToggle
        options={[
          ['audiences', 'Publicuri'],
          ['products', 'Produse și experiențe'],
        ]}
        current={audienceKind}
        onChange={(value) => onAudienceKind(value as AudienceKind)}
      />
      <CardGrid items={items} dense onOpen={(item) => onOpenEntity(item.type, entityKey(item))} />
    </>
  );
}

/* -------------------------------------------------------------- matrices */

function RelationCell({
  role,
  campaignId,
  onOpenCampaign,
}: {
  role: RelationRole;
  campaignId: string;
  onOpenCampaign: (id: string) => void;
}) {
  return (
    <td className={`relation-cell ${role || ''}`}>
      {role ? (
        <button type="button" title={relationTitle(role)} onClick={() => onOpenCampaign(campaignId)}>
          {relationLabel(role)}
        </button>
      ) : null}
    </td>
  );
}

function ProgramObjectiveMatrix({
  model,
  query,
  programKind,
  onProgramKind,
  onOpenEntity,
  onOpenCampaign,
}: ContentProps) {
  const isPrograms = programKind === 'programs';
  const rows = filterItems<StrategyEntity>(isPrograms ? model.programs : model.objectives, query);

  return (
    <>
      <SubToggle
        options={[
          ['programs', 'Programe'],
          ['objectives', 'Obiective SMART'],
        ]}
        current={programKind}
        onChange={(value) => onProgramKind(value as ProgramKind)}
      />
      <section className="matrix-card">
        <header>
          <div>
            <small>Matrice generată din fișele campaniilor</small>
            <h3>{isPrograms ? 'Programe × campanii' : 'Obiective SMART × campanii'}</h3>
          </div>
          <span>P = principal · S = secundar</span>
        </header>
        <div className="matrix-scroll">
          <table className="relation-matrix">
            <thead>
              <tr>
                <th>Reper</th>
                {model.all.map((campaign) => (
                  <th key={campaign.id} title={campaign.title}>
                    {campaignLabel(campaign)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const code = (item as ProgramEntity).code;
                return (
                  <tr key={code}>
                    <th>
                      <button type="button" onClick={() => onOpenEntity(item.type, code)}>
                        <b>{code}</b>
                        <span>{cut(item.name, 54)}</span>
                      </button>
                    </th>
                    {model.all.map((campaign) => (
                      <RelationCell
                        key={campaign.id}
                        role={isPrograms ? programRole(campaign, code) : objectiveRole(campaign, code)}
                        campaignId={campaign.id}
                        onOpenCampaign={onOpenCampaign}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AudienceProductMatrix({
  model,
  query,
  audienceKind,
  onAudienceKind,
  onOpenEntity,
  onOpenCampaign,
}: ContentProps) {
  const isAudiences = audienceKind === 'audiences';
  const rows = filterItems<StrategyEntity>(isAudiences ? model.audiences : model.products, query);

  return (
    <>
      <SubToggle
        options={[
          ['audiences', 'Publicuri'],
          ['products', 'Produse și experiențe'],
        ]}
        current={audienceKind}
        onChange={(value) => onAudienceKind(value as AudienceKind)}
      />
      <section className="matrix-card">
        <header>
          <div>
            <small>Relații generate din fișele campaniilor</small>
            <h3>{isAudiences ? 'Publicuri × campanii' : 'Produse × campanii'}</h3>
          </div>
          <span>
            {isAudiences ? 'P = public principal · S = public secundar' : '● = produs utilizat'}
          </span>
        </header>
        <div className="matrix-scroll">
          <table className="relation-matrix">
            <thead>
              <tr>
                <th>{isAudiences ? 'Public' : 'Produs / experiență'}</th>
                {model.all.map((campaign) => (
                  <th key={campaign.id} title={campaign.title}>
                    {campaignLabel(campaign)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const id = (item as DerivedEntity).id;
                return (
                  <tr key={id}>
                    <th>
                      <button type="button" onClick={() => onOpenEntity(item.type, id)}>
                        <span>{cut(item.name, 62)}</span>
                      </button>
                    </th>
                    {model.all.map((campaign) => {
                      const usage = item.usages.find((entry) => entry.campaign.id === campaign.id);
                      return (
                        <RelationCell
                          key={campaign.id}
                          role={usage?.role || ''}
                          campaignId={campaign.id}
                          onOpenCampaign={onOpenCampaign}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- fișele */

function EntityUsageCards({
  item,
  onOpenCampaign,
}: {
  item: StrategyEntity;
  onOpenCampaign: (id: string) => void;
}) {
  if (!item.usages?.length) {
    return <div className="empty-detail">Acest reper nu este încă asociat niciunei campanii.</div>;
  }
  return (
    <div className="linked-campaigns">
      {item.usages.map((usage) => (
        <article key={usage.campaign.id}>
          <div>
            <span className={`role-mark ${usage.role}`}>{relationLabel(usage.role)}</span>
            <div>
              <strong>{usage.campaign.title}</strong>
              <small>{relationTitle(usage.role)}</small>
            </div>
          </div>
          <button className="btn secondary" type="button" onClick={() => onOpenCampaign(usage.campaign.id)}>
            Deschide campania
          </button>
        </article>
      ))}
    </div>
  );
}

function ProgramDetail({
  item,
  model,
  horizonYear,
  onOpenEntity,
  onOpenCampaign,
}: {
  item: ProgramEntity;
  model: StrategyModel;
  horizonYear: number | undefined;
  onOpenEntity: (type: EntityType, id: string) => void;
  onOpenCampaign: (id: string) => void;
}) {
  return (
    <>
      <section className="detail-hero">
        <span>{item.code}</span>
        <h2>{item.name}</h2>
        <p>{item.result}</p>
      </section>
      <div className="detail-grid">
        <section>
          <h3>Obiectiv de marketing</h3>
          <p>{item.marketingObjective}</p>
        </section>
        <section>
          {/* The year comes from the active strategy version, not a literal,
              so the heading survives the next strategic cycle. */}
          <h3>{`Rezultat urmărit până în ${horizonYear}`}</h3>
          <p>{item.horizonResult}</p>
        </section>
        <section>
          <h3>Abordare</h3>
          <p>{item.approach}</p>
        </section>
        <section>
          <h3>Grupuri-țintă din matrice</h3>
          <p>{item.targetGroups}</p>
        </section>
        <section>
          <h3>KPI strategici</h3>
          <p>{item.kpiText}</p>
        </section>
        <section>
          <h3>Surse de date</h3>
          <p>{item.sources}</p>
        </section>
      </div>
      <section className="detail-section">
        <h3>Obiective SMART asociate în matrice</h3>
        <div className="entity-tags">
          {item.objectiveCodes.map((code) => {
            const objective = model.objectives.find((entry) => entry.code === code);
            return (
              <button key={code} type="button" onClick={() => onOpenEntity('objective', code)}>
                <b>{code}</b>
                <span>{objective?.name || ''}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="detail-section">
        <h3>Campanii care operaționalizează programul</h3>
        <EntityUsageCards item={item} onOpenCampaign={onOpenCampaign} />
      </section>
    </>
  );
}

function ObjectiveDetail({
  item,
  onOpenEntity,
  onOpenCampaign,
}: {
  item: ObjectiveEntity;
  onOpenEntity: (type: EntityType, id: string) => void;
  onOpenCampaign: (id: string) => void;
}) {
  return (
    <>
      <section className="detail-hero">
        <span>{item.code}</span>
        <h2>{item.name}</h2>
        <p>{`Sursă oficială: ${item.source}`}</p>
      </section>
      <section className="detail-section">
        <h3>Programe strategice în care apare</h3>
        <div className="entity-tags">
          {item.programs.length ? (
            item.programs.map((program) => (
              <button key={program.code} type="button" onClick={() => onOpenEntity('program', program.code)}>
                <b>{program.code}</b>
                <span>{program.name}</span>
              </button>
            ))
          ) : (
            <p className="muted-copy">Nu este asociat unui program din matricea de marketing.</p>
          )}
        </div>
      </section>
      <section className="detail-section">
        <h3>Acoperire prin campanii</h3>
        <EntityUsageCards item={item} onOpenCampaign={onOpenCampaign} />
      </section>
    </>
  );
}

function AudienceProductDetail({
  item,
  onOpenCampaign,
}: {
  item: DerivedEntity;
  onOpenCampaign: (id: string) => void;
}) {
  const isAudience = item.type === 'audience';
  return (
    <>
      <section className="detail-hero">
        <span>{isAudience ? 'PUBLIC' : 'PRODUS / EXPERIENȚĂ'}</span>
        <h2>{item.name}</h2>
        <p>
          {item.usages.length
            ? `Utilizat în ${item.usages.length} campanii.`
            : 'Nefolosit în portofoliul actual de campanii.'}
        </p>
      </section>
      <section className="detail-section">
        <h3>Relații cu portofoliul</h3>
        {item.usages.length ? (
          <div className="matrix-scroll">
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Campanie</th>
                  <th>Rol</th>
                  <th>{isAudience ? 'Insight / motivație' : 'Condiții de utilizare'}</th>
                </tr>
                {item.usages.map((usage) => (
                  <tr key={usage.campaign.id}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        onClick={() => onOpenCampaign(usage.campaign.id)}
                      >
                        {usage.campaign.title}
                      </button>
                    </td>
                    <td>{relationTitle(usage.role)}</td>
                    <td>{usage.insight || usage.condition || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-detail">
            Reperul există în nomenclator, dar nu este încă asociat unei campanii.
          </div>
        )}
      </section>
    </>
  );
}

function KpiSourceDetail({
  item,
  onOpenCampaign,
}: {
  item: DerivedEntity;
  onOpenCampaign: (id: string) => void;
}) {
  return (
    <>
      <section className="detail-hero">
        <span>{item.type === 'kpi' ? 'KPI' : 'SURSĂ DE DATE'}</span>
        <h2>{item.name}</h2>
        <p>Relațiile și valorile sunt agregate automat din fișele campaniilor.</p>
      </section>
      <section className="detail-section">
        <h3>Utilizare în campanii</h3>
        {item.usages.length ? (
          <div className="matrix-scroll">
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Campanie</th>
                  <th>Baseline</th>
                  <th>Țintă</th>
                  <th>Sursă</th>
                </tr>
                {item.usages.map((usage, index) => (
                  <tr key={`${usage.campaign.id}-${index}`}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        onClick={() => onOpenCampaign(usage.campaign.id)}
                      >
                        {usage.campaign.title}
                      </button>
                    </td>
                    <td>{usage.metric?.baseline || '—'}</td>
                    <td>{usage.metric?.target || '—'}</td>
                    <td>{usage.metric?.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-detail">Nu există utilizări în portofoliul actual.</div>
        )}
      </section>
    </>
  );
}

function DetailView(props: ContentProps) {
  const { model, payload, tab, query, programKind, audienceKind, selected, onSelect } = props;

  const pool: StrategyEntity[] =
    tab === 'programs'
      ? programKind === 'programs'
        ? model.programs
        : model.objectives
      : tab === 'audiences'
        ? audienceKind === 'audiences'
          ? model.audiences
          : model.products
        : [...model.programs, ...model.objectives];

  const entities = filterItems(pool, query);

  // The selection survives tab and filter changes when it still exists; when it
  // does not, the first entity in the current pool takes over.
  let item =
    pool.find((entry) => entityKey(entry) === selected.id && entry.type === selected.type) ?? pool[0];
  if (query && item && !entities.includes(item)) item = entities[0] ?? item;

  if (!item) return <div className="empty">Nu există repere disponibile.</div>;

  const currentKey = `${item.type}::${entityKey(item)}`;

  return (
    <>
      <div className="detail-selector">
        <label>
          Reper afișat
          <select
            value={currentKey}
            onChange={(event) => {
              const [type, id] = event.target.value.split('::');
              onSelect({ type: type as EntityType, id: id ?? '' });
            }}
          >
            {entities.map((entity) => {
              const key = entityKey(entity);
              const code = 'code' in entity ? entity.code : '';
              return (
                <option key={`${entity.type}::${key}`} value={`${entity.type}::${key}`}>
                  {(code ? `${code} – ` : '') + entity.name}
                </option>
              );
            })}
          </select>
        </label>
        <span>Fișa este generată din nomenclator și din campaniile actuale.</span>
      </div>

      <article className="strategic-detail">
        {item.type === 'program' ? (
          <ProgramDetail
            item={item as ProgramEntity}
            model={model}
            horizonYear={payload.version?.periodEndYear}
            onOpenEntity={props.onOpenEntity}
            onOpenCampaign={props.onOpenCampaign}
          />
        ) : item.type === 'objective' ? (
          <ObjectiveDetail
            item={item as ObjectiveEntity}
            onOpenEntity={props.onOpenEntity}
            onOpenCampaign={props.onOpenCampaign}
          />
        ) : item.type === 'audience' || item.type === 'product' ? (
          <AudienceProductDetail item={item as DerivedEntity} onOpenCampaign={props.onOpenCampaign} />
        ) : (
          <KpiSourceDetail item={item as DerivedEntity} onOpenCampaign={props.onOpenCampaign} />
        )}
      </article>
    </>
  );
}
