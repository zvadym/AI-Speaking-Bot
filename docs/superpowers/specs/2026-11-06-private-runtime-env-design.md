# Private runtime environment

Approved direction: keep SSH deployment; move runtime credentials outside Git. History cleanup and credential rotation are later operations. Do not deploy to production during this change (`scripts/AGENTS.md`). Preserve the unrelated `docs/research/` work.

Public `deploy/bots/*.json` contains only bot metadata. Tokens use `TELEGRAM_BOT_TOKEN_<BOT_KEY>` environment variables (hyphens become underscores, uppercase). API, worker and administration tools share this naming rule. Configs never receive injected secret fields; tokens are resolved separately.

Local configuration defaults to `$HOME/.config/ai-speaking-bot/{api,miniapp,landing}.env`. `API_ENV_FILE`, `MINIAPP_ENV_FILE`, `LANDING_ENV_FILE` can select absolute paths outside the checkout. Production uses `/etc/ai-speaking-bot`, configurable through `DEPLOY_CONFIG_DIR`. Files use mode 0600 and directories 0700. Mini App configuration is separate because VITE variables are public build inputs.

Node only loads an explicitly selected `API_ENV_FILE`; containers receive variables from Compose env_file. Tests do not discover local production configuration. Shell/Python tooling parses dotenv without executing its contents. Existing process variables take precedence for development; deployment wrappers make the private files authoritative. Invalid paths and missing explicitly selected files fail before side effects.

A migration tool validates all values, writes external files and private backups, verifies token parity, then optionally strips token fields and removes old local env files. It refuses conflicts rather than overwriting an existing private secret. It preserves token values so webhook derivation is unchanged. Deployment preflights credentials for every configured bot before database migrations, container recreation or webhook writes. No secret contents enter logs, generated landing assets or Git.

Verification: fixture-only Node/Python tests, API suite/typecheck/build, frontend builds, Compose config validation with synthetic environment, provisioning dry-run, exact local migration parity and tracked-file secret scan. No live bot mutations or production migrations.
