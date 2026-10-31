<script setup lang="ts">
import { computed, inject } from "vue";
import { expandDown, expandUp, inAnchor, windowItems } from "../lib/diff";
import type { Anchor, AnchorKey } from "../lib/types";
import { TOUR } from "../lib/useTour";

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
const topHeader = computed(() => {
  if (!ready.value || !diffWindow.value) return "";
  const { rows, hunks } = ready.value;
  const firstChange = rows.slice(diffWindow.value.lo, diffWindow.value.hi + 1).find((r) => r.hunk !== undefined);
  return firstChange ? hunks[firstChange.hunk!].header : "";
});
const canGrowDown = computed(() => Boolean(ready.value && diffWindow.value && diffWindow.value.hi < ready.value.rows.length - 1));
</script>

<template>
  <section class="box">
    <header class="file">
      <span class="name">{{ anchor.file }}</span>
      <span class="range">{{ range }}</span>
    </header>
    <div v-if="!state || state.status === 'loading'" class="note">Loading diff…</div>
    <div v-else-if="state.status === 'error'" class="note error">{{ state.message }}</div>
    <div v-else-if="!view || !diffWindow" class="note warning">This anchor doesn't match any change in the diff.</div>
    <div v-else class="code">
      <div class="lines">
        <div class="expander" :class="{ action: diffWindow.lo > 0 }" @click="diffWindow.lo > 0 && expandUp(diffWindow)">
          <span class="gutter">{{ diffWindow.lo > 0 ? "↑" : "" }}</span><span class="label">{{ topHeader }}</span>
        </div>
        <template v-for="item in view.items" :key="item.key">
          <div v-if="item.type === 'row'" class="row" :class="{ add: item.row.kind === '+', del: item.row.kind === '-', hit: inAnchor(item.row, anchor) }">
            <span class="gutter"><span>{{ item.row.old ?? "" }}</span><span>{{ item.row.new ?? "" }}</span></span>
            <span class="text"><span class="sign">{{ item.row.kind === " " ? " " : item.row.kind }}</span>{{ item.row.text }}</span>
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

<style scoped>
.box {
  border: 1px solid var(--gh-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--gh-canvas);
  color: var(--gh-fg);
}
.file {
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
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.range {
  flex: none;
  font-size: 11px;
  color: var(--gh-muted);
}
.note {
  padding: 10px 12px;
  color: var(--gh-muted);
  font-size: 12px;
}
.note.error {
  color: var(--gh-del-sign);
}
.note.warning {
  color: var(--gh-selected);
}
.code {
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.lines {
  display: inline-block;
  min-width: 100%;
}
.row,
.expander {
  display: flex;
  min-width: 100%;
}
.gutter {
  position: sticky;
  left: 0;
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: 0;
  width: 91px;
  padding-right: 8px;
  border-left: 3px solid transparent;
  color: var(--gh-muted);
  background: var(--gh-canvas);
  user-select: none;
}
.gutter > span {
  width: 40px;
  text-align: right;
}
.text {
  flex: 1;
  padding: 0 10px 0 8px;
  white-space: pre;
  tab-size: 4;
}
.sign {
  display: inline-block;
  width: 1.5ch;
  user-select: none;
}
.row.add {
  background: var(--gh-add-line);
}
.row.add .gutter {
  background: linear-gradient(var(--gh-add-num), var(--gh-add-num)), var(--gh-canvas);
}
.row.add .sign {
  color: var(--gh-add-sign);
}
.row.del {
  background: var(--gh-del-line);
}
.row.del .gutter {
  background: linear-gradient(var(--gh-del-num), var(--gh-del-num)), var(--gh-canvas);
}
.row.del .sign {
  color: var(--gh-del-sign);
}
.row.hit .gutter {
  border-left-color: var(--gh-selected);
}
.expander {
  height: 28px;
  align-items: center;
  background: var(--gh-hunk-line);
  color: var(--gh-muted);
}
.expander .gutter {
  justify-content: center;
  align-self: stretch;
  align-items: center;
  padding: 0;
  background: linear-gradient(var(--gh-hunk-num), var(--gh-hunk-num)), var(--gh-canvas);
}
.expander .label {
  padding: 0 10px;
  white-space: pre;
}
.expander.action {
  cursor: pointer;
}
.expander.action:hover {
  opacity: 0.8;
}
</style>
