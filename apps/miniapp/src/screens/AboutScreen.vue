<template>
  <div class="shell fade-in">
    <header class="page-hero">
      <div class="kicker">ℹ️ About</div>
      <h1>Lesia’s control room</h1>
      <p class="sub">
        This mini-app changes your learning settings for the Telegram bot and lets you manage your subscription.
      </p>
    </header>

    <section class="card">
      <h2>What gets saved</h2>
      <ul>
        <li><b>Language</b>: the language you practice with me.</li>
        <li><b>Level</b>: how strict my corrections should be.</li>
        <li><b>Subscription</b>: plans, limits, and auto-renew.</li>
      </ul>
    </section>

    <section class="card">
      <h2>Tips</h2>
      <ul>
        <li>Pick your <b>language</b> first, then your <b>level</b>.</li>
        <li>Send voice messages in the target language — I’ll reply and correct gently.</li>
      </ul>
    </section>

    <BackToMenu @navigate="(path) => $emit('navigate', path)" />
  </div>
</template>

<script setup>
import BackToMenu from '../components/BackToMenu.vue';

defineEmits(['navigate']);
</script>

<style scoped>
.shell {
  width: min(860px, 100%);
  padding: 40px 22px 72px;
  display: grid;
  gap: 18px;
}

.page-hero {
  display: grid;
  gap: 10px;
  margin-bottom: 4px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.page-hero h1 {
  font-family: var(--font-display);
  font-size: clamp(28px, 4.6vw, 44px);
  line-height: 1.04;
  margin: 0;
}

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
  max-width: 60ch;
}

.card {
  border: 1px solid var(--stroke);
  border-radius: 18px;
  padding: 18px 18px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 40px var(--shadow);
}

.card h2 {
  margin: 0 0 10px 0;
  font-size: 16px;
  letter-spacing: 0.01em;
}

ul {
  margin: 0;
  padding-left: 18px;
  color: var(--ink);
}

li {
  margin: 8px 0;
  line-height: 1.55;
}

</style>
