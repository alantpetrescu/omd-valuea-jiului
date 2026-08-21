/**
 * Campaign detail — the "Deschide campania" view.
 *
 * Ported from the prototype's `fullCampaignView()`: the same eight numbered
 * sections, the same class names, the same Romanian headings. Content that the
 * prototype read from localStorage now arrives from the API.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api, ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { DeleteButton } from '../../components/DeleteButton';

/**
 * The eight tabs of the prototype's campaign drawer, in its order.
 *
 * The same eight sections are rendered either one at a time (`Cu taburi`) or
 * stacked (`Cap-coadă`). `CampaignBlocks` is the single source for both, so the
 * two views can never drift apart.
 */
export type CampaignTabId =
  | 'overview'
  | 'strategy'
  | 'concept'
  | 'products'
  | 'rules'
  | 'deliverables'
  | 'types'
  | 'acts';

export const CAMPAIGN_TABS: Array<{ id: CampaignTabId; label: string }> = [
  { id: 'overview', label: 'Prezentare' },
  { id: 'strategy', label: 'Încadrare strategică' },
  { id: 'concept', label: 'Public și concept' },
  { id: 'products', label: 'Produse și măsurare' },
  { id: 'rules', label: 'Reguli' },
  { id: 'deliverables', label: 'Livrabile & template-uri' },
  { id: 'types', label: 'Exemple de activări' },
  { id: 'acts', label: 'Activări create' },
];

/**
 * Which section is on screen. `null` means "all of them" — the Cap-coadă view
 * and the standalone /campaigns/:key page both leave it null, so neither has to
 * know that tabs exist.
 */
export const CampaignTabContext = createContext<CampaignTabId | null>(null);

interface Mockup {
  id: string;
  name: string;
  formats: string;
  structure: string;
  generic: boolean;
  canvaUrl: string;
  assets: Array<{ id: string; format: string; label: string; src: string }>;
}

export interface CampaignDetail {
  id: string;
  title: string;
  accent: string;
  type: string;
  status: string;
  pillar: string;
  seasonalityLabel: string;
  seasonalityMonths: number[];
  seasonalityNote: string;
  responsible: string;
  parentCampaignId: string | null;
  marketingObjective: string;
  directResult: string;
  strategicContribution: string[];
  programPrimary: string | null;
  programSecondary: string[];
  objectivePrimary: string | null;
  objectiveSecondary: string[];
  primaryAudienceSegment: string | null;
  primaryAudienceDescription: string;
  secondaryAudienceSegments: string[];
  insight: string;
  valueProposition: string;
  centralIdea: string;
  promise: string;
  mainMessage: string;
  secondaryMessages: string[];
  storytellingDirections: string[];
  tone: string;
  ctas: string[];
  products: string[];
  productCondition: string;
  channels: string[];
  prPartnerships: string;
  kpiDefinitions: Array<{ name: string; baseline: string; target: string; source: string }>;
  fixedElements: string[];
  adaptableElements: string[];
  adaptationLimits: string[];
  applicationExamples: Array<{ context: string; adaptation: string; fixed: string }>;
  frameworkDeliverables: Array<{ name: string; content: string; format: string }>;
  deliverableIntro: string;
  noVisualsNote: string;
  headlines: Array<{ headline: string; support: string; cta: string }>;
  posts: Array<{ title: string; body: string; cta: string }>;
  videoConcepts: Array<{ name: string; duration: string; narrative: string; closing: string }>;
  mockups: Mockup[];
  activationExamples: {
    directions?: Array<{ name: string; purpose: string; channels: string; metrics: string }>;
    simulatedRows?: Array<{ name: string; period: string; status: string; result: string }>;
  };
  strategyVersionLabel: string;
}

export interface CampaignActivation {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  includeAnnualPlan: number;
  hasResults: number;
}

