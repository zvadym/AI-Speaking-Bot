<template>
  <form class="form" @submit.prevent="submitForm">
    <div class="grid">
      <label class="field">
        <span class="label">{{ t('contact.nameLabel') }}</span>
        <input
          v-model="form.name"
          class="input"
          type="text"
          name="name"
          autocomplete="name"
          :placeholder="t('contact.namePlaceholder')"
          maxlength="80"
          required
        >
      </label>

      <label class="field">
        <span class="label">{{ t('contact.contactLabel') }}</span>
        <input
          v-model="form.contact"
          class="input"
          type="text"
          name="contact"
          :placeholder="t('contact.contactPlaceholder')"
          maxlength="160"
          required
        >
      </label>
    </div>

    <label class="field">
      <span class="label">{{ t('contact.messageLabel') }}</span>
      <textarea
        v-model="form.message"
        class="input textarea"
        name="message"
        :placeholder="t('contact.messagePlaceholder')"
        minlength="10"
        maxlength="2000"
        required
      ></textarea>
    </label>

    <label class="trap" aria-hidden="true" tabindex="-1">
      <span>Website</span>
      <input v-model="form.website" type="text" name="website" autocomplete="off" tabindex="-1">
    </label>

    <div class="actions">
      <button class="btn primary" type="submit" :disabled="sending">
        {{ sending ? t('contact.sending') : t('contact.submit') }}
      </button>
      <p class="muted helper">{{ t('contact.replyHint') }}</p>
    </div>

    <p v-if="status === 'success'" class="status ok" aria-live="polite">{{ t('contact.success') }}</p>
    <p v-else-if="status === 'error'" class="status err" aria-live="polite">{{ t('contact.error') }}</p>
  </form>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useI18n } from '../i18n.js';

const { t, locale } = useI18n();

const form = reactive({
  name: '',
  contact: '',
  message: '',
  website: ''
});

const sending = ref(false);
const status = ref('idle');

async function submitForm() {
  if (sending.value) return;

  status.value = 'idle';
  sending.value = true;

  try {
    await $fetch('/api/contact', {
      method: 'POST',
      body: {
        name: form.name,
        contact: form.contact,
        message: form.message,
        website: form.website,
        locale: locale.value,
        pageUrl: import.meta.client ? window.location.href : ''
      }
    });

    form.name = '';
    form.contact = '';
    form.message = '';
    form.website = '';
    status.value = 'success';
  } catch {
    status.value = 'error';
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.form {
  display: grid;
  gap: 14px;
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
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--fg);
  padding: 12px 14px;
  font: inherit;
}

.input:focus-visible {
  outline: 2px solid color-mix(in srgb, #229ed9 55%, white);
  outline-offset: 2px;
}

.textarea {
  min-height: 148px;
  resize: vertical;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.helper {
  margin: 0;
  line-height: 1.6;
}

.status {
  margin: 0;
  font-size: 14px;
}

.ok {
  color: color-mix(in srgb, var(--fg) 78%, #16a34a);
}

.err {
  color: color-mix(in srgb, var(--fg) 78%, #dc2626);
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
