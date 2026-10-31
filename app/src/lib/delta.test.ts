import { describe, expect, it, vi } from "vitest";
import { computed, nextTick, ref, shallowRef } from "vue";
import type { Located } from "./api";
import { createDelta } from "./delta";
import type { CommitId, Entry, LineNumber, Note, NoteId, Progress, RepoFile, StepId, Tour } from "./types";

const H0 = "aaaaaaa" as CommitId;
const H1 = "bbbbbbb" as CommitId;

// The fixup between H0 and H1 replaces line 11 of a.ts.
const fixup = "@@ -10,3 +10,3 @@\n ten\n-eleven\n+eleven, fixed\n twelve\n";

vi.mock("./api", () => ({
  api: {
    branchSince: vi.fn(async () => ({ linear: true, commits: [{ sha: "bbbbbbb", subject: "fix: eleven" }], files: [] })),
    fileDiff: vi.fn(async () => ({ diff: { Ok: fixup }, lines: null, base_lines: null })),
  },
}));

const anchor = (start: number, end: number) => ({ file: "a.ts" as RepoFile, start: start as LineNumber, end: end as LineNumber });
const tour = {
  head_sha: H0,
  steps: [
    { id: "touched", title: "Touched", anchors: [anchor(10, 12)] },
    { id: "untouched", title: "Untouched", anchors: [anchor(30, 31)] },
  ],
} as unknown as Tour;
const note = (id: string, start: number): Note => ({
  id: id as NoteId,
  step: "touched" as StepId,
  head_sha: H0,
  kind: "change",
  text: "x",
  lines: { file: "a.ts" as RepoFile, side: "new", ...{ start: start as LineNumber, end: start as LineNumber } },
  status: "open",
  created_at: "",
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

function setup(progress: Progress) {
  const delta = createDelta({
    tour: shallowRef(tour),
    tip: ref(H1),
    located: shallowRef({ root: "/r" } as unknown as Located),
    progress: ref(progress),
    openNotes: computed(() => [note("on-fix", 11), note("elsewhere", 30)]),
    current: computed(() => ({ id: "overview" }) as Entry),
    highlight: () => {},
  });
  return delta;
}

describe("delta", () => {
  it("brings back only the steps a new commit changed", async () => {
    const delta = setup({ done: { touched: true, untouched: true } as Progress["done"], current: "overview" });
    await delta.loadSince();
    await settle();
    expect(delta.active.value).toBe(true);
    expect(delta.changedSteps.value).toEqual(["touched"]);
    const touched = delta.steps.value.get("touched" as StepId);
    expect(touched).toMatchObject({ status: "changed", since: H0, changes: [{ file: "a.ts", from: H0, to: H1, hunks: [0] }] });
  });

  it("leaves a step reviewed at the tip alone", async () => {
    const delta = setup({ done: { touched: true }, seen: { touched: H1 }, current: "overview" } as Progress);
    await delta.loadSince();
    await settle();
    expect(delta.changedSteps.value).toEqual([]);
  });

  it("follows notes: changed lines suggest resolving, others move with the file", async () => {
    const delta = setup({ done: {}, current: "overview" });
    await delta.loadSince();
    await settle();
    expect(delta.noteDrift(note("on-fix", 11))).toEqual({ status: "changed" });
    expect(delta.noteDrift(note("elsewhere", 30))).toEqual({ status: "moved", start: 30, end: 30 });
  });
});
