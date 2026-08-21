/**
 * Activation server state.
 *
 * Filtering happens server-side so the screen never assumes it holds every row
 * (spec 16.1). The unfiltered total travels in `meta` so the counter can show
 * "N din M".
 */
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type PageMeta } from '../../api/client';

export interface ActivationListItem {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  statusCode: string;
  status: string;
  responsible: string;
  plannedBudget: number | null;
  actualSpend: number | null;
  implementationMode: string | null;
  campaignId: string | null;
  campaignTitle: string | null;
  campaignType: string | null;
  campaignPillar: string | null;
  activationPillar: string | null;
  materialCount: number;
  materialConfiguredCount: number;
  materialsWithoutPublicUrl: number;
  lastResultsAt: string | null;
  includeAnnualPlan: number;
  fundingTotal: number;
}

export interface ActivationStats {
  total: number;
  draft: number;
  active: number;
  closed: number;
  plannedBudget: number;
  actualSpend: number;
  needResults: number;
}

export interface ActivationFilters {
  q: string;
  campaign: string;
  status: string;
  period: string;
  annualPlan: string;
  needsResults: boolean;
  unpublished: boolean;
}

export const EMPTY_ACTIVATION_FILTERS: ActivationFilters = {
  q: '',
  campaign: '',
  status: '',
  period: '',
  annualPlan: '',
  needsResults: false,
  unpublished: false,
};

export function useActivations(filters: ActivationFilters) {
  const [items, setItems] = useState<ActivationListItem[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (options?: { quiet?: boolean }) => {
    /*
     * A quiet reload leaves the table on screen.
     *
     * `loading` unmounts the list in favour of "Se încarcă activările…", which
     * is right on arrival and wrong when one row asks for fresh numbers: the
     * reader loses their place, and the row action loses the button it was
     * showing progress on. So the caller says which kind of reload this is.
     */
    if (!options?.quiet) setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.campaign) params.set('campaign', filters.campaign);
    if (filters.status) params.set('status', filters.status);
    if (filters.period) params.set('period', filters.period);
    if (filters.annualPlan) params.set('annualPlan', filters.annualPlan);
    if (filters.needsResults) params.set('needsResults', 'true');
    if (filters.unpublished) params.set('unpublished', 'true');
    params.set('pageSize', '200');

    try {
      const response = await api.get<ActivationListItem[]>(`/activations?${params.toString()}`);
      setItems(response.data);
      setMeta(response.meta ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Activările nu au putut fi încărcate.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.q,
    filters.campaign,
    filters.status,
    filters.period,
    filters.annualPlan,
    filters.needsResults,
    filters.unpublished,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  return { items, meta, loading, error, reload: load };
}

/** Headline figures, computed over all activations rather than the page. */
export function useActivationStats() {
  const [stats, setStats] = useState<ActivationStats | null>(null);

  useEffect(() => {
    api
      .get<ActivationStats>('/activations/stats')
      .then((response) => setStats(response.data))
      .catch(() => setStats(null));
  }, []);

  return stats;
}
