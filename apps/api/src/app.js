import './patch-express-async.js';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env.js';
import { getApiBoss, stopApiBoss } from './queue.js';
import { isHttpError } from './core/errors.js';
import { createRuntimeDeps } from './runtime.js';
import { createApiHelpers } from './services/api-helpers.js';
import { createStripeWebhookRouter } from './routes/stripe-webhook.js';
import { createPublicRouter } from './routes/public.js';
import { createInternalRouter } from './routes/internal.js';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { createBillingRouter } from './routes/billing.js';
import { createAdminRouter } from './routes/admin.js';
import { ensureSentryInitialized, setupExpressErrorHandler } from './sentry.js';

export async function shutdown(signal) {
  console.log(`API shutting down on ${signal}`);
  await stopApiBoss();
}

export async function createApp({ apiBoss = undefined, configureApp = undefined } = {}) {
  ensureSentryInitialized({ processName: 'api' });
  const resolvedApiBoss = apiBoss !== undefined ? apiBoss : await getApiBoss();
  const ctx = createRuntimeDeps({ apiBoss: resolvedApiBoss });
  const helpers = createApiHelpers(ctx);
  const app = express();

  app.locals.apiBoss = resolvedApiBoss;
  app.locals.ctx = ctx;

  app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : true }));
  app.use(morgan('tiny'));
  app.use('/stripe/webhook', express.raw({ type: 'application/json' }), createStripeWebhookRouter(ctx, helpers));
  app.use(express.json());
  app.use(createPublicRouter(ctx, helpers));
  app.use(createInternalRouter(ctx, helpers));
  app.use(createAuthRouter(ctx, helpers));
  app.use(createBillingRouter(ctx, helpers));
  app.use(createMeRouter(ctx, helpers));
  app.use(createAdminRouter(ctx, helpers));
  if (typeof configureApp === 'function') {
    await configureApp({ app, ctx, helpers });
  }
  setupExpressErrorHandler(app);
  app.use((err, _req, res, _next) => {
    if (isHttpError(err)) {
      return res.status(err.status).json(err.payload);
    }

    console.error('Unhandled API error', err);
    return res.status(500).json({
      error: 'internal_server_error',
      ...(res.sentry ? { eventId: res.sentry } : {})
    });
  });

  return app;
}
