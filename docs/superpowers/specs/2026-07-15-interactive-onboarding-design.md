# Interactive Voice-First Onboarding

Date: 2026-07-15
Status: Approved

## Context

The current `/start` experience asks a new user to send a short voice or text
message and offers one inline `Show example` action. After the first practice,
an idle worker sends a long `onboarding_complete_full_text` message explaining
levels, reply modes, XP, streaks, and the mini-app.

The flow is technically interactive, but most of its product explanation is
passive. It tells the user what the bot can do instead of guiding the user
through a small lesson. The long completion message also presents several
features before they are relevant.

## Goal

Give a new user a useful first win within one to two minutes: send a first voice
message and receive a short personalized correction. The flow should make voice
the obvious primary path while retaining a less prominent text fallback.

The primary product metric is the percentage of new users who receive their
first personalized correction within ten minutes of `/start`.

## Product Decisions

- The experience is voice-first, with text available as a fallback.
- The user chooses one of three everyday scenarios.
- Each scenario supports two confidence levels: answer freely or repeat a
  ready-made phrase.
- The flow does not ask for a CEFR level before practice.
- The model may suggest a level after the first response, but the user must
  confirm before the stored level changes.
- Onboarding is complete after the first personalized correction is delivered.
- A second attempt is an optional bonus, not a completion requirement.
- Every instruction, button, example, success message, and error is localized
  for the bot's base-language/learning-language pair.

## Non-goals

- Building a placement test or claiming an authoritative CEFR assessment from
  one short response.
- Creating a second transcription, correction, XP, or conversation pipeline.
- Opening Telegram's voice recorder programmatically; the Bot API cannot do so.
- Requiring a Mini App visit during onboarding.
- Teaching XP, streaks, subscriptions, and all settings before the first
  practice.
- Automatically re-onboarding existing users when the feature is deployed;
  an existing user opts in by explicitly sending `/start` to an enabled bot.

## User Experience

### 1. Start and scenario choice

For a new user, `/start` immediately presents the value promise and scenario
picker. There is no separate `Start` button.

Example for `uk-en`:

> Привіт, {first_name}! 👋  
> За 30 секунд ти скажеш першу фразу англійською та отримаєш персональне
> виправлення.
>
> Про що поговоримо?

Inline buttons use stable scenario identifiers:

- `👋 Про себе` -> `about_self`
- `☀️ Мій день` -> `daily_life`
- `✈️ Подорожі` -> `travel`

The layout may use two rows to keep localized labels readable. For a bot with
interactive onboarding enabled, every private `/start` explicitly restarts the
flow at the scenario picker. This also lets an existing user opt into or retest
the onboarding without deleting their account. The restart clears only
onboarding-session fields; it preserves level, XP, messages, reply mode,
subscription state, and other user preferences. Disabled bots retain the
legacy `/start` behavior.

### 2. Practice card

After scenario selection, the bot sends one localized practice card. It asks
one concrete question and includes one short phrase in the learning language.

Example for `uk-en` and `daily_life`:

> ☀️ **Мій день**
>
> Розкажи одним реченням, що ти робив сьогодні вранці.
>
> Можеш сказати щось своє або повторити:  
> “This morning, I had coffee and went to work.”
>
> Натисни 🎙 і надішли голосове.

The available actions are:

- `✍️ Відповім текстом`, which switches the instruction but not the learning
  task;
- `🔄 Інша тема`, which returns to the scenario picker.

There is no fake voice-recording button. If the user ignores the picker and
sends a voice or text message immediately, the bot accepts it as `freeform`
instead of blocking progress.

### 3. First personalized correction

The first answer uses the normal transcription, correction, quota, XP, and
delivery pipeline with a compact onboarding presentation mode:

- one encouraging observation;
- the transcript for voice input or the submitted sentence for text input;
- no more than two corrections;
- one short explanation;
- no feature tour or promotional paragraph.

Example:

> Чудовий старт, {first_name}! 🙌
>
> 📝 **Я почув:**  
> This morning I drink coffee and go to work.
>
> ✨ **Краще сказати:**  
> This morning I **drank** coffee and **went** to work.
>
> 🧠 Коли говоримо про завершену дію сьогодні вранці, використовуємо минулий
> час.

Text input uses a localized text-specific label instead of the voice-specific
`I heard` label.

### 4. Level suggestion and success

The same model result may include a nullable `suggested_level` and a confidence
classification. The UI shows a recommendation only for an allowed A1-C1 value
with sufficient confidence. The wording explicitly describes it as an
approximation based on the first response.

The recommendation and bonus actions replace the normal
translation/vocabulary/hints inline markup on the first delivered correction:

