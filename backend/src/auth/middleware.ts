/**
 * Authentication and role enforcement.
 *
 * Spec section 12 and rule 67.10: the backend is the security authority. Hiding
 * buttons in React is convenience, never protection — every protected route
 * re-checks the role here, and `is_active` is re-read per request.
 */
import type { NextFunction, Request, Response } from 'express';

import { queryOne } from '../database/db';
import { ApiError } from '../shared/http';
import { readToken, SESSION_COOKIE } from './session';

export type RoleCode = 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
  is_active: number;
  must_change_password: number;
}

export async function loadUser(userId: string): Promise<AuthenticatedUser | null> {
  const row = await queryOne<UserRow>(
    `SELECT u.id, u.name, u.email, r.code AS role, u.is_active, u.must_change_password
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [userId],
  );

  // A deactivated account is rejected even with a still-valid token.
  if (!row || row.is_active !== 1) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
  };
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = readToken(req.cookies?.[SESSION_COOKIE]);
    if (userId) {
      const user = await loadUser(userId);
      if (user) req.user = user;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(ApiError.unauthenticated());
    return;
  }
  next();
}

/** Route guard: `requireRole('ADMIN')`, `requireRole('ADMIN', 'EDITOR')`. */
export function requireRole(...roles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthenticated());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

/** Anything that writes: ADMIN and EDITOR only. VIEWER is read-only (spec 12). */
export const requireWriteAccess = requireRole('ADMIN', 'EDITOR');
