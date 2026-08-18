/**
 * Session tokens.
 *
 * Spec section 11.4 allows either a server session or a signed token; both must
 * expire, support logout, re-check `users.is_active`, and never live in
 * localStorage. A signed token in an HttpOnly cookie satisfies all four without
 * adding a table to the frozen schema.
 *
 * Format: `<userId>.<expiresAtEpochSeconds>.<hmacSha256>`
 * The signature covers the payload, so neither the user nor the expiry can be
 * altered client-side. `is_active` is re-read from the database on every
 * request, so deactivating a user takes effect immediately.
 */
import crypto from 'node:crypto';

import { env } from '../config/env';

export const SESSION_COOKIE = 'omd_session';

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.AUTH_SECRET).update(payload).digest('base64url');
}

export function issueToken(userId: string, now = Date.now()): { token: string; expiresAt: Date } {
  const expiresAtSeconds = Math.floor(now / 1000) + env.AUTH_TOKEN_TTL;
  const payload = `${userId}.${expiresAtSeconds}`;
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

/** Returns the user id, or null for anything malformed, tampered or expired. */
export function readToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, expiresAtSeconds, signature] = parts as [string, string, string];
  const expected = sign(`${userId}.${expiresAtSeconds}`);

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Constant-time compare; length check first because timingSafeEqual throws on
  // mismatched lengths.
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  const expiry = Number(expiresAtSeconds);
  if (!Number.isFinite(expiry) || expiry * 1000 <= now) return null;

  return userId;
}

export function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
