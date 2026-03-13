This directory contains API-owned LLM prompt templates.

Scope:
- reminder prompts used by `apps/api/src/jobs.js`
- topic generation prompts used by `apps/api/src/topic-generator.js`

Out of scope:
- bot/runtime tutor prompts in `deploy/prompts/`
  Those are the source of truth for rendered n8n workflow prompts and should stay there.

Template format:
- Markdown files with `{{variable_name}}` placeholders
- Rendered through `renderLlmPrompt()` in `index.js`
