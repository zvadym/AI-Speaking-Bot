# Notifications Strategy

Working document for product, copy, and implementation decisions around client notifications for the Telegram language-learning bots.

The goal is to increase retention and useful practice, without turning the bots into spam machines.

## Goals

- Help users come back to practice at the right moment.
- Protect and reinforce daily/weekly habits.
- Continue useful conversations, not generic "come back" nags.
- Support activation, retention, and conversion with different message types.
- Keep the product feeling like a teacher, not like a CRM funnel.

## Non-goals

- Sending daily reminders to everyone by default.
- Treating all inactive users the same way.
- Optimizing for send volume.
- Using guilt-heavy or manipulative copy.

## Product Principles

- Every notification must have a clear user benefit.
- Every notification should have one primary CTA only.
- Notifications should feel contextual, short, and easy to answer.
- Triggered behavioral messages are better than broad generic blasts.
- Quiet users should get fewer touches over time, not more.
- The system should always prefer the highest-priority reminder and suppress the rest.
- Reminder copy should be localized per bot and base language.

## Core Rule: Broadcasts vs Scheduled Tasks

Use the existing systems differently:

- `broadcast_campaigns` should be used for manual campaigns, operator-led experiments, launches, announcements, pricing notices, or targeted one-off messages.
- `scheduled_task_dispatches` should be used for automated lifecycle reminders such as streak saver, continue conversation, weekly digest, and win-back sequences.

Reason:

- Broadcasts already support audience preview, filters, media, and reply markup.
- Scheduled task dispatches already give us per-user dedupe, attempts, send status, and task-level history.
- Automated retention logic belongs in scheduled jobs, not in the manual broadcast workflow.

## Current Repo Fit

The repo already has most of the building blocks we need:

- `user_bots.last_seen_at`, `is_active`, `level`, `reply_mode`, topic state, and nudge flags exist.
- `user_progress` already stores `streak_current`, `streak_best`, `streak_last_day`, and XP totals.
- `scheduled_task_dispatches` already exists and is currently used for onboarding completion sends.
- `broadcast_campaigns` and `broadcast_recipients` already support targeted sends with preview.
- `action_events` already tracks several funnel and behavior milestones.

Important implementation note:

- Manual broadcast streak filters are range-based and derived from activity in a selected time window.
- Automated streak saver logic should use the canonical streak state in `user_progress`, not the range-based broadcast calculation.

Another important note:

- Broadcasts and current scheduled sends are tracked in dispatch tables, but they are not inserted into `messages`.
- If we send a very contextual "continue the conversation" reminder, and the user replies to that reminder later, the reminder itself is not in chat history for the LLM.
- For contextual reminders we should either:
  - persist the reminder as an assistant message in `messages`, or
  - keep the reminder standalone and easy to reply to without historical context.

## Anti-Spam Guardrails

These should be treated as product rules, not optional tuning.

- Max 1 automated behavioral nudge per `chat_id + bot_key` in 24 hours.
- Max 3 automated behavioral nudges in 7 days without a user reply.
- Suppress automated nudges if the user was active in the last 8-12 hours.
- Suppress automated nudges on the same day as a manual broadcast, support reply, or billing event.
- Respect quiet hours in the user's local timezone.
- Do not send two different reminders for the same moment; choose one winner.
- Stop a sequence immediately after the user returns.
- Give users an obvious way to mute or reduce reminders.

Recommended defaults:

- Quiet hours: `21:00-09:00` local time.
- Weekly digest: at most once per calendar week.
- Continue-conversation reminder: at most once per conversation.
- Win-back sequence: no more than 3 touches across 14 days.

## Notification Priority Order

If multiple reminders are eligible at the same time, choose only one. Suggested order:

1. Transactional or billing messages.
2. Onboarding activation follow-up.
3. Streak saver.
4. Continue conversation.
5. Weekly digest.
6. Win-back sequence.
7. Marketing or general broadcast.

This priority order should be enforced in the scheduler, not left to chance.

## Notification Catalog

Start with a small set of automated reminders. This is enough for a strong v1.

### 1. Day 1 Return

Purpose:

- Convert first use into second-day habit.

Trigger:

- User completed onboarding / had a meaningful first session.
- No return after roughly `20-26 hours`.

Message style:

- Light, encouraging, very low-friction.
- No guilt, no hard sell.

CTA:

- Ask for one simple reply in the target language.

Example copy:

> Ready for a 3-minute practice? Send one sentence about your day in Italian.

Notes:

- This is one of the highest-value reminders in the system.
- Existing `day1_return` analytics can help measure whether this is working.

### 2. Continue Conversation

Purpose:

- Bring the user back into an unfinished exchange while context is still fresh.

Trigger:

- User had a real conversation.
- The latest assistant message is unanswered.
- User stopped for `2-6 hours`.
- Conversation reminder has not been sent for that thread.

Message style:

- Specific and contextual.
- Feels like the teacher is continuing naturally.

CTA:

- Ask the user to answer the pending question or send one more sentence.

Example copy:

> Want to continue? Tell me one more thing about your weekend in German.

Notes:

