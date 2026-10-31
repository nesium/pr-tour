<script setup lang="ts">
import { computed, inject } from "vue";
import { expandDown, expandUp, inAnchor, splitItems, windowItems, type Row } from "../lib/diff";
import { highlightKey, type Anchor, type AnchorKey } from "../lib/types";
import { TOUR } from "../lib/useTour";
import CodeText from "./CodeText.vue";
import SplitHalf from "./SplitHalf.vue";

const props = defineProps<{ anchor: Anchor; anchorKey: AnchorKey }>();
const tour = inject(TOUR)!;

const range = computed(() => {
  const { start, end, side } = props.anchor;
  const lines = start === end ? `L${start}` : `L${start}–${end}`;
  return side === "old" ? `${lines} (removed)` : lines;
});
const state = computed(() => tour.diffs.get(props.anchor.file));
const ready = computed(() => (state.value?.status === "ready" ? state.value.diff : null));
const diffWindow = computed(() => (ready.value ? tour.windowFor(props.anchorKey, ready.value.rows, props.anchor) : null));
const view = computed(() => (ready.value && diffWindow.value ? windowItems(ready.value.rows, ready.value.hunks, diffWindow.value) : null));
const split = computed(() => tour.preferences.value.diffView === "split");
const pairs = computed(() => (split.value && view.value ? splitItems(view.value.items) : []));
const wrapped = computed(() => split.value || tour.preferences.value.wrap);
const topHeader = computed(() => {
  if (!ready.value || !diffWindow.value) return "";
  const { rows, hunks } = ready.value;
  const firstChange = rows.slice(diffWindow.value.lo, diffWindow.value.hi + 1).find((r) => r.hunk !== undefined);
  return firstChange ? hunks[firstChange.hunk!].header : "";
});
const canGrowDown = computed(() => Boolean(ready.value && diffWindow.value && diffWindow.value.hi < ready.value.rows.length - 1));

const oldLines = computed(() => tour.highlights.get(highlightKey(props.anchor.file, "old")));
const newLines = computed(() => tour.highlights.get(highlightKey(props.anchor.file, "new")));
/** Removed lines take their colours from the file at base, the rest from the file at head. */
const tokensOf = (row: Row) => (row.kind === "-" ? oldLines.value?.[row.old! - 1] : newLines.value?.[row.new! - 1]);
const tone = (row?: Row) => ({ add: row?.kind === "+", del: row?.kind === "-", empty: !row });
const hit = (row?: Row) => Boolean(row && inAnchor(row, props.anchor));
/** In the split view, the left side shows base and the right side head. */
const leftOf = (row?: Row) => (row?.kind === "+" ? undefined : row);
const rightOf = (row?: Row) => (row?.kind === "-" ? undefined : row);
</script>

<template>
  <section class="box anchor-diff">
    <header class="file">
      <span class="name">{{ anchor.file }}</span>
      <span class="range">{{ range }}</span>
    </header>
    <div v-if="!state || state.status === 'loading'" class="note">Loading diff…</div>
    <div v-else-if="state.status === 'error'" class="note error">{{ state.message }}</div>
    <div v-else-if="!view || !diffWindow" class="note warning">This anchor doesn't match any change in the diff.</div>
    <div v-else class="code" :class="{ wrapped, split }">
      <div class="lines">
        <div class="expander" :class="{ action: diffWindow.lo > 0 }" @click="diffWindow.lo > 0 && expandUp(diffWindow)">
          <span class="gutter">{{ diffWindow.lo > 0 ? "↑" : "" }}</span><span class="label">{{ topHeader }}</span>
        </div>
        <template v-for="item in split ? pairs : view.items" :key="item.key">
          <div v-if="item.type === 'pair'" class="pair">
            <SplitHalf side="old" :row="leftOf(item.left)" :hit="anchor.side === 'old' && hit(leftOf(item.left))" :tokens="leftOf(item.left) && tokensOf(item.left!)" />
            <SplitHalf side="new" :row="rightOf(item.right)" :hit="anchor.side !== 'old' && hit(rightOf(item.right))" :tokens="rightOf(item.right) && tokensOf(item.right!)" />
          </div>
          <div v-else-if="item.type === 'row'" class="row" :class="[tone(item.row), { hit: hit(item.row) }]">
            <span class="gutter"><span>{{ item.row.old ?? "" }}</span><span>{{ item.row.new ?? "" }}</span></span>
            <span class="text"><span class="sign">{{ item.row.kind === " " ? " " : item.row.kind }}</span><CodeText :text="item.row.text" :tokens="tokensOf(item.row)" /></span>
          </div>
          <div v-else-if="item.type === 'jump'" class="expander">
            <span class="gutter" /><span class="label">{{ item.header }}</span>
          </div>
          <div v-else class="expander action" @click="diffWindow.open.add(item.start)">
            <span class="gutter">↕</span><span class="label">{{ item.count }} unchanged lines</span>
          </div>
        </template>
        <div v-if="view.truncated" class="note">… showing the first {{ view.items.length }} lines</div>
        <div v-if="canGrowDown" class="expander action" @click="expandDown(diffWindow, ready!.rows)">
          <span class="gutter">↓</span><span class="label" />
        </div>
      </div>
    </div>
  </section>
