<template>
  <section class="card panel topics-panel">
    <header class="topics-hero">
      <div class="topics-hero-copy">
        <div class="panel-kicker">Topics</div>
        <h2 class="panel-title">Per-bot topic catalog</h2>
        <p class="panel-sub">
          Curate the pre-generated conversation packs used by Telegram topic selection.
          Drafts generated with AI stay editable until you save them.
        </p>

        <div class="topics-hero-stats">
          <div class="topics-stat">
            <span class="topics-stat-label">Catalog</span>
            <strong>{{ topics.length }}</strong>
            <small>topic{{ topics.length === 1 ? '' : 's' }}</small>
          </div>
          <div class="topics-stat">
            <span class="topics-stat-label">Free access</span>
            <strong>{{ catalogStats.freeVisible }}</strong>
            <small>visible to free users</small>
          </div>
          <div class="topics-stat">
            <span class="topics-stat-label">Pro only</span>
            <strong>{{ catalogStats.proOnly }}</strong>
            <small>premium topics</small>
          </div>
        </div>
      </div>

      <div class="topics-actions">
        <button class="btn ghost" type="button" :disabled="!password || loading" @click="refreshTopics">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
        <button class="btn" type="button" :disabled="!password || loading" @click="openGenerateDialog">
          Generate with AI
        </button>
        <button class="btn primary" type="button" :disabled="!password || loading" @click="openNewTopic">
          New topic
        </button>
      </div>
    </header>

    <div class="panel-body topics-body">
      <div v-if="!password" class="callout topics-callout">Enter admin password above to unlock the topic studio.</div>
      <template v-else>
        <div class="topics-toolbar">
          <label class="field topics-filter">
            <span>Target bot</span>
            <select v-model="selectedBotKey" :disabled="loading || !bots.length" @change="refreshTopics">
              <option v-for="bot in bots" :key="bot.bot_key" :value="bot.bot_key">
                {{ botLabel(bot) }}
              </option>
            </select>
          </label>

          <div class="topics-toolbar-badges">
            <div class="toolbar-chip">
              <span class="toolbar-chip-label">Editing for</span>
              <strong>{{ selectedBotLabel }}</strong>
            </div>
            <div class="toolbar-chip">
              <span class="toolbar-chip-label">Updated</span>
              <strong>{{ topics.length ? formatStamp(topics[0]?.updated_at) : '—' }}</strong>
            </div>
          </div>
        </div>

        <div v-if="errorText" class="callout error topics-callout">{{ errorText }}</div>
        <div v-else-if="infoText" class="callout topics-callout">{{ infoText }}</div>

        <div class="topics-layout">
          <section class="topics-catalog card">
            <header class="topics-section-head">
              <div>
                <div class="topics-section-kicker">Catalog</div>
                <h3>Published topics</h3>
              </div>
              <div class="topics-section-note">Tap a card to edit, or start a new draft.</div>
            </header>

            <div v-if="topics.length" class="topic-list">
              <article
                v-for="topic in topics"
                :key="topic.topic_id"
                class="topic-card"
                :class="{ active: editor.originalTopicId === topic.topic_id }"
                tabindex="0"
                role="button"
                @click="editTopic(topic)"
                @keydown.enter.prevent="editTopic(topic)"
              >
                <div class="topic-card-main">
                  <div class="topic-card-avatar">{{ topic.emoji }}</div>

                  <div class="topic-card-copy">
                    <div class="topic-card-heading">
                      <h4>{{ topic.title_base }}</h4>
                      <span class="topic-access-pill" :class="topicAccessClass(topic.access_tier)">
                        {{ topicAccessLabel(topic.access_tier) }}
                      </span>
                    </div>

                    <p class="topic-card-goal">{{ topic.goal_base }}</p>

                    <div class="topic-card-meta">
                      <span class="topic-meta-chip">
                        <small>ID</small>
                        <code>{{ topic.topic_id }}</code>
                      </span>
                      <span class="topic-meta-chip">
                        <small>Order</small>
                        <strong>{{ topic.sort_order }}</strong>
                      </span>
                      <span class="topic-meta-chip">
                        <small>Updated</small>
                        <strong>{{ formatStamp(topic.updated_at) }}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div class="topic-card-actions">
                  <button class="btn" type="button" :disabled="loading" @click.stop="editTopic(topic)">Edit</button>
                  <button class="btn danger" type="button" :disabled="loading" @click.stop="deleteTopic(topic)">Delete</button>
                </div>
              </article>
            </div>

            <div v-else class="empty-state topics-empty">
              <strong>No topics configured yet.</strong>
              <p>Start with a fresh draft or let AI scaffold one for the selected bot.</p>
            </div>
          </section>

          <aside class="topic-editor card">
            <div class="topic-editor-shell">
              <header class="topic-editor-hero">
                <div class="topic-editor-identity">
                  <div class="topic-editor-avatar">{{ editor.emoji || '🧩' }}</div>

                  <div class="topic-editor-copy">
                    <div class="panel-kicker">{{ editor.originalTopicId ? 'Update topic' : 'Create topic' }}</div>
                    <h3>{{ editor.title_base || editor.topic_id || 'New topic draft' }}</h3>
                    <p>
                      {{ selectedBotLabel }}
                      <span class="topic-editor-separator">•</span>
                      {{ editor.originalTopicId ? 'Connected to a saved catalog entry' : 'Draft not saved yet' }}
                    </p>
                  </div>
                </div>

                <div class="topic-editor-badges">
                  <span class="topic-access-pill" :class="topicAccessClass(editor.access_tier)">
                    {{ topicAccessLabel(editor.access_tier) }}
                  </span>
                  <span class="topic-count-pill">{{ editorCounts.allowed }} allowed</span>
                  <span class="topic-count-pill">{{ editorCounts.avoid }} blocked</span>
                  <span class="topic-count-pill">{{ editorCounts.starter }} starters</span>
                  <span class="topic-count-pill">{{ editorCounts.recovery }} recovery</span>
                </div>
              </header>

              <div class="topic-editor-grid">
                <section class="editor-section editor-span-2">
                  <div class="editor-section-head">
                    <div>
                      <div class="topics-section-kicker">Identity</div>
                      <h4>Catalog metadata</h4>
                    </div>
                    <button v-if="hasEditorChanges" class="btn ghost" type="button" :disabled="saving" @click="resetEditor">
                      Reset
                    </button>
                  </div>

                  <div class="editor-fields editor-fields-identity">
                    <label class="field">
                      <span>Emoji</span>
                      <input v-model.trim="editor.emoji" type="text" maxlength="16" placeholder="🧩" />
                    </label>
                    <label class="field">
                      <span>Access</span>
                      <select v-model="editor.access_tier">
                        <option v-for="option in TOPIC_ACCESS_OPTIONS" :key="option.value" :value="option.value">
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Sort order</span>
                      <input v-model.number="editor.sort_order" type="number" min="0" max="100000" />
                    </label>
                    <label class="field">
                      <span>Topic ID</span>
                      <input v-model.trim="editor.topic_id" type="text" autocomplete="off" placeholder="daily-routine" />
                    </label>
                    <label class="field editor-span-2">
                      <span>Title (base language)</span>
                      <input v-model.trim="editor.title_base" type="text" autocomplete="off" placeholder="Daily routine" />
                    </label>
                    <label class="field editor-span-2">
                      <span>Goal (base language)</span>
                      <textarea v-model.trim="editor.goal_base" rows="3" placeholder="Talk about your usual day with practical details." />
                    </label>
                  </div>
                </section>

                <section class="editor-section">
                  <div class="editor-section-head compact">
                    <div>
                      <div class="topics-section-kicker">Guardrails</div>
                      <h4>Allowed areas</h4>
                    </div>
                    <span class="topic-count-pill">{{ editorCounts.allowed }} lines</span>
                  </div>
                  <label class="field">
                    <span>One item per line</span>
                    <textarea v-model="editor.allowed_base_text" rows="8" placeholder="Morning habits&#10;Commute&#10;Work or study&#10;Evening plans" />
                  </label>
                </section>

                <section class="editor-section">
                  <div class="editor-section-head compact">
                    <div>
                      <div class="topics-section-kicker">Guardrails</div>
                      <h4>Avoid areas</h4>
                    </div>
                    <span class="topic-count-pill">{{ editorCounts.avoid }} lines</span>
                  </div>
                  <label class="field">
                    <span>Keep the topic practical</span>
                    <textarea v-model="editor.avoid_base_text" rows="8" placeholder="Politics&#10;Medical advice&#10;Abstract philosophy" />
                  </label>
                </section>

                <section class="editor-section editor-span-2">
                  <div class="editor-section-head compact">
                    <div>
                      <div class="topics-section-kicker">Conversation</div>
                      <h4>Starter questions (target language)</h4>
                    </div>
                    <span class="topic-count-pill">{{ editorCounts.starter }} lines</span>
                  </div>
                  <label class="field">
                    <span>These kick off the first exchange</span>
                    <textarea v-model="editor.starter_questions_target_text" rows="8" placeholder="One question per line" />
                  </label>
                </section>

                <section class="editor-section editor-span-2">
                  <div class="editor-section-head compact">
                    <div>
                      <div class="topics-section-kicker">Conversation</div>
                      <h4>Recovery questions (target language)</h4>
                    </div>
                    <span class="topic-count-pill">{{ editorCounts.recovery }} lines</span>
                  </div>
                  <label class="field">
                    <span>Use these when the conversation stalls</span>
                    <textarea v-model="editor.recovery_questions_target_text" rows="8" placeholder="One question per line" />
                  </label>
                </section>
              </div>

              <p class="error" v-if="saveError">{{ saveError }}</p>
              <p class="hint topic-editor-hint" v-else>
                Starter and recovery questions should each contain 6-10 lines.
              </p>

              <div class="topic-editor-actions">
                <button class="btn ghost" type="button" :disabled="saving" @click="resetEditor">
                  Clear draft
                </button>
                <button class="btn primary" type="button" :disabled="!password || saving || !selectedBotKey" @click="saveTopic">
                  {{ saving ? 'Saving…' : (editor.originalTopicId ? 'Save changes' : 'Create topic') }}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </div>

    <div v-if="showGenerateDialog" class="topics-modal-backdrop" @click.self="closeGenerateDialog">
      <div class="topics-modal card">
        <div class="topic-editor-shell">
          <div class="editor-section-head">
            <div>
              <div class="panel-kicker">AI draft</div>
              <h3>Generate a topic skeleton</h3>
              <p class="topics-modal-sub">Use AI for the first draft, then tune the tone and guardrails by hand.</p>
            </div>
            <button class="btn ghost" type="button" :disabled="generating" @click="closeGenerateDialog">Close</button>
          </div>

          <div class="topic-editor-grid">
            <section class="editor-section editor-span-2">
              <div class="editor-fields">
                <label class="field editor-span-2">
                  <span>Bot</span>
                  <select v-model="generateForm.bot_key" :disabled="generating">
                    <option v-for="bot in bots" :key="bot.bot_key" :value="bot.bot_key">
                      {{ botLabel(bot) }}
                    </option>
                  </select>
                </label>
                <label class="field editor-span-2">
                  <span>Topic name</span>
                  <input
                    v-model.trim="generateForm.topic_name"
                    type="text"
                    autocomplete="off"
                    placeholder="Ordering at the pharmacy"
                    @keydown.enter.prevent="generateDraft"
                  />
                </label>
                <label class="field">
                  <span>Access</span>
                  <select v-model="generateForm.access_tier" :disabled="generating">
                    <option v-for="option in TOPIC_ACCESS_OPTIONS" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
              </div>
            </section>
          </div>

          <p class="error" v-if="generateError">{{ generateError }}</p>

          <div class="topic-editor-actions">
            <button class="btn ghost" type="button" :disabled="generating" @click="closeGenerateDialog">Cancel</button>
            <button
              class="btn primary"
              type="button"
              :disabled="generating || !generateForm.bot_key || !generateForm.topic_name.trim()"
              @click="generateDraft"
            >
              {{ generating ? 'Generating…' : 'Generate draft' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { apiJson } from '../lib/api.js';

const TOPIC_ACCESS_OPTIONS = [
  { value: 'all', label: 'All users' },
  { value: 'free', label: 'Free plan' },
  { value: 'pro', label: 'Pro only' }
];

const props = defineProps({
  apiBase: { type: String, required: true },
  password: { type: String, default: '' }
});

const emit = defineEmits(['stamp']);

const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
const errorText = ref('');
const infoText = ref('');
const saveError = ref('');
const generateError = ref('');
const bots = ref([]);
const topics = ref([]);
const selectedBotKey = ref('');
const showGenerateDialog = ref(false);

const generateForm = reactive({
  bot_key: '',
  topic_name: '',
  access_tier: 'all'
});

const editor = reactive({
  originalTopicId: '',
  bot_key: '',
  emoji: '🧩',
  sort_order: 0,
  access_tier: 'all',
  topic_id: '',
  title_base: '',
  goal_base: '',
  allowed_base_text: '',
  avoid_base_text: '',
  starter_questions_target_text: '',
  recovery_questions_target_text: ''
});

const editorSnapshot = ref('');

const hasEditorChanges = computed(() => JSON.stringify(editor) !== editorSnapshot.value);

const selectedBotLabel = computed(() => {
  const bot = bots.value.find((item) => item.bot_key === selectedBotKey.value) || null;
  return botLabel(bot);
});

const catalogStats = computed(() => {
  const freeVisible = topics.value.filter((topic) => String(topic.access_tier || '').trim().toLowerCase() !== 'pro').length;
  const proOnly = topics.value.filter((topic) => String(topic.access_tier || '').trim().toLowerCase() === 'pro').length;
  return { freeVisible, proOnly };
});

const editorCounts = computed(() => ({
  allowed: splitLines(editor.allowed_base_text).length,
  avoid: splitLines(editor.avoid_base_text).length,
  starter: splitLines(editor.starter_questions_target_text).length,
  recovery: splitLines(editor.recovery_questions_target_text).length
}));

function adminHeaders() {
  return { 'X-Admin-Password': props.password };
}

function splitLines(raw) {
  return String(raw || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinLines(items) {
  return (Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean).join('\n');
}

function isoStampNow() {
  return new Date().toLocaleString();
}

function formatStamp(value) {
  const stamp = new Date(String(value || ''));
  if (!Number.isFinite(stamp.getTime())) return '—';
  return stamp.toLocaleString();
}

function botLabel(bot) {
  if (!bot) return '—';
  const botKey = String(bot.bot_key || '').trim();
  const base = String(bot.base_language || '').trim();
  const learn = String(bot.learning_language || '').trim();
  const name = String(bot.bot_name || '').trim();
  return [botKey, name ? `· ${name}` : '', base && learn ? `(${base} → ${learn})` : ''].filter(Boolean).join(' ');
}

function topicAccessLabel(value) {
  return TOPIC_ACCESS_OPTIONS.find((option) => option.value === String(value || '').trim().toLowerCase())?.label || 'All users';
}

function topicAccessClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pro') return 'is-pro';
  if (normalized === 'free') return 'is-free';
  return 'is-all';
}

function nextSortOrder() {
  if (!topics.value.length) return 0;
  return Math.max(...topics.value.map((topic) => Number(topic.sort_order || 0))) + 10;
}

function applyDraftToEditor(draft = {}, { botKey = selectedBotKey.value, originalTopicId = '' } = {}) {
  editor.originalTopicId = originalTopicId;
  editor.bot_key = botKey || '';
  editor.emoji = String(draft.emoji || '🧩').trim() || '🧩';
  editor.sort_order = Number.isInteger(Number(draft.sort_order)) ? Number(draft.sort_order) : nextSortOrder();
  editor.access_tier = TOPIC_ACCESS_OPTIONS.some((option) => option.value === String(draft.access_tier || '').trim().toLowerCase())
    ? String(draft.access_tier || '').trim().toLowerCase()
    : 'all';
  editor.topic_id = String(draft.topic_id || '').trim();
  editor.title_base = String(draft.title_base || '').trim();
  editor.goal_base = String(draft.goal_base || '').trim();
  editor.allowed_base_text = joinLines(draft.allowed_base);
  editor.avoid_base_text = joinLines(draft.avoid_base);
  editor.starter_questions_target_text = joinLines(draft.starter_questions_target);
  editor.recovery_questions_target_text = joinLines(draft.recovery_questions_target);
  editorSnapshot.value = JSON.stringify(editor);
}

function resetEditor() {
  applyDraftToEditor({
    emoji: '🧩',
    sort_order: nextSortOrder(),
    access_tier: 'all',
    topic_id: '',
    title_base: '',
    goal_base: '',
    allowed_base: [],
    avoid_base: [],
    starter_questions_target: [],
    recovery_questions_target: []
  }, { botKey: selectedBotKey.value, originalTopicId: '' });
  saveError.value = '';
}

function openNewTopic() {
  infoText.value = '';
  resetEditor();
}

function editTopic(topic) {
  infoText.value = '';
  applyDraftToEditor(topic, { botKey: selectedBotKey.value, originalTopicId: topic.topic_id });
  saveError.value = '';
}

function buildPayloadFromEditor() {
  return {
    bot_key: selectedBotKey.value,
    emoji: editor.emoji,
    sort_order: Number(editor.sort_order || 0),
    access_tier: editor.access_tier,
    topic_id: editor.topic_id,
    title_base: editor.title_base,
    goal_base: editor.goal_base,
    allowed_base: splitLines(editor.allowed_base_text),
    avoid_base: splitLines(editor.avoid_base_text),
    starter_questions_target: splitLines(editor.starter_questions_target_text),
    recovery_questions_target: splitLines(editor.recovery_questions_target_text)
  };
}

async function refreshTopics() {
  if (!props.password) {
    bots.value = [];
    topics.value = [];
    selectedBotKey.value = '';
    errorText.value = '';
    infoText.value = '';
    emit('stamp', '');
    return;
  }
  loading.value = true;
  errorText.value = '';
  try {
    const query = selectedBotKey.value ? { bot_key: selectedBotKey.value } : undefined;
    const data = await apiJson(props.apiBase, '/admin/topics', { headers: adminHeaders(), query });
    bots.value = Array.isArray(data?.bots) ? data.bots : [];
    selectedBotKey.value = String(data?.selected_bot_key || bots.value[0]?.bot_key || '').trim();
    topics.value = Array.isArray(data?.items) ? data.items : [];
    if (!selectedBotKey.value) {
      resetEditor();
    } else if (
      !editor.originalTopicId ||
      editor.bot_key !== selectedBotKey.value ||
      !topics.value.some((topic) => topic.topic_id === editor.originalTopicId)
    ) {
      resetEditor();
    }
    emit('stamp', isoStampNow());
  } catch (err) {
    const detail = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    errorText.value = `Failed to load topics: ${detail}`;
    topics.value = [];
    emit('stamp', '');
  } finally {
    loading.value = false;
  }
}

async function saveTopic() {
  saveError.value = '';
  infoText.value = '';
  saving.value = true;
  try {
    const isUpdate = Boolean(editor.originalTopicId);
    const body = buildPayloadFromEditor();
    const path = isUpdate ? `/admin/topics/${encodeURIComponent(editor.originalTopicId)}` : '/admin/topics';
    const method = isUpdate ? 'PUT' : 'POST';
    const data = await apiJson(props.apiBase, path, { method, headers: adminHeaders(), body });
    const item = data?.item;
    await refreshTopics();
    if (item) {
      editTopic(item);
    }
    infoText.value = isUpdate ? 'Topic updated.' : 'Topic created.';
  } catch (err) {
    const detail = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    saveError.value = `Save failed: ${detail}`;
  } finally {
    saving.value = false;
  }
}

async function deleteTopic(topic) {
  if (!topic || !selectedBotKey.value) return;
  if (!window.confirm(`Delete topic "${topic.title_base}" (${topic.topic_id}) from ${selectedBotKey.value}?`)) return;
  errorText.value = '';
  infoText.value = '';
  loading.value = true;
  try {
    await apiJson(props.apiBase, `/admin/topics/${encodeURIComponent(topic.topic_id)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
      query: { bot_key: selectedBotKey.value }
    });
    if (editor.originalTopicId === topic.topic_id) {
      resetEditor();
    }
    await refreshTopics();
    infoText.value = 'Topic deleted.';
  } catch (err) {
    const detail = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    errorText.value = `Delete failed: ${detail}`;
  } finally {
    loading.value = false;
  }
}

function openGenerateDialog() {
  generateError.value = '';
  generateForm.bot_key = selectedBotKey.value || bots.value[0]?.bot_key || '';
  generateForm.topic_name = '';
  generateForm.access_tier = 'all';
  showGenerateDialog.value = true;
}

function closeGenerateDialog() {
  if (generating.value) return;
  showGenerateDialog.value = false;
}

async function generateDraft() {
  generateError.value = '';
  generating.value = true;
  try {
    const data = await apiJson(props.apiBase, '/admin/topics/generate-draft', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        bot_key: generateForm.bot_key,
        topic_name: generateForm.topic_name,
        access_tier: generateForm.access_tier,
        sort_order: nextSortOrder()
      }
    });
    selectedBotKey.value = String(data?.bot_key || generateForm.bot_key || '').trim();
    applyDraftToEditor(data?.draft || {}, {
      botKey: selectedBotKey.value,
      originalTopicId: ''
    });
    infoText.value = 'AI draft generated. Review and save when ready.';
    showGenerateDialog.value = false;
  } catch (err) {
    const detail = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    generateError.value = `Generation failed: ${detail}`;
  } finally {
    generating.value = false;
  }
}

watch(
  () => props.password,
  (next) => {
    if (!next) {
      bots.value = [];
      topics.value = [];
      selectedBotKey.value = '';
      showGenerateDialog.value = false;
      resetEditor();
      emit('stamp', '');
      return;
    }
    refreshTopics();
  },
  { immediate: true }
);
</script>

<style scoped>
.topics-panel {
  --topics-ink: #18242c;
  --topics-muted: rgba(24, 36, 44, 0.66);
  --topics-line: rgba(24, 36, 44, 0.1);
  --topics-panel-bg: linear-gradient(180deg, rgba(255, 251, 245, 0.96), rgba(250, 244, 235, 0.94));
  --topics-card-bg: rgba(255, 255, 255, 0.86);
  --topics-card-strong: rgba(255, 255, 255, 0.96);
  --topics-shadow: 0 22px 60px rgba(107, 76, 43, 0.12);
  --topics-accent: #b7612a;
  --topics-accent-soft: rgba(183, 97, 42, 0.12);
  --topics-pro: #6f3856;
  --topics-pro-soft: rgba(111, 56, 86, 0.12);
  --topics-free: #1d6f63;
  --topics-free-soft: rgba(29, 111, 99, 0.12);
  gap: 1.5rem;
  padding: 1.6rem;
  border: 1px solid rgba(160, 123, 91, 0.16);
  border-radius: 1.6rem;
  background: var(--topics-panel-bg);
  box-shadow: var(--topics-shadow);
  color: var(--topics-ink);
  overflow: hidden;
  position: relative;
}

.topics-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top left, rgba(183, 97, 42, 0.12), transparent 26rem),
    radial-gradient(circle at bottom right, rgba(29, 111, 99, 0.1), transparent 24rem),
    linear-gradient(90deg, rgba(24, 36, 44, 0.03) 1px, transparent 1px),
    linear-gradient(rgba(24, 36, 44, 0.03) 1px, transparent 1px);
  background-size: auto, auto, 28px 28px, 28px 28px;
  pointer-events: none;
}

.topics-panel > * {
  position: relative;
  z-index: 1;
}

.topics-hero,
.topics-actions,
.topics-toolbar,
.topics-toolbar-badges,
.topics-hero-stats,
.topic-card-main,
.topic-card-heading,
.topic-card-meta,
.topic-card-actions,
.topic-editor-identity,
.topic-editor-hero,
.topic-editor-badges,
.editor-section-head,
.topic-editor-actions {
  display: flex;
}

.topics-hero,
.topics-toolbar,
.editor-section-head,
.topic-editor-actions {
  justify-content: space-between;
}

.topics-hero {
  align-items: flex-start;
  gap: 1.5rem;
}

.topics-hero-copy {
  max-width: 62rem;
}

.topics-hero-copy .panel-title {
  margin-bottom: 0.55rem;
  font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  font-size: clamp(2rem, 2.6vw, 2.8rem);
  line-height: 0.98;
  letter-spacing: -0.03em;
}

.topics-hero-copy .panel-sub {
  max-width: 46rem;
  margin: 0;
  color: var(--topics-muted);
  font-size: 1rem;
  line-height: 1.7;
}

.topics-hero-stats {
  gap: 0.85rem;
  flex-wrap: wrap;
  margin-top: 1.2rem;
}

.topics-stat,
.toolbar-chip,
.topic-count-pill,
.topic-access-pill {
  border-radius: 999px;
}

.topics-stat {
  min-width: 9rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(24, 36, 44, 0.08);
  background: rgba(255, 255, 255, 0.64);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.topics-stat-label,
.toolbar-chip-label,
.topics-section-kicker,
.topic-meta-chip small {
  display: block;
  color: var(--topics-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.topics-stat strong {
  display: block;
  margin-top: 0.3rem;
  font-size: 1.4rem;
  line-height: 1;
}

.topics-stat small {
  display: block;
  margin-top: 0.26rem;
  color: var(--topics-muted);
}

.topics-actions {
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.topics-panel .btn {
  border-radius: 999px;
  border: 1px solid rgba(24, 36, 44, 0.14);
  background: rgba(255, 255, 255, 0.78);
  color: var(--topics-ink);
  box-shadow: 0 8px 18px rgba(24, 36, 44, 0.07);
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    border-color 160ms ease,
    background 160ms ease;
}

.topics-panel .btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(24, 36, 44, 0.22);
  box-shadow: 0 14px 28px rgba(24, 36, 44, 0.11);
}

.topics-panel .btn.primary {
  border-color: rgba(183, 97, 42, 0.26);
  background: linear-gradient(135deg, #c67137, #a34a25);
  color: #fffaf5;
}

.topics-panel .btn.ghost {
  background: rgba(255, 251, 246, 0.58);
}

.topics-panel .btn.danger {
  border-color: rgba(133, 54, 41, 0.24);
  color: #7a2f24;
}

.topics-body {
  padding-top: 0;
}

.topics-callout {
  border-radius: 1rem;
  border: 1px solid rgba(24, 36, 44, 0.08);
  background: rgba(255, 255, 255, 0.7);
}

.topics-toolbar {
  align-items: flex-end;
  gap: 1rem;
  margin-bottom: 1rem;
}

.topics-filter {
  min-width: min(32rem, 100%);
  flex: 1;
}

.topics-toolbar-badges {
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toolbar-chip {
  align-items: center;
  gap: 0.65rem;
  padding: 0.9rem 1rem;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(24, 36, 44, 0.08);
  min-width: 12rem;
  justify-content: space-between;
}

.toolbar-chip strong {
  font-size: 0.98rem;
  color: var(--topics-ink);
}

.topics-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(24rem, 0.92fr);
  gap: 1rem;
  align-items: start;
}

.topics-catalog,
.topic-editor,
.topics-modal {
  border: 1px solid rgba(24, 36, 44, 0.08);
  border-radius: 1.4rem;
  background: var(--topics-card-bg);
  box-shadow: 0 18px 42px rgba(78, 53, 33, 0.1);
  backdrop-filter: blur(12px);
}

.topics-catalog,
.topic-editor {
  overflow: hidden;
}

.topics-section-head,
.topic-editor-shell {
  padding: 1.15rem 1.15rem 1.2rem;
}

.topics-section-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: end;
  border-bottom: 1px solid var(--topics-line);
  background: rgba(255, 255, 255, 0.58);
}

.topics-section-head h3,
.topic-editor-hero h3,
.editor-section-head h4,
.topics-modal h3 {
  margin: 0.18rem 0 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.topics-section-note,
.topics-modal-sub,
.topic-editor-copy p,
.topic-editor-hint {
  margin: 0;
  color: var(--topics-muted);
  line-height: 1.6;
}

.topic-list {
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
}

.topic-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1.15rem;
  border: 1px solid rgba(24, 36, 44, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(247, 240, 230, 0.74));
  cursor: pointer;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.topic-card:hover,
.topic-card:focus-visible {
  transform: translateY(-2px);
  outline: none;
  border-color: rgba(183, 97, 42, 0.26);
  box-shadow: 0 20px 38px rgba(91, 57, 29, 0.14);
}

.topic-card.active {
  border-color: rgba(183, 97, 42, 0.3);
  background: linear-gradient(180deg, rgba(255, 249, 243, 0.98), rgba(247, 232, 214, 0.92));
  box-shadow: inset 0 0 0 1px rgba(183, 97, 42, 0.12), 0 18px 34px rgba(91, 57, 29, 0.16);
}

.topic-card-main {
  gap: 0.95rem;
  min-width: 0;
}

.topic-card-avatar,
.topic-editor-avatar {
  display: grid;
  place-items: center;
  border-radius: 1rem;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.9), transparent 55%),
    linear-gradient(145deg, rgba(183, 97, 42, 0.18), rgba(29, 111, 99, 0.12));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 12px 24px rgba(91, 57, 29, 0.1);
  flex: 0 0 auto;
}

.topic-card-avatar {
  width: 3.25rem;
  height: 3.25rem;
  font-size: 1.7rem;
}

.topic-card-copy {
  min-width: 0;
}

.topic-card-heading {
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.topic-card-heading h4 {
  margin: 0;
  font-size: 1.28rem;
  line-height: 1.1;
}

.topic-card-goal {
  margin: 0.38rem 0 0;
  color: var(--topics-muted);
  font-size: 0.98rem;
  line-height: 1.6;
}

.topic-card-meta {
  gap: 0.55rem;
  flex-wrap: wrap;
  margin-top: 0.78rem;
}

.topic-meta-chip {
  display: inline-flex;
  flex-direction: column;
  gap: 0.16rem;
  padding: 0.5rem 0.72rem;
  border-radius: 0.85rem;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(24, 36, 44, 0.07);
}

.topic-meta-chip strong,
.topic-meta-chip code {
  color: var(--topics-ink);
  font-size: 0.92rem;
}

.topic-card-actions {
  flex-direction: column;
  gap: 0.55rem;
  align-items: stretch;
}

.topic-access-pill,
.topic-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  padding: 0.35rem 0.8rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.topic-access-pill.is-all {
  background: rgba(24, 36, 44, 0.08);
  color: var(--topics-ink);
}

.topic-access-pill.is-free {
  background: var(--topics-free-soft);
  color: var(--topics-free);
}

.topic-access-pill.is-pro {
  background: var(--topics-pro-soft);
  color: var(--topics-pro);
}

.topic-count-pill {
  background: rgba(255, 255, 255, 0.68);
  color: var(--topics-muted);
  border: 1px solid rgba(24, 36, 44, 0.08);
}

.topics-empty {
  padding: 1.4rem 1.2rem 1.6rem;
}

.topics-empty strong {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 1rem;
}

.topics-empty p {
  margin: 0;
  color: var(--topics-muted);
  line-height: 1.6;
}

.topic-editor-shell {
  display: grid;
  gap: 1rem;
}

.topic-editor-hero {
  flex-direction: column;
  align-items: stretch;
  gap: 0.9rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--topics-line);
}

.topic-editor-identity {
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.topic-editor-avatar {
  width: 4.6rem;
  height: 4.6rem;
  font-size: 2.3rem;
}

.topic-editor-copy {
  min-width: 0;
  flex: 1;
}

.topic-editor-copy h3 {
  max-width: 24rem;
  font-size: 2rem;
  line-height: 1.02;
  overflow-wrap: anywhere;
}

.topic-editor-copy p {
  margin-top: 0.38rem;
  max-width: 36rem;
}

.topic-editor-separator {
  margin: 0 0.35rem;
}

.topic-editor-badges {
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.topic-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.95rem;
}

.editor-section {
  padding: 1rem;
  border-radius: 1.15rem;
  border: 1px solid rgba(24, 36, 44, 0.08);
  background: var(--topics-card-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.editor-section-head {
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
}

.editor-section-head.compact {
  align-items: flex-start;
}

.editor-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.editor-fields-identity {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.editor-span-2 {
  grid-column: span 2;
}

.field {
  display: grid;
  gap: 0.45rem;
}

.field span {
  color: var(--topics-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.topics-panel :is(input, select, textarea) {
  width: 100%;
  border: 1px solid rgba(24, 36, 44, 0.12);
  border-radius: 0.9rem;
  padding: 0.82rem 0.95rem;
  background: rgba(255, 252, 248, 0.92);
  color: var(--topics-ink);
  font: inherit;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.topics-panel textarea {
  min-height: 8rem;
  line-height: 1.6;
  resize: vertical;
}

.topics-panel :is(input, select, textarea):focus {
  outline: none;
  border-color: rgba(183, 97, 42, 0.44);
  background: rgba(255, 255, 255, 0.98);
  box-shadow:
    0 0 0 4px rgba(183, 97, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.topic-editor-actions {
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.topics-modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background:
    linear-gradient(rgba(24, 36, 44, 0.44), rgba(24, 36, 44, 0.58)),
    radial-gradient(circle at top, rgba(183, 97, 42, 0.2), transparent 28rem);
  backdrop-filter: blur(10px);
  z-index: 30;
}

.topics-modal {
  width: min(46rem, 100%);
}

@media (max-width: 1240px) {
  .topics-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 960px) {
  .topics-hero,
  .topics-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .topics-actions,
  .topic-editor-badges,
  .topics-toolbar-badges {
    justify-content: flex-start;
  }

  .topic-editor-identity {
    align-items: flex-start;
  }

  .editor-fields-identity {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .topics-panel {
    padding: 1rem;
    border-radius: 1.2rem;
  }

  .topics-stat,
  .toolbar-chip,
  .topic-card,
  .editor-section {
    border-radius: 1rem;
  }

  .topic-card {
    grid-template-columns: 1fr;
  }

  .topic-editor-identity {
    flex-direction: column;
    align-items: stretch;
  }

  .topic-card-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .topic-editor-grid,
  .editor-fields,
  .editor-fields-identity {
    grid-template-columns: 1fr;
  }

  .editor-span-2 {
    grid-column: span 1;
  }

  .topic-editor-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
