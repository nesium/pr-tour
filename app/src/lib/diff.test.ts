import { describe, expect, it } from "vitest";
import { anchorWindow, expandUp, fileRows, parseDiff, parseFile, windowItems, type DiffItem } from "./diff";
import type { Anchor, LineNumber, RepoFile, RowIndex } from "./types";

const anchor = (start: number, end: number, side?: "old" | "new"): Anchor => ({
  file: "a.ts" as RepoFile,
  side,
  start: start as LineNumber,
  end: end as LineNumber,
});
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const kinds = (items: DiffItem[]) => items.map((i) => (i.type === "row" ? i.row.kind : i.type)).join("");

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,3 +2,3 @@ fn a
 line 2
-old 3
+line 3
 line 4
@@ -30,2 +30,3 @@ fn b
 line 30
+line 31
 line 32
\\ No newline at end of file
`;

describe("parseDiff", () => {
  it("numbers both sides and skips the no-newline marker", () => {
    const [first, second] = parseDiff(DIFF);
    expect(first.rows.map((r) => [r.kind, r.old, r.new])).toEqual([
      [" ", 2, 2],
      ["-", 3, undefined],
      ["+", undefined, 3],
      [" ", 4, 4],
    ]);
    expect(second).toMatchObject({ oldStart: 30, oldLen: 2, newStart: 30, newLen: 3 });
    expect(second.rows).toHaveLength(3);
  });

  it("defaults a missing length to 1", () => {
    expect(parseDiff("@@ -5 +5 @@\n-a\n+b\n")[0]).toMatchObject({ oldLen: 1, newLen: 1 });
  });
});

describe("fileRows", () => {
  it("fills the unchanged lines between and after hunks", () => {
    const { rows } = parseFile(DIFF, numbered(40));
    expect(rows[0]).toMatchObject({ gap: true, old: 1, new: 1, text: "line 1" });
    const at31 = rows.find((r) => r.new === 31);
    expect(at31).toMatchObject({ kind: "+", hunk: 1 });
    expect(rows.at(-1)).toMatchObject({ gap: true, new: 40 });
  });

  it("keeps only the hunks when the file at head is unknown", () => {
    const rows = fileRows(parseDiff(DIFF), null);
    expect(rows).toHaveLength(7);
    expect(rows.some((r) => r.gap)).toBe(false);
  });
});

describe("windows", () => {
  const { rows, hunks } = parseFile(DIFF, numbered(40));

  it("adds context around the anchor and stops at the file's edges", () => {
    const window = anchorWindow(rows, anchor(3, 3))!;
    expect(rows[window.lo].new).toBe(1);
    expect(rows[window.hi].new).toBe(6);
    expect(anchorWindow(rows, anchor(3, 3, "old"))).not.toBeNull();
    expect(anchorWindow(rows, anchor(99, 99))).toBeNull();
  });

  it("folds a long run of unchanged lines and shows all of it once opened", () => {
    const window = anchorWindow(rows, anchor(3, 3))!;
    window.hi = rows.findIndex((r) => r.new === 32) as RowIndex;
    const folded = windowItems(rows, hunks, window).items;
    const fold = folded.find((i) => i.type === "fold");
    expect(fold).toMatchObject({ count: 25 });

    window.open.add(fold!.type === "fold" ? fold!.start : (0 as RowIndex));
    const opened = windowItems(rows, hunks, window).items;
    expect(opened.some((i) => i.type === "fold")).toBe(false);
    expect(opened.filter((i) => i.type === "row")).toHaveLength(window.hi - window.lo + 1);
  });

  it("never folds a run at the window's edge", () => {
    const window = anchorWindow(rows, anchor(31, 31))!;
    expandUp(window);
    expandUp(window);
    expect(window.lo).toBe(0);
    expect(windowItems(rows, hunks, window).items[0].type).toBe("row");
  });

  it("marks jumps between hunks when the lines in between are unknown", () => {
    const sparse = fileRows(hunks, null);
    const window = { lo: 0 as RowIndex, hi: (sparse.length - 1) as RowIndex, open: new Set<RowIndex>() };
    expect(kinds(windowItems(sparse, hunks, window).items)).toBe(" -+ jump + ");
  });

  it("stops at the row limit", () => {
    const window = anchorWindow(rows, anchor(3, 3))!;
    window.hi = (rows.length - 1) as RowIndex;
    const { items, truncated } = windowItems(rows, hunks, window, 5);
    expect(items.filter((i) => i.type === "row")).toHaveLength(5);
    expect(truncated).toBe(true);
  });
});
