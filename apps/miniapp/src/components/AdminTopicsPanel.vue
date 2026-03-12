<template>
  <section class="card panel topics-panel">
    <header class="panel-head topics-head">
      <div>
        <div class="panel-kicker">Topics</div>
        <h2 class="panel-title">Per-bot topic catalog</h2>
        <p class="panel-sub">Pre-generated topic packs used by Telegram topic selection. AI generation creates an editable draft only.</p>
      </div>
      <div class="panel-actions topics-actions">
        <button class="btn" type="button" :disabled="!password || loading" @click="refreshTopics">
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
      <div v-if="!password" class="callout">Enter admin password above to load topics.</div>
      <template v-else>
        <div class="topics-toolbar">
          <label class="field grow">
            <span>Bot</span>
            <select v-model="selectedBotKey" :disabled="loading || !bots.length" @change="refreshTopics">
              <option v-for="bot in bots" :key="bot.bot_key" :value="bot.bot_key">
                {{ botLabel(bot) }}
              </option>
            </select>
          </label>
          <div class="topics-summary">
            <strong>{{ topics.length }}</strong>
            <span>topic{{ topics.length === 1 ? '' : 's' }}</span>
          </div>
        </div>

        <div v-if="errorText" class="callout error">{{ errorText }}</div>
        <div v-else-if="infoText" class="callout">{{ infoText }}</div>

        <div class="topics-layout">
          <div class="topics-table-wrap">
            <table v-if="topics.length" class="topics-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>ID</th>
                  <th>Access</th>
                  <th class="num">Order</th>
                  <th>Updated</th>
                  <th class="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="topic in topics" :key="topic.topic_id" :class="{ active: editor.originalTopicId === topic.topic_id }">
                  <td>
                    <div class="topic-main-cell">
                      <span class="topic-emoji">{{ topic.emoji }}</span>
                      <div>
                        <div class="topic-title">{{ topic.title_base }}</div>
                        <div class="topic-goal">{{ topic.goal_base }}</div>
                      </div>
                    </div>
                  </td>
                  <td><code>{{ topic.topic_id }}</code></td>
                  <td>{{ topicAccessLabel(topic.access_tier) }}</td>
                  <td class="num">{{ topic.sort_order }}</td>
                  <td>{{ formatStamp(topic.updated_at) }}</td>
                  <td class="actions">
                    <button class="btn" type="button" :disabled="loading" @click="editTopic(topic)">Edit</button>
                    <button class="btn danger" type="button" :disabled="loading" @click="deleteTopic(topic)">Delete</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-state">
              No topics configured for this bot yet.
            </div>
          </div>

          <aside class="topic-editor card">
            <div class="topic-editor-head">
              <div>
                <div class="panel-kicker">{{ editor.originalTopicId ? 'Update topic' : 'Create topic' }}</div>
                <h3>{{ editor.originalTopicId ? editor.title_base || editor.originalTopicId : 'New topic draft' }}</h3>
              </div>
              <button v-if="hasEditorChanges" class="btn" type="button" :disabled="saving" @click="resetEditor">
                Reset
              </button>
            </div>

            <div class="topic-editor-grid">
              <label class="field">
                <span>Emoji</span>
                <input v-model.trim="editor.emoji" type="text" maxlength="16" placeholder="🧩" />
              </label>
              <label class="field">
                <span>Sort order</span>
                <input v-model.number="editor.sort_order" type="number" min="0" max="100000" />
              </label>
              <label class="field">
                <span>Access</span>
                <select v-model="editor.access_tier">
                  <option v-for="option in TOPIC_ACCESS_OPTIONS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="field grow editor-span-2">
                <span>Topic ID</span>
                <input v-model.trim="editor.topic_id" type="text" autocomplete="off" placeholder="daily-routine" />
              </label>
              <label class="field grow editor-span-2">
                <span>Title (base language)</span>
                <input v-model.trim="editor.title_base" type="text" autocomplete="off" placeholder="Daily routine" />
              </label>
              <label class="field grow editor-span-2">
                <span>Goal (base language)</span>
                <textarea v-model.trim="editor.goal_base" rows="3" placeholder="Talk about your usual day with practical details." />
              </label>
              <label class="field grow">
                <span>Allowed areas</span>
                <textarea v-model="editor.allowed_base_text" rows="6" placeholder="One item per line" />
              </label>
              <label class="field grow">
                <span>Avoid areas</span>
                <textarea v-model="editor.avoid_base_text" rows="6" placeholder="One item per line" />
              </label>
              <label class="field grow editor-span-2">
                <span>Starter questions (target language)</span>
                <textarea v-model="editor.starter_questions_target_text" rows="7" placeholder="One question per line" />
              </label>
              <label class="field grow editor-span-2">
                <span>Recovery questions (target language)</span>
                <textarea v-model="editor.recovery_questions_target_text" rows="7" placeholder="One question per line" />
              </label>
            </div>

            <p class="error" v-if="saveError">{{ saveError }}</p>
            <p class="hint" v-else>Starter and recovery questions should each contain 6-10 lines.</p>

            <div class="topic-editor-actions">
              <button class="btn primary" type="button" :disabled="!password || saving || !selectedBotKey" @click="saveTopic">
                {{ saving ? 'Saving…' : (editor.originalTopicId ? 'Save changes' : 'Create topic') }}
              </button>
            </div>
          </aside>
        </div>
      </template>
    </div>

    <div v-if="showGenerateDialog" class="topics-modal-backdrop" @click.self="closeGenerateDialog">
      <div class="topics-modal card">
        <div class="topic-editor-head">
          <div>
            <div class="panel-kicker">AI draft</div>
            <h3>Generate topic rules</h3>
          </div>
          <button class="btn" type="button" :disabled="generating" @click="closeGenerateDialog">Close</button>
        </div>
        <div class="topic-editor-grid">
          <label class="field grow editor-span-2">
            <span>Bot</span>
            <select v-model="generateForm.bot_key" :disabled="generating">
              <option v-for="bot in bots" :key="bot.bot_key" :value="bot.bot_key">
                {{ botLabel(bot) }}
              </option>
            </select>
          </label>
          <label class="field grow editor-span-2">
            <span>Topic name</span>
            <input v-model.trim="generateForm.topic_name" type="text" autocomplete="off" placeholder="Ordering at the pharmacy" @keydown.enter.prevent="generateDraft" />
          </label>
          <label class="field grow editor-span-2">
            <span>Access</span>
            <select v-model="generateForm.access_tier" :disabled="generating">
              <option v-for="option in TOPIC_ACCESS_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
        <p class="error" v-if="generateError">{{ generateError }}</p>
        <div class="topic-editor-actions">
          <button class="btn primary" type="button" :disabled="generating || !generateForm.bot_key || !generateForm.topic_name.trim()" @click="generateDraft">
            {{ generating ? 'Generating…' : 'Generate draft' }}
          </button>
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
    const stamp = isoStampNow();
    emit('stamp', stamp);
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
  gap: 1.5rem;
}

