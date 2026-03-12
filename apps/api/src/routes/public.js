import { Router } from 'express';
import { normalizeLanguageCode } from '../shared/normalization.js';

export function createPublicRouter(_ctx, helpers) {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/public/billing/currencies', (req, res) => {
    const baseLanguage = normalizeLanguageCode(req.query?.base_language ?? req.query?.baseLanguage ?? null);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json(helpers.buildBillingCurrencyCatalog({ baseLanguage }));
  });

  router.get('/public/plans', async (req, res) => {
    const currency = (req.query.currency || 'EUR').toString().toUpperCase();
    const includeAllIntervals = helpers.parseQueryBoolean(
      req.query.include_all_intervals ?? req.query.includeAllIntervals
    );
    const plans = await helpers.loadPlanCatalog(currency, includeAllIntervals);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({
      currency,
      plans
    });
  });

  return router;
}
