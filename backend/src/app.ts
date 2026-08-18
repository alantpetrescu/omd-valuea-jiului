/**
 * Express application wiring.
 *
 * Kept separate from server.ts so tests can import the app without binding a
 * port. Middleware order matters: user attachment runs before routes, and the
 * error handler is registered last.
 */
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { pingDatabase } from './database/pool';
import { logger } from './shared/logger';
import { errorHandler, notFoundHandler } from './shared/http';
import { attachUser } from './auth/middleware';
import { authRouter } from './auth/auth-routes';
import { campaignRouter } from './campaigns/campaign-routes';
import { activationRouter } from './activations/activation-routes';
import { annualPlanRouter } from './annual-plans/annual-plan-routes';
import { monitoringRouter } from './monitoring/monitoring-routes';
import { strategyRouter } from './strategy/strategy-routes';
import { adminRouter } from './admin/admin-routes';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  if (env.AUTH_TOKEN_TTL) {

  }

  app.disable('x-powered-by');
  //  The API serves JSON only; CSP is applied by the web server for the SPA.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(pinoHttp({ logger, genReqId: () => crypto.randomUUID() }));
  app.use(express.json({ limit: '1mb' })); // imports use multipart with their own limit
  app.use(cookieParser());

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Liveness says the process is up; readiness says the database answers too.
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      await pingDatabase();
      res.json({ status: 'ok', database: 'ok' });
    } catch (error) {
      logger.error({ err: error }, 'readiness probe failed');
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  });

  /**
   * API responses are never stored by the browser.
   *
   * Two reasons. Responses are user-scoped, so a cached body must not survive a
   * logout or leak between accounts. And the ETag on campaign detail carries
   * `version_number` for If-Match concurrency, not as a cache validator — it
   * does not change when the DTO shape changes, so a conditional request could
   * return 304 and leave the client rendering a stale body.
   */
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/v1', attachUser);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', campaignRouter);
  app.use('/api/v1', activationRouter);
  app.use('/api/v1', annualPlanRouter);
  app.use('/api/v1', monitoringRouter);
  app.use('/api/v1', strategyRouter);
  app.use('/api/v1', adminRouter);

  // Uploaded images. Storage keys stay opaque; this is the only public mapping.
  app.use('/uploads', express.static(env.uploadDir, { fallthrough: false, maxAge: '1h' }));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
