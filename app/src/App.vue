<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide } from "vue";
import ConcernsPage from "./components/ConcernsPage.vue";
import OverviewPage from "./components/OverviewPage.vue";
import StepPage from "./components/StepPage.vue";
import TourSidebar from "./components/TourSidebar.vue";
import { shortCommit } from "./lib/types";
import { createTourState, TOUR } from "./lib/useTour";

const tour = createTourState();
provide(TOUR, tour);

const loaded = computed(() => tour.tour.value);
const reviewedCount = computed(() => loaded.value?.steps.filter((s) => tour.progress.value.done[s.id]).length ?? 0);
const currentStep = computed(() => (tour.current.value && "step" in tour.current.value ? tour.current.value.step : null));
const currentDone = computed(() => Boolean(currentStep.value && tour.progress.value.done[currentStep.value.id]));

function onKey(event: KeyboardEvent) {
  if (!loaded.value || event.metaKey || event.ctrlKey || event.altKey) return;
  const actions: Record<string, () => void> = {
    j: () => tour.move(1),
    ArrowDown: () => tour.move(1),
    k: () => tour.move(-1),
    ArrowUp: () => tour.move(-1),
    " ": () => {
      if (tour.current.value) tour.toggleDone(tour.current.value.id);
      tour.move(1);
    },
    f: () => tour.toggleFilter(),
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  void tour.start();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="!loaded" class="empty">
    <div class="strong">Reviewer's tour</div>
    <div class="muted">{{ tour.status.value }}</div>
  </div>
  <div v-else class="app">
    <header class="top">
      <div class="bar">
        <span class="strong">Tour</span>
        <span class="branches muted">{{ loaded.branch }} → {{ loaded.base }}</span>
        <span class="small dim">{{ shortCommit(loaded.base_sha) }}..{{ shortCommit(loaded.head_sha) }}</span>
        <span class="spacer" />
        <span class="small muted">{{ reviewedCount }}/{{ loaded.steps.length }} reviewed</span>
        <button class="filter" :class="{ on: tour.closelyOnly.value }" @click="tour.toggleFilter()">
          {{ tour.closelyOnly.value ? "● Read closely only" : "○ Read closely only" }}
        </button>
      </div>
      <div v-if="tour.stale.value" class="banner">
        This tour is for {{ shortCommit(loaded.head_sha) }}; the branch is now at {{ shortCommit(tour.tip.value) }}. Line notes may be off.
      </div>
      <details v-if="tour.problems.value.length" class="banner">
        <summary>The tour has {{ tour.problems.value.length }} problem{{ tour.problems.value.length === 1 ? "" : "s" }}</summary>
        <div v-for="problem in tour.problems.value" :key="problem" class="problem">{{ problem }}</div>
      </details>
    </header>
    <div class="main">
      <TourSidebar :concern-count="loaded.concerns.length" />
      <main :key="tour.current.value?.id" class="detail">
        <OverviewPage v-if="tour.current.value?.id === 'overview'" :tour="loaded" />
        <ConcernsPage v-else-if="tour.current.value?.id === 'concerns'" :concerns="loaded.concerns" />
        <StepPage v-else-if="currentStep" :step="currentStep" />
      </main>
    </div>
    <footer class="bottom">
      <button class="button" @click="tour.move(-1)">← Prev</button>
      <button class="button" @click="tour.move(1)">Next →</button>
      <span class="spacer small dim">j/k move · space reviewed + next · f filter</span>
      <button v-if="currentStep" class="button" :class="{ primary: !currentDone }" @click="tour.toggleDone(currentStep.id)">
        {{ currentDone ? "✓ Reviewed" : "Mark reviewed" }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.top {
  flex: none;
  border-bottom: 1px solid var(--border);
}
.bar {
  height: 42px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.branches {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.filter {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.filter.on {
  border-color: var(--accent);
  color: var(--accent);
}
.banner {
  padding: 4px 14px;
  font-size: 11px;
  color: var(--blocked);
  background: color-mix(in srgb, var(--blocked) 13%, transparent);
}
.banner summary {
  cursor: pointer;
}
.problem {
  padding: 2px 0 2px 12px;
  font-family: var(--mono);
}
.main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px;
}
.bottom {
  flex: none;
  height: 46px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--border);
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
.button:hover {
  opacity: 0.85;
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
