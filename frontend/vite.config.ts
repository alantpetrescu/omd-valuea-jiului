import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server proxies the API to the backend so the browser sees a single
 * origin — the same arrangement production uses behind a reverse proxy
 * (spec section 3.2). Session cookies therefore work without CORS.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,

    /**
     * Pre-transform the route modules at start-up.
     *
     * Vite compiles on demand, so the first visit to a route pays for its whole
     * import chain. Listing the pages here moves that cost into `npm run dev`,
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
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
});
