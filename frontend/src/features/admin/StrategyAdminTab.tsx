/**
 * Administrare → Strategie.
 *
 * Versiuni strategice, piloni, programe și obiective SMART — the strategic
 * repere, which are NOT master catalogs: they are scoped to a strategy version,
 * they carry no `is_system` flag, and their codes are unique per version rather
 * than globally. That is why they sit in their own tab instead of joining the
 * ten nomenclatoare.
 *
 * Placement note: README_PROGRAMMER §5.1 and spec §11.8 put strategic editing on
 * the `Repere strategice` screen and state that the repere must not be
 * duplicated in Admin. This module is a deliberate departure, recorded as D-002
 * in KNOWN_DEVIATIONS.md — editing lives here and only here, so the operational
 * screen stays a read-only projection identical to the v13.3 prototype for
 * every role.
 *
 * Implements TASK-2: four row actions, an add button per list, the inline fiche,
 * column sorting, code editing where the API allows it, the programme ↔
 * objective matrix, the dependency-aware delete dialog, and version cloning.
 *
 * Two rules the UI must not soften, and one it now states more precisely:
 *
 *   - a used reper is deactivated, never deleted, so historical campaigns keep
 *     resolving (spec §35.1.4);
 *   - the code is the identity campaigns point at *and* the key the importer
 *     matches on, so it may only be renamed while nothing references it and no
 *     import has ever written it. The server decides that, per record; the form
 *     asks and shows the reason when the answer is no.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../../api/client';
import { countLabel } from '../../domain/services';
import { naturalCompare } from '../../domain/sorting';
import { DeleteReperDialog } from './DeleteReperDialog';
import {
  KIND_LABEL,
  StrategyReperForm,
  type Kind,
  type StrategyRecord,
} from './StrategyReperForm';
import { StrategyReperView } from './StrategyReperView';

interface StrategyVersion {
  id: string;
  label: string;
  status: string;
  periodStartYear: number;
  periodEndYear: number;
  notes: string | null;
  campaignCount: number;
  pillarCount: number;
  programCount: number;
  objectiveCount: number;
}

interface StrategyPayload {
  version: { id: string; label: string; status: string; periodEndYear: number };
  pillars: StrategyRecord[];
  programs: StrategyRecord[];
  objectives: StrategyRecord[];
  programObjectives: Array<{ programCode: string; objectiveCode: string }>;
}

const KINDS: Array<[Kind, string]> = [
  ['pillars', 'Piloni'],
  ['programs', 'Programe'],
  ['objectives', 'Obiective SMART'],
];

/*
 * Row actions, as Unicode characters rather than an icon library (SPEC §7.1).
 * Zero new dependencies, and the same visual weight as the rest of the app.
 *
 * Every one carries its name in `title` and `aria-label`: an icon without a name
 * is not a button, it is a guess.
 */
const ICONS = {
  view: '◉',
  edit: '✎',
  toggle: '⊘',
  remove: '🗑',
  activate: '▲',
} as const;

type SortColumn = 'code' | 'title' | 'usage' | 'state';
type SortState = { column: SortColumn; direction: 'asc' | 'desc' } | null;

/** The title of a record, whichever column its kind keeps it in. */
function titleOf(record: StrategyRecord): string {
  return String(record.name ?? record.label ?? '');
}

/**
 * Click once to sort ascending, twice for descending, a third time to fall back
 * to `sort_order` — the order the strategic matrix itself uses, which is the
 * only one that carries meaning from the source document.
 */
function nextSort(current: SortState, column: SortColumn): SortState {
  if (current === null || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
}

function SortableHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort?.column === column;
  const direction = active ? (sort.direction === 'asc' ? '▲' : '▼') : '';

  return (
    <th>
      <button
        type="button"
        className={active ? 'strategy-sort active' : 'strategy-sort'}
        onClick={() => onSort(column)}
        aria-label={`Sortează după ${label}`}
      >
        {label}
        <span aria-hidden="true">{direction}</span>
      </button>
    </th>
  );
}

