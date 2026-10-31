import type { Hunk } from "./diff";
import { globMatches } from "./glob";
import type { Anchor, HunkIndex, RepoFile, Skipped, Tour } from "./types";

/** The `skipped` entry that leaves `file` out of the tour, if any. */
export function skippedBy(tour: Tour, file: RepoFile): Skipped | undefined {
  return tour.skipped?.find((s) => globMatches(s.file, file));
}

/** Every anchor in the tour that points into `file`, steps and concerns alike. */
export function anchorsIn(tour: Tour, file: RepoFile): Anchor[] {
  const anchors = [...tour.steps.flatMap((s) => s.anchors), ...tour.concerns.flatMap((c) => (c.anchor ? [c.anchor] : []))];
  return anchors.filter((a) => a.file === file);
}

const overlaps = (start: number, length: number, anchor: Anchor) => length > 0 && anchor.start <= start + length - 1 && anchor.end >= start;

/** The hunks no anchor overlaps, on the side each anchor refers to. */
export function uncoveredHunks(hunks: Hunk[], anchors: Anchor[]): HunkIndex[] {
  const covered = (h: Hunk) =>
    anchors.some((a) => (a.side === "old" ? overlaps(h.oldStart, h.oldLen, a) : overlaps(h.newStart, h.newLen, a)));
  return hunks.flatMap((h, i) => (covered(h) ? [] : [i as HunkIndex]));
}

export type Block = "add" | "del" | "neutral";

/** GitHub's size bar: five blocks split between added and removed lines. */
export function sizeBlocks(added: number, removed: number, blocks = 5): Block[] {
  const total = added + removed;
  if (total === 0) return Array(blocks).fill("neutral");
  const green = Math.round((added / total) * blocks);
  return Array.from({ length: blocks }, (_, i) => (i < green ? "add" : "del"));
}
