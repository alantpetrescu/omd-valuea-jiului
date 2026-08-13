/**
 * Express application wiring.
 *
 * Kept separate from server.ts so tests can import the app without binding a port.
 * Cross-cutting concerns (response envelopes, error handler, auth) are added in
 * Stage 1 steps 5 and 6; this file currently carries only the health route.
 */
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { pingDatabase } from './database/pool';
import { logger } from './shared/logger';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(pinoHttp({ logger, genReqId: () => crypto.randomUUID() }));
  app.use(express.json({ limit: '1mb' })); // import endpoints use multipart and set their own limit
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

  return app;
}
