<script setup lang="ts">
import { computed, inject } from "vue";
import { expandDown, expandUp, splitItems, windowItems, type DiffWindow, type ParsedDiff, type Row } from "../lib/diff";
import { highlightKey, type AnchorKey, type CommitId, type NoteLines, type RepoFile, type Side, type StepId } from "../lib/types";
import type { DiffItem, SplitItem } from "../lib/diff";
import { TOUR } from "../lib/useTour";
import CodeText from "./CodeText.vue";
import NoteCard from "./NoteCard.vue";
import NoteComposer from "./NoteComposer.vue";
import SplitHalf from "./SplitHalf.vue";

/** A file whole: no expanders, folds at the edges too, and a higher row limit. */
const WHOLE_FILE_ROWS = 5000;

const props = defineProps<{
  file: RepoFile;
  diff: ParsedDiff;
  /** The commits the diff is between; colours and notes refer to them. */
  from: CommitId;
  to: CommitId;
  window: DiffWindow;
  /** Whether a row is marked as one the tour points at, on that side. */
  hit: (row: Row, side: Side) => boolean;
  whole?: boolean;
  /** With `whole`: show every line instead of folding long unchanged runs. */
  unfolded?: boolean;
  /** With both: line numbers pick lines for a note on `step`, written and shown right in the diff. */
  step?: StepId;
  place?: AnchorKey;
}>();
const pickable = computed(() => Boolean(props.step && props.place));
const tour = inject(TOUR)!;

const view = computed(() =>
  windowItems(props.diff.rows, props.diff.hunks, props.window, props.whole ? { foldEdges: true, maxRows: WHOLE_FILE_ROWS, fold: !props.unfolded } : {}),
);
const split = computed(() => tour.preferences.value.diffView === "split");
const pairs = computed(() => (split.value ? splitItems(view.value.items) : []));
const wrapped = computed(() => split.value || tour.preferences.value.wrap);
const topHeader = computed(() => {
  const { rows, hunks } = props.diff;
  const firstChange = rows.slice(props.window.lo, props.window.hi + 1).find((r) => r.hunk !== undefined);
  return firstChange ? hunks[firstChange.hunk!].header : "";
});
const canGrowUp = computed(() => !props.whole && props.window.lo > 0);
const canGrowDown = computed(() => !props.whole && props.window.hi < props.diff.rows.length - 1);

const oldLines = computed(() => tour.highlights.get(highlightKey(props.file, props.from)));
const newLines = computed(() => tour.highlights.get(highlightKey(props.file, props.to)));
/** Removed lines take their colours from the file at base, the rest from the file at head. */
const tokensOf = (row: Row) => (row.kind === "-" ? oldLines.value?.[row.old! - 1] : newLines.value?.[row.new! - 1]);
const tone = (row: Row) => ({ add: row.kind === "+", del: row.kind === "-" });
const hitAny = (row: Row) => props.hit(row, "old") || props.hit(row, "new");

/** Whether the row has a line on that side: removed lines only on the old one, added only on the new one. */
const lineOn = (row: Row, side: Side) => (side === "old" ? (row.kind !== "+" ? row.old : undefined) : row.kind !== "-" ? row.new : undefined);
const within = (row: Row, side: Side, lines: { file: RepoFile; side: Side; start: number; end: number }) => {
  const n = lineOn(row, side);
  return lines.file === props.file && lines.side === side && n !== undefined && n >= lines.start && n <= lines.end;
};
/** The lines picked in this box, if any. */
const target = computed(() => (pickable.value && tour.notePlace.value === props.place ? tour.noteTarget.value : null));
const picked = (row: Row, side: Side) => Boolean(target.value && within(row, side, target.value));
/** Open notes on this commit mark their lines; an older note's lines may have moved. */
const noted = (row: Row, side: Side) =>
  tour.openNotes.value.some((n) => n.lines && n.head_sha === props.to && within(row, side, n.lines));

function pick(event: MouseEvent, row: Row, side: Side) {
  const line = lineOn(row, side);
  if (pickable.value && line !== undefined) tour.pickLine(props.place!, props.file, side, line, event.shiftKey);
}

