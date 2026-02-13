-- migrate:up
UPDATE public.plan_prices
SET active = false,
    updated_at = NOW()
WHERE tier = 'plus'
  AND active = true;

-- migrate:down
UPDATE public.plan_prices
SET active = true,
    updated_at = NOW()
WHERE tier = 'plus'
  AND active = false;
