/**
 * Confirmation for deleting a reper, showing what actually depends on it.
 *
 * Not `window.confirm` (TASK-2 §2.7). A native confirm can only ask "sure?",
 * which is the least useful question here: the answer depends entirely on
 * whether six campaigns point at this code, and on whether the rows in the
 * programme matrix are a use of the reper or part of it. Those are two different
 * lists, and the dialog shows them as two different lists.
 *
 * When deletion is blocked it does not simply refuse — it offers the action that
 * does work, deactivation, which keeps the reper resolvable for historical
 * campaigns while removing it from new ones.
 */
import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { countLabel } from '../../domain/services';
import { KIND_LABEL, type Kind, type ReperUsage, type StrategyRecord } from './StrategyReperForm';

/**
 * "4 campanii", "1 campanie", "34 de campanii".
 *
 * The server sends the plural noun with the count, since it has no reason to
 * know Romanian agreement; the singular is derived here from the four nouns this
 * endpoint actually returns.
 */
const SINGULARS: Record<string, string> = {
  campanii: 'campanie',
  activări: 'activare',
  'matrice programe': 'program din matrice',
};

function dependencyLabel(entry: { type: string; count: number }): string {
  const many = entry.type === 'matrice programe' ? 'programe din matrice' : entry.type;
  return countLabel(entry.count, SINGULARS[entry.type] ?? many, many);
}

export function DeleteReperDialog({
  kind,
  versionKey,
  record,
  onDeleted,
  onDeactivate,
  onClose,
}: {
  kind: Kind;
  versionKey: string;
  record: StrategyRecord;
  onDeleted: (message: string) => void;
  onDeactivate: () => void;
  onClose: () => void;
}) {
  const [usage, setUsage] = useState<ReperUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ReperUsage>(
        `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(record.code)}/usage`,
      )
      .then((response) => {
        if (!cancelled) setUsage(response.data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Dependențele nu au putut fi citite.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, versionKey, record.code]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(
        `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(record.code)}`,
      );
      onDeleted(`${KIND_LABEL[kind]} „${record.code}” a fost șters.`);
    } catch (caught) {
      /*
       * The server's own message, not a generic one. The preview above may be a
       * few seconds old, and when the delete is refused because a campaign
       * appeared in between, that is exactly what the user needs to read.
       */
      setError(caught instanceof ApiError ? caught.message : 'Ștergerea nu a putut fi făcută.');
      setBusy(false);
    }
  }

  const title = String(record.name ?? record.label ?? '');
  const canDelete = usage?.canDelete === true;

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Confirmare ștergere">
        <h3>
          Ștergi definitiv „{record.code}
          {title !== '' ? ` — ${title}` : ''}”?
        </h3>

        {error ? (
          <div className="state-note error" role="alert">
            {error}
          </div>
        ) : null}

        {usage === null ? (
          <p className="muted-copy">Se verifică dependențele…</p>
        ) : (
          <>
            <dl className="confirm-dependencies">
              <div>
                <dt>Utilizat în</dt>
                <dd>
                  {usage.business.length === 0
                    ? 'nimic'
                    : usage.business.map((entry) => dependencyLabel(entry)).join(', ')}
                  {usage.business.length > 0 ? <span className="confirm-blocker">blochează</span> : null}
                </dd>
              </div>
              <div>
                <dt>Apare în</dt>
                <dd>
                  {usage.internal.length === 0
                    ? 'nimic'
                    : usage.internal.map((entry) => dependencyLabel(entry)).join(', ')}
                </dd>
              </div>
            </dl>

            <p>
              {canDelete ? (
                <>
                  Reperul nu este folosit nicăieri. Ștergerea este definitivă, iar rândurile lui din
                  matricea programelor dispar odată cu el.
                </>
              ) : (
                <>
                  Reperul nu poate fi șters. Îl poți dezactiva: rămâne rezolvabil în campaniile
                  existente, dar nu mai poate fi ales în înregistrări noi.
                </>
              )}
            </p>
          </>
        )}

        <div className="wizard-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Renunță
          </button>
          {usage !== null && !canDelete ? (
            <button className="btn primary" type="button" onClick={onDeactivate}>
              Dezactivează
            </button>
          ) : null}
          {canDelete ? (
            <button className="btn danger-text" type="button" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Se șterge…' : 'Șterge definitiv'}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
