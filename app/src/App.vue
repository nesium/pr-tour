<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from "vue";
import ChatPanel from "./components/ChatPanel.vue";
import ConcernsPage from "./components/ConcernsPage.vue";
import DiffSize from "./components/DiffSize.vue";
import FileView from "./components/FileView.vue";
import NoTour from "./components/NoTour.vue";
import OverviewPage from "./components/OverviewPage.vue";
import StepPage from "./components/StepPage.vue";
import TabBar from "./components/TabBar.vue";
import TourSidebar from "./components/TourSidebar.vue";
import UncoveredPage from "./components/UncoveredPage.vue";
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
/** The branch's size; binary files count as changed but add no lines. */
const size = computed(() => {
  const files = tour.stat.value;
  if (!files) return null;
  const sum = (key: "added" | "removed") => files.reduce((total, f) => total + (f[key] ?? 0), 0);
  return { files: files.length, added: sum("added"), removed: sum("removed") };
});
/** What "Copy for the author" just did, shown briefly in the footer. */
const handedOff = ref<string | null>(null);
let handedOffTimer: ReturnType<typeof setTimeout> | undefined;
async function copyForAuthor() {
  let message: string;
  try {
    const count = await tour.copyForAuthor();
    message = count ? `Copied ${count} note${count === 1 ? "" : "s"}; paste them into the author's session` : "No open notes to copy";
  } catch (e) {
    message = `Couldn't copy: ${e}`;
  }
  handedOff.value = message;
  clearTimeout(handedOffTimer);
  handedOffTimer = setTimeout(() => (handedOff.value = null), 4000);
}
const currentDone = computed(() => Boolean(currentStep.value && tour.progress.value.done[currentStep.value.id]));

