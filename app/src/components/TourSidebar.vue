<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { EntryId, Step } from "../lib/types";
import { TOUR } from "../lib/useTour";

const props = defineProps<{ concernCount: number }>();
const emit = defineEmits<{ nextMatch: [delta: number] }>();
const tour = inject(TOUR)!;
const search = ref<HTMLInputElement | null>(null);

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
  <nav class="sidebar">
    <div class="search">
      <input ref="search" v-model="tour.query.value" type="search" placeholder="Search the tour" spellcheck="false" @keydown="onSearchKey" />
      <span v-if="matchCount !== null" class="count">{{ matchCount ? `${matchCount} match${matchCount === 1 ? "" : "es"} · ⏎ next` : "No matches" }}</span>
    </div>
    <button v-if="shown('overview')" class="entry" :class="{ current: tour.current.value?.id === 'overview' }" @click="tour.go('overview')">
      <span class="left dim">◇</span><span class="label strong">Overview</span>
    </button>
    <template v-for="(entry, n) in tour.list.value" :key="entry.id">
      <button v-if="'step' in entry && shown(entry.id)" class="entry" :class="{ current: tour.current.value?.id === entry.id }" @click="tour.go(entry.id)">
        <span v-if="tour.progress.value.done[entry.id]" class="left done">✓</span>
        <span v-else class="left dim small">{{ n }}</span>
        <span class="label">
          <span class="title" :class="{ reviewed: tour.progress.value.done[entry.id] }">{{ entry.step.title }}</span>
          <span class="files">{{ fileLabel(entry.step) }}</span>
        </span>
        <span class="right">
          <span v-if="entry.step.hotspot" class="star">★</span>
          <span class="dot" :class="{ closely: entry.step.tag === 'read_closely' }" />
        </span>
      </button>
    </template>
    <button v-if="shown('concerns')" class="entry" :class="{ current: tour.current.value?.id === 'concerns' }" @click="tour.go('concerns')">
      <span class="left blocked">!</span><span class="label strong">Open concerns ({{ props.concernCount }})</span>
    </button>
  </nav>
</template>

<style scoped>
.sidebar {
  flex: none;
  width: 250px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-right: 1px solid var(--border);
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
.done {
  color: var(--done);
}
.blocked {
  color: var(--blocked);
}
</style>
