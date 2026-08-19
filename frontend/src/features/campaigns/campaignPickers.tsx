/**
 * The campaign wizard's composite controls, ported from the prototype's
 * `form.js` helpers: `programUI()`, `objectiveUI()`, `audienceUI()`, `ctaUI()`,
 * `multiPicker()` and the seven `.edit-table` editors.
 *
 * Split out of CampaignWizard so the wizard file stays about the eight steps
 * rather than about widget mechanics. Markup and class names are the
 * prototype's, so the lifted stylesheet applies unchanged.
 *
 * One deliberate difference: the prototype made every option draggable as well
 * as clickable — its own labels read "click / drag". Dragging is a second route
 * to the same two actions (choose, remove), so these are click-only and no
 * capability is lost. The labels say "click" rather than promising a gesture
 * that is not implemented.
 */
import { useState } from 'react';

import type { CatalogEntry } from './useCampaigns';

const labelFor = (options: CatalogEntry[], code: string): string => {
  const found = options.find((entry) => entry.code === code);
  return found?.displayLabel ?? found?.label ?? code;
};

/**
 * Programs and objectives are shown code-first — "P5.1 – Programul pentru
 * Ecosistemul Digital Integrat al Destinației".
 *
 * The catalogue already stores that combined string in `label`, while
 * `displayLabel` carries `name`, the bare title. `labelFor` above prefers
 * `displayLabel` and so drops the code, which is right for audiences and CTAs
 * but wrong for strategic references, where the code is how people cite them.
 */
const codedLabel = (entry: CatalogEntry): string => entry.label || entry.displayLabel || entry.code;

const codedLabelFor = (options: CatalogEntry[], code: string): string => {
  const found = options.find((entry) => entry.code === code);
  return found ? codedLabel(found) : code;
};

/** Diacritic-insensitive compare, as the prototype's `OMD.u.norm` did. */
const norm = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Catalogue on the left, one primary slot and a capped secondary list on the
 * right — the prototype's `programUI()`.
 *
 * Clicking an option promotes it: into the empty primary slot first, then into
 * secondary until the cap. Clicking a chosen chip removes it.
 */
