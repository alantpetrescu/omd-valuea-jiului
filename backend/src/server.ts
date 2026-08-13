/**
 * Process entry point: binds the HTTP port and handles shutdown.
 */
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './shared/logger';

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT, env: env.APP_ENV }, 'OMD Valea Jiului API started');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
