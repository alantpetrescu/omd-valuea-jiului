/**
 * Identifier generation.
 *
 * Two distinct identities per entity (spec section 8):
 *
 *   id            CHAR(36) UUID, internal, never exposed as business identity
 *   external_key  stable integration key, what the API and UI speak
 *
 * External keys are immutable once assigned: not regenerated on edit, never
 * derived from the title, and never sequential (`camp-007` would collide with
 * an imported package sooner or later).
 */
import crypto from 'node:crypto';

/** Internal primary key. Generated in Node, not by MySQL's UUID(). */
export function newId(): string {
  return crypto.randomUUID();
}

export type ExternalKeyPrefix =
  | 'camp'
  | 'activation'
  | 'material'
  | 'kpi'
  | 'asset'
  | 'template'
  | 'package';

/** External key for an entity created through the UI, e.g. `camp-3f2b...`. */
export function newExternalKey(prefix: ExternalKeyPrefix): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
