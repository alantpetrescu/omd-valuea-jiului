/**
 * The create / edit form for one strategic reper.
 *
 * One component for both, because they are the same form: the only difference
 * is whether the `Cod` field starts empty and editable, or filled and — usually
 * — locked. TASK-2 §2.3 asks for exactly that ("deschide același formular ca
 * editarea, cu câmpul Cod activ").
 *
 * Two rules the form must not soften:
 *
 *   - every column the type owns is sent on every save. `PUT` replaces what it
 *     names, so a field left out of `FIELDS` would be silently blanked. That is
 *     why the field lists live in one place and are used for both the inputs and
 *     the payload.
 *   - the code is never rewritten on its way to the server. No upper-casing, no
 *     substitutions: the convention belongs to the beneficiary's strategic
 *     matrix, and it is the key the importer matches on.
 */
import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { countLabel } from '../../domain/services';
import { naturalCompare } from '../../domain/sorting';

export type Kind = 'pillars' | 'programs' | 'objectives';

export interface StrategyRecord {
  code: string;
  label: string;
  isActive: number;
  usageCount: number;
  sortOrder: number;
  [field: string]: unknown;
}

export interface ReperUsage {
  canDelete: boolean;
  canEditCode: boolean;
  business: Array<{ type: string; count: number }>;
  internal: Array<{ type: string; count: number }>;
  importedAt: string | null;
}

export interface Field {
  key: string;
  label: string;
  control: 'input' | 'textarea';
  hint?: string;
  required?: boolean;
}

/**
 * Every column each kind owns, in the order the fiche reads.
 *
 * Shared with `StrategyReperView`, so the read-only fiche and the form can never
 * show a different set of fields.
 */
export const FIELDS: Record<Kind, Field[]> = {
  pillars: [
    { key: 'label', label: 'Denumire', control: 'input', required: true },
    { key: 'displayLabel', label: 'Etichetă scurtă', control: 'input', hint: 'Apare ca badge pe campanii' },
    { key: 'hint', label: 'Descriere', control: 'textarea' },
  ],
  programs: [
    { key: 'name', label: 'Denumire', control: 'input', required: true },
    { key: 'label', label: 'Etichetă scurtă', control: 'input' },
    { key: 'result', label: 'Rezultat urmărit', control: 'textarea' },
    { key: 'marketingObjective', label: 'Obiectiv de marketing', control: 'textarea' },
    { key: 'approach', label: 'Abordare', control: 'textarea' },
    { key: 'horizonResult', label: 'Rezultat pe orizontul strategiei', control: 'textarea' },
    { key: 'targetGroups', label: 'Grupuri-țintă din matrice', control: 'textarea' },
    { key: 'kpiText', label: 'KPI strategici', control: 'textarea' },
    { key: 'sources', label: 'Surse de date', control: 'textarea' },
    { key: 'annualActions', label: 'Acțiuni anuale', control: 'textarea' },
    { key: 'validationStatus', label: 'Stadiu de validare', control: 'input' },
  ],
  objectives: [
    { key: 'name', label: 'Obiectiv', control: 'textarea', required: true },
    { key: 'label', label: 'Etichetă scurtă', control: 'input' },
    { key: 'source', label: 'Sursă oficială', control: 'input' },
  ],
};

export const KIND_LABEL: Record<Kind, string> = {
  pillars: 'pilon',
  programs: 'program',
  objectives: 'obiectiv',
};

/** Plural noun as the API sends it → the singular Romanian needs for a count of 1. */
const SINGULARS: Record<string, string> = {
  campanii: 'campanie',
  activări: 'activare',
  'matrice programe': 'program din matrice',
};

