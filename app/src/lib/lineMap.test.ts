import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff";
import { coverLines, hunksChanging, moveLine, moveLines } from "./lineMap";
import type { LineNumber } from "./types";

// Old file lines 1..40. Hunk 0 replaces line 5 by two lines. Hunk 1 removes
// lines 20-21. Hunk 2 inserts a line after 30.
const hunks = parseDiff(`@@ -4,3 +4,4 @@
 four
-five
+five a
+five b
 six
@@ -19,4 +20,2 @@
 nineteen
-twenty
-twenty-one
 twenty-two
@@ -30,0 +30,1 @@
+thirty and a half
`);
const lines = (a: number, b: number) => moveLines(hunks, a as LineNumber, b as LineNumber);

describe("moveLine", () => {
  it("keeps lines before the first change", () => {
    expect(moveLine(hunks, 2)).toBe(2);
  });

  it("follows context lines inside a hunk and shifts lines after it", () => {
    expect(moveLine(hunks, 6)).toBe(7);
    expect(moveLine(hunks, 10)).toBe(11);
    expect(moveLine(hunks, 22)).toBe(21);
  });

  it("knows removed lines are gone", () => {
    expect(moveLine(hunks, 5)).toBeNull();
    expect(moveLine(hunks, 20)).toBeNull();
  });

  it("shifts lines after an insertion, not the line it follows", () => {
    expect(moveLine(hunks, 30)).toBe(29);
    expect(moveLine(hunks, 31)).toBe(31);
  });
});

describe("moveLines", () => {
  it("moves an untouched range", () => {
    expect(lines(10, 12)).toEqual({ start: 11, end: 13 });
    expect(lines(23, 25)).toEqual({ start: 22, end: 24 });
  });

  it("reports a range whose lines were replaced or removed", () => {
    expect(lines(4, 6)).toBe("changed");
    expect(lines(18, 20)).toBe("changed");
  });

  it("reports an insertion inside the range, not next to it", () => {
    expect(lines(29, 31)).toBe("changed");
    expect(lines(31, 33)).toEqual({ start: 31, end: 33 });
    expect(lines(28, 30)).toEqual({ start: 27, end: 29 });
  });

  it("names the hunks that changed a range", () => {
    expect(hunksChanging(hunks, 1, 40)).toEqual([0, 1, 2]);
    expect(hunksChanging(hunks, 22, 29)).toEqual([]);
  });
});

describe("coverLines", () => {
  const cover = (a: number, b: number) => coverLines(hunks, a as LineNumber, b as LineNumber);

  it("moves untouched ranges like moveLines", () => {
    expect(cover(10, 12)).toEqual({ start: 11, end: 13 });
  });

  it("stretches over what replaced a changed edge", () => {
    expect(cover(5, 8)).toEqual({ start: 4, end: 9 });
    expect(cover(15, 20)).toEqual({ start: 16, end: 21 });
  });
});