- Best used only for users who already engaged meaningfully.
- If we make this highly contextual, we should probably store the reminder into `messages`.

### 3. Streak Saver

Purpose:

- Preserve momentum for users with an active streak.

Trigger:

- `user_progress.streak_current > 0`
- No activity yet on the user's current local day.
- Current time is close to the user's usual practice window.

Message style:

- Short, useful, motivating.
- Mention streak as context, not pressure.

CTA:

- Ask for a single sentence or very short voice note.

Example copy:

> Your 4-day streak is still alive. Send one sentence now and keep it going 🔥

Notes:

- Send once per day at most.
- Do not send this too early in the day.
- Strong candidate for personalized timing.

### 4. Weekly Progress Digest

Purpose:

- Reinforce progress and identity for engaged users.

Trigger:

- User was active in the last 7 days.
- User has meaningful progress to show.
- Weekly digest has not been sent this week.

Message style:

- Celebratory, reflective, useful.

CTA:

- Offer a next step: a mini challenge, a topic, or a return prompt.

Example copy:

> This week: 4 practice days, 118 XP. Want a quick challenge to make it 5?

Notes:

- This is not for cold users.
- Strongly personalized metrics make this feel earned.

### 5. Win-back D3 / D7 / D14

Purpose:

- Re-engage users who drifted away without hammering them.

Trigger:

- No activity for 3, 7, or 14 days.

Message style by step:

- `D3`: easy restart, low-friction, gentle.
- `D7`: novelty angle, new topic, teacher angle, or useful challenge.
- `D14`: final comeback message, still respectful.

Example copy:

> Want an easy restart? Send me one sentence and I’ll help correct it.

> Want a new topic? We can do travel, work, or small talk today.

> If you want to come back, I’m here. We can restart with a 2-minute exercise.

Notes:

- Do not repeat the same copy across all steps.
- Stop after the user returns.
- After 14 days, go quiet unless there is a meaningful product event.

### 6. Usage Limit / Plan / Billing Notifications

Purpose:

- Inform users about limits, trial state, renewals, or plan changes.

Trigger:

- Near voice limit.
- Trial ending.
- Renewal or billing event.

Message style:

- Transactional, clear, direct.

Notes:

- These are not "behavioral nudges" and should not share the same copy style.
- They should still respect clarity and brevity.

## Suggested User Segments

The scheduler should think in segments, not in one global reminder rule.

- New user: first 48 hours after start.
- Activating user: used product 1-3 times, still fragile.
- Habit user: active streak, recurring use.
- Engaged user: recent usage + meaningful XP + multiple sessions.
- At-risk user: previously active, now fading.
- Dormant user: no activity for 14+ days.
- Paid user: should get fewer generic nudges and more relevant product/use reminders.

## Suggested Eligibility Logic

### Day 1 Return

- Had onboarding completion or meaningful first session.
- No user activity after that moment.
- First reminder only.

### Continue Conversation

- Conversation had enough depth to justify re-entry.
- Latest assistant turn is still the latest turn.
- User has not been active since.
- Reminder for this conversation has not already been sent.

### Streak Saver

- Current streak is greater than zero.
- User has not practiced today.
- It is late enough in the day to be helpful.
- User did not already receive another automated behavioral nudge in the last 24h.

### Weekly Digest

- Active in the last 7 days.
- Has meaningful stats worth showing.
- No digest sent this week.

### Win-back

- No activity since the relevant inactivity threshold.
- No strong reason to suppress.
- Previous step in the sequence was either not sent or was unanswered.

## Copy Rules

All reminder copy should follow these rules:

- Sound like a helpful teacher.
- Be short enough to read instantly in Telegram.
- Include one concrete next action.
- Avoid generic lines like "We miss you" or "Come back now".
- Avoid guilt-heavy streak language.
- Avoid repeating the same opening every time.
- Prefer a direct practice prompt over abstract encouragement.
- Mention level, topic, streak, XP, or plan only when it improves relevance.

What good copy usually looks like:

- "Send one sentence about your day."
- "Want to continue this topic?"
- "Your streak is still alive."
- "This week you practiced 4 times."

What bad copy usually looks like:

- "Hey, we noticed you haven’t been active."
- "Come back to the app now."
- "Don’t lose your streak!!!"
- "Special offer inside" for normal learning reminders.

## Localization and Storage of Copy

Reminder copy should live with bot-localized copy, not in hardcoded worker logic.

Recommended location:

- `deploy/bots/*.json`

Recommended structure:

```json
{
  "locale": {
    "notifications": {
      "day1_return": [
        "Ready for a 3-minute practice? Send one sentence about your day in Italian."
      ],
      "streak_saver": [
        "Your 4-day streak is still alive. Send one sentence now and keep it going 🔥"
      ],
      "continue_conversation": [
        "Want to continue? Tell me one more thing about your weekend in German."
      ]
    }
  }
}
```

Why:

- This keeps copy per bot and per language pair.
- It aligns with the repo convention that bot configs are the source of truth for bot behavior and locale content.
- It makes copy iteration easier without hunting through worker code.

## Data and Preference Model

