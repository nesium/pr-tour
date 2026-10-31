import { describe, expect, it } from "vitest";
import { sizeBlocks, uncoveredHunks } from "./coverage";
import { parseDiff } from "./diff";
import type { Anchor, LineNumber, RepoFile } from "./types";

const anchor = (start: number, end: number, side?: "old" | "new"): Anchor => ({ file: "a.ts" as RepoFile, side, start: start as LineNumber, end: end as LineNumber });
const hunks = parseDiff("@@ -2,3 +2,3 @@\n a\n-b\n+B\n c\n@@ -20,2 +20,0 @@\n-x\n-y\n@@ -40,1 +38,2 @@\n z\n+w\n");

describe("uncoveredHunks", () => {
  it("lists every hunk when nothing points into the file", () => {
    expect(uncoveredHunks(hunks, [])).toEqual([0, 1, 2]);
  });

  it("counts a hunk covered when an anchor overlaps it on the anchor's side", () => {
    expect(uncoveredHunks(hunks, [anchor(4, 10)])).toEqual([1, 2]);
    expect(uncoveredHunks(hunks, [anchor(21, 21, "old")])).toEqual([0, 2]);
    expect(uncoveredHunks(hunks, [anchor(39, 39)])).toEqual([0, 1]);
  });

  it("never counts a removal-only hunk covered by a new-side anchor", () => {
    expect(uncoveredHunks(hunks, [anchor(20, 20)])).toEqual([0, 1, 2]);
  });
});

describe("sizeBlocks", () => {
  it("splits five blocks by the share of added lines", () => {
    expect(sizeBlocks(100, 0)).toEqual(["add", "add", "add", "add", "add"]);
    expect(sizeBlocks(60, 40)).toEqual(["add", "add", "add", "del", "del"]);
    expect(sizeBlocks(1, 99)).toEqual(["del", "del", "del", "del", "del"]);
    expect(sizeBlocks(0, 0)).toEqual(["neutral", "neutral", "neutral", "neutral", "neutral"]);
  });
});
