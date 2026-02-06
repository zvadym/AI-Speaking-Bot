# Costs (max usage)

This document estimates **variable OpenAI spend per user** when a user consumes the **maximum allowed weekly limits** for each plan.

## Source limits

From `/home/developer/WorkProjects/AI-Speaking-Bot/db/migrations/20260203130000_seed_plans.sql`:


| Plan | User audio (sec/week) | TTS (sec/week) |
| ---- | --------------------- | -------------- |
| FREE | 120                   | 120            |
| PLUS | 3,600                 | 3,600          |
| PRO  | 36,000                | 36,000         |


## Workflow usage (what consumes OpenAI)

From `/home/developer/WorkProjects/AI-Speaking-Bot/deploy/workflows/ai-bot.json`:

- **STT**: `Transcribe a recording` (`resource:"audio", operation:"transcribe"`).
- **Tutor LLM**: `Message a model` (`gpt-5-mini-2025-08-07`).
- **Summarizer LLM** (periodic): `Make summary` (`gpt-5-mini`).
- **TTS**: `Generate audio` (`resource:"audio"`; voice `nova`; the model is not explicitly pinned in the node).

## “Max usage per month”

Assumption: average weeks per month = `52/12 = 4.33`.


| Plan | User audio (sec/mo) | User audio (min/mo) | TTS (sec/mo) | TTS (hours/mo) |
| ---- | ------------------- | ------------------- | ------------ | -------------- |
| FREE | 520                 | 8.67                | 520          | 0.14           |
| PLUS | 15,600              | 260.00              | 15,600       | 4.33           |
| PRO  | 156,000             | 2,600.00            | 156,000      | 43.33          |


## Pricing + modeling assumptions

These are **assumptions** to turn the plan limits into a dollar estimate. Adjust them to match your actual OpenAI pricing/models.

### STT

- Assume **Whisper-like** pricing: `$0.006 / minute` of user audio.

### TTS

- Assume **TTS-like** pricing: `$15 / 1M characters`.
- Convert seconds → characters using speech rate:
  - `150 wpm` ⇒ `2.5 words/sec`
  - assume `~6 chars/word` (letters + space)
  - ⇒ `~15 chars/sec`

### LLM

The bot calls the tutor LLM once per message, and calls the summary LLM periodically.

The workflow includes:

- Tutor system prompt size: ~`3404` chars
- Tutor user template size: ~`349` chars
- Summary system prompt size: ~`786` chars
- Summary user template size: ~`107` chars
- Rolling summary size target: ~~`600–1200` chars (assume `~~900` chars)
- History window: last `20` messages (≈ `10` turns)

Token estimation (rough):

- tokens/sec of spoken text: `150 wpm` ⇒ `2.5 words/sec`; assume `~1.33 tokens/word` ⇒ `~3.33 tokens/sec`
- prompt tokens ≈ `chars / 4`

Turn sizing (affects number of LLM calls, not the total audio seconds):

- assume average `20s` user voice per turn and `20s` assistant TTS per turn.

LLM pricing scenarios:

1. **Mini-like** (used for the main numbers below): `$0.15 / 1M input tokens`, `$0.60 / 1M output tokens`
2. **4o-like** (sensitivity check): `$5.00 / 1M input tokens`, `$15.00 / 1M output tokens`

## Results (USD / user / month, maxed out)

All results below assume the user reaches **both** weekly limits (user audio + TTS) every week.

### Scenario A — “mini-like” LLM pricing

Breakdown:


| Plan | STT    | TTS    | LLM   | Total      |
| ---- | ------ | ------ | ----- | ---------- |
| FREE | $0.05  | $0.12  | $0.01 | **$0.18**  |
| PLUS | $1.56  | $3.51  | $0.43 | **$5.50**  |
| PRO  | $15.60 | $35.10 | $4.31 | **$55.01** |


### Scenario B — “4o-like” LLM pricing (sensitivity)


| Plan | Total       |
| ---- | ----------- |
| FREE | **$0.60**   |
| PLUS | **$18.57**  |
| PRO  | **$185.92** |


## Notes / caveats

- The **largest driver is TTS** at high usage (because TTS seconds scale linearly with plan limits).
- Real spend varies a lot based on:
  - the actual STT/TTS models and their pricing,
  - average message length / turns per month (affects number of LLM calls and summarization overhead),
  - whether the user runs in **text** mode vs **voice** mode (TTS only applies in voice mode),
  - how often the bot emits long explanations / translations / hints.

