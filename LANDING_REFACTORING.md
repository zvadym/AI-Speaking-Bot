# 🐦 Landing Page Refactor — “Practice Paths” (Romi Concept)

## 🎯 Goal

Replace the current **“Teachers” concept** with a unified **Romi identity** and restructure the landing page around:

> **Practice Paths (language pairs + goals)**

Instead of:

* many fictional teachers

We present:

* **one companion (Romi)**
* many **practice paths (language + intent)**

---

## 1. 🔄 Rename & Routing

### Change navigation label

* `Teachers` → **Practice Paths**

### Recommended URL changes

* `/en/teachers` → `/en/practice`
* (optional redirect: keep `/teachers` → `/practice` for SEO continuity)

---

## 2. 🧱 Page Structure (NEW)

### Section 1 — Hero

**Title:**

> Practice with Romi

**Subtitle:**

> One friendly speaking companion. Multiple language paths.
> Speak every day in Telegram.

**CTA:**

* Primary: `Start practicing`
* Secondary (optional): `Choose your path`

**Visual:**

* Romi mascot (centered or right side) - apps/landing/public/avatar/base.png

---

### Section 2 — Practice Paths Grid (MAIN BLOCK)

#### Section title:

> Choose your practice path

#### Structure:

Group by **base language (user’s native language)**

---

### Example groups:

#### For English speakers

* English → German
* English → Spanish
* English → Italian

#### For Ukrainian speakers

* Ukrainian → English
* Ukrainian → German

#### For German speakers

* German → English
* German → Spanish

---

### Card Design (CRITICAL)

Each card represents a **practice path**, NOT a teacher.

#### Card structure:

**Title:**

> English → German

**Subtitle:**

> Practice real conversations with Romi

**Description (1 line):**

> Speak daily, get corrections, build confidence.

**Optional tag:**

* `Daily`
* `Work`
* `Travel`

**CTA button:**

> Start with Romi →

---

### ❗ Important rules

* Do NOT show human names
* Do NOT show multiple avatars
* Use **same Romi avatar everywhere**
* Keep cards minimal (scan-friendly)

---

## 3. 🧠 Data Model Changes

### BEFORE:

```json
{
  "teacher_name": "Emma",
  "language_pair": "Italian → English"
}
```

### AFTER:

```json
{
  "base_language": "English",
  "target_language": "German",
  "slug": "en-de",
  "title": "English → German",
  "description": "Practice real conversations with Romi",
  "tags": ["daily"]
}
```

---

## 4. 🧩 Component Changes

### Remove:

* Teacher avatars (multiple)
* Teacher names (Emma, John, etc.)
* “Meet your teacher” sections

### Replace with:

* **Single Romi avatar component**
* Reusable **PracticePathCard**

---

## 5. 🧱 PracticePathCard Component

### Props:

```ts
{
  baseLanguage: string
  targetLanguage: string
  title: string
  description: string
  slug: string
  tags?: string[]
}
```

### Behavior:

* Click → opens Telegram bot with correct `start` param
* Example:

  ```
  https://t.me/your_bot?start=en-de
  ```

---

## 6. 🎯 Copy Guidelines (IMPORTANT)

### Tone:

* simple
* direct
* calm
* no marketing fluff

### Examples:

**Good:**

* Speak every day
* Short practice, real improvement
* No pressure, just conversation

**Avoid:**

* “Master fluency today!”
* “Best AI teacher ever”
* Over-promising

---

## 7. 🐦 Romi Integration

### Rules:

* Always refer to assistant as **Romi**
* Never use:

  * “AI”
  * “bot”
  * “teacher”

### Example usage:

* “Practice with Romi”
* “Start with Romi”
* “Romi helps you speak naturally”

---

## 8. 🔍 SEO Considerations

### Update page title:

> Practice Languages with Romi | Speak in Telegram

### Keep keywords:

* “learn English”
* “learn German”
* “speaking practice”

### Add structured sections per language pair:

* Helps indexing for long-tail queries

---

## 9. 🚀 Migration Plan

### Phase 1 (fast)

* Replace UI labels
* Replace cards (teachers → paths)
* Keep same backend

### Phase 2

* Update URLs
* Add grouping by base language

### Phase 3

* Add filters:

  * base language
  * target language
  * goal (daily / work / travel)

---

## 10. ❌ What NOT to do

* Do NOT mix Romi + teachers
* Do NOT create “Romi Emma”, “Romi John”
* Do NOT keep multiple personalities

---

## 11. ✅ Final UX Principle

User should feel:

> “I choose how I want to practice”
> NOT
> “I choose a teacher”

---

## 🔚 Result

* Stronger brand (Romi)
* Simpler UX
* Better scalability (more bots = more paths)
* Better conversion (decision is easier)

---

## (Optional Next Step)

Add second dimension later:

**Practice Modes:**

* Daily
* Work
* Travel
* Interview

→ Combined with language pairs

Example:

> English → German (Work)

