/**
 * Latest measured numbers per material, for one activation.
 *
 * The fiche's "Rezultate pe postare și canal" table needs the same rows the
 * Monitorizare screen shows, narrowed to one activation. The endpoint already
 * accepts `activation=`; this just asks for it and keys the answer by material
 * so the table can look each one up.
 *
 * `refresh()` is what the "Actualizează rezultate social" button calls. It
 * re-reads; it never writes. The prototype's version of that button invents
 * metrics, which is fine for a demo and would be fabricated measurement here.
 */
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api/client';
import type { MaterialResult } from './ActivationSummary';

interface SnapshotRow {
  materialId: string;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  spend: number | null;
}

export function useMaterialResults(activationKey: string) {
  const [results, setResults] = useState<Map<string, MaterialResult>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activationKey) return;
    setRefreshing(true);
    try {
      const response = await api.get<SnapshotRow[]>(
        `/monitoring/activations/latest?activation=${encodeURIComponent(activationKey)}&pageSize=200`,
      );
      setResults(new Map(response.data.map((row) => [row.materialId, row])));
    } catch {
      // The fiche stays usable without numbers; every cell falls back to an em
      // dash, which is also what "not supplied" looks like.
      setResults(new Map());
    } finally {
      setRefreshing(false);
    }
  }, [activationKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { results, refreshing, refresh: load };
}
