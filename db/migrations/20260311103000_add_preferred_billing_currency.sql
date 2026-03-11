-- migrate:up

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_billing_currency text;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_preferred_billing_currency_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_preferred_billing_currency_check
  CHECK (
    preferred_billing_currency IS NULL
    OR char_length(preferred_billing_currency) = 3
  );

-- migrate:down
SELECT 1;