Recommended additions for `user_bots` or an adjacent settings table:

- `notifications_enabled boolean`
- `notification_tz text` or `timezone_offset_minutes integer`
- `preferred_practice_hour smallint`
- `quiet_hours_start smallint`
- `quiet_hours_end smallint`
- `last_behavioral_nudge_at timestamptz`
- `last_behavioral_nudge_type text`
- `notification_paused_until timestamptz`

Minimal v1:

- `notifications_enabled`
- `timezone_offset_minutes`
- `preferred_practice_hour`
- `last_behavioral_nudge_at`
- `last_behavioral_nudge_type`

Why timezone matters:

- Current backend logic is mostly UTC-centric.
- Habit reminders are much better when sent near the user's usual local window.
- The miniapp is the easiest place to capture timezone reliably.

## Scheduling Model

Use `scheduled_task_dispatches` for automated reminders.

Suggested task types:

- `day1_return`
- `continue_conversation`
- `streak_saver`
- `weekly_digest`
- `winback_d3`
- `winback_d7`
- `winback_d14`

Suggested `schedule_key` strategy:

- `day1_return`: first eligible date/hour bucket
- `continue_conversation`: conversation or assistant message id
- `streak_saver`: local date, e.g. `2026-03-10`
- `weekly_digest`: ISO week, e.g. `2026-W11`
- `winback_d3`: inactivity checkpoint key

Why this fits:

- The unique key on `scheduled_task_dispatches` already prevents duplicates per task + user + bot + schedule slot.
- `payload_json` can store metadata like variant id, trigger source, and selected copy.

## Message Selection Engine

The scheduler should not independently send all eligible reminders. It should:

1. Build candidate reminders for a user.
2. Apply suppression and cooldown rules.
3. Pick the single highest-priority candidate.
4. Dispatch it.
5. Record the outcome and metadata.

This is the difference between a smart system and a spammy one.

## Analytics and Measurement

Telegram does not give reliable "open rates" in the same way email does, so we should measure behavior.

Primary metrics:

- Reply within 24 hours of reminder.
- Return within 24 hours.
- Return within 7 days.
- Practice session count after reminder.
- Streak preserved after streak saver.
- Block / inactive / delivery failure rate after sends.
- Conversion uplift for relevant paid/billing nudges.

Recommended experimentation rule:

- Keep a 10% holdout group for each automated reminder type.

Without a holdout, we can measure correlation but not real lift.

## Logging Recommendations

V1 can work with existing dispatch records, but we should log richer reminder metadata.

At minimum, capture:

- `task_type`
- `chat_id`
- `bot_key`
- `schedule_key`
- `variant_id`
- `copy_key`
- `sent_at`
- `status`
- `last_error`

Possible approaches:

- Reuse `scheduled_task_dispatches.payload_json` for variant and trigger metadata.
- Later, add a dedicated `notification_events` table if attribution needs become more detailed.

## Use of Broadcasts

Broadcasts should still play an important role.

Best uses for broadcast campaigns:

- New feature announcement.
- Teacher or topic launch.
- Plan or pricing changes.
- One-off retention experiments on a narrow audience.
- Re-engagement test before automating a sequence.

Broadcast best practices:

- Always preview the audience first.
- Start with a small segment and measure outcomes.
- Treat broadcasts as experiments or announcements, not habit infrastructure.
- Broadcasts should still respect the overall reminder budget when possible.

## Rollout Plan

### Phase 1: Manual Experiments

- Draft copy variants for day1 return, streak saver, continue conversation, and win-back.
- Test a few of them manually on small broadcast segments.
- Use current admin preview/filtering to validate audience assumptions.

### Phase 2: First Automated Nudges

- Implement `day1_return`.
- Implement `streak_saver`.
- Implement `continue_conversation`.
- Add basic cooldown logic and one-message-per-day rule.

### Phase 3: Preference Layer

- Add reminder preferences and timezone capture.
- Expose simple controls in the miniapp.
- Respect quiet hours and preferred hour.

### Phase 4: Retention Expansion

- Add weekly digest.
- Add win-back D3/D7/D14 sequence.
- Add attribution logging and experiment holdouts.

## Recommended First Scope

If we want the smallest high-value scope, build this first:

- `day1_return`
- `streak_saver`
- `continue_conversation`
- Global anti-spam rules
- Localized reminder copy in bot configs

This gives real retention value without overcomplicating the system.

## Open Decisions

These decisions should be made before implementation:

- Should reminder preferences live in `user_bots` or a new dedicated table?
- Should contextual reminders be stored into `messages`?
- Should users be able to pause reminders from Telegram directly, from the miniapp, or both?
- How should we infer timezone before the user opens the miniapp?
- What exact inactivity thresholds should define D3/D7/D14 win-back?
- What is the minimum conversation depth required for a continue-conversation reminder?

## Short Summary

The right notification system for this product is:

- small in surface area,
- highly contextual,
- strict about suppression,
- localized per bot,
- built on scheduled tasks for automation,
- and supported by broadcasts for manual experiments and announcements.

If a message is not clearly useful to the user at that moment, it should not be sent.
