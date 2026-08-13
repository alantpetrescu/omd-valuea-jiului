/**
 * Structured application logger.
 *
 * Spec section 39: logs carry timestamp, level, request id, method, route,
 * status and duration. Passwords and auth tokens are never logged — the
 * redaction list below is the enforcement point.
 */
import pino from 'pino';

import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  base: { env: env.APP_ENV },
});
