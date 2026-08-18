/**
 * Standard API shapes — spec section 16.
 *
 * Success:  { "data": ..., "meta": { ... } }
 * Error:    { "error": { code, message, details, requestId } }
 *
 * One shape everywhere means the React client has exactly one success path and
 * one error path to handle, and it never has to guess at a response.
 */
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { logger } from './logger';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'ENTITY_IN_USE'
  | 'SYSTEM_VALUE_PROTECTED'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_VERSION: 409,
  ENTITY_IN_USE: 409,
  SYSTEM_VALUE_PROTECTED: 409,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_ERROR: 422,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  static unauthenticated(message = 'Autentificare necesară.'): ApiError {
    return new ApiError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'Nu ai drepturi pentru această operație.'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Resursa nu a fost găsită.'): ApiError {
    return new ApiError('NOT_FOUND', message);
  }
  static validation(message = 'Datele nu sunt valide.', details?: unknown): ApiError {
    return new ApiError('VALIDATION_ERROR', message, details);
  }
}

export interface PageMeta extends Record<string, unknown> {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function sendData<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  res.json(meta ? { data, meta } : { data });
}

/**
 * Pagination is applied from v1 even though the seed is small (rule 68.18):
 * the client must never assume a list endpoint returns everything.
 */
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

export function readPagination(req: Request): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const requested = Number.parseInt(String(req.query.pageSize ?? PAGE_SIZE_DEFAULT), 10);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number.isFinite(requested) ? requested : PAGE_SIZE_DEFAULT),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta(total: number, page: number, pageSize: number): PageMeta {
  return { total, page, pageSize, hasMore: page * pageSize < total };
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Resursa nu a fost găsită.', details: [], requestId: null },
  });
}

/**
 * Central error handler.
 *
 * An unexpected error becomes a generic 500: the message and stack are logged,
 * never sent to the client (spec 16.2).
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { id?: string }).id ?? null;

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? [],
        requestId,
      },
    });
    return;
  }

  logger.error({ err: error, requestId, url: req.originalUrl }, 'unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'A apărut o eroare neașteptată. Încearcă din nou.',
      details: env.isProduction ? [] : [String((error as Error)?.message ?? error)],
      requestId,
    },
  });
}