- `✅ Так, {suggested_level}` persists the suggested level;
- `🎚 Обрати інший` opens the existing level picker;
- `🔁 Сказати ще раз` asks the user to retry the corrected sentence;
- `💬 Продовжити розмову` sends the next conversational prompt.

If the model does not provide a usable level suggestion, the level row is
omitted and the user's existing A1 default remains unchanged. The success copy
may display actual XP awarded by the existing XP result, but must never
hardcode a reward amount.

Onboarding is marked complete after the personalized correction is delivered.
Afterward, the bot sends a separate one-line success message with the existing
persistent reply keyboard. Telegram cannot attach an inline keyboard and a
persistent reply keyboard to the same message. This small second message
replaces the legacy feature tour; it does not explain every keyboard control.
Its delivery is an independently idempotent durable effect, so a transient
failure can retry without repeating the correction or XP. Level confirmation
and both bonus actions remain valid after completion.

### 5. Progressive disclosure

The idle `onboarding_complete_full_text` message is not sent for interactive
onboarding sessions. Features are introduced when they become relevant:

- show the level recommendation after the first response;
- show actual XP when it is earned;
- explain streaks when the user returns on a later day;
- expose the mini-app when the user needs expanded settings or account
  management.

`Onboarding complete` remains an internal state and analytics concept, not a
user-facing sentence.

## Architecture

### Components

The implementation has three focused units:

1. `OnboardingSessionRepository` creates sessions and performs atomic,
   idempotent state transitions.
2. `OnboardingLocale` validates and renders localized copy, scenarios, buttons,
   and allowed placeholders.
3. `OnboardingCoordinator` connects `/start`, onboarding callbacks, and the
   first conversation result without owning transcription, correction, XP, or
   Telegram delivery.

`command.start` becomes context-aware rather than relying solely on the current
static route message. `callback.onboarding` owns scenario, input-mode, level,
and bonus callbacks. The text and voice conversation handlers receive active
onboarding context and continue to use the universal typed pipeline.

Onboarding-specific behavior attaches only at explicit conversation stages:

- before generation, supply the selected scenario and request the compact
  first-response shape;
- after structured generation, validate the optional level suggestion;
- after successful Telegram delivery, complete the session and record the
  completion event.

### Session storage

A forward-only migration adds `bot_onboarding_sessions` with:

- `chat_id` and `bot_key` as the composite primary key and foreign key to
  `user_bots`;
- `version`;
- `state`: `choose_scenario`, `await_practice`, or `completed`;
- nullable `scenario`: `about_self`, `daily_life`, `travel`, or `freeform`;
- nullable `first_input_mode`: `voice` or `text`;
- nullable `suggested_level`, restricted to A1-C1 values;
- `started_at`, `updated_at`, and nullable `completed_at`.

The bootstrap transaction creates a version-2 session when it inserts a new
`user_bots` row for a bot with interactive onboarding enabled. In addition, a
private `/start` on an enabled bot atomically inserts or resets that bot's
session to `choose_scenario`, including for an existing user. The reset clears
`scenario`, `first_input_mode`, `suggested_level`, `completion_decision_id`, and
`completed_at`, and refreshes `started_at` and `updated_at`. Other updates never
reset a session. The session stores `last_start_update_id`; only a newer
Telegram update ID may perform another reset, so delayed duplicate webhook
delivery cannot move a session backward after the user has already selected a
scenario. An absent session still means legacy or normal behavior.

Allowed transitions are:

```text
new -> choose_scenario
any state -> choose_scenario          (explicit /start on an enabled bot)
choose_scenario -> choose_scenario    (change or repeat selection)
choose_scenario -> await_practice     (scenario selected or text fallback)
await_practice -> choose_scenario     (choose another scenario)
await_practice -> completed           (first correction delivered)
completed -> completed                (level and bonus callbacks)
```

Normal transition writes include the expected current state. The explicit
`/start` reset is the sole unconditional backward transition. Duplicate
delivery of the same Telegram `/start` update repeats the same reset and
renders the same picker, while durable message delivery prevents a duplicate
outbound picker message.

### Effective completion compatibility

Current consumers infer onboarding completion from a sent
`scheduled_task_dispatches` row for the legacy `onboarding_complete` message.
The new flow must not write a fake message dispatch.

The migration introduces one canonical `bot_onboarding_completion` database
view. It exposes `chat_id`, `bot_key`, `completed_at`, and a source of
`interactive_v2` or `legacy_message`. Once any interactive session exists, its
state is authoritative: an active reset session is incomplete even if the user
previously has a legacy completion dispatch. The legacy timestamp is used only
when no interactive session exists. Because the original view has already
shipped, restart support uses a new forward-only `CREATE OR REPLACE VIEW`
migration to enforce this precedence.

