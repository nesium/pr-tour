<script setup lang="ts">
import { open } from "@tauri-apps/plugin-dialog";
import { computed, inject, onMounted, ref } from "vue";
import { api, type Setup } from "../lib/api";
import { TOUR } from "../lib/useTour";

const tour = inject(TOUR)!;
const generation = computed(() => tour.generation.value);
const canWrite = computed(() => tour.missing.value && !generation.value.running && !generation.value.failure);

const setup = ref<Setup | null>(null);
const installed = ref(false);
const installFailure = ref<string | null>(null);
const needsInstall = computed(() => [setup.value?.command, setup.value?.skill].some((p) => p === "missing" || p === "outdated"));

onMounted(async () => {
  if (tour.choosing.value) setup.value = await api.setupStatus().catch(() => null);
});

async function install() {
  installFailure.value = null;
  try {
    setup.value = await api.installSetup();
    installed.value = true;
  } catch (e) {
    installFailure.value = String(e);
  }
}

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
    <div v-if="tour.choosing.value && (needsInstall || installed)" class="setup small">
      <template v-if="installed && !needsInstall">
        Installed the <code>pr-tour</code> command and the <code>/pr-tour</code> skill. Restart running Claude Code sessions to use it.
      </template>
      <template v-else>
        <span>Install the <code>pr-tour</code> command and the <code>/pr-tour</code> skill for Claude Code?</span>
        <button class="button" @click="install">Install</button>
      </template>
      <div v-if="installFailure" class="failure">{{ installFailure }}</div>
    </div>
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
.setup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  max-width: 440px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  color: var(--muted);
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
