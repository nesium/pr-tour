import { describe, expect, it } from "vitest";
import { entryMatches, searchQuery, type SearchQuery } from "./search";
import { entries } from "./tour";
import type { Anchor, Tour } from "./types";

const tour = {
  version: 1,
  branch: "feat/x",
  base: "main",
  base_sha: "aaaa",
  head_sha: "bbbb",
  intent: "Keeps renders **short**.",
  reading_order: [{ file: "src/viewer.js", why: "Where rendering happens" }],
  steps: [
    { id: "budget", tag: "read_closely", title: "Render budget", why: "Stops long renders", anchors: [{ file: "src/viewer.js", start: 3, end: 4 }] },
    { id: "docs", tag: "skim", title: "Docs", why: "Explains reloading", check: "Is the touch command right?", anchors: [{ file: "README.md", start: 1, end: 1 }] },
  ],
  concerns: [{ text: "Timer may fire after close", anchor: { file: "src/timer.js", start: 9, end: 9 } }],
} as unknown as Tour;

const query = (raw: string) => searchQuery(raw) as SearchQuery;
const noCode = () => null;
const matching = (raw: string, codeOf: (a: Anchor) => string[] | null = noCode) =>
  entries(tour, false).filter((e) => entryMatches(tour, e, query(raw), codeOf)).map((e) => e.id);

describe("search", () => {
  it("ignores case and surrounding space, and never searches for nothing", () => {
    expect(searchQuery("  Render ")).toBe("render");
    expect(searchQuery("   ")).toBeNull();
  });

  it("finds steps by title, explanation, check and file", () => {
    expect(matching("budget")).toEqual(["budget"]);
    expect(matching("touch command")).toEqual(["docs"]);
    expect(matching("readme")).toEqual(["docs"]);
  });

  it("finds the overview by intent and reading order, and concerns by text and file", () => {
    expect(matching("short")).toEqual(["overview"]);
    expect(matching("timer")).toEqual(["concerns"]);
    expect(matching("viewer.js")).toEqual(["overview", "budget"]);
  });

  it("finds code once its diff has loaded", () => {
    const codeOf = (a: Anchor) => (a.file === "src/viewer.js" ? ["const RENDER_BUDGET_MS = 60;"] : null);
    expect(matching("budget_ms")).toEqual([]);
    expect(matching("budget_ms", codeOf)).toEqual(["budget"]);
  });
});
