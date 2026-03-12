import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env.js';
import { getApiBoss, stopApiBoss } from './queue.js';
import { createRuntimeDeps } from './runtime.js';
import { createApiHelpers } from './services/api-helpers.js';
import { createStripeWebhookRouter } from './routes/stripe-webhook.js';
import { createPublicRouter } from './routes/public.js';
import { createInternalRouter } from './routes/internal.js';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { createBillingRouter } from './routes/billing.js';
import { createAdminRouter } from './routes/admin.js';

export async function shutdown(signal) {
  console.log(`API shutting down on ${signal}`);
  await stopApiBoss();
}

export async function createApp({ apiBoss = undefined } = {}) {
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

  return app;
}
