/**
 * Everything the parity suite needs to locate, in one place.
 *
 * Defaults assume the handoff package sits next to the repository, which is how
 * it arrives; override with environment variables when it does not.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const REPO = resolve(here, '../../..');

/** Root of the unpacked `programmer_full_package_FINAL` handoff. */
export const PKG = process.env.OMD_PACKAGE_DIR ?? resolve(REPO, '..', 'programmer_full_package_FINAL');

export const PROTOTYPE_HTML = resolve(PKG, '01_REFERENCE_FRONTEND/OMD-Valea-Jiului-prototip_external_json_v13_3.html');
export const IMPORTER_JS = resolve(PKG, '01_REFERENCE_FRONTEND/omd_import_packages_v1.js');
export const SEEDS = resolve(PKG, '04_DEMO_SEEDS');
export const CAMPAIGN_SEED = resolve(SEEDS, 'OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json');

export const WORK = process.env.OMD_PARITY_WORK ?? resolve(here, '.work');
export const SHOTS = resolve(WORK, 'shots');
export const PROTO_SERVE = resolve(WORK, 'prototype');
export const FIXTURE = resolve(WORK, 'fixture-strategy.json');

export const PROTO_PORT = Number(process.env.OMD_PROTO_PORT ?? 8811);

/**
 * The mock stands in for the backend, so it listens where `vite.config.ts`
 * already proxies `/api` — no second proxy configuration to keep in sync. The
 * real API must not be running on that port at the same time.
 */
export const MOCK_PORT = Number(process.env.OMD_MOCK_PORT ?? 3000);

export const APP_PORT = Number(process.env.OMD_APP_PORT ?? 5174);

export const PROTO_URL = `http://127.0.0.1:${PROTO_PORT}/index.html`;
export const APP_URL = process.env.OMD_APP_URL ?? `http://127.0.0.1:${APP_PORT}/strategic`;

/** Administrare → Strategie, where the strategic repere are edited (D-002). */
export const ADMIN_URL = process.env.OMD_ADMIN_URL ?? APP_URL.replace(/\/strategic$/, '/admin');

/**
 * Chromium is compared against itself, so the exact build does not matter —
 * only that both sides use the same one. `OMD_CHROMIUM` covers environments
 * where Playwright's own download is unavailable.
 */
export const CHROMIUM = process.env.OMD_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

/** Tall enough that `.content` never scrolls; the sticky topbar would clip it. */
export const VIEWPORT = { width: 1440, height: 5200 };

export const TAB_LABEL = {
  summary: 'Sinteză',
  programs: 'Programe și obiective',
  audiences: 'Publicuri și produse',
};
export const VIEW_LABEL = { matrix: 'Matrice', cards: 'Carduri', detail: 'Fișă' };
export const KIND_LABEL = {
  programs: 'Programe',
  objectives: 'Obiective SMART',
  audiences: 'Publicuri',
  products: 'Produse și experiențe',
};

export const STATIC_STATES = [
  ['summary', 'matrix'],
  ['summary', 'cards'],
  ['programs', 'matrix'],
  ['programs', 'cards'],
  ['programs', 'detail'],
  ['audiences', 'matrix'],
  ['audiences', 'cards'],
  ['audiences', 'detail'],
];

export const KIND_STATES = [
  ['programs', 'cards', 'objectives'],
  ['programs', 'matrix', 'objectives'],
  ['audiences', 'cards', 'products'],
  ['audiences', 'matrix', 'products'],
];

export const SCENARIOS = [
  { name: 'search-iarna', steps: [['tab', 'programs'], ['view', 'cards'], ['search', 'iarna']] },
  { name: 'search-outdoor-matrix', steps: [['tab', 'programs'], ['view', 'matrix'], ['search', 'outdoor']] },
  { name: 'search-audiences-familii', steps: [['tab', 'audiences'], ['view', 'cards'], ['search', 'familii']] },
  { name: 'search-diacritics', steps: [['tab', 'programs'], ['view', 'cards'], ['search', 'POZITIONARE']] },
  { name: 'search-no-results', steps: [['tab', 'programs'], ['view', 'cards'], ['search', 'zzzz']] },
  { name: 'detail-P5.7', steps: [['tab', 'programs'], ['view', 'detail'], ['select', 'program::P5.7']] },
  { name: 'detail-OS17', steps: [['tab', 'programs'], ['kind', 'objectives'], ['view', 'detail'], ['select', 'objective::os17']] },
  { name: 'detail-uncovered-audience', steps: [['tab', 'audiences'], ['view', 'detail'], ['select', 'audience::last']] },
  { name: 'jump-objective-gaps', steps: [['tab', 'summary'], ['view', 'cards'], ['jump', 'objectives']] },
  { name: 'card-opens-fiche', steps: [['tab', 'programs'], ['view', 'cards'], ['card', '1']] },
];

/** The region under comparison: what `.content` actually paints. */
export async function contentBox(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.content');
    const boxes = [...host.children].map((el) => el.getBoundingClientRect());
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    const rect = host.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(top),
      width: Math.round(rect.width),
      height: Math.round(bottom - top),
    };
  });
}

export const launchOptions = () => (CHROMIUM ? { executablePath: CHROMIUM } : {});
