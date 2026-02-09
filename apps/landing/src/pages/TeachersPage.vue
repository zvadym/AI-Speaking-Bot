<template>
  <section class="page">
    <div class="container">
      <h1 class="h1">Meet the teachers</h1>
      <p class="muted sub">
        Each teacher is a dedicated Telegram bot. Pick one to start speaking today.
      </p>

      <div class="grid-2 list">
        <TeacherCard v-for="t in teachers" :key="t.slug" :teacher="t" />
      </div>
    </div>
  </section>
</template>

<script setup>
import TeacherCard from '../components/TeacherCard.vue';
import { teachers } from '../data/teachers.js';
</script>

<style scoped>
.page {
  padding: 56px 0;
}

.sub {
  max-width: 66ch;
  margin-top: 10px;
  font-size: 18px;
  line-height: 1.6;
}

.list {
  margin-top: 22px;
}
</style>

