<template>
  <div class="feedback-shell fade-in">
    <GlassCard tone="subtle" class="support-hero">
      <div>
        <div class="eyebrow">{{ $t('feedback.eyebrow') }}</div>
        <h1>{{ $t('feedback.title') }}</h1>
        <p class="hero-copy">{{ $t('feedback.sub') }}</p>
      </div>
      <div v-if="thread.unread_admin_replies" class="hero-meta">
        <span>{{ $t('feedback.unreadCount', { count: thread.unread_admin_replies }) }}</span>
      </div>
    </GlassCard>

    <GlassCard tone="subtle" class="composer-card">
      <div class="composer-head">
        <div>
          <div class="eyebrow">{{ $t('feedback.newMessage') }}</div>
          <h2>{{ $t('feedback.composeTitle') }}</h2>
        </div>
        <MessageSquarePlus class="section-icon" />
      </div>

      <div class="category-row" role="radiogroup" :aria-label="$t('feedback.category')">
        <button
          v-for="option in categoryOptions"
          :key="option.value"
          type="button"
          class="category-chip"
          :class="{ active: category === option.value }"
          :aria-pressed="category === option.value"
          @click="category = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <label class="message-field">
        <span>{{ $t('feedback.messageLabel') }}</span>
        <textarea
          v-model.trim="message"
          :placeholder="$t('feedback.messagePlaceholder')"
          :maxlength="1000"
          rows="4"
        />
      </label>

      <div class="composer-foot">
        <span :class="{ danger: validationMessage }">{{ validationMessage || $t('feedback.charactersLeft', { count: remainingChars }) }}</span>
        <button type="button" class="send-btn" :disabled="sending || !canSubmit" @click="submit">
          <SendHorizontal class="button-icon" />
          <span>{{ sending ? $t('feedback.sending') : $t('feedback.send') }}</span>
        </button>
      </div>
    </GlassCard>

    <GlassCard tone="subtle" class="thread-card">
      <div class="thread-head">
        <div>
          <div class="eyebrow">{{ $t('feedback.threadLabel') }}</div>
          <h2>{{ $t('feedback.threadTitle') }}</h2>
        </div>
        <RefreshCw class="section-icon refresh" :class="{ spinning: loading }" @click="refreshThread({ markRead: false })" />
      </div>

      <div v-if="error" class="thread-state error">{{ error }}</div>
      <div v-else-if="loading" class="thread-state">{{ $t('feedback.loading') }}</div>
      <div v-else-if="!items.length" class="thread-state">{{ $t('feedback.empty') }}</div>

      <div v-else class="thread-list">
        <article
          v-for="item in items"
          :key="`${item.kind}-${item.id}`"
          class="thread-item"
          :class="item.sender"
        >
          <div class="thread-item-meta">
            <span>{{ item.sender === 'admin' ? $t('feedback.admin') : $t('feedback.you') }}</span>
            <span v-if="item.category">{{ categoryLabel(item.category) }}</span>
            <time>{{ formatDate(item.created_at) }}</time>
          </div>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </GlassCard>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { MessageSquarePlus, RefreshCw, SendHorizontal } from 'lucide-vue-next';
import GlassCard from '../components/GlassCard.vue';
import { apiJson } from '../lib/api.js';
import { tgHaptic } from '../lib/tg.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true },
  botKey: { type: String, default: '' },
  me: { type: Object, default: null },
  toast: { type: Function, required: true }
});

const { t } = useI18n({ useScope: 'global' });

const loading = ref(true);
const sending = ref(false);
const error = ref('');
const items = ref([]);
const thread = ref({
  archived: false,
  user_last_read_at: null,
  unread_admin_replies: 0
});
const category = ref('bug');
const message = ref('');
const attempted = ref(false);

const categoryOptions = computed(() => ([
  { value: 'bug', label: t('feedback.categories.bug') },
  { value: 'idea', label: t('feedback.categories.idea') },
  { value: 'billing', label: t('feedback.categories.billing') },
  { value: 'coach', label: t('feedback.categories.coach') }
]));

const remainingChars = computed(() => 1000 - message.value.length);
const canSubmit = computed(() => Boolean(category.value) && Boolean(message.value.trim()) && message.value.trim().length <= 1000);
const validationMessage = computed(() => {
  if (!category.value && attempted.value) return t('feedback.validation.category');
  if (!message.value.trim() && attempted.value) return t('feedback.validation.message');
  if (message.value.trim().length > 1000) return t('feedback.validation.length');
  return '';
});

function categoryLabel(value) {
  return t(`feedback.categories.${value}`);
}

