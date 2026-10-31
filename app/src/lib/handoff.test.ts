import { describe, expect, it } from "vitest";
import { handoffPrompt, where } from "./handoff";
import type { CommitId, LineNumber, Note, NoteId, NoteLines, RepoFile, StepId, Tour } from "./types";

const tour = {
  branch: "feat/x",
  base: "main",
  head_sha: "bbbbbbbbbbbb",
  steps: [{ id: "budget", title: "Render budget" }],
} as unknown as Tour;

const lines = (start: number, end: number, side: "old" | "new" = "new"): NoteLines => ({
  file: "src/viewer.js" as RepoFile,
  side,
  start: start as LineNumber,
  end: end as LineNumber,
});

const note = (id: string, kind: Note["kind"], text: string, extra: Partial<Note> = {}): Note => ({
  id: id as NoteId,
  step: "budget" as StepId,
  head_sha: "bbbbbbbbbbbb" as CommitId,
  kind,
  text,
  status: "open",
  created_at: "2026-10-31T18:00:00Z",
  ...extra,
});

describe("handoffPrompt", () => {
  it("numbers change requests with their place and code, and lists remarks after them", () => {
    const prompt = handoffPrompt(
      tour,
      [note("a", "change", "Make this 60 ms a named constant.", { lines: lines(3, 4) }), note("b", "remark", "Nice split."), note("c", "change", "Test the timer.")],
      () => ["3 + const budget = 60;", "4 + run(budget);"],
    );
    expect(prompt).toContain("Review notes on `feat/x` at bbbbbbb (against `main`).");
    expect(prompt).toContain('1. Step "Render budget" — src/viewer.js:L3-4\n   Make this 60 ms a named constant.');
    expect(prompt).toContain("   3 + const budget = 60;");
    expect(prompt).toContain('2. Step "Render budget"\n   Test the timer.');
    expect(prompt).toContain('## Remarks (no change needed)\n\n- Step "Render budget": Nice split.');
  });

  it("says when a note's lines are from an older commit", () => {
    const prompt = handoffPrompt(tour, [note("a", "change", "x", { head_sha: "aaaaaaaaaaaa" as CommitId, lines: lines(9, 9) })], () => ["9 + today"]);
    expect(prompt).toContain("src/viewer.js:L9 (lines as of aaaaaaa)");
    expect(prompt).not.toContain("today");
  });

  it("leaves out the change section when there are only remarks", () => {
    expect(handoffPrompt(tour, [note("b", "remark", "FYI")], () => null)).not.toContain("Change requests");
  });

  it("names removed lines", () => {
    expect(where(lines(5, 5, "old"))).toBe("src/viewer.js:L5 (removed)");
  });
});