.topics-head,
.topics-actions,
.topics-toolbar,
.topics-summary,
.topic-main-cell,
.topic-editor-head,
.topic-editor-actions {
  display: flex;
  align-items: center;
}

.topics-head,
.topics-toolbar,
.topic-editor-head,
.topic-editor-actions {
  justify-content: space-between;
}

.topics-actions {
  gap: 0.75rem;
  flex-wrap: wrap;
}

.topics-toolbar {
  gap: 1rem;
  margin-bottom: 1rem;
}

.topics-summary {
  gap: 0.5rem;
  color: var(--muted, rgba(36, 57, 81, 0.72));
}

.topics-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
  gap: 1rem;
}

.topics-table-wrap,
.topic-editor {
  border: 1px solid rgba(22, 37, 57, 0.08);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
}

.topics-table {
  width: 100%;
  border-collapse: collapse;
}

.topics-table th,
.topics-table td {
  padding: 0.9rem 1rem;
  border-bottom: 1px solid rgba(22, 37, 57, 0.08);
  vertical-align: top;
}

.topics-table tbody tr:last-child td {
  border-bottom: 0;
}

.topics-table tbody tr.active td {
  background: rgba(224, 139, 67, 0.08);
}

.topics-table th.num,
.topics-table td.num {
  text-align: right;
  white-space: nowrap;
}

.topics-table th.actions,
.topics-table td.actions {
  width: 1%;
  white-space: nowrap;
}

.topics-table td.actions {
  display: flex;
  gap: 0.5rem;
}

.topic-main-cell {
  gap: 0.85rem;
}

.topic-emoji {
  font-size: 1.5rem;
  line-height: 1;
}

.topic-title {
  font-weight: 700;
}

.topic-goal {
  margin-top: 0.25rem;
  color: rgba(36, 57, 81, 0.72);
  white-space: normal;
}

.topic-editor {
  padding: 1rem;
}

.topic-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.editor-span-2 {
  grid-column: span 2;
}

.topics-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  z-index: 30;
}

.topics-modal {
  width: min(640px, 100%);
  padding: 1rem;
}

.empty-state {
  padding: 1.5rem;
  color: rgba(36, 57, 81, 0.72);
}

@media (max-width: 1080px) {
  .topics-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .topic-editor-grid {
    grid-template-columns: 1fr;
  }

  .editor-span-2 {
    grid-column: span 1;
  }

  .topics-toolbar,
  .topic-editor-head,
  .topic-editor-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .topics-actions,
  .topics-table td.actions {
    flex-wrap: wrap;
  }
}
</style>
