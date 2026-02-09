# Bot Configs (`deploy/bots/*.json`)

Each file defines one Telegram bot for a fixed language pair and provides:

- Language pair (`base_language`, `learning_language`)
- Telegram credentials (n8n credential ID)
- Localized texts/prompts used by the `Set Locale` node in the workflow

## File naming

Use `deploy/bots/<base>-<learning>.json` (example: `deploy/bots/uk-de.json`).

## Schema (informal)

```json
{
  "bot_key": "uk-de",
  "base_language": "uk",
  "learning_language": "de",
  "telegram_credential_id": "V39Lr6UfHsLcBQsS",
  "locale": {
    "model_system_prompt": "...",
    "waiting_text": "...",
    "loader_messages": ["...", "..."],
    "hi_message_text": "={{ ... }}",
    "...": "..."
  }
}
```

Notes:

- `bot_key` should equal `${base_language}-${learning_language}`.
- `telegram_credential_id` is the **n8n credential ID** (not the bot token).
- `locale` keys must match the keys used by the `Set Locale` node in the `ai-bot` template.
- `locale.loader_messages` can be either:
  - an array of strings (recommended), or
  - a raw n8n expression string like `={{ JSON.stringify([...]) }}`.