const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function BulletList({ values }: { values: string[] | undefined }) {
  if (!values?.length) return <p className="muted-copy">Nu există informații completate.</p>;
  return (
    <ul>
      {values.map((value, index) => (
        <li key={index}>{value}</li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Block({
  number,
  title,
  tab,
  children,
}: {
  number: string;
  title: string;
  tab: CampaignTabId;
  children: React.ReactNode;
}) {
  const activeTab = useContext(CampaignTabContext);
  if (activeTab !== null && activeTab !== tab) return null;

  // In tabs mode the tab strip already names the section, so the prototype
  // renders the content bare - no card, no numbered green header. The header
  // belongs to Cap-coadă, where eight sections run together and need
  // separating. Same source, two presentations (prototype: tabContent() vs
  // fullCampaignView()).
  if (activeTab !== null) return <>{children}</>;

  return (
    <section className="campaign-full-section">
      <header>
        <b>{number}</b>
        <h3>{title}</h3>
      </header>
      <div className="campaign-full-section-body">{children}</div>
    </section>
  );
}

/** Lightbox for template visuals, as the prototype's `showImage()` did. */
export function Lightbox({
  image,
  onClose,
}: {
  image: { src: string; caption: string } | null;
  onClose: () => void;
}) {
  if (!image) return null;
  return (
    <div className="image-lightbox" onClick={onClose} role="presentation">
      <button className="lightbox-close" aria-label="Închide" type="button">
        ×
      </button>
      <figure>
        <img src={image.src} alt={image.caption} />
        <figcaption>{image.caption}</figcaption>
      </figure>
    </div>
  );
}

function MockupCard({
  mockup,
  index,
  accent,
  onPreview,
}: {
  mockup: Mockup;
  index: number;
  accent: string;
  onPreview: (image: { src: string; caption: string }) => void;
}) {
  const icon =
    accent === 'community' ? '●' : accent === 'heritage' ? '◆' : accent === 'winter' ? '❄' : accent === 'summer' ? '☀' : '▦';

  return (
    <article className="mockup-card">
      <header>
        <div>
          <small>Machetă {index + 1}</small>
          <h4>{mockup.name}</h4>
        </div>
        <span className="format-pill">{mockup.formats}</span>
      </header>

      {mockup.assets.length > 0 ? (
        <div className="visual-gallery">
          {mockup.assets.map((asset) => (
            <button
              key={asset.id}
              className="visual-preview"
              type="button"
              onClick={() => onPreview({ src: asset.src, caption: `${mockup.name} – ${asset.label}` })}
            >
              <img src={asset.src} alt={`${mockup.name} – ${asset.label}`} />
              <span>{asset.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="generic-visual" data-accent={accent}>
          <span className="generic-icon">{icon}</span>
          <strong>{mockup.name}</strong>
          <small>
            Previzualizare generică
            <br />
            {mockup.formats}
          </small>
          <em>Zona va fi înlocuită cu vizualul final</em>
        </div>
      )}

      <p>{mockup.structure}</p>
    </article>
  );
}

export function CampaignDetailPage() {
  const { externalKey = '' } = useParams();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [activations, setActivations] = useState<CampaignActivation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ src: string; caption: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      api.get<CampaignDetail>(`/campaigns/${encodeURIComponent(externalKey)}`),
      api.get<CampaignActivation[]>(`/campaigns/${encodeURIComponent(externalKey)}/activations`),
    ])
      .then(([detail, list]) => {
        setCampaign(detail.data);
        setActivations(list.data);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : 'Campania nu a putut fi încărcată.'),
      )
      .finally(() => setLoading(false));
  }, [externalKey]);

  if (loading) return <div className="state-note">Se încarcă campania…</div>;
  if (error) return <div className="state-note error">{error}</div>;
  if (!campaign) return null;

  return (
    <>
      <header className="page-head">
        <div>
          <Link to="/campaigns" className="btn secondary">
            ← Înapoi la campanii
          </Link>
          <h1>{campaign.title}</h1>
          <p>
            {campaign.type} · {campaign.pillar} · {campaign.strategyVersionLabel}
          </p>
        </div>
        {canEdit ? (
          <div className="actions">
            <Link className="btn primary" to={`/campaigns/${campaign.id}/edit`}>
              Editează campania
            </Link>
            <DeleteButton
              resource="campaigns"
              externalKey={campaign.id}
              label={campaign.title}
              redirectTo="/campaigns"
            />
          </div>
        ) : null}
      </header>

      <CampaignBlocks campaign={campaign} activations={activations} />
    </>
  );
}

/**
 * The eight numbered sections, shared by the standalone page and the drawer.
 *
 * Rendering is driven entirely by CampaignTabContext: with no provider every
 * Block renders, which is what the page and the Cap-coadă view want.
 */
export function CampaignBlocks({
  campaign,
  activations,
  onOpenActivation,
}: {
  campaign: CampaignDetail;
  activations: CampaignActivation[];
  /**
   * Opens one of the listed activations, when the host can stack a drawer.
   *
   * Optional because the same blocks render on the standalone page, where there
   * is nothing to stack onto.
   */
  onOpenActivation?: (externalKey: string) => void;
}) {
  const [preview, setPreview] = useState<{ src: string; caption: string } | null>(null);

  const months = (campaign.seasonalityMonths ?? []).map((month) => MONTHS[month - 1]).join(', ');
  /*
   * An umbrella campaign describes framework deliverables instead of shipping
   * visual templates, and this switches the whole of section 5 between the two.
   *
   * It counts entries with something in them, not entries. Counting rows made a
   * single blank one — which the editor used to leave behind on every save —
   * enough to reclassify a thematic campaign as an umbrella one, at which point
   * its mockups and their images stopped being rendered. The editor no longer
   * writes blank rows, but campaigns saved before that still carry them, and a
   * question about whether content exists should be answered by looking at the
   * content.
   */
  const hasFramework = (campaign.frameworkDeliverables ?? []).some(
    (item) => item.name?.trim() || item.content?.trim() || item.format?.trim(),
  );

  return (
    <>
      <div className="campaign-full-view">
        <Block number="0" tab="overview" title="Prezentare și identificare">
          <Section title="Identificare">
            <table className="table">
              <tbody>
                <tr>
                  <th>Tip</th>
                  <td>{campaign.type}</td>
                </tr>
                <tr>
                  <th>Campanie părinte</th>
                  <td>{campaign.parentCampaignId ?? 'Nu este cazul'}</td>
                </tr>
                <tr>
                  <th>Pilon</th>
                  <td>{campaign.pillar}</td>
                </tr>
                <tr>
                  <th>Tip sezonalitate</th>
                  <td>{campaign.seasonalityLabel}</td>
                </tr>
                <tr>
                  <th>Luni de relevanță</th>
                  <td>{months || '—'}</td>
                </tr>
                <tr>
                  <th>Observații sezonalitate</th>
                  <td>{campaign.seasonalityNote || '—'}</td>
                </tr>
                <tr>
                  <th>Stadiu</th>
                  <td>{campaign.status}</td>
                </tr>
                <tr>
                  <th>Responsabil</th>
                  <td>{campaign.responsible || '—'}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section title="Obiectiv de marketing">
            <p>{campaign.marketingObjective || 'De completat'}</p>
          </Section>
          <Section title="Rezultat direct urmărit">
            <p>{campaign.directResult || 'De completat'}</p>
          </Section>
          <Section title="Contribuție strategică">
            <BulletList values={campaign.strategicContribution} />
          </Section>
        </Block>

        <Block number="1" tab="strategy" title="Încadrare strategică">
          <Section title="Program principal">
            <p>{campaign.programPrimary ?? 'De completat'}</p>
          </Section>
          <Section title="Programe secundare">
            <BulletList values={campaign.programSecondary} />
          </Section>
          <Section title="Obiectiv SMART principal">
            <p>{campaign.objectivePrimary ?? 'De completat'}</p>
          </Section>
          <Section title="Obiective secundare">
            <BulletList values={campaign.objectiveSecondary} />
          </Section>
        </Block>

        <Block number="2" tab="concept" title="Public și concept">
          <Section title="Public principal">
            <p>
              <strong>{campaign.primaryAudienceSegment ?? ''}</strong>
              {campaign.primaryAudienceDescription &&
              campaign.primaryAudienceDescription !== campaign.primaryAudienceSegment ? (
                <>
                  <br />
                  {campaign.primaryAudienceDescription}
                </>
              ) : null}
            </p>
          </Section>
          <Section title="Publicuri secundare">
            <BulletList values={campaign.secondaryAudienceSegments} />
          </Section>
          <Section title="Insight și motivație">
            <p>{campaign.insight || 'De completat'}</p>
          </Section>
          <Section title="Propunerea de valoare">
            <p>{campaign.valueProposition || 'De completat'}</p>
          </Section>
          <Section title="Ideea centrală">
            <p>{campaign.centralIdea || 'De completat'}</p>
          </Section>
          <Section title="Promisiunea campaniei">
            <p>{campaign.promise || 'De completat'}</p>
          </Section>
          <Section title="Mesajul principal">
            <p>{campaign.mainMessage || 'De completat'}</p>
          </Section>
          <Section title="Mesaje secundare">
            <BulletList values={campaign.secondaryMessages} />
          </Section>
          <Section title="Direcții de storytelling">
            <BulletList values={campaign.storytellingDirections} />
          </Section>
          <Section title="Tonul comunicării">
            <p>{campaign.tone || 'De completat'}</p>
          </Section>
          <Section title="CTA-uri">
            <div className="badges">
              {campaign.ctas.length ? (
                campaign.ctas.map((cta) => (
                  <span className="badge season" key={cta}>
                    {cta}
                  </span>
                ))
              ) : (
                <span className="muted-copy">Nu există CTA-uri selectate.</span>
              )}
            </div>
          </Section>
        </Block>

        <Block number="3" tab="products" title="Produse, canale și măsurare">
          <Section title="Produse și experiențe promovate">
            <BulletList values={campaign.products} />
          </Section>
          {campaign.productCondition ? (
            <Section title="Condiții de utilizare">
              <div className="view-note">{campaign.productCondition}</div>
            </Section>
          ) : null}
          <Section title="Canale recomandate">
            <BulletList values={campaign.channels} />
          </Section>
          <Section title="PR și parteneriate">
            <p>{campaign.prPartnerships || 'De completat'}</p>
          </Section>
          <Section title="Indicatori și surse de date">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Indicator</th>
                    <th>Referință</th>
                    <th>Țintă</th>
                    <th>Sursă</th>
                  </tr>
                  {campaign.kpiDefinitions?.length ? (
                    campaign.kpiDefinitions.map((kpi, index) => (
                      <tr key={index}>
                        <td>{kpi.name}</td>
                        <td>{kpi.baseline}</td>
                        <td>{kpi.target}</td>
                        <td>{kpi.source}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>Nu există indicatori completați.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </Block>

        <Block number="4" tab="rules" title="Reguli de utilizare și adaptare">
          <Section title="Elemente fixe">
            <BulletList values={campaign.fixedElements} />
          </Section>
          <Section title="Elemente adaptabile">
            <BulletList values={campaign.adaptableElements} />
          </Section>
          <Section title="Limite de adaptare">
            <BulletList values={campaign.adaptationLimits} />
          </Section>
          <Section title="Exemple de aplicare">
            <div className="drawer-table-scroll">
              <table className="table wide">
                <tbody>
                  <tr>
                    <th>Context</th>
                    <th>Adaptare recomandată</th>
                    <th>Elemente fixe</th>
                  </tr>
                  {campaign.applicationExamples?.length ? (
                    campaign.applicationExamples.map((example, index) => (
                      <tr key={index}>
                        <td>{example.context}</td>
                        <td>{example.adaptation}</td>
                        <td>{example.fixed}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>Nu există exemple completate.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </Block>

        <Block number="5" tab="deliverables" title="Livrabile și template-uri">
          {hasFramework ? (
            <>
              <Section title="Livrabile de cadru">
                <p>{campaign.deliverableIntro}</p>
                <div className="drawer-table-scroll">
                  <table className="table wide">
                    <tbody>
                      <tr>
                        <th>Livrabil</th>
                        <th>Conținut orientativ</th>
                        <th>Format</th>
                      </tr>
                      {campaign.frameworkDeliverables.map((item, index) => (
                        <tr key={index}>
                          <td>{item.name}</td>
                          <td>{item.content}</td>
                          <td>{item.format}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <div className="no-visual-note">
                <b>Fără machete vizuale distincte</b>
                <span>{campaign.noVisualsNote}</span>
              </div>
            </>
          ) : (
            <>
              <Section title="Headline-uri și texte">
                <div className="drawer-table-scroll">
                  <table className="table wide">
                    <tbody>
                      <tr>
                        <th>Headline</th>
                        <th>Text suport</th>
                        <th>CTA</th>
                      </tr>
                      {campaign.headlines?.length ? (
                        campaign.headlines.map((item, index) => (
                          <tr key={index}>
                            <td>
                              <strong>{item.headline}</strong>
                            </td>
                            <td>{item.support}</td>
                            <td>{item.cta}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3}>Nu există exemple completate.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="Machete digitale editabile">
                <div className="mockup-list">
                  {campaign.mockups.length ? (
                    campaign.mockups.map((mockup, index) => (
                      <MockupCard
                        key={mockup.id}
                        mockup={mockup}
                        index={index}
                        accent={campaign.accent}
                        onPreview={setPreview}
                      />
                    ))
                  ) : (
                    <p className="muted-copy">Nu există machete configurate.</p>
                  )}
                </div>
              </Section>

              <Section title="Exemple de postări">
                {campaign.posts?.length ? (
                  <div className="post-examples">
                    {campaign.posts.map((post, index) => (
                      <article key={index}>
                        <small>Exemplu de postare</small>
                        <h4>{post.title.replace(/^Postarea\s*\d+\s*[–-]\s*/, '')}</h4>
                        <p>{post.body}</p>
                        <b>CTA: {post.cta}</b>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">Nu există exemple de postări.</p>
                )}
              </Section>

              <Section title="Concepte / scenarii video">
                <div className="drawer-table-scroll">
                  <table className="table wide">
                    <tbody>
                      <tr>
                        <th>Concept</th>
                        <th>Durată</th>
                        <th>Structură narativă</th>
                        <th>Închidere / CTA</th>
                      </tr>
                      {campaign.videoConcepts?.length ? (
                        campaign.videoConcepts.map((video, index) => (
                          <tr key={index}>
                            <td>
                              <strong>{video.name}</strong>
                            </td>
                            <td>{video.duration}</td>
                            <td>{video.narrative}</td>
                            <td>{video.closing}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4}>Nu există concepte video.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </Block>

        <Block number="6" tab="types" title="Exemple orientative de activări">
          <div className="view-note">
            <b>Direcții de lucru.</b> Pentru fiecare activare implementată se va completa ulterior o
            fișă distinctă în Planul anual, cu perioadă, buget, responsabilități, materiale, ținte și
            rezultate.
          </div>
          <div className="drawer-table-scroll">
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Denumire</th>
                  <th>Scop și public</th>
                  <th>Canale / materiale</th>
                  <th>Indicatori relevanți</th>
                </tr>
                {campaign.activationExamples?.directions?.length ? (
                  campaign.activationExamples.directions.map((direction, index) => (
                    <tr key={index}>
                      <td>
                        <strong>{direction.name}</strong>
                      </td>
                      <td>{direction.purpose}</td>
                      <td>{direction.channels}</td>
                      <td>{direction.metrics}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>Nu există tipuri orientative completate.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Block>

        <Block number="7" tab="acts" title="Activări create">
          <div className="drawer-table-scroll">
            <table className="table wide">
              <tbody>
                <tr>
                  <th>Denumire</th>
                  <th>Perioadă</th>
                  <th>Stadiu</th>
                  <th>Plan anual</th>
                  <th>Rezultate</th>
                </tr>
                {activations.length ? (
                  activations.map((activation) => (
                    <tr key={activation.id}>
                      <td>
                        {/* Clickable only where there is somewhere to open it.
                            The standalone page has no drawer stack, so there it
                            stays plain text rather than a button that would have
                            to navigate away. */}
                        {onOpenActivation ? (
                          <button
                            type="button"
                            className="activation-title-link"
                            onClick={() => onOpenActivation(activation.id)}
                          >
                            {activation.title}
                          </button>
                        ) : (
                          <strong>{activation.title}</strong>
                        )}
                      </td>
                      <td>
                        {activation.startDate ?? '—'} – {activation.endDate ?? '—'}
                      </td>
                      <td>{activation.status}</td>
                      <td>
                        {activation.includeAnnualPlan ? (
                          <span className="badge status">Plan anual</span>
                        ) : (
                          <span className="muted-copy">Nu</span>
                        )}
                      </td>
                      <td>{activation.hasResults ? 'Actualizate' : 'În așteptare'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>Nu există încă activări operaționale.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Block>
      </div>

      <Lightbox image={preview} onClose={() => setPreview(null)} />
    </>
  );
}
