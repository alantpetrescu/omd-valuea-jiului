/**
 * Campaign server state.
 *
 * component -> hook -> repository -> ApiClient -> API (spec section 9.2).
 * Nothing is cached in localStorage; the server is the source of truth.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type PageMeta } from '../../api/client';

export interface CampaignListItem {
  id: string;
  title: string;
  accent: string;
  type: string;
  pillar: string;
  pillarShort: string;
  statusCode: string;
  status: string;
  seasonalityLabel: string;
  seasonalityMonths: number[];
  mainMessage: string;
  marketingObjective: string;
  primaryAudienceDescription: string;
  primaryAudienceSegment: string | null;
  strategyVersion: string;
  strategyVersionLabel: string;
  activationExampleCount: number;
  templateCount: number;
}

export interface CatalogEntry {
  code: string;
  label: string;
  displayLabel: string | null;
  hint: string | null;
}

export interface Catalogs {
  campaign_types: CatalogEntry[];
  campaign_statuses: CatalogEntry[];
  audience_segments: CatalogEntry[];
  cta_types: CatalogEntry[];
  seasonality_types: CatalogEntry[];
  pillars: CatalogEntry[];
  programs: CatalogEntry[];
  objectives: CatalogEntry[];
  [key: string]: CatalogEntry[];
}

export interface CampaignFilters {
  q: string;
  type: string;
  pillar: string;
  status: string;
}

export const EMPTY_FILTERS: CampaignFilters = { q: '', type: '', pillar: '', status: '' };

export function useCampaigns(filters: CampaignFilters) {
  const [items, setItems] = useState<CampaignListItem[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.type) params.set('type', filters.type);
    if (filters.pillar) params.set('pillar', filters.pillar);
    if (filters.status) params.set('status', filters.status);
    params.set('pageSize', '200');

    try {
      const response = await api.get<CampaignListItem[]>(`/campaigns?${params.toString()}`);
      setItems(response.data);
      setMeta(response.meta ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Campaniile nu au putut fi încărcate.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.type, filters.pillar, filters.status]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = setTimeout(() => void load(), filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  return { items, meta, loading, error, reload: load };
}

/** Dropdown options come from the database, never hardcoded (rule 68.14). */
export function useCatalogs() {
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);

  useEffect(() => {
    api
      .get<Catalogs>('/catalogs')
      .then((response) => setCatalogs(response.data))
      .catch(() => setCatalogs(null));
  }, []);

  return catalogs;
}
