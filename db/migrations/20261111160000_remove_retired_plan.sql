-- migrate:up
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE plan_tier = 'plus'
       OR override_plan_tier = 'plus'
       OR pending_plan_tier = 'plus'
  ) OR EXISTS (
    SELECT 1 FROM public.plan_prices WHERE tier = 'plus' AND active
  ) THEN
    RAISE EXCEPTION 'Retired plan still has current user references or active prices';
  END IF;
END $$;

DELETE FROM public.plan_prices WHERE tier = 'plus';
DELETE FROM public.plans WHERE tier = 'plus';

-- migrate:down
DO $$ BEGIN
  RAISE EXCEPTION 'Retired plans must be restored with a forward migration';
END $$;