export function ChipPicker({
  options,
  primary,
  secondary,
  max,
  title,
  primaryTitle,
  secondaryTitle,
  onChange,
}: {
  options: CatalogEntry[];
  primary: string;
  secondary: string[];
  max: number;
  title: string;
  primaryTitle: string;
  secondaryTitle: string;
  onChange: (primary: string, secondary: string[]) => void;
}) {
  const pick = (code: string) => {
    if (code === primary) return onChange('', secondary);
    if (secondary.includes(code)) return onChange(primary, secondary.filter((c) => c !== code));
    if (!primary) return onChange(code, secondary);
    if (secondary.length < max) return onChange(primary, [...secondary, code]);
    return undefined;
  };

  return (
    <div className="picker">
      <div className="pickbox">
        <div className="picktitle">
          <span>{title}</span>
          <span>click</span>
        </div>
        <div className="chips">
          {options.map((entry) => (
            <button
              key={entry.code}
              type="button"
              className={
                entry.code === primary || secondary.includes(entry.code) ? 'chip selected' : 'chip'
              }
              onClick={() => pick(entry.code)}
            >
              {codedLabel(entry)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="pickbox drop-program">
          <div className="picktitle">
            <span>{primaryTitle}</span>
            <span>max. 1</span>
          </div>
          {primary ? (
            <button type="button" className="chip selected" onClick={() => onChange('', secondary)}>
              {codedLabelFor(options, primary)} ×
            </button>
          ) : (
            <div className="drop">Apasă pe o opțiune din stânga.</div>
          )}
        </div>

        <div className="pickbox drop-program" style={{ marginTop: 9 }}>
          <div className="picktitle">
            <span>{secondaryTitle}</span>
            <span>max. {max}</span>
          </div>
          <div className="chips">
            {secondary.length > 0 ? (
              secondary.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="chip selected"
                  onClick={() => onChange(primary, secondary.filter((c) => c !== code))}
                >
                  {codedLabelFor(options, code)} ×
                </button>
              ))
            ) : (
              <div className="drop">Opțional.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The prototype's `objectiveUI()`: same shape as ChipPicker, plus a filter. */
export function ObjectivePicker({
  options,
  primary,
  secondary,
  onChange,
}: {
  options: CatalogEntry[];
  primary: string;
  secondary: string[];
  onChange: (primary: string, secondary: string[]) => void;
}) {
  const [search, setSearch] = useState('');

  const query = norm(search);
  const visible = query
    ? options.filter((entry) => norm(`${entry.label} ${entry.displayLabel ?? ''}`).includes(query))
    : options;

  const pick = (code: string) => {
    if (code === primary) return onChange('', secondary);
    if (secondary.includes(code)) return onChange(primary, secondary.filter((c) => c !== code));
    if (!primary) return onChange(code, secondary);
    if (secondary.length < 2) return onChange(primary, [...secondary, code]);
    return undefined;
  };

  return (
    <div className="picker">
      <div className="pickbox">
        <div className="picktitle">
          <span>Obiective disponibile</span>
          <span>click</span>
        </div>
        <input
          className="search-small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Caută OS sau cuvânt-cheie"
        />
        <div className="objective-list">
          {visible.map((entry) => {
            const chosen = entry.code === primary || secondary.includes(entry.code);
            return (
              <button
                key={entry.code}
                type="button"
                // The prototype gave this list no selected state, so a chosen
                // objective looked identical to an unchosen one. See app.css.
                className={chosen ? 'objective selected' : 'objective'}
                aria-pressed={chosen}
                onClick={() => pick(entry.code)}
              >
                {codedLabel(entry)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="pickbox drop-objective">
          <div className="picktitle">
            <span>Obiectiv principal</span>
            <span>max. 1</span>
          </div>
          {primary ? (
            <div className="selected-objective primary">
              <span>{codedLabelFor(options, primary)}</span>
              <button type="button" className="remove" onClick={() => onChange('', secondary)}>
                ×
              </button>
            </div>
          ) : (
            <div className="drop">Apasă pe un obiectiv.</div>
          )}
        </div>

        <div className="pickbox drop-objective" style={{ marginTop: 9 }}>
          <div className="picktitle">
            <span>Obiective secundare</span>
            <span>max. 2</span>
          </div>
          {secondary.length > 0 ? (
            secondary.map((code) => (
              <div key={code} className="selected-objective">
                <span>{codedLabelFor(options, code)}</span>
                <button
                  type="button"
                  className="remove"
                  onClick={() => onChange(primary, secondary.filter((c) => c !== code))}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <div className="drop">Opțional.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The prototype's `audienceUI()`. */
export function AudiencePicker({
  options,
  primary,
  secondary,
  onChange,
}: {
  options: CatalogEntry[];
  primary: string;
  secondary: string[];
  onChange: (primary: string, secondary: string[]) => void;
}) {
  const pick = (code: string) => {
    if (code === primary) return onChange('', secondary);
    if (secondary.includes(code)) return onChange(primary, secondary.filter((c) => c !== code));
    if (!primary) return onChange(code, secondary);
    if (secondary.length < 6) return onChange(primary, [...secondary, code]);
    return undefined;
  };

  return (
    <div className="audience-picker">
      <div className="pickbox">
        <div className="picktitle">
          <span>Segmente disponibile</span>
          <span>click</span>
        </div>
        <div className="audience-list">
          {options.map((entry) => (
            <button
              key={entry.code}
              type="button"
              className={
                entry.code === primary || secondary.includes(entry.code)
                  ? 'audience-option selected'
                  : 'audience-option'
              }
              onClick={() => pick(entry.code)}
            >
              <strong>{entry.displayLabel ?? entry.label}</strong>
              <span>{entry.hint ?? ''}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="pickbox drop-audience">
          <div className="picktitle">
            <span>Public principal</span>
            <span>max. 1</span>
          </div>
          {primary ? (
            <button
              type="button"
              className="audience-selected primary"
              onClick={() => onChange('', secondary)}
            >
              <strong>{labelFor(options, primary)}</strong>
              <span>×</span>
            </button>
          ) : (
            <div className="drop">Apasă pe un segment.</div>
          )}
        </div>

        <div className="pickbox drop-audience" style={{ marginTop: 9 }}>
          <div className="picktitle">
            <span>Publicuri secundare</span>
            <span>max. 6</span>
          </div>
          <div className="selected-audiences">
            {secondary.length > 0 ? (
              secondary.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="audience-selected"
                  onClick={() => onChange(primary, secondary.filter((c) => c !== code))}
                >
                  <strong>{labelFor(options, code)}</strong>
                  <span>×</span>
                </button>
              ))
            ) : (
              <div className="drop">Opțional. Alege numai segmentele relevante.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The prototype's `ctaUI()` — flat chip list with free entry, capped at five. */
export function CtaPicker({
  options,
  selected,
  onChange,
}: {
  options: CatalogEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [custom, setCustom] = useState('');

  const toggle = (code: string) => {
    if (selected.includes(code)) return onChange(selected.filter((c) => c !== code));
    if (selected.length < 5) return onChange([...selected, code]);
    return undefined;
  };

  const addCustom = () => {
    const value = custom.trim();
    if (!value || selected.includes(value) || selected.length >= 5) return;
    onChange([...selected, value]);
    setCustom('');
  };

  return (
    <div className="picker cta-picker">
      <div className="pickbox">
        <div className="picktitle">
          <span>CTA-uri orientative</span>
          <span>click</span>
        </div>
        <div className="chips">
          {options.map((entry) => (
            <button
              key={entry.code}
              type="button"
              className={selected.includes(entry.code) ? 'chip selected' : 'chip'}
              onClick={() => toggle(entry.code)}
            >
              {entry.displayLabel ?? entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pickbox drop-cta">
        <div className="picktitle">
          <span>CTA-uri selectate</span>
          <span>max. 5</span>
        </div>
        <div className="chips">
          {selected.length > 0 ? (
            selected.map((code) => (
              <button
                key={code}
                type="button"
                className="chip selected"
                onClick={() => onChange(selected.filter((c) => c !== code))}
              >
                {labelFor(options, code)} ×
              </button>
            ))
          ) : (
            <div className="drop">Apasă pe un CTA. Maximum 5.</div>
          )}
        </div>
        <div className="inline-add">
          <input
            className="search-small"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="Adaugă un CTA propriu"
          />
          <button type="button" className="btn ghost" onClick={addCustom}>
            Adaugă
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The prototype's `multiPicker()` — products, channels, adaptable elements.
 *
 * Values are plain strings rather than catalogue codes: these campaign columns
 * store free text and the catalogue only supplies suggestions, which is why the
 * box accepts a typed entry alongside the offered ones. With no catalogue at
 * all the left box is omitted and the control degrades to free entry.
 */
export function MultiPicker({
  options,
  selected,
  title,
  selectedTitle,
  placeholder,
  max,
  onChange,
}: {
  options: Array<{ value: string; hint?: string | null }>;
  selected: string[];
  title: string;
  selectedTitle: string;
  placeholder: string;
  max: number;
  onChange: (next: string[]) => void;
}) {
  const [custom, setCustom] = useState('');

  const toggle = (value: string) => {
    if (selected.includes(value)) return onChange(selected.filter((v) => v !== value));
    if (selected.length < max) return onChange([...selected, value]);
    return undefined;
  };

  const addCustom = () => {
    const value = custom.trim();
    if (!value || selected.includes(value) || selected.length >= max) return;
    onChange([...selected, value]);
    setCustom('');
  };

  return (
    // Without a suggestion catalogue only the right-hand box renders, and the
    // prototype's two-column grid would leave the other half empty — the
    // modifier collapses it to one column. See app.css.
    <div className={options.length > 0 ? 'multi-picker' : 'multi-picker single'}>
      {options.length > 0 ? (
        <div className="pickbox">
          <div className="picktitle">
            <span>{title}</span>
            <span>click</span>
          </div>
          <div className="multi-list">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  selected.includes(option.value) ? 'multi-option selected' : 'multi-option'
                }
                onClick={() => toggle(option.value)}
              >
                <strong>{option.value}</strong>
                {option.hint ? <span>{option.hint}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="pickbox">
        <div className="picktitle">
          <span>{selectedTitle}</span>
          <span>max. {max}</span>
        </div>
        <div className="selected-stack">
          {selected.length > 0 ? (
            selected.map((value) => (
              <button
                key={value}
                type="button"
                className="selected-line"
                onClick={() => onChange(selected.filter((v) => v !== value))}
              >
                <strong>{value}</strong>
                <span>×</span>
              </button>
            ))
          ) : (
            // With no catalogue there is nothing to click, so the empty state
            // must not offer it.
            <div className="drop">
              {options.length > 0
                ? 'Selectează prin click sau adaugă mai jos.'
                : 'Adaugă primul element în câmpul de mai jos.'}
            </div>
          )}
        </div>
        <div className="inline-add">
          <input
            className="search-small"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder={placeholder}
          />
          <button type="button" className="btn ghost" onClick={addCustom}>
            Adaugă
          </button>
        </div>
      </div>
    </div>
  );
}

export type Column<T> = {
  key: keyof T & string;
  header: string;
  placeholder: string;
  /** `<textarea>` where the prototype used one; widths come from the CSS. */
  multiline?: boolean;
};

/**
 * The prototype's `metricsUI()`, `examplesUI()`, `headlinesUI()`, `postsUI()`,
 * `videosUI()`, `frameworkDeliverablesUI()` and `activationExamplesUI()`.
 *
 * All seven are the same `.edit-table` inside a `.metric-scroll` with an
 * `.add-row` button underneath, differing only in their columns — so they are
 * one component here rather than seven near-copies.
 */
export function RowTable<T extends Record<string, string>>({
  rows,
  columns,
  addLabel,
  empty,
  wrapClass = 'content-editor',
  tableClass = 'edit-table content-table',
  onChange,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  addLabel: string;
  empty: () => T;
  wrapClass?: string;
  tableClass?: string;
  onChange: (next: T[]) => void;
}) {
  const patch = (index: number, key: keyof T & string, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <div className={wrapClass}>
      <div className="metric-scroll">
        <table className={tableClass}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.header}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // Rows are positional and carry no id, so the index is the key.
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column.key}>
                    {column.multiline ? (
                      <textarea
                        value={row[column.key] ?? ''}
                        placeholder={column.placeholder}
                        onChange={(event) => patch(index, column.key, event.target.value)}
                      />
                    ) : (
                      <input
                        value={row[column.key] ?? ''}
                        placeholder={column.placeholder}
                        onChange={(event) => patch(index, column.key, event.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="row-remove"
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn ghost add-row"
        onClick={() => onChange([...rows, empty()])}
      >
        {addLabel}
      </button>
    </div>
  );
}

/**
 * Newline-separated text bound to a string array — the prototype's
 * list-textarea.
 *
 * The naive binding — `value={value.join('\n')}` with a `trim().filter()` in
 * `onChange` — is unusable: the value shown is derived from the array, so the
 * normalisation runs on every keystroke and deletes the space you just typed.
 * A trailing space could never be entered, and a blank line vanished the moment
 * Enter was pressed twice, because `filter(Boolean)` dropped it.
 *
 * So the textarea keeps its own draft and reports raw lines while typing;
 * trimming and dropping blanks happen on blur, when the author has finished the
 * line. `seen` lets a value arriving from outside — loading a campaign, or a
 * context import — replace the draft, without a re-render mid-word clobbering
 * what is being typed.
 */
export function ListTextarea({
  value,
  onChange,
  placeholder,
  className = 'control list-textarea',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  className?: string;
}) {
  const joined = value.join('\n');
  const [draft, setDraft] = useState(joined);
  const [seen, setSeen] = useState(joined);

  if (joined !== seen) {
    setSeen(joined);
    setDraft(joined);
  }

  return (
    <textarea
      className={className}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        setSeen(text);
        onChange(text.split('\n'));
      }}
      onBlur={() => {
        const clean = draft
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        setDraft(clean.join('\n'));
        setSeen(clean.join('\n'));
        onChange(clean);
      }}
    />
  );
}
