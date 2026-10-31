<script setup lang="ts">
import { open } from "@tauri-apps/plugin-dialog";
import { computed, inject } from "vue";
import { TOUR } from "../lib/useTour";

const tour = inject(TOUR)!;
const generation = computed(() => tour.generation.value);
const canWrite = computed(() => tour.missing.value && !generation.value.running && !generation.value.failure);

async function chooseRepo() {
  const folder = await open({ directory: true, title: "Choose a repository" });
  if (typeof folder === "string") await tour.chooseRepo(folder);
}
</script>

<template>
  <div class="empty">
    <div class="strong">Reviewer's tour</div>
    <div class="muted">{{ tour.status.value }}</div>
    <button v-if="tour.choosing.value" class="button primary" @click="chooseRepo">Choose repository…</button>
    <button v-if="canWrite" class="button primary" @click="tour.writeTour(false)">Write the tour</button>
    <div v-if="generation.lines.length || generation.failure" class="log">
      <div v-for="(line, i) in generation.lines" :key="i">{{ line }}</div>
      <div v-if="generation.failure" class="failure">{{ generation.failure }}</div>
    </div>
    <template v-if="generation.running">
      <div class="small dim">Closing this window stops writing the tour.</div>
      <button class="button" @click="tour.stopWriting()">Stop</button>
    </template>
    <button v-else-if="generation.failure" class="button" @click="tour.writeTour(false)">Try again</button>
  </div>
</template>

<style scoped>
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}
.log {
  max-width: 640px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-family: var(--mono);
  font-size: 11px;
  text-align: left;
  white-space: pre-wrap;
  color: var(--muted);
}
.failure {
  color: var(--gh-del-sign);
}
.button {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: var(--raised);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.button.primary {
  background: var(--solid);
  color: var(--solid-fg);
}
.strong {
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
.dim {
  color: var(--dim);
}
.small {
  font-size: 11px;
}
</style>
