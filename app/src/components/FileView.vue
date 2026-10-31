<script setup lang="ts">
import { computed, inject, reactive, ref } from "vue";
import { inAnchor, wholeFileWindow, type Row } from "../lib/diff";
import { shortCommit, type Anchor, type RepoFile, type Side } from "../lib/types";
import { TOUR } from "../lib/useTour";
import DiffBody from "./DiffBody.vue";

const props = defineProps<{ file: RepoFile }>();
const tour = inject(TOUR)!;

const loaded = computed(() => tour.tour.value!);
const state = computed(() => tour.diffs.get(props.file));
const ready = computed(() => (state.value?.status === "ready" ? state.value.diff : null));
// A new diff (the tour changed) starts a new window; folds opened by hand belong to the old one.
const diffWindow = computed(() => (ready.value ? reactive(wholeFileWindow(ready.value.rows)) : null));
const unfolded = ref(false);

const counts = computed(() => {
  const rows = ready.value?.rows ?? [];
  return { added: rows.filter((r) => r.kind === "+").length, removed: rows.filter((r) => r.kind === "-").length };
});

/** Everything in the tour that points into this file, in tour order. */
const pointers = computed(() => {
  const found: { label: string; anchor: Anchor }[] = [];
  for (const step of loaded.value.steps) {
    for (const anchor of step.anchors) if (anchor.file === props.file) found.push({ label: step.title, anchor });
  }
  loaded.value.concerns.forEach((concern, i) => {
    if (concern.anchor?.file === props.file) found.push({ label: `Concern ${i + 1}`, anchor: concern.anchor });
  });
  return found;
});
const range = ({ start, end, side }: Anchor) => `${side === "old" ? "removed " : ""}L${start}${end === start ? "" : `–${end}`}`;
const hit = (row: Row, side: Side) => pointers.value.some(({ anchor }) => (anchor.side ?? "new") === side && inAnchor(row, anchor));
</script>

<template>
  <div class="file-view">
    <header class="top">
      <span class="path">{{ file }}</span>
      <span class="small muted">{{ loaded.branch }} → {{ loaded.base }} · {{ shortCommit(loaded.base_sha) }}..{{ shortCommit(loaded.head_sha) }}</span>
      <span v-if="ready" class="small"><span class="added">+{{ counts.added }}</span> <span class="removed">−{{ counts.removed }}</span></span>
      <span class="spacer" />
      <div class="segmented">
        <button :class="{ on: tour.preferences.value.diffView === 'unified' }" @click="tour.setDiffView('unified')">Unified</button>
        <button :class="{ on: tour.preferences.value.diffView === 'split' }" @click="tour.setDiffView('split')">Split</button>
      </div>
      <button
        class="toggle"
        :class="{ on: tour.preferences.value.wrap || tour.preferences.value.diffView === 'split' }"
        :disabled="tour.preferences.value.diffView === 'split'"
        title="Wrap long lines (w); the split view always wraps"
        @click="tour.toggleWrap()"
      >
        Wrap
      </button>
      <button class="toggle" :class="{ on: unfolded }" title="Show every line instead of folding unchanged ones" @click="unfolded = !unfolded">All lines</button>
    </header>
    <div v-if="pointers.length" class="pointers">
      <span class="small dim">The tour points here:</span>
      <span v-for="(pointer, i) in pointers" :key="i" class="pointer"><span class="mark" />{{ pointer.label }} · {{ range(pointer.anchor) }}</span>
    </div>
    <main class="body">
      <div v-if="!state || state.status === 'loading'" class="note">Loading diff…</div>
      <div v-else-if="state.status === 'error'" class="note error">{{ state.message }}</div>
      <section v-else-if="ready && diffWindow" class="diff-box">
        <DiffBody :file="file" :diff="ready" :window="diffWindow" :hit="hit" whole :unfolded="unfolded" />
      </section>
    </main>
  </div>
</template>

<style scoped>
.file-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.top {
  flex: none;
  height: 42px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}
.path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.pointers {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
.pointer {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
}
.mark {
  width: 3px;
  height: 12px;
  background: var(--gh-selected);
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}
.note {
  color: var(--muted);
}
.note.error {
  color: var(--gh-del-sign);
}
.added {
  color: var(--gh-add-sign);
}
.removed {
  color: var(--gh-del-sign);
}
.spacer {
  flex: 1;
}
.segmented {
  display: flex;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.segmented button,
.toggle {
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
.toggle {
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.toggle:disabled {
  cursor: default;
  opacity: 0.6;
}
.toggle.on {
  border-color: var(--accent);
  color: var(--accent);
}
.small {
  font-size: 11px;
}
.muted {
  color: var(--muted);
}
.dim {
  color: var(--dim);
}
</style>
