/**
 * Campaign export — downloads the package the backend builds.
 *
 * The shape is not assembled here. `GET /campaigns/:key/export` returns a
 * complete `OMD_CAMPAIGNS_PACKAGE` v1.0 and validates it against the frozen
 * JSON Schema before answering, so the file that lands on disk is one the
 * importer accepts. Building it in the browser was not possible: the contract
 * needs the strategy version, all ten catalogues and per-campaign timestamps
 * the read API does not expose.
 *
 * Two variants, chosen by the caller:
 *
 *   embed  template visuals inline as base64 data URIs. Re-importable, ~1 MB.
 *   link   visuals as /uploads URLs. Small and readable, NOT importable.
 */
import { api } from '../../api/client';

export type VisualMode = 'embed' | 'link';

export interface ExportMeta {
  visuals: VisualMode;
  importable: boolean;
  contractValid: boolean;
  assetCount: number;
  missingAssets: string[];
  campaignKeys?: string[];
}

/** `campania-camp-002-2026-08-18.json`, or `...-link.json` for the light variant. */
function fileName(externalKey: string, visuals: VisualMode, when: Date): string {
  const stamp = [
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
  ].join('-');
  const safeKey = externalKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  const suffix = visuals === 'link' ? '-link' : '';
  return `campania-${safeKey}-${stamp}${suffix}.json`;
}

/**
 * Saves the file the browser was handed.
 *
 * The object URL is revoked on the next tick rather than immediately: Firefox
 * cancels an in-flight download if the URL dies before it starts.
 */
function save(text: string, name: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Fetches and downloads the package. Returns the server's report so the caller
 * can say what actually happened — how many campaigns travelled, and whether
 * any visual was missing from storage.
 *
 * Errors are left to propagate: the client throws a typed ApiError, and the
 * drawer already knows how to show one.
 */
export async function downloadCampaignPackage(
  externalKey: string,
  visuals: VisualMode = 'embed',
  now = new Date(),
): Promise<ExportMeta> {
  const response = await api.get<unknown>(
    `/campaigns/${encodeURIComponent(externalKey)}/export?visuals=${visuals}`,
  );

  save(`${JSON.stringify(response.data, null, 2)}\n`, fileName(externalKey, visuals, now));

  return (response.meta ?? {
    visuals,
    importable: visuals === 'embed',
    contractValid: true,
    assetCount: 0,
    missingAssets: [],
  }) as unknown as ExportMeta;
}