The runtime keyboard context, admin funnel, day-1 return eligibility, winback
eligibility, and other completion consumers read this view. The legacy idle
scanner excludes every user with a version-2 onboarding session so it cannot
send the old information dump during a canary or rollback.

### Conversation and level inference

The first practice uses the same model call as a normal conversation response.
When onboarding context is active, the structured response contract additionally
allows:

- `suggested_level`: `a1`, `a2`, `b1`, `b2`, `c1`, or `null`;
- `suggested_level_confidence`: `low`, `medium`, or `high`;
- a compact correction limited to two issues.

No downstream behavior trusts unvalidated model output. Invalid values become
`null`; low confidence suppresses the recommendation. The confirmed level is
written through the existing level preference path so its normal validation,
event tracking, and keyboard refresh still apply.

The response may be classified as `custom`, `repeated_example`, or `unknown`
by a deterministic normalized transcript comparison. This classification is
analytics-only and never changes feedback or completion behavior.

## Localization Contract

Every `deploy/bots/*.json` receives a nested `locale.onboarding_v2` block. This
is the concrete `uk-en` example; every other pair provides the same keys with
its own base-language copy and learning-language examples:

```json
{
  "welcome": "Привіт, {first_name}! 👋",
  "choose_scenario": "За 30 секунд ти скажеш першу фразу англійською та отримаєш персональне виправлення. Про що поговоримо?",
  "voice_instruction": "Натисни 🎙 і надішли голосове.",
  "text_instruction": "Напиши одне коротке речення.",
  "success": "Перша практика готова 🔥",
  "voice_input_header": "Я почув:",
  "text_input_header": "Твоя відповідь:",
  "level_suggestion": "За першою відповіддю тобі приблизно підійде рівень {suggested_level}. Залишити?",
  "already_completed": "Перша практика вже готова. Продовжимо?",
  "retry_corrected": "Спробуй ще раз із виправленою фразою:",
  "continue_prompt": "Чудово. Продовжимо розмову:",
  "errors": {
    "expired": "Ця кнопка вже неактуальна.",
    "retry_voice": "Не вдалося розібрати голосове. Спробуй ще раз трохи голосніше.",
    "retry_delivery": "Не вдалося надіслати відповідь. Спробуй ще раз."
  },
  "buttons": {
    "use_text": "✍️ Відповім текстом",
    "change_scenario": "🔄 Інша тема",
    "confirm_level": "✅ Так, {suggested_level}",
    "choose_level": "🎚 Обрати інший",
    "retry": "🔁 Сказати ще раз",
    "continue": "💬 Продовжити розмову"
  },
  "scenarios": {
    "about_self": {
      "button": "👋 Про себе",
      "prompt": "Розкажи, звідки ти й чим займаєшся.",
      "example": "Hi, I’m Anna. I’m from Ukraine and I work in design."
    },
    "daily_life": {
      "button": "☀️ Мій день",
      "prompt": "Розкажи одним реченням, що ти робив сьогодні вранці.",
      "example": "This morning, I had coffee and went to work."
    },
    "travel": {
      "button": "✈️ Подорожі",
      "prompt": "Розкажи, куди ти хочеш поїхати.",
      "example": "I’d like to visit Italy because I love the food and history."
    }
  }
}
```

Localization rules:

- instructions and interface copy use the bot's `base_language`;
- examples use the bot's `learning_language`;
- scenario and callback identifiers are never localized;
- allowed placeholders are explicitly enumerated and HTML-escaped before
  rendering;
- button labels respect Telegram callback-data and practical display limits;
- enabled production bots never silently fall back to English onboarding copy.

A config validator checks every bot file for the full shape, stable scenario
set, non-empty values, valid placeholders, and callback-safe IDs. Language
quality and the semantic correctness of each learning-language example require
review for every pair; CI cannot reliably infer language quality from arbitrary
short phrases. If a malformed block reaches runtime despite validation, the
bot logs a structured configuration error and uses that bot's existing
localized `hi_message_text` as the safe fallback.

When changing this nested config shape, both API loading and landing config
consumers are checked even though the landing generator is not expected to use
the onboarding block.

## Analytics

The `action_events` constraint and admin analytics add:

- `onboarding_scenario_selected`;
- `onboarding_practice_sent`;
- `onboarding_completed`;
- `onboarding_level_confirmed`;
- `onboarding_bonus_selected`.

Events use idempotency keys scoped by chat, bot, session version, and logical
step. Properties may contain `scenario`, `input_mode`, `version`,
`response_style`, `suggested_level`, and the selected bonus action. They must
not contain message text, transcripts, usernames, bot tokens, or raw Telegram
payloads.

