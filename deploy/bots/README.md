# Bot Configs (`deploy/bots/*.json`)

Each file defines one Telegram bot for a fixed language pair and provides:

- Language pair (`base_language`, `learning_language`)
- Runtime credentials (`telegram_bot_token`, `telegram_credential_id`)
- Workflow locale/prompt data (`locale`, model prompt fields)
- **Telegram presentation data** in `telegram_presentation` (hard cutover)

These config files are mounted into the API container at `/deploy/bots` and read at startup.

## File naming

Use `deploy/bots/<base>-<learning>.json` (example: `deploy/bots/uk-de.json`).

## Hard-Cutover `telegram_presentation`

`scripts/provision-bots.py apply` now reads Telegram-facing settings **only** from:

- `telegram_presentation.name`
- `telegram_presentation.description`
- `telegram_presentation.short_description`
- `telegram_presentation.commands[]`
- `telegram_presentation.menu_button.text`
- `telegram_presentation.menu_button.web_app_url`
- `telegram_presentation.username`
- `telegram_presentation.profile_photo_path` (optional, repo-relative)

No fallback to legacy top-level presentation fields.

Example:

```json
{
  "bot_key": "en-de",
  "base_language": "en",
  "learning_language": "de",
  "telegram_credential_id": "AbCdEf123",
  "telegram_bot_token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  "telegram_presentation": {
    "name": "Emma",
    "description": "Practice German with Emma.",
    "short_description": "Practice German daily.",
    "commands": [
      { "command": "start", "description": "Start the bot" },
      { "command": "level", "description": "Set your language level" },
      { "command": "voice", "description": "Choose voice or text replies" },
      { "command": "stats", "description": "Check subscription status" },
      { "command": "xp", "description": "Check your streak and XP" },
      { "command": "feedback", "description": "Send feedback" },
      { "command": "lang", "description": "Show fixed learning language" }
    ],
    "menu_button": {
      "text": "Open app",
      "web_app_url": "https://learn-language-app.notarobot.dev/?bot-key=en-de"
    },
    "username": "language_en_de_bot",
    "profile_photo_path": "assets/bots/en-de.jpg"
  }
}
```

## Contract Template

The field contract lives in:

- `deploy/bot-presentation.template.yaml`

It defines required fields, length limits, regex, and Telegram method mapping.

## Two-Step Workflow

### 1) Validate / normalize bot files

Dry-run validation (default behavior):

```bash
python3 scripts/provision-bots.py sync --source deploy/bot-presentation.template.yaml --dry-run
```

Write normalized changes (for example, ensure `bot-key` query param in menu URL):

```bash
python3 scripts/provision-bots.py sync --source deploy/bot-presentation.template.yaml --write
```

Single bot:

```bash
python3 scripts/provision-bots.py sync \
  --source deploy/bot-presentation.template.yaml \
  --bot-key en-de \
  --write
```

### 2) Apply to Telegram

Dry-run:

```bash
python3 scripts/provision-bots.py apply --config deploy/bots/en-de.json --dry-run
```

Live apply:

```bash
python3 scripts/provision-bots.py apply --config deploy/bots/en-de.json
```

Bulk apply:

```bash
python3 scripts/provision-bots.py apply \
  --config deploy/bots/en-de.json \
  --config deploy/bots/en-es.json
```

## Bot API Calls Per Apply

- `getMe` (token validation + username mismatch guard)
- `setMyName`
- `setMyDescription`
- `setMyShortDescription`
- `setMyCommands`
- `setChatMenuButton`
- `setMyProfilePhoto` (when `profile_photo_path` exists or `--profile-photo` is passed)

## Out of Scope

- Workflow `/start` message (`locale.hi_message_text`)
- Other workflow locale/model prompt text sync
- n8n render/import/activate pipeline