function formatDate(value) {
  if (!value) return t('common.dash');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('common.dash');
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

async function refreshThread({ markRead = true } = {}) {
  if (!props.token) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await apiJson(props.apiBase, '/me/feedback-thread', {
      token: props.token,
      query: props.botKey ? { bot_key: props.botKey } : undefined
    });
    items.value = Array.isArray(data?.items) ? data.items : [];
    thread.value = data?.thread || thread.value;
    if (markRead) {
      const readRes = await apiJson(props.apiBase, '/me/feedback-thread/read', {
        method: 'POST',
        token: props.token,
        body: props.botKey ? { bot_key: props.botKey } : {}
      });
      thread.value = {
        ...thread.value,
        user_last_read_at: readRes?.user_last_read_at || thread.value.user_last_read_at,
        unread_admin_replies: Number(readRes?.unread_admin_replies || 0)
      };
    }
  } catch (err) {
    console.error(err);
    error.value = t('feedback.loadError');
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.token, props.botKey],
  () => {
    refreshThread({ markRead: true });
  },
  { immediate: true }
);

async function submit() {
  attempted.value = true;
  if (sending.value || !canSubmit.value) return;
  sending.value = true;
  error.value = '';
  try {
    const data = await apiJson(props.apiBase, '/me/feedbacks', {
      method: 'POST',
      token: props.token,
      body: {
        bot_key: props.botKey || undefined,
        category: category.value,
        message: message.value.trim()
      }
    });
    if (data?.item) items.value = [...items.value, data.item];
    thread.value = {
      ...thread.value,
      unread_admin_replies: Number(data?.feedback_summary?.unread_admin_replies || 0),
      user_last_read_at: data?.feedback_summary?.user_last_read_at || new Date().toISOString()
    };
    message.value = '';
    attempted.value = false;
    tgHaptic('notification', 'success');
    props.toast(t('feedback.sent'));
  } catch (err) {
    console.error(err);
    const code = err?.message || '';
    if (code === 'bad_feedback_category') error.value = t('feedback.validation.category');
    else if (code === 'feedback_message_too_long') error.value = t('feedback.validation.length');
    else error.value = t('feedback.sendError');
    tgHaptic('notification', 'error');
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.feedback-shell {
  width: min(760px, 100%);
  padding: calc(var(--app-header-offset) + 16px) 16px calc(104px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 14px;
  align-content: start;
}

.support-hero,
.composer-card,
.thread-card {
  padding: 16px;
  display: grid;
  gap: 12px;
  align-content: start;
}

.eyebrow {
  font-size: 10px;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
}

h1,
h2 {
  margin: 0;
  font-family: var(--font-body);
  letter-spacing: -0.04em;
}

h1 {
  font-size: clamp(28px, 7vw, 38px);
  font-weight: 800;
}

h2 {
  font-size: clamp(20px, 4vw, 26px);
  font-weight: 760;
}

.hero-copy,
.thread-item p,
.thread-state {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.hero-meta,
.thread-item-meta,
.composer-foot,
.thread-head,
.composer-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.hero-meta {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.hero-meta span,
.category-chip {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.56);
  border: 1px solid rgba(157, 146, 129, 0.22);
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}

.category-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-chip {
  border-width: 1px;
  border-style: solid;
  cursor: pointer;
}

.category-chip.active {
  color: var(--ink);
  background: rgba(127, 150, 128, 0.18);
  border-color: rgba(95, 117, 96, 0.28);
}

.message-field {
  display: grid;
  gap: 8px;
}

.message-field span {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.message-field textarea {
  width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(157, 146, 129, 0.28);
  background: rgba(255, 255, 255, 0.62);
  min-height: 112px;
  padding: 14px;
  color: var(--ink);
  resize: vertical;
}

.message-field textarea:focus-visible {
  border-color: rgba(95, 117, 96, 0.45);
  box-shadow: 0 0 0 4px rgba(95, 117, 96, 0.09);
}

.composer-foot span {
  color: var(--muted);
  font-size: 12px;
}

.composer-foot span.danger,
.thread-state.error {
  color: var(--danger);
}

.send-btn {
  border: 0;
  border-radius: 14px;
  min-height: 42px;
  padding: 0 16px;
  cursor: pointer;
  color: #f7f3ec;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--accent-strong);
}

.send-btn:disabled {
  cursor: not-allowed;
  opacity: 1;
  background: rgba(95, 117, 96, 0.22);
  color: var(--muted-strong);
}

.section-icon,
.button-icon {
  width: 16px;
  height: 16px;
}

.refresh {
  cursor: pointer;
}

.refresh.spinning {
  animation: spin 900ms linear infinite;
}

.thread-list {
  display: grid;
  gap: 8px;
}

.thread-item {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(157, 146, 129, 0.2);
}

.thread-item.user {
  background: rgba(255, 255, 255, 0.56);
}

.thread-item.admin {
  background:
    radial-gradient(120% 160% at 0% 0%, rgba(127, 150, 128, 0.12), transparent 48%),
    rgba(247, 242, 235, 0.96);
}

.thread-item-meta {
  font-size: 11px;
  color: var(--muted);
  flex-wrap: wrap;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
