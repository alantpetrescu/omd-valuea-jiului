/**
 * "Preia context dintr-o fișă existentă" — the prototype's `contextPanel()`.
 *
 * Six of the wizard's steps offer to seed themselves from an existing campaign:
 * you pick a source, read a summary of what would come across, and press
 * "Preia selecția". Nothing is copied until you do, and one press can be undone
 * — "Șterge ce a fost preluat" restores the section to how it looked *before the
 * first* import, not to the previous import, which is what the prototype's
 * `contextImports[kind].before` snapshot preserves.
 *
 * The prototype held every campaign in memory. Here the summary needs fields the
 * list projection does not carry, so the selected campaign's detail is fetched
 * on selection — hence the loading line the original had no need for.
 */
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import type { CampaignDetail } from './CampaignDetailPage';
import type { CampaignListItem } from './useCampaigns';

export type ContextSection =
  | 'public'
  | 'concept'
  | 'products'
  | 'rules'
  | 'deliverables'
  | 'activationExamples';

const SECTION_LABELS: Record<ContextSection, string> = {
  public: 'Publicuri, insight și valoare',
  concept: 'Concept și mesaje',
  products: 'Produse, canale și KPI-uri',
  rules: 'Reguli și exemple',
  deliverables: 'Livrabile și template-uri',
  activationExamples: 'Exemple de activări',
};

const cut = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Diacritic-insensitive match, as `OMD.u.norm` did. */
const norm = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const shortType = (type: string): string =>
  type.includes('umbrelă')
    ? 'Campanie-umbrelă'
    : type.includes('tactică')
      ? 'Campanie tactică'
      : 'Campanie tematică';

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <b>{label}</b>
      <span>{value || '—'}</span>
    </div>
  );
}