/** Romanian date, for the "brought in by the import of …" explanation. */
function importDate(value: string): string {
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function StrategyReperForm({
  kind,
  versionKey,
  record,
  objectives,
  linkedObjectiveCodes,
  existingCodes,
  onSaved,
  onCancel,
}: {
  kind: Kind;
  versionKey: string;
  /** Null when creating. */
  record: StrategyRecord | null;
  /** All objectives of this version, for the programme matrix. */
  objectives: StrategyRecord[];
  linkedObjectiveCodes: string[];
  existingCodes: string[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const creating = record === null;

  const [code, setCode] = useState(record?.code ?? '');
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of FIELDS[kind]) initial[field.key] = String(record?.[field.key] ?? '');
    return initial;
  });
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>(linkedObjectiveCodes);
  const [usage, setUsage] = useState<ReperUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Whether the code may still be renamed is the server's call, not a guess we
   * can make from `usageCount`: it also depends on whether an import ever wrote
   * this row, which the list does not carry.
   */
  useEffect(() => {
    if (creating || !record) return;
    let cancelled = false;

    api
      .get<ReperUsage>(
        `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(record.code)}/usage`,
      )
      .then((response) => {
        if (!cancelled) setUsage(response.data);
      })
      .catch(() => {
        // Not fatal: without an answer the field stays locked, which is the safe
        // direction — a rename that should have been refused is worse than one
        // the user has to ask for again.
        if (!cancelled) setUsage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [creating, record, kind, versionKey]);

  const codeEditable = creating || usage?.canEditCode === true;

  const lockReason = useMemo(() => {
    if (creating || codeEditable) return null;
    if (usage === null) return 'Nu am putut verifica dacă acest cod mai poate fi schimbat.';

    // `countLabel`, not interpolation: the endpoint sends the plural noun, and
    // "folosit în 1 campanii" reads as a typo in the one case that matters most
    // — the single reference that is blocking the rename.
    const used = usage.business
      .map((entry) => countLabel(entry.count, SINGULARS[entry.type] ?? entry.type, entry.type))
      .join(', ');
    if (used !== '') return `folosit în ${used}`;
    if (usage.importedAt !== null) return `adus prin importul din ${importDate(usage.importedAt)}`;
    return 'codul nu mai poate fi schimbat';
  }, [creating, codeEditable, usage]);

  /*
   * The convention help from SPEC §3.2 — the codes already in this version, so
   * `D6.1` typed into a `P5.x` version is visible as odd. It never blocks: the
   * convention can legitimately change between strategic cycles.
   */
  const conventionHint = useMemo(() => {
    if (!creating || existingCodes.length === 0) return null;
    const sample = [...existingCodes].sort(naturalCompare).slice(0, 4);
    return `Convenția folosită în această versiune: ${sample.join(', ')}${
      existingCodes.length > sample.length ? ', …' : ''
    }`;
  }, [creating, existingCodes]);

  function toggleObjective(objectiveCode: string) {
    setSelectedObjectives((current) =>
      current.includes(objectiveCode)
        ? current.filter((entry) => entry !== objectiveCode)
        : // Appended, so the tick order becomes the matrix order (§4.4).
          [...current, objectiveCode],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = { ...draft };
    if (kind === 'programs') payload.objectiveCodes = selectedObjectives;

    try {
      if (creating) {
        payload.code = code;
        await api.post(`/strategy/${encodeURIComponent(versionKey)}/${kind}`, payload);
        onSaved(`${KIND_LABEL[kind]} „${code}” a fost creat.`);
      } else {
        if (codeEditable && code !== record.code) payload.newCode = code;
        await api.put(
          `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(record.code)}`,
          payload,
        );
        onSaved(`Reperul ${code} a fost actualizat.`);
      }
    } catch (caught) {
      // Kept open with the message in place: a form that closes on a duplicate
      // code throws away everything the user typed.
      setError(caught instanceof ApiError ? caught.message : 'Modificarea nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wizard-body strategy-form">
      <div className="strategy-form-head">
        <strong>
          {creating ? `${KIND_LABEL[kind]} nou` : `Editează ${KIND_LABEL[kind]}ul ${record.code}`}
        </strong>
      </div>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      <label className="form-field">
        <span className="form-label">
          Cod
          {conventionHint ? <small>{conventionHint}</small> : null}
          {lockReason ? <small>Codul nu poate fi schimbat: {lockReason}.</small> : null}
        </span>
        <input
          value={code}
          disabled={!codeEditable}
          onChange={(event) => setCode(event.target.value)}
          placeholder={creating ? 'ex. P5.9' : undefined}
        />
      </label>

      {FIELDS[kind].map((field) => (
        <label className="form-field" key={field.key}>
          <span className="form-label">
            {field.label}
            {field.hint ? <small>{field.hint}</small> : null}
          </span>
          {field.control === 'textarea' ? (
            <textarea
              rows={2}
              value={draft[field.key] ?? ''}
              onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
            />
          ) : (
            <input
              value={draft[field.key] ?? ''}
              onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
            />
          )}
        </label>
      ))}

      {kind === 'programs' ? (
        <div className="form-field">
          <span className="form-label">
            Obiective SMART asociate
            <small>
              Doar obiective din această versiune. Ordinea bifării devine ordinea din matrice.
            </small>
          </span>
          {objectives.length === 0 ? (
            <span className="muted-copy">Versiunea nu are încă obiective.</span>
          ) : (
            <div className="strategy-objective-picker">
              {objectives.map((objective) => (
                <label key={objective.code}>
                  <input
                    type="checkbox"
                    checked={selectedObjectives.includes(objective.code)}
                    onChange={() => toggleObjective(objective.code)}
                  />
                  <span>
                    <code>{objective.code}</code> {String(objective.name ?? objective.label ?? '')}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="wizard-actions">
        <button className="btn secondary" type="button" onClick={onCancel}>
          Renunță
        </button>
        <button className="btn primary" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? 'Se salvează…' : creating ? 'Creează' : 'Salvează'}
        </button>
      </div>
    </div>
  );
}
