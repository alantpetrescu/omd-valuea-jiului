/**
 * Delete control that respects the deletion policy.
 *
 * It asks the API what is allowed before offering anything, so the user is told
 * *why* something cannot be deleted and what to do instead, rather than being
 * shown a button that always fails.
 *
 * The backend re-checks on DELETE regardless — this preview can go stale
 * between rendering and clicking (spec 35.1.11).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../api/client';

interface Assessment {
  canDelete: boolean;
  canClose: boolean;
  dependencies: Array<{ type: string; count: number }>;
  reason: string | null;
}

const DEPENDENCY_LABELS: Record<string, string> = {
  ACTIVATION: 'activări',
  ANNUAL_PLAN: 'planuri anuale',
  CHILD_CAMPAIGN: 'campanii subordonate',
  SUCCESSOR_CAMPAIGN: 'campanii succesoare',
  TEMPLATE_USED_BY_MATERIAL: 'materiale care folosesc machetele',
  PERFORMANCE_SNAPSHOT: 'rezultate de monitorizare',
};

export function DeleteButton({
  resource,
  externalKey,
  label,
  redirectTo,
}: {
  resource: 'campaigns' | 'activations';
  externalKey: string;
  label: string;
  redirectTo: string;
}) {
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Assessment>(`/${resource}/${encodeURIComponent(externalKey)}/dependencies`)
      .then((response) => setAssessment(response.data))
      .catch(() => setAssessment(null));
  }, [resource, externalKey]);

  if (!assessment) return null;

  async function remove() {
    const confirmed = window.confirm(
      `Ștergi „${label}"? Înregistrarea dispare din liste, dar poate fi restaurată de un administrator.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await api.del(`/${resource}/${encodeURIComponent(externalKey)}`);
      navigate(redirectTo);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ștergerea nu a putut fi finalizată.');
      setBusy(false);
    }
  }

  if (!assessment.canDelete) {
    const summary = assessment.dependencies
      .map((d) => `${d.count} ${DEPENDENCY_LABELS[d.type] ?? d.type.toLowerCase()}`)
      .join(', ');

    return (
      <div className="delete-blocked" title={assessment.reason ?? undefined}>
        <span className="muted-copy">Nu se poate șterge — {summary}.</span>
        <small>Dacă activitatea s-a încheiat, schimbă stadiul în „Încheiată".</small>
      </div>
    );
  }

  return (
    <>
      <button className="btn ghost danger" type="button" disabled={busy} onClick={() => void remove()}>
        {busy ? 'Se șterge…' : 'Șterge'}
      </button>
      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