export function StrategyAdminTab({
  onError,
  onNotice,
}: {
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [data, setData] = useState<StrategyPayload | null>(null);
  const [kind, setKind] = useState<Kind>('pillars');

  const [editing, setEditing] = useState<StrategyRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<StrategyRecord | null>(null);
  const [sort, setSort] = useState<SortState>(null);

  const [versionForm, setVersionForm] = useState<StrategyVersion | 'new' | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      const response = await api.get<StrategyVersion[]>('/strategy/versions');
      setVersions(response.data);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Versiunile nu au putut fi încărcate.');
    }
  }, [onError]);

  const loadContent = useCallback(
    async (version: string | null) => {
      try {
        const query = version ? `?version=${encodeURIComponent(version)}` : '';
        const response = await api.get<StrategyPayload>(`/strategy${query}`);
        setData(response.data);
      } catch (caught) {
        onError(caught instanceof ApiError ? caught.message : 'Strategia nu a putut fi încărcată.');
      }
    },
    [onError],
  );

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    void loadContent(selectedVersion);
  }, [selectedVersion, loadContent]);

  const rows = data ? ((data[kind] ?? []) as StrategyRecord[]) : [];
  const versionKey = data?.version.id ?? '';
  const objectives = data?.objectives ?? [];

  /*
   * Display order only. `sort_order` is never sent anywhere, so the `Repere
   * strategice` screen keeps the order of the strategic matrix whatever is
   * clicked here.
   */
  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      switch (sort.column) {
        case 'code':
          return factor * naturalCompare(a.code, b.code);
        case 'title':
          return factor * titleOf(a).localeCompare(titleOf(b), 'ro');
        case 'usage':
          // Numeric, not lexicographic: "10 campanii" belongs after "9".
          return factor * (a.usageCount - b.usageCount);
        case 'state':
          return factor * (a.isActive - b.isActive);
        default:
          return 0;
      }
    });
  }, [rows, sort]);

  const objectivesByProgram = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of data?.programObjectives ?? []) {
      map.set(link.programCode, [...(map.get(link.programCode) ?? []), link.objectiveCode]);
    }
    return map;
  }, [data]);

  const objectiveNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const objective of objectives) map.set(objective.code, titleOf(objective));
    return map;
  }, [objectives]);

  function closeForms() {
    setEditing(null);
    setCreating(false);
    setDeleting(null);
    onError(null);
  }

  async function afterWrite(message: string) {
    closeForms();
    onNotice(message);
    await loadContent(selectedVersion);
    await loadVersions();
  }

  async function toggleActive(record: StrategyRecord) {
    onError(null);
    try {
      await api.post(
        `/strategy/${encodeURIComponent(versionKey)}/${kind}/${encodeURIComponent(record.code)}/toggle-active`,
      );
      setDeleting(null);
      await loadContent(selectedVersion);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Starea nu a putut fi schimbată.');
    }
  }

  async function versionAction(action: 'activate' | 'archive', id: string) {
    onError(null);
    try {
      await api.post(`/strategy/versions/${encodeURIComponent(id)}/${action}`);
      onNotice(
        action === 'activate' ? `Versiunea ${id} este acum activă.` : `Versiunea ${id} a fost arhivată.`,
      );
      await loadVersions();
      await loadContent(selectedVersion);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Operația nu a putut fi făcută.');
    }
  }

  async function deleteVersion(version: StrategyVersion) {
    onError(null);
    try {
      await api.del(`/strategy/versions/${encodeURIComponent(version.id)}`);
      onNotice(`Versiunea ${version.id} a fost ștearsă.`);
      if (selectedVersion === version.id) setSelectedVersion(null);
      await loadVersions();
      await loadContent(null);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Versiunea nu a putut fi ștearsă.');
    }
  }

  return (
    <>
      <VersionsCard
        versions={versions}
        openVersionKey={versionKey}
        form={versionForm}
        onForm={setVersionForm}
        onSelect={(id) => {
          setSelectedVersion(id);
          closeForms();
          setOpened([]);
        }}
        onAction={versionAction}
        onDelete={deleteVersion}
        onSaved={async (message) => {
          setVersionForm(null);
          onNotice(message);
          await loadVersions();
        }}
        onError={onError}
      />

      <section className="activation-list-card">
        <div className="activation-list-count">
          <strong>{data ? `Repere · ${data.version.label}` : 'Repere'}</strong>
          <span>
            Codul poate fi schimbat doar cât reperul este nefolosit și neatins de import — este
            identitatea la care trimit campaniile și cheia după care importul recunoaște reperele. Un
            reper utilizat nu se șterge, ci se dezactivează: rămâne rezolvabil în istoric, dar nu mai
            poate fi ales în înregistrări noi.
          </span>
        </div>

        <div className="sub-toggle">
          {KINDS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={kind === id ? 'active' : ''}
              onClick={() => {
                setKind(id);
                closeForms();
                setOpened([]);
                setSort(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {creating || editing ? (
          <StrategyReperForm
            kind={kind}
            versionKey={versionKey}
            record={editing}
            objectives={objectives}
            linkedObjectiveCodes={editing ? objectivesByProgram.get(editing.code) ?? [] : []}
            existingCodes={rows.map((row) => row.code)}
            onSaved={(message) => void afterWrite(message)}
            onCancel={closeForms}
          />
        ) : null}

        <div className="activation-table-scroll">
          <table className="activation-list-table admin-narrow-table">
            <thead>
              <tr>
                <SortableHeader column="code" label="Cod" sort={sort} onSort={(c) => setSort(nextSort(sort, c))} />
                <SortableHeader column="title" label="Denumire" sort={sort} onSort={(c) => setSort(nextSort(sort, c))} />
                <SortableHeader column="usage" label="Utilizat în" sort={sort} onSort={(c) => setSort(nextSort(sort, c))} />
                <SortableHeader column="state" label="Stare" sort={sort} onSort={(c) => setSort(nextSort(sort, c))} />
                <th aria-label="Acțiuni" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isOpen = opened.includes(row.code);
                const blocked = row.usageCount > 0;

                return (
                  /* Two sibling rows per record — the row and its fiche — so the
                     key belongs on a Fragment, not on either <tr>. */
                  <Fragment key={row.code}>
                    <tr>
                      <td>
                        <code>{row.code}</code>
                      </td>
                      <td>
                        <strong>{titleOf(row)}</strong>
                        {kind === 'programs' && row.result ? <small>{String(row.result)}</small> : null}
                        {kind === 'objectives' && row.source ? <small>{String(row.source)}</small> : null}
                      </td>
                      <td>
                        {row.usageCount > 0 ? (
                          countLabel(row.usageCount, 'campanie', 'campanii')
                        ) : (
                          <span className="muted-copy">nefolosit</span>
                        )}
                      </td>
                      <td>
                        <span className={row.isActive ? 'badge status' : 'badge'}>
                          {row.isActive ? 'Activ' : 'Inactiv'}
                        </span>
                      </td>
                      <td>
                        <div className="strategy-row-actions">
                          <button
                            type="button"
                            className="activation-icon-btn"
                            title={isOpen ? 'Închide fișa' : 'Vizualizează'}
                            aria-label={`${isOpen ? 'Închide fișa' : 'Vizualizează'} ${row.code}`}
                            onClick={() =>
                              setOpened((current) =>
                                current.includes(row.code)
                                  ? current.filter((code) => code !== row.code)
                                  : [...current, row.code],
                              )
                            }
                          >
                            {ICONS.view}
                          </button>

                          <button
                            type="button"
                            className="activation-icon-btn"
                            title="Editează"
                            aria-label={`Editează ${row.code}`}
                            onClick={() => {
                              setCreating(false);
                              setEditing(row);
                              onError(null);
                            }}
                          >
                            {ICONS.edit}
                          </button>

                          <button
                            type="button"
                            className="activation-icon-btn"
                            title={row.isActive ? 'Dezactivează' : 'Activează'}
                            aria-label={`${row.isActive ? 'Dezactivează' : 'Activează'} ${row.code}`}
                            onClick={() => void toggleActive(row)}
                          >
                            {ICONS.toggle}
                          </button>

                          {/* Visible even when it cannot succeed. A button that
                              disappears reads as a missing feature; one that is
                              disabled with the reason in its tooltip says why. */}
                          <button
                            type="button"
                            className="activation-icon-btn danger"
                            disabled={blocked}
                            title={
                              blocked
                                ? `Nu se poate șterge: folosit în ${countLabel(row.usageCount, 'campanie', 'campanii')}. Dezactivează-l.`
                                : 'Șterge'
                            }
                            aria-label={
                              blocked
                                ? `Ștergere indisponibilă pentru ${row.code}: folosit în ${countLabel(row.usageCount, 'campanie', 'campanii')}`
                                : `Șterge ${row.code}`
                            }
                            onClick={() => setDeleting(row)}
                          >
                            {ICONS.remove}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isOpen ? (
                      <tr className="strategy-view-row">
                        <td colSpan={5}>
                          <StrategyReperView
                            kind={kind}
                            versionKey={versionKey}
                            record={row}
                            linkedObjectives={(objectivesByProgram.get(row.code) ?? []).map((code) => ({
                              code,
                              name: objectiveNames.get(code) ?? '',
                            }))}
                            onClose={() =>
                              setOpened((current) => current.filter((code) => code !== row.code))
                            }
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <span className="muted-copy">Versiunea nu are încă repere de acest tip.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Under the list it extends, not up in the filters: the button belongs
            to the thing it adds to. */}
        <div className="strategy-add-row">
          <button
            className="btn secondary"
            type="button"
            disabled={versionKey === ''}
            onClick={() => {
              setEditing(null);
              setCreating(true);
              onError(null);
            }}
          >
            ＋ Adaugă {KIND_LABEL[kind]}
          </button>
        </div>
      </section>

      {deleting ? (
        <DeleteReperDialog
          kind={kind}
          versionKey={versionKey}
          record={deleting}
          onDeleted={(message) => void afterWrite(message)}
          onDeactivate={() => void toggleActive(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- Versiuni */

function VersionsCard({
  versions,
  openVersionKey,
  form,
  onForm,
  onSelect,
  onAction,
  onDelete,
  onSaved,
  onError,
}: {
  versions: StrategyVersion[];
  openVersionKey: string;
  form: StrategyVersion | 'new' | null;
  onForm: (value: StrategyVersion | 'new' | null) => void;
  onSelect: (id: string) => void;
  onAction: (action: 'activate' | 'archive', id: string) => void;
  onDelete: (version: StrategyVersion) => void;
  onSaved: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <section className="activation-list-card">
      <div className="activation-list-count">
        <strong>{versions.length} versiuni strategice</strong>
        <span>
          Codurile sunt unice per versiune: același cod poate însemna altceva într-un ciclu strategic
          următor, iar campaniile istorice își păstrează contextul. O corecție de text se face în
          aceeași versiune; o schimbare de sens cere o versiune nouă.
        </span>
      </div>

      {form !== null ? (
        <VersionForm
          version={form === 'new' ? null : form}
          versions={versions}
          onSaved={onSaved}
          onCancel={() => onForm(null)}
          onError={onError}
        />
      ) : null}

      <div className="activation-table-scroll">
        <table className="activation-list-table admin-narrow-table">
          <thead>
            <tr>
              <th>Versiune</th>
              <th>Denumire</th>
              <th>Perioadă</th>
              <th>Stare</th>
              <th>Campanii</th>
              <th>Piloni / programe / obiective</th>
              <th aria-label="Acțiuni" />
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => {
              const isActive = version.status === 'ACTIVE';
              const blocked = version.campaignCount > 0 || version.status !== 'DRAFT';

              return (
                <tr key={version.id}>
                  <td>
                    <code>{version.id}</code>
                  </td>
                  <td>
                    <strong>{version.label}</strong>
                  </td>
                  <td>{`${version.periodStartYear}–${version.periodEndYear}`}</td>
                  <td>
                    <span className={isActive ? 'badge status' : 'badge'}>{version.status}</span>
                  </td>
                  <td>{version.campaignCount}</td>
                  <td>{`${version.pillarCount} / ${version.programCount} / ${version.objectiveCount}`}</td>
                  <td>
                    <div className="strategy-row-actions">
                      <button
                        type="button"
                        className="activation-icon-btn"
                        title={version.id === openVersionKey ? 'Reperele sunt deschise' : 'Vizualizează reperele'}
                        aria-label={`Deschide reperele versiunii ${version.id}`}
                        onClick={() => onSelect(version.id)}
                      >
                        {ICONS.view}
                      </button>

                      <button
                        type="button"
                        className="activation-icon-btn"
                        title="Editează versiunea"
                        aria-label={`Editează versiunea ${version.id}`}
                        onClick={() => onForm(version)}
                      >
                        {ICONS.edit}
                      </button>

                      <button
                        type="button"
                        className="activation-icon-btn"
                        disabled={isActive}
                        title={
                          isActive
                            ? 'Versiunea activă nu se arhivează. Activează altă versiune, iar aceasta se arhivează automat.'
                            : 'Arhivează versiunea'
                        }
                        aria-label={`Arhivează versiunea ${version.id}`}
                        onClick={() => onAction('archive', version.id)}
                      >
                        {ICONS.toggle}
                      </button>

                      <button
                        type="button"
                        className="activation-icon-btn danger"
                        disabled={blocked}
                        title={
                          version.campaignCount > 0
                            ? `Nu se poate șterge: ${countLabel(version.campaignCount, 'campanie o folosește', 'campanii o folosesc')}.`
                            : version.status !== 'DRAFT'
                              ? 'Doar o versiune în lucru (DRAFT) poate fi ștearsă.'
                              : 'Șterge versiunea și reperele ei'
                        }
                        aria-label={`Șterge versiunea ${version.id}`}
                        onClick={() => onDelete(version)}
                      >
                        {ICONS.remove}
                      </button>

                      {/* The fifth button, only where it means anything. */}
                      {!isActive ? (
                        <button
                          type="button"
                          className="activation-icon-btn"
                          title="Activează versiunea"
                          aria-label={`Activează versiunea ${version.id}`}
                          onClick={() => onAction('activate', version.id)}
                        >
                          {ICONS.activate}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="strategy-add-row">
        <button className="btn secondary" type="button" onClick={() => onForm('new')}>
          ＋ Versiune nouă
        </button>
      </div>
    </section>
  );
}

function VersionForm({
  version,
  versions,
  onSaved,
  onCancel,
  onError,
}: {
  version: StrategyVersion | null;
  versions: StrategyVersion[];
  onSaved: (message: string) => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const creating = version === null;
  const currentYear = new Date().getFullYear();

  const [draft, setDraft] = useState({
    externalKey: version?.id ?? '',
    label: version?.label ?? '',
    periodStartYear: version?.periodStartYear ?? currentYear,
    periodEndYear: version?.periodEndYear ?? currentYear + 2,
    notes: version?.notes ?? '',
  });
  const [cloneFrom, setCloneFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = versions.find((entry) => entry.id === cloneFrom) ?? null;

  async function save() {
    setSaving(true);
    setError(null);
    onError(null);

    const payload = {
      ...draft,
      periodStartYear: Number(draft.periodStartYear),
      periodEndYear: Number(draft.periodEndYear),
    };

    try {
      if (creating) {
        await api.post('/strategy/versions', cloneFrom === '' ? payload : { ...payload, cloneFromExternalKey: cloneFrom });
        onSaved(
          cloneFrom === ''
            ? `Versiunea ${draft.externalKey} a fost creată.`
            : `Versiunea ${draft.externalKey} a fost creată prin copierea reperelor din ${cloneFrom}.`,
        );
      } else {
        await api.put(`/strategy/versions/${encodeURIComponent(version.id)}`, payload);
        onSaved(`Versiunea ${version.id} a fost actualizată.`);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Versiunea nu a putut fi salvată.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wizard-body strategy-form">
      <div className="strategy-form-head">
        <strong>{creating ? 'Versiune strategică nouă' : `Editează versiunea ${version.id}`}</strong>
      </div>

      {error ? (
        <div className="state-note error" role="alert">
          {error}
        </div>
      ) : null}

      <label className="form-field">
        <span className="form-label">
          Cheie
          <small>
            {creating
              ? 'Identificator stabil, ex. strategy-2029-2033'
              : 'Nu se schimbă: este cheia după care importul recunoaște versiunea.'}
          </small>
        </span>
        <input
          value={draft.externalKey}
          disabled={!creating}
          onChange={(event) => setDraft({ ...draft, externalKey: event.target.value })}
        />
      </label>

      <label className="form-field">
        <span className="form-label">Denumire</span>
        <input
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        />
      </label>

      <label className="form-field">
        <span className="form-label">Primul an</span>
        <input
          type="number"
          value={draft.periodStartYear}
          onChange={(event) => setDraft({ ...draft, periodStartYear: Number(event.target.value) })}
        />
      </label>

      <label className="form-field">
        <span className="form-label">Ultimul an</span>
        <input
          type="number"
          value={draft.periodEndYear}
          onChange={(event) => setDraft({ ...draft, periodEndYear: Number(event.target.value) })}
        />
      </label>

      <label className="form-field">
        <span className="form-label">Note</span>
        <textarea
          rows={2}
          value={draft.notes ?? ''}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </label>

      {/* Only on creation: cloning into a version that already has repere would
          mean merging two matrices, which is not a thing the spec defines. */}
      {creating ? (
        <label className="form-field">
          <span className="form-label">
            Repere
            <small>Un ciclu strategic nou pornește de obicei din cel precedent.</small>
          </span>
          <select value={cloneFrom} onChange={(event) => setCloneFrom(event.target.value)}>
            <option value="">Pornesc de la zero</option>
            {versions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                Copiez reperele din {entry.label}
              </option>
            ))}
          </select>
          {source ? (
            <small className="strategy-clone-preview">
              Se copiază {source.pillarCount} piloni, {source.programCount} programe,{' '}
              {source.objectiveCount} obiective și relațiile dintre ele. Campaniile și activările nu
              se copiază.
            </small>
          ) : null}
        </label>
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
