<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import type { EntryId, Step } from "../lib/types";
import { TOUR } from "../lib/useTour";

const props = defineProps<{ concernCount: number }>();
const emit = defineEmits<{ nextMatch: [delta: number] }>();
const tour = inject(TOUR)!;
const search = ref<HTMLInputElement | null>(null);

// While dragging, the width follows the pointer locally; it's saved once, on release.
const dragging = ref<number | null>(null);
const width = computed(() => dragging.value ?? tour.preferences.value.sidebarWidth);

function startResize(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = width.value;
  handle.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => (dragging.value = tour.clampWidth(startWidth + e.clientX - startX));
  const end = () => {
    handle.removeEventListener("pointermove", move);
    if (dragging.value !== null) tour.setSidebarWidth(dragging.value);
    dragging.value = null;
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end, { once: true });
  handle.addEventListener("pointercancel", end, { once: true });
}

/** A step's number in the tour, the same whether or not entries are filtered or added. */
const stepNumber = (id: EntryId) => (tour.tour.value?.steps.findIndex((s) => s.id === id) ?? 0) + 1;

const openChanges = (id: EntryId) => tour.openNotes.value.filter((n) => n.step === id && n.kind === "change").length;

const shown = (id: EntryId) => !tour.matching.value || tour.matching.value.has(id);
const matchCount = computed(() => tour.matching.value?.size ?? null);

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Enter") emit("nextMatch", event.shiftKey ? -1 : 1);
  else if (event.key === "Escape") {
    tour.query.value = "";
    search.value?.blur();
  } else return;
  event.preventDefault();
}

defineExpose({
  focusSearch() {
    search.value?.focus();
    search.value?.select();
  },
});

const fileLabel = (step: Step) => {
  const name = step.anchors[0].file.split("/").pop();
  return step.anchors.length > 1 ? `${name} +${step.anchors.length - 1}` : name;
};
</script>

<template>
  <nav class="sidebar" :style="{ width: `${width}px` }">
    <div class="resize" :class="{ active: dragging !== null }" title="Drag to resize" @pointerdown.prevent="startResize" @dblclick="tour.setSidebarWidth(DEFAULT_PREFERENCES.sidebarWidth)" />
    <div class="search">
      <button class="filter" :class="{ on: tour.closelyOnly.value }" title="Show only the steps to read closely (f)" @click="tour.toggleFilter()">
        {{ tour.closelyOnly.value ? "● Read closely only" : "○ Read closely only" }}
      </button>
      <input ref="search" v-model="tour.query.value" type="search" placeholder="Search the tour" spellcheck="false" @keydown="onSearchKey" />
      <span v-if="matchCount !== null" class="count">{{ matchCount ? `${matchCount} match${matchCount === 1 ? "" : "es"} · ⏎ next` : "No matches" }}</span>
    </div>
    <button v-if="shown('overview')" class="entry" :class="{ current: tour.current.value?.id === 'overview' }" @click="tour.go('overview')">
      <span class="left dim">◇</span><span class="label strong">Overview</span>
    </button>
    <button v-if="tour.delta.active.value && shown('since')" class="entry" :class="{ current: tour.current.value?.id === 'since' }" @click="tour.go('since')">
      <span class="left changed">↻</span>
      <span class="label strong">Since the tour<template v-if="tour.delta.since.value"> ({{ tour.delta.since.value.commits.length }})</template></span>
    </button>
    <template v-for="entry in tour.list.value" :key="entry.id">
      <button v-if="'step' in entry && shown(entry.id)" class="entry" :class="{ current: tour.current.value?.id === entry.id }" @click="tour.go(entry.id)">
        <span v-if="tour.delta.steps.value.get(entry.id)?.status === 'changed'" class="left changed" title="Changed since reviewed">↻</span>
        <span v-else-if="tour.progress.value.done[entry.id]" class="left done">✓</span>
        <span v-else class="left dim small">{{ stepNumber(entry.id) }}</span>
        <span class="label">
          <span class="title" :class="{ reviewed: tour.isReviewed(entry.id) }">{{ entry.step.title }}</span>
          <span class="files">{{ fileLabel(entry.step) }}</span>
        </span>
        <span class="right">
          <span v-if="openChanges(entry.id)" class="notes" :title="`${openChanges(entry.id)} open change request(s)`">{{ openChanges(entry.id) }}</span>
          <span v-if="entry.step.hotspot" class="star">★</span>
          <span class="dot" :class="{ closely: entry.step.tag === 'read_closely' }" />
        </span>
      </button>
    </template>
    <button v-if="shown('concerns')" class="entry" :class="{ current: tour.current.value?.id === 'concerns' }" @click="tour.go('concerns')">
      <span class="left blocked">!</span><span class="label strong">Open concerns ({{ props.concernCount }})</span>
    </button>
    <button v-if="shown('uncovered')" class="entry" :class="{ current: tour.current.value?.id === 'uncovered' }" @click="tour.go('uncovered')">
      <span class="left dim">○</span>
      <span class="label strong">Not in the tour<template v-if="tour.uncovered.value"> ({{ tour.uncovered.value.length }})</template></span>
    </button>
  </nav>
</template>

<style scoped>
.sidebar {
  position: relative;
  flex: none;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-right: 1px solid var(--border);
}
.resize {
  position: absolute;
  z-index: 1;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
}
.resize:hover,
.resize.active {
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}
.search {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 2px 8px;
}
.search input {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.search input:focus {
  border-color: var(--accent);
}
.filter {
  height: 24px;
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
.count {
  padding-left: 2px;
  font-size: 10px;
  color: var(--dim);
}
.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 4px 8px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.entry:hover {
  background: var(--hover);
}
.entry.current {
  background: var(--selected);
}
.left {
  flex: none;
  width: 16px;
  text-align: center;
}
.label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.strong {
  font-weight: 600;
}
.title {
  font-size: 12px;
}
.title.reviewed {
  color: var(--muted);
}
.files {
  font-size: 10px;
  color: var(--dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.notes {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}
.star {
  font-size: 11px;
  color: var(--blocked);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
}
.dot.closely {
  background: var(--accent);
}
.dim {
  color: var(--dim);
}
.small {
  font-size: 11px;
}
.changed {
  color: var(--accent);
}
.done {
  color: var(--done);
}
.blocked {
  color: var(--blocked);
}
</style>
