# Prompt Templates (`deploy/prompts/*.md`)

This directory is the source of truth for LLM prompt text used by rendered
multi-bot workflows.

Templates:

- `model_system_prompt.md`
- `model_support_prompt.md`
- `model_hints_prompt.md`
- `model_summary_prompt.md`
- `model_vocab_prompt.md`

They are loaded and rendered by `scripts/render-n8n-workflows.py` for each bot.

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

## Rules

- Placeholder replacement is strict:
  - unknown placeholders fail render
  - unresolved placeholders fail render
- Prompt templates should stay generic and rely on placeholders instead of
  hardcoding specific bots/languages.
- Bot configs (`deploy/bots/*.json`) should not define `model_*_prompt` keys in
  `locale`; those are injected from templates at render time.
