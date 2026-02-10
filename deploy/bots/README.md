# Bot Configs (`deploy/bots/*.json`)

Each file defines one Telegram bot for a fixed language pair and provides:

- Language pair (`base_language`, `learning_language`)
- Telegram credentials (n8n credential ID and bot token)
- Localized texts/prompts used by the `Set Locale` node in the workflow

These config files are mounted into the API container at `/deploy/bots` and read at startup.

## File naming

Use `deploy/bots/<base>-<learning>.json` (example: `deploy/bots/uk-de.json`).

## Schema (informal)

```json
{
  "bot_key": "uk-de",
  "base_language": "uk",
  "learning_language": "de",
  "telegram_credential_id": "V39Lr6UfHsLcBQsS",
  "telegram_bot_token": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
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
- `telegram_credential_id` is the **n8n credential ID** (used by n8n workflows).
- `telegram_bot_token` is the **Telegram bot token** (used by the API service). **Required**.
- `locale` keys must match the keys used by the `Set Locale` node in the `ai-bot` template.
- `locale.loader_messages` can be either:
  - an array of strings (recommended), or
  - a raw n8n expression string like `={{ JSON.stringify([...]) }}`.
