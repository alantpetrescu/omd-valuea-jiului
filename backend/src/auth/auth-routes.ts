/**
 * Auth endpoints — spec section 11.2.
 *
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me
 *   POST /api/v1/auth/change-password
 */
import { Router } from 'express';
import { z } from 'zod';

import { execute, queryOne } from '../database/db';
import { hashPassword, verifyPassword } from '../shared/password';
import { ApiError, asyncHandler, sendData } from '../shared/http';
import { writeAudit } from '../audit/audit-service';
import { loadUser, requireAuth, type RoleCode } from './middleware';
import { cookieOptions, issueToken, SESSION_COOKIE } from './session';

export const authRouter = Router();

const LoginBody = z.object({
  email: z.string().email('Adresa de e-mail nu este validă.'),
  password: z.string().min(1, 'Parola este obligatorie.'),
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Parola actuală este obligatorie.'),
  newPassword: z.string().min(10, 'Parola nouă trebuie să aibă minimum 10 caractere.'),
});

/**
 * Minimal in-process rate limiting (spec 11.6): 10 attempts / 15 min per
 * IP+email. Deliberately not a shared store — one process, one deployment.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function tooManyAttempts(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string, now = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

interface LoginRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_active: number;
  must_change_password: number;
  role: RoleCode;
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele de autentificare nu sunt valide.', parsed.error.issues);
    }

    const { email, password } = parsed.data;
    const key = `${req.ip ?? 'unknown'}|${email.toLowerCase()}`;

    if (tooManyAttempts(key)) {
      throw new ApiError(
        'CONFLICT',
        'Prea multe încercări de autentificare. Încearcă din nou peste 15 minute.',
      );
    }

    const row = await queryOne<LoginRow>(
      `SELECT u.id, u.name, u.email, u.password_hash, u.is_active, u.must_change_password, r.code AS role
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.email = ?`,
      [email],
    );

    // Same message whether the account is missing, inactive or the password is
    // wrong — no account enumeration.
    const invalid = ApiError.unauthenticated('E-mail sau parolă incorecte.');

    if (!row || row.is_active !== 1) {
      recordFailure(key);
      throw invalid;
    }
    if (!(await verifyPassword(row.password_hash, password))) {
      recordFailure(key);
      throw invalid;
    }

    attempts.delete(key);

    const { token, expiresAt } = issueToken(row.id);
    res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));

    await execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [row.id]);
    await writeAudit({
      userId: row.id,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: row.id,
      entityExternalKey: row.email,
    });

    sendData(res, {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      mustChangePassword: row.must_change_password === 1,
    });
  }),
);

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  sendData(res, { ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    sendData(res, req.user);
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = ChangePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Parola nouă nu este validă.', parsed.error.issues);
    }

    const user = req.user!;
    const row = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id],
    );
    if (!row || !(await verifyPassword(row.password_hash, parsed.data.currentPassword))) {
      throw ApiError.unauthenticated('Parola actuală este incorectă.');
    }

    await execute(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_by = ? WHERE id = ?',
      [await hashPassword(parsed.data.newPassword), user.id, user.id],
    );
    await writeAudit({
      userId: user.id,
      action: 'USER_CHANGE',
      entityType: 'USER',
      entityId: user.id,
      entityExternalKey: user.email,
      newValues: { passwordChanged: true },
    });

    sendData(res, await loadUser(user.id));
  }),
);
