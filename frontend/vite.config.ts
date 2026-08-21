import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Which backend the dev server proxies to.
 *
 * Two implementations answer the same 53 routes — Node on 3000, the PHP port on
 * 8080 — and the only way to tell whether they really agree is to point the
 * same frontend at each in turn. Editing this file to switch would make that a
 * code change, and a code change is something you forget to undo.
 *
 *   pnpm dev                                                -> Node
 *   $env:API_TARGET='http://127.0.0.1:8080'; pnpm run dev   -> PHP
 */
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:3000';

/**
 * The URL path the built app is served from.
 *
 * `/` when it owns the domain root, `/app/` when it lives in a subdirectory —
 * which is the cPanel case, where the root already hosts other things. Vite
 * rewrites every asset URL with it, and `App.tsx` reads the same value back as
 * `import.meta.env.BASE_URL` for the router, so the two cannot disagree.
 *
 *   pnpm build                               -> served from /
 *   $env:APP_BASE_PATH='/app/'; pnpm build   -> served from /app/
 *
 * The trailing slash matters to Vite. It is added here rather than demanded of
 * whoever sets the variable.
 */
const rawBase = process.env.APP_BASE_PATH ?? '/';
const BASE_PATH = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

/**
 * Dev server proxies the API to the backend so the browser sees a single
 * origin — the same arrangement production uses behind a reverse proxy
 * (spec section 3.2). Session cookies therefore work without CORS.
 */
export default defineConfig({
  plugins: [react()],
  base: BASE_PATH,
  server: {
    port: 5173,

    /**
     * Pre-transform the route modules at start-up.
     *
     * Vite compiles on demand, so the first visit to a route pays for its whole
     * import chain. Listing the pages here moves that cost into `pnpm dev`,
     * where it is unattended, instead of into the first click. Development only
     * — the production build is a single pre-built bundle.
     */
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/app/App.tsx',
        './src/features/campaigns/CampaignsPage.tsx',
        './src/features/campaigns/CampaignDetailPage.tsx',
        './src/features/campaigns/CampaignWizard.tsx',
        './src/features/activations/ActivationsPage.tsx',
        './src/features/activations/ActivationDetailPage.tsx',
        './src/features/activations/ActivationEditor.tsx',
        './src/features/annual-plan/AnnualPlanPage.tsx',
        './src/features/monitoring/MonitoringActivationsPage.tsx',
        './src/features/monitoring/MonitoringReputationPage.tsx',
        './src/features/strategy/StrategyPage.tsx',
        './src/features/admin/AdminPage.tsx',
      ],
    },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/uploads': { target: API_TARGET, changeOrigin: true },
    },
  },
});
