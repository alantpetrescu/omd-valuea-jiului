/**
 * Routing and the authentication gate.
 *
 * Real URLs with SPA fallback (spec 42): /campaigns, /activations, ... Deep
 * links and refresh must work, which the dev server and the production web
 * server both handle by serving index.html.
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from '../features/auth/AuthContext';
import { LoginPage } from '../features/auth/LoginPage';
import { CampaignsPage } from '../features/campaigns/CampaignsPage';
import { CampaignDetailPage } from '../features/campaigns/CampaignDetailPage';
import { CampaignWizard } from '../features/campaigns/CampaignWizard';
import { ActivationsPage } from '../features/activations/ActivationsPage';
import { ActivationDetailPage } from '../features/activations/ActivationDetailPage';
import { ActivationEditor } from '../features/activations/ActivationEditor';
import { AnnualPlanPage } from '../features/annual-plan/AnnualPlanPage';
import { MonitoringActivationsPage } from '../features/monitoring/MonitoringActivationsPage';
import { MonitoringReputationPage } from '../features/monitoring/MonitoringReputationPage';
import { StrategyPage } from '../features/strategy/StrategyPage';
import { AdminPage } from '../features/admin/AdminPage';
import { AboutPage } from '../features/about/AboutPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { AppShell } from './AppShell';

function AuthenticatedRoutes() {
  const { user } = useAuth();

  // A temporary password must be replaced before the app is usable (spec 11.5).
  if (user?.mustChangePassword) {
    return (
      <AppShell>
        <ChangePasswordPage />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/campaigns" element={<CampaignsPage />} />
        {/* `new` must precede `:externalKey` or it would be read as a key. */}
        <Route path="/campaigns/new" element={<CampaignWizard />} />
        <Route path="/campaigns/:externalKey/edit" element={<CampaignWizard />} />
        <Route path="/campaigns/:externalKey" element={<CampaignDetailPage />} />
        <Route path="/strategic" element={<StrategyPage />} />
        <Route path="/activations" element={<ActivationsPage />} />
        <Route path="/activations/new" element={<ActivationEditor />} />
        <Route path="/activations/:externalKey/edit" element={<ActivationEditor />} />
        <Route path="/activations/:externalKey" element={<ActivationDetailPage />} />
        <Route path="/annual" element={<AnnualPlanPage />} />
        <Route path="/monitoring-activations" element={<MonitoringActivationsPage />} />
        <Route path="/monitoring-reputation" element={<MonitoringReputationPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/admin" element={<AdminPage />} />
        {/* After login the user lands in the operational area (spec 11.7). */}
        <Route path="*" element={<Navigate to="/campaigns" replace />} />
      </Routes>
    </AppShell>
  );
}

function Gate() {
  const { user, loading } = useAuth();

  if (loading) return <div className="boot-screen">Se încarcă…</div>;
  return user ? <AuthenticatedRoutes /> : <LoginPage />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
