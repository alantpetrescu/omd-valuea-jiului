/**
 * Read-only fiche for one reper, shown inline under its row.
 *
 * Inline rather than a modal, on purpose (SPEC §7.4): two fiches can be open at
 * once, which is the whole point when the question is "how does P5.3 differ from
 * P5.7". A modal answers one question at a time.
 *
 * It is also the only place all eleven fields of a programme are visible without
 * entering edit mode — reading a record should not require opening the form that
 * can change it.
 */
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { countLabel } from '../../domain/services';
import {
  FIELDS,
  type Kind,
  type ReperUsage,
  type StrategyRecord,
} from './StrategyReperForm';

function formatDate(value: string): string {
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function StrategyReperView({
  kind,
  versionKey,
  record,
  linkedObjectives,
  onClose,
}: {
  kind: Kind;
  versionKey: string;
  record: StrategyRecord;
  /** Objectives this programme points at, code and name. */
  linkedObjectives: Array<{ code: string; name: string }>;
  onClose: () => void;
}) {
  const [usage, setUsage] = useState<ReperUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ReperUsage>(
        `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(record.code)}/usage`,
      )
      .then((response) => {
        if (!cancelled) setUsage(response.data);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, versionKey, record.code]);

  const references = usage
    ? [...usage.business, ...usage.internal]
        .map((entry) =>
          countLabel(
            entry.count,
            entry.type === 'campanii'
              ? 'campanie'
              : entry.type === 'activări'
                ? 'activare'
                : 'program din matrice',
            entry.type === 'matrice programe' ? 'programe din matrice' : entry.type,
          ),
        )
        .join(' · ')
    : '';

  return (
    <div className="strategy-reper-view">
      <div className="strategy-reper-view-head">
        <div>
          <small className="entity-code">{record.code}</small>
          <strong>{String(record.name ?? record.label ?? '')}</strong>
        </div>
        <button type="button" className="x" onClick={onClose} aria-label="Închide fișa">
          ×
        </button>
      </div>

      {/* `detail-grid` from the lifted stylesheet, which expects `<section>`
          children with a heading and a paragraph — the same two-column fiche the
          prototype uses everywhere else. A `<dl>` would have needed a parallel
          set of rules for no gain. */}
      <div className="detail-grid">
        {FIELDS[kind].map((field) => {
          const value = String(record[field.key] ?? '').trim();
          return (
            <section key={field.key}>
              <h3>{field.label}</h3>
              <p>{value === '' ? <span className="muted-copy">—</span> : value}</p>
            </section>
          );
        })}

        {kind === 'programs' ? (
          <section>
            <h3>Obiective SMART asociate</h3>
            {linkedObjectives.length === 0 ? (
              <p>
                <span className="muted-copy">Niciunul</span>
              </p>
            ) : (
              <ul className="strategy-linked-objectives">
                {linkedObjectives.map((objective) => (
                  <li key={objective.code}>
                    <code>{objective.code}</code> {objective.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section>
          <h3>Stare</h3>
          <p>{record.isActive ? 'Activ' : 'Inactiv'}</p>
        </section>

        <section>
          <h3>Referințe</h3>
          <p>
            {usage === null ? (
              <span className="muted-copy">se verifică…</span>
            ) : references === '' ? (
              <span className="muted-copy">nefolosit</span>
            ) : (
              references
            )}
          </p>
        </section>

        {/* Only when it is true. An "Import: —" row on a hand-created reper
            would suggest the field means something it does not. */}
        {usage?.importedAt ? (
          <section>
            <h3>Adus prin import</h3>
            <p>{formatDate(usage.importedAt)}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
