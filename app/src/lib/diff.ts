import type { Anchor, HunkIndex, LineNumber, RowIndex } from "./types";

export const CONTEXT = 3;
export const EXPAND_STEP = 20;
export const FOLD_AFTER = 8;
export const MAX_ROWS = 400;

export type RowKind = "+" | "-" | " ";

export interface Row {
  kind: RowKind;
  old?: LineNumber;
  new?: LineNumber;
  text: string;
  hunk?: HunkIndex;
  /** An unchanged line between hunks, taken from the file at head. */
  gap?: true;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  rows: Row[];
}

export interface ParsedDiff {
  hunks: Hunk[];
  rows: Row[];
}

/** The rows an anchor shows, widened by the expanders; `open` holds unfolded gap runs. */
export interface DiffWindow {
  lo: RowIndex;
  hi: RowIndex;
  open: Set<RowIndex>;
}

export type DiffItem =
  | { type: "row"; key: string; row: Row; index: RowIndex }
  | { type: "jump"; key: string; header: string }
  | { type: "fold"; key: string; start: RowIndex; count: number };

const line = (n: number) => n as LineNumber;
const rowIndex = (n: number) => n as RowIndex;

export function parseDiff(text: string): Hunk[] {
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let old = 0;
  let next = 0;
  for (const raw of text.replace(/\n$/, "").split("\n")) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/.exec(raw);
    if (match) {
      old = +match[1];
      next = +match[3];
      hunk = { header: raw, oldStart: old, oldLen: +(match[2] ?? 1), newStart: next, newLen: +(match[4] ?? 1), rows: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk || raw.startsWith("\\")) continue;
    const kind = raw[0];
    const text = raw.slice(1);
    if (kind === "-") hunk.rows.push({ kind, old: line(old++), text });
    else if (kind === "+") hunk.rows.push({ kind, new: line(next++), text });
    else if (kind === " ") hunk.rows.push({ kind, old: line(old++), new: line(next++), text });
  }
  return hunks;
}

/**
 * The whole file as one list: each hunk's rows, with the unchanged lines between
 * hunks (from the file at head) filled in, so an anchor's window can grow past its
 * hunk. Without the file at head (deleted or binary), only the hunks are known.
 */
export function fileRows(hunks: Hunk[], lines: string[] | null): Row[] {
  const rows: Row[] = [];
  let oldAt = 1;
  let newAt = 1;
  const fill = (until: number) => {
    for (; newAt <= until; newAt++, oldAt++) {
      if (lines) rows.push({ kind: " ", gap: true, old: line(oldAt), new: line(newAt), text: lines[newAt - 1] ?? "" });
    }
  };
  hunks.forEach((h, i) => {
    fill(h.newLen === 0 ? h.newStart : h.newStart - 1);
    for (const row of h.rows) rows.push({ ...row, hunk: i as HunkIndex });
    oldAt = h.oldLen === 0 ? h.oldStart + 1 : h.oldStart + h.oldLen;
    newAt = h.newLen === 0 ? h.newStart + 1 : h.newStart + h.newLen;
  });
  if (lines) fill(lines.length);
  return rows;
}

export function parseFile(diff: string, atHead: string | null): ParsedDiff {
  const hunks = parseDiff(diff);
  const lines = atHead === null ? null : atHead.replace(/\n$/, "").split("\n");
  return { hunks, rows: fileRows(hunks, lines) };
}

export function inAnchor(row: Row, anchor: Anchor): boolean {
  const n = anchor.side === "old" ? row.old : row.new;
  return n !== undefined && n >= anchor.start && n <= anchor.end;
}

/** The anchor's own rows plus CONTEXT on each side, or null if it matches no row. */
export function anchorWindow(rows: Row[], anchor: Anchor): DiffWindow | null {
  const first = rows.findIndex((r) => inAnchor(r, anchor));
  if (first < 0) return null;
  const last = rows.findLastIndex((r) => inAnchor(r, anchor));
  return {
    lo: rowIndex(Math.max(0, first - CONTEXT)),
    hi: rowIndex(Math.min(rows.length - 1, last + CONTEXT)),
    open: new Set(),
  };
}

