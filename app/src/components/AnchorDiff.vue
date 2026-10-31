<script setup lang="ts">
import { computed, inject } from "vue";
import { inAnchor, type Row } from "../lib/diff";
import type { Anchor, AnchorKey, Side, StepId } from "../lib/types";
import { TOUR } from "../lib/useTour";
import DiffBody from "./DiffBody.vue";

/** With `step`, lines can be picked for notes on it, right in the diff. */
const props = defineProps<{ anchor: Anchor; anchorKey: AnchorKey; step?: StepId }>();
const tour = inject(TOUR)!;

const range = computed(() => {
  const { start, end, side } = props.anchor;
  const lines = start === end ? `L${start}` : `L${start}–${end}`;
  return side === "old" ? `${lines} (removed)` : lines;
});
const state = computed(() => tour.diffs.get(props.anchor.file));
const ready = computed(() => (state.value?.status === "ready" ? state.value.diff : null));
const diffWindow = computed(() => (ready.value ? tour.windowFor(props.anchorKey, ready.value.rows, props.anchor) : null));
const hit = (row: Row, side: Side) => (props.anchor.side ?? "new") === side && inAnchor(row, props.anchor);
</script>

<template>
  <section class="diff-box">
    <header class="file">
      <span class="name">{{ anchor.file }}</span>
      <span class="range">{{ range }}</span>
      <button class="open-file" title="Open the whole file's diff in a tab" @click="tour.openTab(anchor.file)">Whole file ↗</button>
    </header>
    <div v-if="!state || state.status === 'loading'" class="note">Loading diff…</div>
    <div v-else-if="state.status === 'error'" class="note error">{{ state.message }}</div>
    <div v-else-if="!ready || !diffWindow" class="note warning">This anchor doesn't match any change in the diff.</div>
    <DiffBody
      v-else
      :file="anchor.file"
      :diff="ready"
      :from="tour.tour.value!.base_sha"
      :to="tour.tour.value!.head_sha"
      :window="diffWindow"
      :hit="hit"
      :step="step"
      :place="anchorKey"
    />
  </section>
</template>

<style>
/* Not scoped: DiffBody and SplitHalf draw inside the box, and the file view uses it too. */
.diff-box {
  border: 1px solid var(--gh-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--gh-canvas);
  color: var(--gh-fg);
}
.diff-box .file {
  display: flex;
  gap: 10px;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  background: var(--gh-header);
  border-bottom: 1px solid var(--gh-border);
  font-family: var(--mono);
  font-size: 12px;
}
.diff-box .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.diff-box .open-file {
  flex: none;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--gh-border);
  border-radius: 6px;
  background: none;
  color: var(--gh-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.diff-box .open-file:hover {
  color: var(--gh-fg);
}
.diff-box .range {
  flex: none;
  font-size: 11px;
  color: var(--gh-muted);
}
.diff-box .note {
  padding: 10px 12px;
  color: var(--gh-muted);
  font-size: 12px;
}
.diff-box .note.error {
  color: var(--gh-del-sign);
}
.diff-box .note.warning {
  color: var(--gh-selected);
}
.diff-box .code {
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.diff-box .code.wrapped {
  overflow-x: hidden;
}
.diff-box .lines {
  display: inline-block;
  min-width: 100%;
}
.diff-box .wrapped .lines {
  display: block;
}
.diff-box .row,
.diff-box .expander {
  display: flex;
  min-width: 100%;
}
.diff-box .pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.diff-box .half {
  min-width: 0;
}
.diff-box .half + .half {
  border-left: 1px solid var(--gh-border);
}
.diff-box .gutter {
  position: sticky;
  left: 0;
  flex: none;
  display: flex;
  justify-content: flex-end;
  width: 91px;
  padding-right: 8px;
  border-left: 3px solid transparent;
  color: var(--gh-muted);
  background: var(--gh-canvas);
  user-select: none;
}
.diff-box .gutter.single {
  width: 54px;
}
.diff-box .gutter > span {
  width: 40px;
  text-align: right;
}
.diff-box .text {
  flex: 1;
  min-width: 0;
  padding: 0 10px 0 8px;
  white-space: pre;
  tab-size: 4;
}
.diff-box .wrapped .text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-left: calc(8px + 1.5ch);
  text-indent: -1.5ch;
}
.diff-box .sign {
  display: inline-block;
  width: 1.5ch;
  text-indent: 0;
  user-select: none;
}
.diff-box .row.add {
  background: var(--gh-add-line);
}
.diff-box .row.add .gutter {
  background: linear-gradient(var(--gh-add-num), var(--gh-add-num)), var(--gh-canvas);
}
.diff-box .row.add .sign {
  color: var(--gh-add-sign);
}
.diff-box .row.del {
  background: var(--gh-del-line);
}
.diff-box .row.del .gutter {
  background: linear-gradient(var(--gh-del-num), var(--gh-del-num)), var(--gh-canvas);
}
.diff-box .row.del .sign {
  color: var(--gh-del-sign);
}
.diff-box .row.empty {
  background: color-mix(in srgb, var(--gh-border) 25%, transparent);
}
.diff-box .pickable .gutter span,
.diff-box .pickable .gutter.single {
  cursor: pointer;
}
.diff-box .pickable .gutter span:hover,
.diff-box .pickable .gutter.single:hover {
  color: var(--gh-fg);
}
/* Container units let an inline note span the visible width while long lines scroll sideways. */
.diff-box .code {
  container-type: inline-size;
}
.diff-box .inline-row {
  position: sticky;
  left: 0;
  width: 100cqw;
  /* Prose, not code: undo the code area's font, line height and no-wrap. */
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.4;
  white-space: normal;
  padding: 8px 12px;
  border-top: 1px solid var(--gh-border);
  border-bottom: 1px solid var(--gh-border);
  background: var(--gh-header);
}
.diff-box .inline-row.composer {
  padding: 0;
}
.diff-box .row.picked {
  background: color-mix(in srgb, var(--gh-selected) 22%, var(--gh-canvas));
}
.diff-box .row.picked .gutter {
  background: color-mix(in srgb, var(--gh-selected) 30%, var(--gh-canvas));
}
.diff-box .row.noted .gutter {
  box-shadow: inset -3px 0 0 var(--accent);
}
.diff-box .row.hit .gutter {
  border-left-color: var(--gh-selected);
}
.diff-box .expander {
  height: 28px;
  align-items: center;
  background: var(--gh-hunk-line);
  color: var(--gh-muted);
}
.diff-box .expander .gutter {
  justify-content: center;
  align-self: stretch;
  align-items: center;
  padding: 0;
  background: linear-gradient(var(--gh-hunk-num), var(--gh-hunk-num)), var(--gh-canvas);
}
.diff-box .expander .label {
  padding: 0 10px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.diff-box .expander.action {
  cursor: pointer;
}
.diff-box .expander.action:hover {
  opacity: 0.8;
}
</style>