/** This step's open notes on this commit, each shown under its last line. */
const lineNotes = computed(() =>
  pickable.value
    ? tour.openNotes.value.filter((n) => n.step === props.step && n.lines?.file === props.file && n.head_sha === props.to)
    : [],
);
const endsAt = (row: Row | undefined, side: Side, lines: NoteLines) => Boolean(row && lines.side === side && lineOn(row, side) === lines.end);
/** The rows an item shows on each side: a unified row on both, a split pair on its own. */
const sidesOf = (item: DiffItem | SplitItem): [Row | undefined, Row | undefined] =>
  item.type === "row" ? [item.row, item.row] : item.type === "pair" ? [leftOf(item.left), rightOf(item.right)] : [undefined, undefined];
const endsHere = (item: DiffItem | SplitItem, lines: NoteLines) => {
  const [old, next] = sidesOf(item);
  return endsAt(old, "old", lines) || endsAt(next, "new", lines);
};
const notesAfter = (item: DiffItem | SplitItem) => lineNotes.value.filter((n) => endsHere(item, n.lines!));
const composerAfter = (item: DiffItem | SplitItem) => Boolean(target.value && endsHere(item, target.value));
/** In the split view, the left side shows base and the right side head. */
const leftOf = (row?: Row) => (row?.kind === "+" ? undefined : row);
const rightOf = (row?: Row) => (row?.kind === "-" ? undefined : row);
</script>

<template>
  <div class="code" :class="{ wrapped, split, pickable }">
    <div class="lines">
      <div v-if="!whole" class="expander" :class="{ action: canGrowUp }" @click="canGrowUp && expandUp(window)">
        <span class="gutter">{{ canGrowUp ? "↑" : "" }}</span><span class="label">{{ topHeader }}</span>
      </div>
      <template v-for="item in split ? pairs : view.items" :key="item.key">
        <div v-if="item.type === 'pair'" class="pair">
          <SplitHalf
            side="old"
            :row="leftOf(item.left)"
            :hit="Boolean(leftOf(item.left) && hit(item.left!, 'old'))"
            :tokens="leftOf(item.left) && tokensOf(item.left!)"
            :picked="Boolean(leftOf(item.left) && picked(item.left!, 'old'))"
            :noted="Boolean(leftOf(item.left) && noted(item.left!, 'old'))"
            @pick="pick($event, item.left!, 'old')"
          />
          <SplitHalf
            side="new"
            :row="rightOf(item.right)"
            :hit="Boolean(rightOf(item.right) && hit(item.right!, 'new'))"
            :tokens="rightOf(item.right) && tokensOf(item.right!)"
            :picked="Boolean(rightOf(item.right) && picked(item.right!, 'new'))"
            :noted="Boolean(rightOf(item.right) && noted(item.right!, 'new'))"
            @pick="pick($event, item.right!, 'new')"
          />
        </div>
        <div
          v-else-if="item.type === 'row'"
          class="row"
          :class="[
            tone(item.row),
            {
              hit: hitAny(item.row),
              picked: picked(item.row, 'old') || picked(item.row, 'new'),
              noted: noted(item.row, 'old') || noted(item.row, 'new'),
            },
          ]"
        >
          <span class="gutter">
            <span @click="pick($event, item.row, 'old')">{{ item.row.old ?? "" }}</span>
            <span @click="pick($event, item.row, 'new')">{{ item.row.new ?? "" }}</span>
          </span>
          <span class="text"><span class="sign">{{ item.row.kind === " " ? " " : item.row.kind }}</span><CodeText :text="item.row.text" :tokens="tokensOf(item.row)" /></span>
        </div>
        <div v-else-if="item.type === 'jump'" class="expander">
          <span class="gutter" /><span class="label">{{ item.header }}</span>
        </div>
        <div v-else class="expander action" @click="window.open.add(item.start)">
          <span class="gutter">↕</span><span class="label">{{ item.count }} unchanged lines</span>
        </div>
        <template v-if="pickable && (item.type === 'row' || item.type === 'pair')">
          <div v-for="note in notesAfter(item)" :key="note.id" class="inline-row">
            <NoteCard :note="note" inline />
          </div>
          <div v-if="composerAfter(item)" class="inline-row composer">
            <NoteComposer :step="step!" :head="to" :lines="target" inline @cancel="tour.noteTarget.value = null" />
          </div>
        </template>
      </template>
      <div v-if="view.truncated" class="note">… showing the first {{ view.items.length }} lines</div>
      <div v-if="canGrowDown" class="expander action" @click="expandDown(window, diff.rows)">
        <span class="gutter">↓</span><span class="label" />
      </div>
    </div>
  </div>
</template>