/** The prototype's `contextPreview()` — what each section would bring across. */
function Preview({
  section,
  source,
  isTactical,
}: {
  section: ContextSection;
  source: CampaignDetail;
  isTactical: boolean;
}) {
  if (section === 'public') {
    return (
      <>
        <PreviewLine
          label="Public principal"
          value={source.primaryAudienceSegment || source.primaryAudienceDescription}
        />
        <PreviewLine
          label="Publicuri secundare"
          value={`${(source.secondaryAudienceSegments ?? []).length} segmente`}
        />
        <PreviewLine label="Insight" value={cut(source.insight ?? '', 150)} />
        <PreviewLine label="Valoare" value={cut(source.valueProposition ?? '', 150)} />
      </>
    );
  }

  if (section === 'concept') {
    // A tactical campaign keeps its own core: the import brings the supporting
    // messages across but never overwrites the central idea or promise.
    return (
      <>
        <PreviewLine
          label={isTactical ? 'Se copiază' : 'Idee centrală'}
          value={
            isTactical
              ? 'Mesajele secundare, storytelling-ul, tonul și CTA-urile; nucleul tactic rămâne de formulat.'
              : cut(source.centralIdea ?? '', 150)
          }
        />
        <PreviewLine
          label="Promisiune"
          value={isTactical ? 'Nu se suprascrie automat' : cut(source.promise ?? '', 130)}
        />
        <PreviewLine
          label="Mesaje secundare"
          value={`${(source.secondaryMessages ?? []).length} mesaje`}
        />
        <PreviewLine label="CTA-uri" value={(source.ctas ?? []).join(', ')} />
      </>
    );
  }

  if (section === 'products') {
    return (
      <>
        <PreviewLine label="Produse" value={`${(source.products ?? []).length} selecții`} />
        <PreviewLine label="Canale" value={`${(source.channels ?? []).length} selecții`} />
        <PreviewLine
          label="KPI-uri"
          value={(source.kpiDefinitions ?? [])
            .map((kpi) => kpi.name)
            .filter(Boolean)
            .slice(0, 4)
            .join(' · ')}
        />
        <PreviewLine
          label="PR / parteneriate"
          value={cut(source.prPartnerships ?? '', 130)}
        />
      </>
    );
  }

  if (section === 'rules') {
    return (
      <>
        <PreviewLine
          label="Elemente fixe"
          value={
            isTactical
              ? 'Rămân legate de campania părinte'
              : `${(source.fixedElements ?? []).length} elemente`
          }
        />
        <PreviewLine
          label="Elemente adaptabile"
          value={`${(source.adaptableElements ?? []).length} selecții`}
        />
        <PreviewLine label="Limite" value={`${(source.adaptationLimits ?? []).length} reguli`} />
        <PreviewLine
          label="Exemple"
          value={`${(source.applicationExamples ?? []).length} exemple`}
        />
      </>
    );
  }

  if (section === 'deliverables') {
    const visuals = (source.mockups ?? [])
      .flatMap((mockup) =>
        (mockup.assets ?? []).map((asset) => ({
          src: asset.src,
          label: asset.label || mockup.name || 'Vizual',
        })),
      )
      .slice(0, 4);

    return (
      <>
        <PreviewLine label="Headline-uri" value={`${(source.headlines ?? []).length}`} />
        <PreviewLine
          label="Machete"
          value={(source.mockups ?? [])
            .map((mockup) => mockup.name)
            .filter(Boolean)
            .slice(0, 4)
            .join(' · ')}
        />
        <PreviewLine
          label="Vizualuri incluse"
          value={`${(source.mockups ?? []).reduce((sum, m) => sum + (m.assets?.length ?? 0), 0)}`}
        />
        <PreviewLine
          label="Conținut suplimentar"
          value={`${(source.posts ?? []).length} postări · ${(source.videoConcepts ?? []).length} video`}
        />
        {visuals.length > 0 ? (
          <div className="context-preview-visuals">
            {visuals.map((visual) => (
              <figure key={visual.src}>
                <img src={visual.src} alt={visual.label} />
                <figcaption>{visual.label}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </>
    );
  }

  const directions = source.activationExamples?.directions ?? [];
  return (
    <>
      <PreviewLine label="Exemple de activări" value={`${directions.length}`} />
      <PreviewLine
        label="Exemple"
        value={directions
          .map((direction) => direction.name)
          .filter(Boolean)
          .slice(0, 5)
          .join(' · ')}
      />
    </>
  );
}

export function ContextImportPanel({
  section,
  campaigns,
  isTactical,
  importedFrom,
  onApply,
  onClear,
}: {
  section: ContextSection;
  campaigns: CampaignListItem[];
  isTactical: boolean;
  /** Title of the campaign this section was last seeded from, if any. */
  importedFrom: string | null;
  onApply: (source: CampaignDetail) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const query = norm(search);
  const visible = query
    ? campaigns.filter((campaign) =>
        norm(
          [campaign.title, campaign.type, campaign.pillar, campaign.mainMessage].join(' '),
        ).includes(query),
      )
    : campaigns;

  // Keep the selection inside the filtered list, defaulting to its first entry.
  const selectedKey = visible.some((campaign) => campaign.id === sourceKey)
    ? sourceKey
    : (visible[0]?.id ?? '');

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<CampaignDetail>(`/campaigns/${encodeURIComponent(selectedKey)}`)
      .then((response) => {
        if (!cancelled) setDetail(response.data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  return (
    <div className="context-import">
      <div className="context-import-head">
        <div>
          <small>Preia context dintr-o fișă existentă</small>
          <strong>{SECTION_LABELS[section]}</strong>
          <span>
            Alege orice campanie din baza de date, verifică informațiile și decide ce preiei.
            Conținutul copiat rămâne editabil.
          </span>
        </div>
      </div>

      <div className="context-import-controls">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filtrează după nume, tip sau pilon"
        />
        <select
          aria-label="Fișa sursă"
          value={selectedKey}
          onChange={(event) => setSourceKey(event.target.value)}
        >
          {visible.length > 0 ? (
            visible.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.title} · {shortType(campaign.type)} ·{' '}
                {campaign.pillarShort || campaign.pillar}
              </option>
            ))
          ) : (
            <option value="">Nicio fișă disponibilă</option>
          )}
        </select>
        <button
          type="button"
          className="btn secondary"
          disabled={!detail || loading}
          onClick={() => detail && onApply(detail)}
        >
          Preia selecția
        </button>
      </div>

      <div className="context-import-preview">
        {loading ? (
          <div className="context-import-empty">Se încarcă fișa selectată…</div>
        ) : detail ? (
          <Preview section={section} source={detail} isTactical={isTactical} />
        ) : (
          <div className="context-import-empty">Nu există fișe disponibile pentru preluare.</div>
        )}
      </div>

      <div className="context-import-actions">
        <div className="context-import-state">
          {importedFrom ? (
            <>
              Conținut preluat din <strong>„{importedFrom}”</strong>. Poți alege altă fișă sau
              reveni la situația anterioară.
            </>
          ) : (
            'Nu a fost preluat încă niciun conținut în această secțiune.'
          )}
        </div>
        <div className="context-import-buttons">
          {importedFrom ? (
            <button type="button" className="btn ghost danger-text" onClick={onClear}>
              Șterge ce a fost preluat
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
