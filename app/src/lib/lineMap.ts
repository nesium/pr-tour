import type { Hunk } from "./diff";
import type { HunkIndex, LineNumber } from "./types";

/** Where a range of lines went: its new place, or "changed" when its content did. */
export type Moved = { start: LineNumber; end: LineNumber } | "changed";

/** The first line of the old file a hunk touches; a pure insertion goes after its oldStart. */
const firstOld = (h: Hunk) => (h.oldLen === 0 ? h.oldStart + 1 : h.oldStart);

/** Where line `n` of the old file is in the new one, or null when it was removed or replaced. */
export function moveLine(hunks: Hunk[], n: number): number | null {
  let offset = 0;
  for (const h of hunks) {
    if (n < firstOld(h)) break;
    if (h.oldLen > 0 && n < h.oldStart + h.oldLen) {
      const row = h.rows.find((r) => r.old === n);
      return row?.kind === " " ? row.new! : null;
    }
    offset += h.newLen - h.oldLen;
  }
  return n + offset;
}

/**
 * The hunks that change lines start..end of the old file: they remove or
 * replace one of them, or insert lines between two of them. Lines added just
 * before or after the range leave it as it was.
 */
export function hunksChanging(hunks: Hunk[], start: number, end: number): HunkIndex[] {
  return hunks.flatMap((h, i) => {
    let before = h.oldLen === 0 ? h.oldStart : h.oldStart - 1;
    for (const row of h.rows) {
      if (row.kind === "-" && row.old! >= start && row.old! <= end) return [i as HunkIndex];
      if (row.kind === "+" && before >= start && before < end) return [i as HunkIndex];
      if (row.old !== undefined) before = row.old;
    }
    return [];
  });
}

/** Lines start..end of the old file in the new one. */
export function moveLines(hunks: Hunk[], start: LineNumber, end: LineNumber): Moved {
  if (hunksChanging(hunks, start, end).length) return "changed";
  const [movedStart, movedEnd] = [moveLine(hunks, start), moveLine(hunks, end)];
  if (movedStart === null || movedEnd === null) return "changed";
  return { start: movedStart as LineNumber, end: movedEnd as LineNumber };
}

/**
 * Lines start..end of the old file as a region of the new one, also when some
 * of them changed: an end that was removed or replaced takes the edge of its
 * hunk's new lines, so the region still covers what replaced it.
 */
export function coverLines(hunks: Hunk[], start: LineNumber, end: LineNumber): { start: LineNumber; end: LineNumber } {
  const edge = (n: number, which: "start" | "end") => {
    const moved = moveLine(hunks, n);
    if (moved !== null) return moved;
    const h = hunks.find((h) => h.oldLen > 0 && n >= h.oldStart && n < h.oldStart + h.oldLen)!;
    return which === "start" ? h.newStart : Math.max(h.newStart, h.newStart + h.newLen - 1);
  };
  const [a, b] = [edge(start, "start"), edge(end, "end")];
  return { start: Math.min(a, b) as LineNumber, end: Math.max(a, b) as LineNumber };
}