</template>

<style>
/* Not scoped: SplitHalf draws rows too. */
.anchor-diff {
  border: 1px solid var(--gh-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--gh-canvas);
  color: var(--gh-fg);
}
.anchor-diff .file {
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
.anchor-diff .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.anchor-diff .range {
  flex: none;
  font-size: 11px;
  color: var(--gh-muted);
}
.anchor-diff .note {
  padding: 10px 12px;
  color: var(--gh-muted);
  font-size: 12px;
}
.anchor-diff .note.error {
  color: var(--gh-del-sign);
}
.anchor-diff .note.warning {
  color: var(--gh-selected);
}
.anchor-diff .code {
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.anchor-diff .code.wrapped {
  overflow-x: hidden;
}
.anchor-diff .lines {
  display: inline-block;
  min-width: 100%;
}
.anchor-diff .wrapped .lines {
  display: block;
}
.anchor-diff .row,
.anchor-diff .expander {
  display: flex;
  min-width: 100%;
}
.anchor-diff .pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.anchor-diff .half {
  min-width: 0;
}
.anchor-diff .half + .half {
  border-left: 1px solid var(--gh-border);
}
.anchor-diff .gutter {
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
.anchor-diff .gutter.single {
  width: 54px;
}
.anchor-diff .gutter > span {
  width: 40px;
  text-align: right;
}
.anchor-diff .text {
  flex: 1;
  min-width: 0;
  padding: 0 10px 0 8px;
  white-space: pre;
  tab-size: 4;
}
.anchor-diff .wrapped .text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-left: calc(8px + 1.5ch);
  text-indent: -1.5ch;
}
.anchor-diff .sign {
  display: inline-block;
  width: 1.5ch;
  text-indent: 0;
  user-select: none;
}
.anchor-diff .row.add {
  background: var(--gh-add-line);
}
.anchor-diff .row.add .gutter {
  background: linear-gradient(var(--gh-add-num), var(--gh-add-num)), var(--gh-canvas);
}
.anchor-diff .row.add .sign {
  color: var(--gh-add-sign);
}
.anchor-diff .row.del {
  background: var(--gh-del-line);
}
.anchor-diff .row.del .gutter {
  background: linear-gradient(var(--gh-del-num), var(--gh-del-num)), var(--gh-canvas);
}
.anchor-diff .row.del .sign {
  color: var(--gh-del-sign);
}
.anchor-diff .row.empty {
  background: color-mix(in srgb, var(--gh-border) 25%, transparent);
}
.anchor-diff .row.hit .gutter {
  border-left-color: var(--gh-selected);
}
.anchor-diff .expander {
  height: 28px;
  align-items: center;
  background: var(--gh-hunk-line);
  color: var(--gh-muted);
}
.anchor-diff .expander .gutter {
  justify-content: center;
  align-self: stretch;
  align-items: center;
  padding: 0;
  background: linear-gradient(var(--gh-hunk-num), var(--gh-hunk-num)), var(--gh-canvas);
}
.anchor-diff .expander .label {
  padding: 0 10px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.anchor-diff .expander.action {
  cursor: pointer;
}
.anchor-diff .expander.action:hover {
  opacity: 0.8;
}
</style>
