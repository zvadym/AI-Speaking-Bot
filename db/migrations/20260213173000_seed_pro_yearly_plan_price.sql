-- migrate:up
-- Replace the placeholder stripe_price_id with a real Stripe yearly price ID
-- before activating this price in production.
INSERT INTO public.plan_prices (tier, currency, amount_cents, billing_interval, stripe_price_id, active)
VALUES
  ('pro', 'EUR', 10000, 'year', 'price_PRO_YEARLY_PLACEHOLDER', false)
ON CONFLICT (tier, currency, billing_interval) DO UPDATE
SET
  amount_cents = EXCLUDED.amount_cents,
  stripe_price_id = EXCLUDED.stripe_price_id,
  active = EXCLUDED.active,
  updated_at = NOW();

-- migrate:down
DELETE FROM public.plan_prices
WHERE tier = 'pro'
  AND currency = 'EUR'
  AND billing_interval = 'year';
