# AI Speaking Bot

A multi-bot Telegram language-learning application with voice transcription,
conversation practice, corrections, a Mini App, and paid plans.

- **API and worker:** Node.js, TypeScript, Express, PostgreSQL, and pg-boss.
- **Mini App:** Vue 3 and Vite.
- **Landing site:** Nuxt 3.
- **Integrations:** Telegram, OpenAI, and Stripe.

## Development and deployment

See [development and deployment](DEV_DEPLOY.md) for setup and commands,
[server deployment](deploy/README.md) for Docker Compose and SSH deployment,
and [private configuration migration](deploy/PRIVATE_ENV_MIGRATION.md) for
existing installations.

Runtime credentials belong in private environment files outside the Git checkout.
Bot files in `deploy/bots/` contain public configuration; each bot token is supplied
through its `TELEGRAM_BOT_TOKEN_<BOT_KEY>` environment variable.
Do not commit database exports, chat recordings, populated env files, or credentials.

## License

Project source code and documentation are available under the [MIT License](LICENSE).
Third-party dependencies and materials retain their respective licenses and notices.
The MIT license does not grant rights to third-party trademarks or imply endorsement.
