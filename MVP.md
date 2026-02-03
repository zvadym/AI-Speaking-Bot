## 🎯 Project Goal

Build a **Telegram bot** for **learning English and German**, using **voice messages** and **AI feedback**. The bot should:

* Automatically **transcribe and analyze** user voice messages
* Check for **mistakes** in the message
* If errors are found: send a friendly **correction with explanations and examples**
* Continue conversation in a natural tone, adapted to the user’s language level
* Handle **multi-language input** (e.g., reject messages in the wrong language)
* Allow users to select **voice or text** replies
* Track user **history** and **usage**
* Support **paid plans** (Plus, Pro)

---

## ✅ Tech Stack & Tools

* **Telegram bot** (using BotFather, Telegram API)
* **n8n (v2+)** for automation and workflow building
* **Docker + Ngrok** for local testing
* **OpenAI Whisper** for transcription and error checking
* **PostgreSQL** for user/message/history/payments database
* **Stripe (hosted Checkout)** for monetization

---

## 💡 Key Features Implemented

### 🎙 Voice Message Workflow

* Receive Telegram voice message via trigger
* Transcribe using OpenAI “Transcribe a recording” node
* Store and parse transcript
* Check if language matches the target language
* Detect mistakes using GPT
* Send one of:
  * ✅ Friendly follow-up if correct
  * ❌ Explanation + corrected version + continue
* Markdown/HTML formatting used for clarity

### 🔄 Conversation Flow

* Tracks recent history (20–30 messages or summarized)
* Level and language are selected in `/start`
* Includes emoji indicators for correct/incorrect/explanation
* Supports optional voice replies using TTS
* Shows progress ("Thinking...", "Almost done...") during long processing

### 📦 Payment and Plans

* Free: 20 messages (~5 min)
* Plus (€5/month): 1h/week
* Pro (€15/month): 10h/week
* Users can **upgrade**, **downgrade**, or **cancel auto-renew**
* Payments processed using **Stripe subscriptions**
* Plans table and usage tracking implemented
* Workflow handles:

  * `/plans` UI with buttons and descriptions
  * `pay:sub:plus` and `pay:sub:pro` actions
  * `successful_payment` activation
  * Edge cases (e.g., upgrades mid-period, downgrades delayed)

---

## 🔧 Implementation Notes

* Voice transcription sometimes “corrected” grammar — problematic for error detection
* Language detection and enforcement are done using GPT
* Stripe-only flow inside Telegram mini-app (policy risk accepted)
* Created Telegram UI messages, buttons, and error handlers
* Handled DB cases like empty message history, new user joins, etc.
* Built `/plans`, `pay:*`, `successful_payment` branches

---

## 🧪 Experiments & Problems Solved

* Made OpenAI response formatting Telegram-safe (switched to HTML for explanation blocks)
* Used Telegram “Edit Message” to simulate progress bar
* Resolved issues with file handling and binary input in n8n
* Handled errors like `"Bad Request: can't parse entities"` or invalid response_format schemas
* Designed DB schema: `users`, `messages`, `plans`, `payments`, `usage`

---

## 🖼 Design and Visuals

* Generated custom **bot icon** (Ukrainian female, flags, soft Eve-like look)
* Used emoji consistently for correction flow:

  * ✅ / ❌ for right/wrong
  * 💡 or 🧠 for explanation
* Planned to build a Telegram mini-app page (but postponed due to iOS/Stripe limitations)

---

## 🔜 Planned / Next Features

* Add better UI for `/plans` and `/profile` command
* Implement "pause auto-renew", "remind before next payment"
* Build analytics and dashboard
* Multi-language interface (Ukrainian/German)
* Dynamic leveling system (A1 → C1)
