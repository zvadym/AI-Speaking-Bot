# Telegram AI Speaking Bot (UA UI) — n8n MVP Plan (EN + DE)

**Scope (phase 1):** Telegram-only, built in **n8n**.
**Core feature:** User sends **voice** in English or German → bot transcribes → generates a natural reply + corrections explained in **Ukrainian** → sends back to Telegram.
**Later:** Payments via Telegram, PRO limits.

## 0) One-time setup

1. Create a Telegram bot via **BotFather** → get `BOT_TOKEN`.
2. In BotFather:

   * `/setcommands` (minimal):

     * `start` — onboarding
     * `lang` — choose English/German
     * `help` — usage
     * `pro` — explain PRO
     * `buy` — start payment
3. Deploy **n8n** (local or server) and open UI.

---

## 1) Workflow #1 — “Telegram In → Voice → Transcribe → AI Reply+Corrections → Send Back”

Goal: validate the end-to-end pipeline today.

### 1.1 Nodes (minimum)

1. **Telegram Trigger**

   * Update types: `message`
2. **IF** node: check if incoming message contains voice

   * Condition: `{{$json.message.voice}}` exists
   * **true** → voice branch
   * **false** → text branch (for now: ask user to send a voice message)

---

### 1.2 Voice branch — get audio file from Telegram

3. **HTTP Request** → Telegram `getFile`

   * Method: `GET`
   * URL:
     `https://api.telegram.org/bot{{$env.BOT_TOKEN}}/getFile?file_id={{$json.message.voice.file_id}}`

4. **HTTP Request** → download file binary

   * Method: `GET`
   * URL:
     `https://api.telegram.org/file/bot{{$env.BOT_TOKEN}}/{{$json.result.file_path}}`
   * Response: **Binary** (store as binary data in n8n)

---

### 1.3 STT — transcribe audio to text

5. **HTTP Request** → OpenAI Audio Transcriptions (multipart/form-data)

   * URL: `https://api.openai.com/v1/audio/transcriptions`
   * Headers:

     * `Authorization: Bearer {{$env.OPENAI_API_KEY}}`
   * Body type: `Form-Data`
   * Fields:

     * `model` = `gpt-4o-mini-transcribe`
     * `file` = binary from step 4
   * Output: `text` (the transcript)

---

### 1.4 LLM — produce reply + corrections (UA explanations)

6. **OpenAI call** (HTTP Request to Responses / Chat Completions)

   * Inputs:

     * `target_language`: `"EN"` or `"DE"`
     * `transcript`: string from STT
     * (optional) `level`: `"A1"..."C1"`
   * Output must be stable and structured.

**Recommended response format (plain text):**

* `Reply:` (target language, 2–5 sentences)
* `Corrections (UA):` 2–4 bullet points
* `Try again:` 1 sentence to repeat correctly
* `Next question:` 1 follow-up question (target language)

**System prompt (starter, short):**

* You are a friendly conversation partner.
* First respond naturally in the **target language**.
* Then provide **2–4 corrections in Ukrainian** with brief explanations.
* Don’t be dry. Keep it short and practical.

---

### 1.5 Send result back to Telegram

7. **Telegram** → `sendMessage`

   * `chat_id` = `{{$json.message.chat.id}}`
   * `text` = LLM output (from step 6)

✅ After this workflow works, you have a functional MVP:
**voice → transcript → AI conversation + UA corrections → Telegram message back**.

---

## 2) Add language selection (EN/DE) + user state

Goal: store user preference per chat.

### 2.1 Command `/lang` with inline buttons

* Implement inline keyboard:

  * “🇬🇧 English”
  * “🇩🇪 Deutsch”

### 2.2 Persistence (choose one)

* **Option A (fastest):** n8n **Data Store**

  * key: `chat_id`
  * value: `{ target_language: "EN" | "DE" }`
* **Option B (more scalable):** Postgres/SQLite

  * table: `users(chat_id PRIMARY KEY, target_language, level, pro_until, created_at, updated_at)`

### 2.3 Use preference in Workflow #1

Before the LLM node, fetch `target_language` for the chat_id and pass it into step 6.

---

## 3) Add Free tier usage limits (prep for PRO)

Goal: enforce a daily voice limit using Telegram voice metadata.

### 3.1 Measure usage

Use Telegram `message.voice.duration` (seconds).

### 3.2 Store daily usage

* key: `${chat_id}:${YYYY-MM-DD}`
* value: `total_seconds_used_today`

### 3.3 Enforce

* If `total_seconds_used_today + new_duration > DAILY_LIMIT_SECONDS`:

  * send a paywall message
  * suggest `/buy`
* Else:

  * proceed with STT + LLM
  * increment usage counter

---

## 4) Payments via Telegram (after MVP is stable)

Two parts: send invoice + handle confirmations.

### 4.1 Workflow #2 — “/buy → sendInvoice”

* Telegram Trigger: `message`
* IF message text == `/buy`
* Call Telegram `sendInvoice`

  * Requires a Telegram-supported payment provider token (e.g., Stripe via Telegram payments)
  * Price options:

    * Monthly
    * Yearly

### 4.2 Workflow #3 — Payment updates

Listen for:

* `pre_checkout_query`
* `successful_payment` (inside message payload)

**Actions:**

* On `pre_checkout_query`: answer with `answerPreCheckoutQuery(ok=true)`
* On `successful_payment`:

  * set `pro_until = now + 30d` (or 365d)
  * send confirmation message: “Payment successful ✅”

---

## “Today” validation checklist (6 hours)

1. Telegram Trigger receives messages ✅
2. Voice branch: `getFile` → download binary ✅
3. OpenAI transcription returns transcript ✅
4. LLM generates “Reply + Corrections (UA)” ✅
5. sendMessage returns result to Telegram ✅

