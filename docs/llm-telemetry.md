# LLM Call Telemetry

`llm_call_events` stores one privacy-minimal row per OpenAI call. It contains
model routing, timing, outcome, and token counters only. It must never contain
prompts, learner messages, transcripts, model output, usernames, or bot tokens.

## Daily Cost Estimate

The rates below are OpenAI Standard short-context prices in USD per one million
tokens, verified on 2026-07-12. Review them against the official pricing page
before using this query for financial reporting. `output_tokens` already includes
reasoning tokens, so `reasoning_tokens` must not be billed a second time.

```sql
WITH model_rates(model, input_usd, cached_input_usd, output_usd) AS (
  VALUES
    ('gpt-5.6-sol', 5.00::numeric, 0.50::numeric, 30.00::numeric),
    ('gpt-5.6-terra', 2.50::numeric, 0.25::numeric, 15.00::numeric),
    ('gpt-5.6-luna', 1.00::numeric, 0.10::numeric, 6.00::numeric),
    ('gpt-5.4', 2.50::numeric, 0.25::numeric, 15.00::numeric),
    ('gpt-5.4-mini', 0.75::numeric, 0.075::numeric, 4.50::numeric),
    ('gpt-5-mini', 0.25::numeric, 0.025::numeric, 2.00::numeric)
),
daily AS (
  SELECT
    date_trunc('day', event.occurred_at) AS day_utc,
    event.bot_key,
    event.operation,
    event.model,
    COUNT(*) AS calls,
    COUNT(*) FILTER (WHERE event.success) AS successful_calls,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY event.duration_ms) AS p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY event.duration_ms) AS p95_ms,
    SUM(COALESCE(event.input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(event.cached_input_tokens, 0)) AS cached_input_tokens,
    SUM(COALESCE(event.output_tokens, 0)) AS output_tokens
  FROM llm_call_events event
  WHERE event.occurred_at >= NOW() - INTERVAL '30 days'
  GROUP BY 1, 2, 3, 4
)
SELECT
  daily.*,
  CASE WHEN rates.model IS NULL THEN NULL ELSE ROUND((
    GREATEST(daily.input_tokens - daily.cached_input_tokens, 0) * rates.input_usd
    + daily.cached_input_tokens * rates.cached_input_usd
    + daily.output_tokens * rates.output_usd
  ) / 1000000, 6) END AS estimated_usd,
  rates.model IS NULL AS pricing_missing
FROM daily
LEFT JOIN model_rates rates USING (model)
ORDER BY day_utc DESC, bot_key, operation, model;
```

Source: <https://developers.openai.com/api/docs/pricing> and the GPT-5 mini
model page at <https://developers.openai.com/api/docs/models/gpt-5-mini>.

## Operational Checks

Recent failures by operation:

```sql
SELECT operation, model, error_code, COUNT(*) AS failures
FROM llm_call_events
WHERE occurred_at >= NOW() - INTERVAL '24 hours'
  AND success = false
GROUP BY operation, model, error_code
ORDER BY failures DESC;
```

Verify that a runtime decision used the expected operation-to-model mapping:

```sql
SELECT occurred_at, decision_id, bot_key, route, operation, model,
       reasoning_effort, duration_ms, success,
       input_tokens, cached_input_tokens, output_tokens
FROM llm_call_events
WHERE decision_id = $1
ORDER BY occurred_at;
```