function onKey(event: KeyboardEvent) {
  if (!loaded.value) return;
  const onTourTab = !tour.activeTab.value;
  if ((event.metaKey || event.ctrlKey) && event.key === "f" && onTourTab) {
    event.preventDefault();
    sidebar.value?.focusSearch();
    return;
  }
  // ⌘⇧[ and ⌘⇧], as in browsers; with Shift held, the keys arrive as { and }.
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "{" || event.key === "}")) {
    event.preventDefault();
    tour.moveTab(event.key === "}" ? 1 : -1);
    return;
  }
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  const anyTab: Record<string, () => void> = {
    s: () => tour.toggleDiffView(),
    w: () => tour.toggleWrap(),
    t: () => tour.cycleTheme(),
  };
  // Moving through the tour belongs to the Tour tab; a file tab only changes how its diff looks.
  const actions: Record<string, () => void> = !onTourTab ? anyTab : {
    ...anyTab,
    j: () => tour.move(1),
    ArrowDown: () => tour.move(1),
    k: () => tour.move(-1),
    ArrowUp: () => tour.move(-1),
    " ": () => {
      if (tour.current.value) tour.toggleDone(tour.current.value.id);
      tour.move(1);
    },
    f: () => tour.toggleFilter(),
    a: () => tour.toggleChat(),
    c: () => void copyForAuthor(),
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
  <div v-else class="app">
    <header class="top">
      <div class="bar">
        <span class="strong">Tour</span>
        <span class="branches muted">{{ loaded.branch }} → {{ loaded.base }}</span>
        <span class="small dim">{{ shortCommit(loaded.base_sha) }}..{{ shortCommit(loaded.head_sha) }}</span>
        <DiffSize v-if="size" :files="size.files" :added="size.added" :removed="size.removed" />
        <span class="spacer" />
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
      </div>
      <div v-if="tour.generation.value.running" class="banner info">
        <span>Rewriting the tour… {{ tour.generation.value.lines.at(-1) }}</span>
        <span class="spacer" />
        <button class="banner-action" @click="tour.stopWriting()">Stop</button>
      </div>
      <div v-else-if="tour.generation.value.failure" class="banner">
        <span>Rewriting the tour failed: {{ tour.generation.value.failure }}</span>
        <span class="spacer" />
        <button class="banner-action" @click="tour.writeTour(true)">Try again</button>
      </div>
      <template v-else>
        <div v-if="tour.stale.value" class="banner">
          <span>This tour is for {{ shortCommit(loaded.head_sha) }}; the branch is now at {{ shortCommit(tour.tip.value) }}. Line notes may be off.</span>
          <span class="spacer" />
          <button class="banner-action" @click="tour.writeTour(false)">Rewrite for {{ shortCommit(tour.tip.value) }}</button>
        </div>
        <details v-if="tour.tourProblems.value.length" class="banner">
          <summary>
            The tour has {{ tour.tourProblems.value.length }} problem{{ tour.tourProblems.value.length === 1 ? "" : "s" }}
          </summary>
          <div v-for="problem in tour.tourProblems.value" :key="problem" class="problem">{{ problem }}</div>
        </details>
        <div v-if="tour.coverageGaps.value" class="banner info">
          <span>
            {{ tour.coverageGaps.value }} change{{ tour.coverageGaps.value === 1 ? " isn't" : "s aren't" }} in this tour.
          </span>
          <button class="banner-link" @click="tour.go('uncovered')">Show them</button>
          <span class="spacer" />
          <button class="banner-action" title="Write the tour again, covering or skipping every change" @click="tour.writeTour(true)">
            Rewrite the tour
          </button>
        </div>
        <div v-else-if="tour.tourProblems.value.length" class="banner">
          <span class="spacer" />
          <button class="banner-action" @click="tour.writeTour(true)">Rewrite the tour</button>
        </div>
      </template>
    </header>
    <TabBar />
    <!-- The Tour tab stays mounted under a file tab, so coming back keeps its place. -->
    <div v-show="!tour.activeTab.value" class="tab-body">
      <div class="main">
        <TourSidebar ref="sidebar" :concern-count="loaded.concerns.length" @next-match="nextMatch" />
        <main :key="tour.current.value?.id" ref="detail" class="detail">
          <OverviewPage v-if="tour.current.value?.id === 'overview'" :tour="loaded" />
          <ConcernsPage v-else-if="tour.current.value?.id === 'concerns'" :concerns="loaded.concerns" />
          <UncoveredPage v-else-if="tour.current.value?.id === 'uncovered'" />
          <StepPage v-else-if="currentStep" :step="currentStep" />
        </main>
        <ChatPanel v-if="tour.preferences.value.chatOpen" />
      </div>
      <footer class="bottom">
        <button class="button" @click="tour.move(-1)">← Prev</button>
        <button class="button" @click="tour.move(1)">Next →</button>
        <span class="small muted">{{ reviewedCount }}/{{ loaded.steps.length }} reviewed</span>
        <button class="button" :disabled="!tour.openNotes.value.length" title="Copy the open notes as a prompt for the author's session (c)" @click="copyForAuthor">
          Copy for the author<template v-if="tour.openNotes.value.length"> ({{ tour.openNotes.value.length }})</template>
        </button>
        <span v-if="handedOff" class="small muted">{{ handedOff }}</span>
        <span class="spacer small dim">j/k move · space reviewed + next · f filter · s split · w wrap · t theme · a ask · c copy notes · / search · ⌘⇧[ ] tabs</span>
        <button class="button" :class="{ on: tour.preferences.value.chatOpen }" title="Show or hide the chat (a)" @click="tour.toggleChat()">
          {{ tour.preferences.value.chatOpen ? "Ask ⇥" : "⇤ Ask" }}
        </button>
        <button v-if="currentStep" class="button" :class="{ primary: !currentDone }" @click="tour.toggleDone(currentStep.id)">
          {{ currentDone ? "✓ Reviewed" : "Mark reviewed" }}
        </button>
      </footer>
    </div>
    <div v-if="tour.activeTab.value" class="tab-body">
      <KeepAlive :max="12">
        <FileView :key="tour.activeTab.value" :file="tour.activeTab.value" />
      </KeepAlive>
    </div>
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
div.banner {
  display: flex;
  align-items: center;
  gap: 8px;
}
.banner.info {
  color: var(--muted);
  background: var(--raised);
}
.banner-action,
.banner-link {
  flex: none;
  height: 20px;
  padding: 0 8px;
  border: 1px solid currentColor;
  border-radius: 5px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.banner-link {
  padding: 0;
  border: 0;
  color: var(--accent);
}
.banner summary {
  cursor: pointer;
}
.problem {
  padding: 2px 0 2px 12px;
  font-family: var(--mono);
}
.tab-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
.button:disabled {
  opacity: 0.45;
  cursor: default;
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
