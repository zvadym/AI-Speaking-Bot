# Bot Configs (`deploy/bots/*.json`)

Each file defines one Telegram bot for a fixed language pair and provides:

- Language pair (`base_language`, `learning_language`)
- Public bot metadata only; credentials are stored outside the repository
- Runtime locale and prompt data (`locale`, model prompt fields)
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
  "telegram_presentation": {
    "name": "Emma",
    "description": "Practice German with Emma.",
    "short_description": "Practice German daily.",
    "commands": [
      { "command": "start", "description": "Start the bot" },
      { "command": "level", "description": "Set your language level" },
      { "command": "voice", "description": "Choose voice or text replies" },
      { "command": "stats", "description": "Check subscription status" },
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

## Locale Keys For Bottom Keyboard

The TypeScript bot runtime reads these `locale` keys to build the persistent bottom keyboard labels:

- `keyboard_btn_level_prefix`
- `keyboard_btn_topic_prefix`
- `keyboard_btn_topic_none`
- `keyboard_btn_voice_prefix`
- `keyboard_btn_voice_text`
- `keyboard_btn_voice_voice`

They should be localized in the bot's base language and kept short because Telegram reply-keyboard buttons have limited horizontal space.

The bottom keyboard offers topic, language level and reply format.
`/progress` and `/xp` are not registered commands. Old reply-keyboard buttons and
already queued jobs receive the standard unknown-command reply with the current keyboard.

The API automated notifications also read these locale keys when present:

- `locale.notifications.day1_return.*`
- `locale.notifications.weekly_digest.*`
- `locale.notifications.winback.*`
- `locale.notifications.free_limit_50.message_html`
- `locale.notifications.idiom_phrase_practice.*`

The main chat runtime also expects:

- `locale.msg_needs_text_or_voice` for unsupported media in the regular practice flow, for example a photo sent without text

## Interactive Onboarding Locale

Bots enabled through `BOT_ONBOARDING_V2_ENABLED_BOT_KEYS` must provide a
complete `locale.onboarding_v2` object. It contains the welcome and scenario
copy, voice/text instructions, first-response labels, level suggestion,
completion and bonus-action messages, button labels, and expired-state errors.
Instructions use the bot's base language; scenario examples use its learning
language. Startup fails for an enabled bot when a required localized value or
placeholder is missing.

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

Apply every config in `deploy/bots`:

```bash
python3 scripts/provision-bots.py apply --all
```

Apply every config from a custom directory:

```bash
python3 scripts/provision-bots.py apply --all --bots-dir deploy/bots-dev
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

- Runtime `/start` message (`locale.hi_message_text`)
- Other runtime locale/model prompt text sync

## Credentials

Set `TELEGRAM_BOT_TOKEN_<BOT_KEY>` in the private API env file, uppercasing the bot
key and replacing hyphens with underscores (`uk-en` -> `TELEGRAM_BOT_TOKEN_UK_EN`).
API/worker resolve tokens separately from this metadata; the landing generator does
not need credentials. Do not add `telegram_bot_token` to JSON.

`provision-bots.py sync` validates public metadata without secrets. `apply` resolves
credentials from the process environment or external `API_ENV_FILE` (default
`~/.config/ai-speaking-bot/api.env`) and checks every selected token before calls.
Interactive provisioning stores the entered token only in that private file and
refuses to overwrite a different existing credential. `--dry-run` writes no files
and makes no Telegram API calls.