const jumpsBetween = (a: Row, b: Row) => a.hunk !== undefined && b.hunk !== undefined && a.hunk !== b.hunk;

export interface WindowOptions {
  maxRows?: number;
  /**
   * Fold runs at the window's edges too. An anchor's window leaves them open,
   * since its expanders grow it there; a whole file has nothing to grow into.
   */
  foldEdges?: boolean;
  /** False shows every line, folding nothing. */
  fold?: boolean;
}

/** All of a file's rows, for the file view. */
export function wholeFileWindow(rows: Row[]): DiffWindow {
  return { lo: rowIndex(0), hi: rowIndex(Math.max(0, rows.length - 1)), open: new Set() };
}

/**
 * What a window draws, top to bottom: rows, a header where the diff jumps between
 * hunks without the lines in between, and a fold for each long run of unchanged
 * lines that hasn't been opened.
 */
export function windowItems(rows: Row[], hunks: Hunk[], window: DiffWindow, { maxRows = MAX_ROWS, foldEdges = false, fold = true }: WindowOptions = {}): { items: DiffItem[]; truncated: boolean } {
  const items: DiffItem[] = [];
  let shown = 0;
  for (let i = window.lo as number; i <= window.hi && shown < maxRows; i++) {
    const row = rows[i];
    const previous = i > window.lo ? rows[i - 1] : undefined;
    if (previous && jumpsBetween(previous, row)) {
      items.push({ type: "jump", key: `jump-${i}`, header: hunks[row.hunk!].header });
    }
    const startsRun = row.gap && !previous?.gap;
    if (fold && startsRun && (foldEdges || i !== window.lo) && !window.open.has(rowIndex(i))) {
      let end = i;
      while (end + 1 <= window.hi && rows[end + 1].gap) end++;
      const count = end - i + 1;
      if (count > FOLD_AFTER && (foldEdges || end !== window.hi)) {
        items.push({ type: "fold", key: `fold-${i}`, start: rowIndex(i), count });
        i = end;
        continue;
      }
    }
    items.push({ type: "row", key: `row-${i}`, row, index: rowIndex(i) });
    shown++;
  }
  return { items, truncated: shown >= maxRows };
}

export function expandUp(window: DiffWindow) {
  window.lo = rowIndex(Math.max(0, window.lo - EXPAND_STEP));
}

export function expandDown(window: DiffWindow, rows: Row[]) {
  window.hi = rowIndex(Math.min(rows.length - 1, window.hi + EXPAND_STEP));
}

/** One line of the split view: base on the left, head on the right. */
export type SplitItem =
  | { type: "pair"; key: string; left?: Row; right?: Row }
  | Exclude<DiffItem, { type: "row" }>;

/**
 * Pairs a unified window for the split view. Within a change, the n-th removed
 * line sits beside the n-th added one; unchanged lines sit beside themselves.
 */
export function splitItems(items: DiffItem[]): SplitItem[] {
  const split: SplitItem[] = [];
  let removed: Extract<DiffItem, { type: "row" }>[] = [];
  let added: Extract<DiffItem, { type: "row" }>[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      split.push({ type: "pair", key: (removed[i] ?? added[i]).key, left: removed[i]?.row, right: added[i]?.row });
    }
    removed = [];
    added = [];
  };
  for (const item of items) {
    if (item.type === "row" && item.row.kind === "-") {
      if (added.length) flush();
      removed.push(item);
    } else if (item.type === "row" && item.row.kind === "+") {
      added.push(item);
    } else {
      flush();
      split.push(item.type === "row" ? { type: "pair", key: item.key, left: item.row, right: item.row } : item);
    }
  }
  flush();
  return split;
}
