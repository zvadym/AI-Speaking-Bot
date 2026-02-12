<template>
  <form class="card form" @submit.prevent="onSubmit">
    <div class="head">
      <h3 class="h3">{{ t('contact.title') }}</h3>
      <p class="muted">{{ t('contact.subhead') }}</p>
    </div>

    <div class="grid">
      <label class="field">
        <span class="label">{{ t('contact.name') }}</span>
        <input v-model.trim="name" class="input" type="text" autocomplete="name" :disabled="isDisabled" />
      </label>

      <label class="field">
        <span class="label">{{ t('contact.telegram') }}</span>
        <input
          v-model.trim="telegram"
          class="input"
          type="text"
          inputmode="text"
          placeholder="@username"
          :disabled="isDisabled"
        />
      </label>
    </div>

    <label class="field">
      <span class="label">{{ t('contact.message') }} *</span>
      <textarea v-model.trim="message" class="input textarea" rows="5" :disabled="isDisabled" />
    </label>

    <input v-model="trap" class="trap" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" />

    <div class="actions">
      <button class="btn primary" type="submit" :disabled="submitDisabled">
        <span v-if="state === 'loading'">{{ t('contact.sending') }}</span>
        <span v-else>{{ t('contact.send') }}</span>
      </button>
      <div v-if="state === 'success'" class="muted status ok">{{ t('contact.sent') }}</div>
      <div v-else-if="state === 'error'" class="muted status err">{{ t('contact.error') }}</div>
      <div v-else-if="missingWebhook" class="muted status">{{ t('contact.unavailable') }}</div>
    </div>
  </form>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from '../i18n.js';

const { t, locale } = useI18n();

const name = ref('');
const telegram = ref('');
const message = ref('');
const trap = ref('');
const startedAt = ref(0);
const state = ref('idle'); // idle | loading | success | error

const webhookUrl = (import.meta.env.VITE_CONTACT_WEBHOOK_URL || '').toString().trim();
const missingWebhook = computed(() => !webhookUrl);
const isDisabled = computed(() => missingWebhook.value || state.value === 'loading');
const submitDisabled = computed(() => isDisabled.value || !message.value);

onMounted(() => {
  startedAt.value = Date.now();
});

async function onSubmit() {
  if (missingWebhook.value) return;
  if (trap.value) return;
  if (!message.value) return;

  state.value = 'loading';
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.value,
        telegram: telegram.value,
        message: message.value,
        trap: trap.value,
        locale: locale.value,
        startedAt: startedAt.value,
        sentAt: Date.now(),
        href: typeof window !== 'undefined' ? window.location.href : ''
      })
    });

    if (!res.ok) throw new Error(`Bad status: ${res.status}`);

    state.value = 'success';
    message.value = '';
  } catch {
    state.value = 'error';
  } finally {
    window.setTimeout(() => {
      if (state.value === 'success' || state.value === 'error') state.value = 'idle';
    }, 5000);
  }
}
</script>

<style scoped>
.form {
  display: grid;
  gap: 14px;
}

.head p {
  margin: 6px 0 0;
  line-height: 1.6;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted);
}

.input {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  padding: 12px 14px;
  font: inherit;
}

.textarea {
  resize: vertical;
  min-height: 120px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.status {
  font-size: 14px;
}

.ok {
  color: color-mix(in srgb, var(--fg) 80%, #16a34a);
}

.err {
  color: color-mix(in srgb, var(--fg) 80%, #dc2626);
}

.trap {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

@media (min-width: 860px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

