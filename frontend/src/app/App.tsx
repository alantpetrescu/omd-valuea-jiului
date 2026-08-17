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
import { AppShell } from './AppShell';

function Placeholder({ title }: { title: string }) {
  return (
    <section className="about-intro">
      <h2>{title}</h2>
      <p>Acest modul va fi implementat într-o etapă următoare.</p>
    </section>
  );
}

function AuthenticatedRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/campaigns" element={<CampaignsPage />} />
        {/* `new` must precede `:externalKey` or it would be read as a key. */}
        <Route path="/campaigns/new" element={<CampaignWizard />} />
        <Route path="/campaigns/:externalKey/edit" element={<CampaignWizard />} />
        <Route path="/campaigns/:externalKey" element={<CampaignDetailPage />} />
        <Route path="/strategic" element={<Placeholder title="Repere strategice" />} />
        <Route path="/activations" element={<ActivationsPage />} />
        <Route path="/activations/new" element={<ActivationEditor />} />
        <Route path="/activations/:externalKey/edit" element={<ActivationEditor />} />
        <Route path="/activations/:externalKey" element={<ActivationDetailPage />} />
        <Route path="/annual" element={<Placeholder title="Plan anual" />} />
        <Route path="/monitoring-activations" element={<Placeholder title="Monitorizare activări" />} />
        <Route path="/monitoring-reputation" element={<Placeholder title="Monitorizare reputație" />} />
        <Route path="/about" element={<Placeholder title="Despre aplicație" />} />
        <Route path="/admin" element={<Placeholder title="Administrare" />} />
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
