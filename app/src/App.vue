<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from "vue";
import ConcernsPage from "./components/ConcernsPage.vue";
import FileView from "./components/FileView.vue";
import NoTour from "./components/NoTour.vue";
import OverviewPage from "./components/OverviewPage.vue";
import StepPage from "./components/StepPage.vue";
import TourSidebar from "./components/TourSidebar.vue";
import { shortCommit } from "./lib/types";
import { useSearchHighlight } from "./lib/useSearchHighlight";
import { createTourState, TOUR } from "./lib/useTour";

const tour = createTourState();
provide(TOUR, tour);

const sidebar = ref<InstanceType<typeof TourSidebar> | null>(null);
const detail = ref<HTMLElement | null>(null);
const { revealFirst } = useSearchHighlight(detail, tour.searched);

function nextMatch(delta: number) {
  tour.nextMatch(delta);
  revealFirst();
}

const loaded = computed(() => tour.tour.value);
const reviewedCount = computed(() => loaded.value?.steps.filter((s) => tour.progress.value.done[s.id]).length ?? 0);
const currentStep = computed(() => (tour.current.value && "step" in tour.current.value ? tour.current.value.step : null));
const THEME_LABELS = { system: "◐ System", light: "☀ Light", dark: "☾ Dark" } as const;
const themeLabel = computed(() => THEME_LABELS[tour.preferences.value.theme]);
const currentDone = computed(() => Boolean(currentStep.value && tour.progress.value.done[currentStep.value.id]));

function onKey(event: KeyboardEvent) {
  if (!loaded.value) return;
  if ((event.metaKey || event.ctrlKey) && event.key === "f") {
    event.preventDefault();
    sidebar.value?.focusSearch();
    return;
  }
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  const viewing: Record<string, () => void> = {
    s: () => tour.toggleDiffView(),
    w: () => tour.toggleWrap(),
    t: () => tour.cycleTheme(),
  };
  // A file window only changes how its diff looks.
  const actions: Record<string, () => void> = tour.focusFile.value ? viewing : {
    ...viewing,
    j: () => tour.move(1),
    ArrowDown: () => tour.move(1),
    k: () => tour.move(-1),
    ArrowUp: () => tour.move(-1),
    " ": () => {
      if (tour.current.value) tour.toggleDone(tour.current.value.id);
      tour.move(1);
    },
    f: () => tour.toggleFilter(),
    "/": () => sidebar.value?.focusSearch(),
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
  <NoTour v-if="!loaded" />
  <FileView v-else-if="tour.focusFile.value" :file="tour.focusFile.value" />
  <div v-else class="app">
    <header class="top">
      <div class="bar">
        <span class="strong">Tour</span>
        <span class="branches muted">{{ loaded.branch }} → {{ loaded.base }}</span>
        <span class="small dim">{{ shortCommit(loaded.base_sha) }}..{{ shortCommit(loaded.head_sha) }}</span>
        <span class="spacer" />
        <span class="small muted">{{ reviewedCount }}/{{ loaded.steps.length }} reviewed</span>
        <div class="segmented">
          <button :class="{ on: tour.preferences.value.diffView === 'unified' }" @click="tour.setDiffView('unified')">Unified</button>
          <button :class="{ on: tour.preferences.value.diffView === 'split' }" @click="tour.setDiffView('split')">Split</button>
        </div>
        <button
          class="filter"
          :class="{ on: tour.preferences.value.wrap || tour.preferences.value.diffView === 'split' }"
          :disabled="tour.preferences.value.diffView === 'split'"
          title="The split view always wraps"
          @click="tour.toggleWrap()"
        >
          Wrap
        </button>
        <button class="filter" title="Theme: system, light or dark (t)" @click="tour.cycleTheme()">{{ themeLabel }}</button>
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
      <TourSidebar ref="sidebar" :concern-count="loaded.concerns.length" @next-match="nextMatch" />
      <main :key="tour.current.value?.id" ref="detail" class="detail">
        <OverviewPage v-if="tour.current.value?.id === 'overview'" :tour="loaded" />
        <ConcernsPage v-else-if="tour.current.value?.id === 'concerns'" :concerns="loaded.concerns" />
        <StepPage v-else-if="currentStep" :step="currentStep" />
      </main>
    </div>
    <footer class="bottom">
      <button class="button" @click="tour.move(-1)">← Prev</button>
      <button class="button" @click="tour.move(1)">Next →</button>
      <span class="spacer small dim">j/k move · space reviewed + next · f filter · s split · w wrap · t theme · / search</span>
      <button v-if="currentStep" class="button" :class="{ primary: !currentDone }" @click="tour.toggleDone(currentStep.id)">
        {{ currentDone ? "✓ Reviewed" : "Mark reviewed" }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
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
.filter:disabled {
  cursor: default;
  opacity: 0.6;
}
.segmented {
  display: flex;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.segmented button {
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.segmented button.on {
  background: var(--selected);
  color: var(--fg);
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
