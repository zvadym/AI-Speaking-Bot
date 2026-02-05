-- migrate:up
-- Replace the stripe_price_id values below with real Stripe Price IDs.
-- Example Stripe price IDs look like: price_1ABCDEFghijkLMNOP
INSERT INTO public.plan_prices (tier, currency, amount_cents, billing_interval, stripe_price_id, active)
VALUES
  ('plus', 'EUR', 500, 'month', 'price_1SxY7nFQD06rLSW0mVld2CaS', true),
  ('pro', 'EUR', 1000, 'month', 'price_1SxY8AFQD06rLSW0q1qTUGUS', true)
ON CONFLICT (tier, currency, billing_interval) DO UPDATE
SET
  amount_cents = EXCLUDED.amount_cents,
  stripe_price_id = EXCLUDED.stripe_price_id,
  active = EXCLUDED.active,
  updated_at = NOW();

-- migrate:down
DELETE FROM public.plan_prices
WHERE (tier, currency, billing_interval) IN (
  ('plus', 'EUR', 'month'),
  ('pro', 'EUR', 'month')
);