The admin onboarding funnel becomes the following. Direct freeform input may
skip the scenario-selected step:

```text
start -> scenario selected -> first practice sent -> onboarding completed
      -> optional second practice -> day-1 return
```

The dashboard reports:

- completion within ten minutes of start;
- time to first voice and time to completion;
- voice versus text completion share;
- conversion and completion by scenario and bot pair;
- repeated-example versus custom-response share where classification is known;
- optional second-practice and day-1-return rates;
- first-response latency and failure rate.

Existing `first_voice_sent` and `first_answer_delivered` events remain intact.

## Failure Semantics

- On an enabled bot, a repeated `/start` atomically resets the session and
  renders the scenario picker. On a disabled bot it preserves legacy behavior.
- A stale callback reloads the session. Completed sessions receive a localized
  already-completed acknowledgement and normal continuation actions.
- A malformed or unsupported callback is answered and does not mutate state.
- Too-short, too-long, silent, or undecodable input leaves the session in
  `await_practice` and uses the existing localized retry guidance.
- Model, transcription, quota, or Telegram failures do not complete the
  session. Existing durable retry behavior remains authoritative.
- Completion occurs only after the first correction delivery succeeds.
- Delivery retries cannot duplicate XP, completion, or analytics events.
- A missing or low-confidence level suggestion never blocks completion.
- Clearing the rollout flag stops new enrollment. Existing active sessions
  remain stored and can resume when the flag is restored; normal practice
  continues while the feature is disabled.

## Testing

Focused tests cover:

1. Session creation for a newly inserted `user_bots` row on an enabled bot.
2. Every allowed and rejected state transition, including duplicate updates.
3. `/start` creation and reset for new, active, completed, and legacy users,
   plus unchanged behavior for disabled bots.
4. All scenario callbacks, scenario changes, and text fallback.
5. Voice or text sent before scenario selection becoming `freeform`.
6. Compact first-response rendering for voice and text.
7. Successful delivery as the completion boundary.
8. Retry behavior without duplicate XP, events, or completion.
9. Level validation, confidence suppression, confirmation, and manual picker.
10. Bonus retry and continue actions after completion.
11. Legacy completion fallback only when no interactive session exists, and
    incomplete effective state while a restarted session is active.
12. Exclusion of version-2 sessions from the legacy idle completion sender.
13. Structural localization validation for every bot config.
14. Representative localization fixtures in both base/learning directions,
    including a non-English target language.
15. Existing users remaining outside interactive onboarding until they send
    `/start` to an enabled bot.
16. Admin funnel counts, time-window calculations, and bot-pair segmentation.

The API test suite, TypeScript checks, bot-config validation, schema snapshot
check, and affected Mini App/admin build must pass before deployment.

## Rollout and Rollback

`BOT_ONBOARDING_V2_ENABLED_BOT_KEYS` follows existing bot-key rollout
semantics:

- empty: do not create or reset interactive sessions;
- comma-separated keys: enroll new users and honor explicit `/start` restarts
  on those bots;
- `*`: apply the same behavior to every configured bot;
- unknown keys: fail startup validation.

Deployment proceeds in stages:

1. Update and review localization for all bot pairs.
2. Deploy the migration, runtime, admin analytics, and feature flag with the
   flag empty.
3. Enable `uk-en` as the first canary.
4. Verify the full voice, text, repeat-example, level, retry, and continuation
   paths and compare the ten-minute funnel with the legacy baseline.
5. Enable a bot with a different base and learning language to validate
   localization direction.
6. Expand to all bots only when completion, error, and latency guardrails are
   healthy.
7. Retire the legacy idle completion sender in a separate cleanup after the
   global cohort no longer depends on it.

Immediate rollback clears the feature flag. It does not delete sessions,
change user levels, or roll back the migration. New users and existing users
who send `/start` receive the legacy start path; active interactive users can
still send normal practice messages and resume their saved onboarding if the
flag is restored.

## Success Criteria

- More new users receive a personalized correction within ten minutes of
  `/start` than under the legacy flow.
- Voice remains the majority completion path; the text fallback prevents a
  hard block without becoming the dominant choice.
- No enabled bot displays onboarding instructions in the wrong base language
  or examples in the wrong learning language.
- Existing users are not enrolled automatically; only an explicit `/start` on
  an enabled bot restarts onboarding.
- Retries and repeated callbacks do not duplicate XP, completion, or analytics.
- Day-1 reminders, persistent keyboards, and admin funnel reporting work for
  both interactive and legacy completion sources.
- The first correction remains concise and contains no more than two issues.
