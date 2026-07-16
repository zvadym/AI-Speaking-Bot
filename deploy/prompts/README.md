# Prompt Templates (`deploy/prompts/*.md`)

This directory is the source of truth for LLM prompt text used by the typed
multi-bot runtime.

Shared reusable tone partials live in `shared/llm-prompts/` and are injected
when templates are rendered at runtime.

Templates:

- `model_system_prompt.md`
- `model_support_prompt.md`
- `model_hints_prompt.md`
- `model_summary_prompt.md`
- `model_vocab_prompt.md`
- `transcription/<language-code>.md`

Transcription prompts are selected by the audio language. `transcription/en.md`
is required and is used when a language-specific file is unavailable.

They are loaded by `apps/api/src/bot-runtime/bot-ai.ts` for each bot.

## Available placeholders

- `{{bot_name}}`
- `{{bot_key}}`
- `{{base_language_code}}`
- `{{target_language_code}}`
- `{{base_language_label}}`
- `{{target_language_label}}`
- `{{explanation_title}}`
- `{{article_gender_example}}`
- `{{vague_reason_example}}`
- `{{english_style_rule}}`
- `{{user_facing_tone_rules}}`

## Rules

- Placeholder replacement is strict:
  - unknown placeholders fail render
  - unresolved placeholders fail render
- Prompt templates should stay generic and rely on placeholders instead of
  hardcoding specific bots/languages.
- Bot configs (`deploy/bots/*.json`) should not define `model_*_prompt` keys in
  `locale`; those are injected from templates at render time.
