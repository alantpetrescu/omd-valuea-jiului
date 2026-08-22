/**
 * Row-action glyphs for Administrare.
 *
 * Unicode characters, not an icon library (SPEC §7.1): zero new dependencies and
 * the same visual weight as the rest of the app. Defined once here because all
 * three tabs — Utilizatori, Nomenclatoare, Strategie — draw the same actions,
 * and three copies of `✎` would drift the day one of them changes.
 *
 * The buttons that use these carry three attributes, and each earns its place:
 *
 *   data-tooltip  the bubble `.activation-icon-btn::after` draws from
 *                 `content: attr(data-tooltip)`. Without it the pseudo-element
 *                 still renders — you hover and get an empty dark rectangle.
 *                 `white-space: nowrap`, so it has to stay short.
 *   title         the native tooltip, a second later. Where the long form goes:
 *                 the reason an action is unavailable.
 *   aria-label    for a screen reader, which sees neither of the above.
 */
export const ICONS = {
  view: '◉',
  edit: '✎',
  toggle: '⊘',
  remove: '🗑',
  activate: '▲',
} as const;
