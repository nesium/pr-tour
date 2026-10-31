import { computed, shallowReactive, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { api, type Located, type Since } from "./api";
import { parseFile, type ParsedDiff } from "./diff";
import { coverLines, hunksChanging, moveLines } from "./lineMap";
import { rangeKey, type Anchor, type CommitId, type Entry, type HunkIndex, type LineNumber, type Note, type Progress, type RangeKey, type RepoFile, type StepId, type Tour } from "./types";

type RangeState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; diff: ParsedDiff };

/** One anchor's lines changed after the step was last reviewed: these hunks of from..to changed them. */
export interface AnchorChange {
  file: RepoFile;
  from: CommitId;
  to: CommitId;
  hunks: HunkIndex[];
}

/**
 * How a step stands against the branch tip. "changed": a commit after the one
 * it was last reviewed at (or the tour's) changed its anchored lines.
 */
export type StepDelta = { status: "same" } | { status: "loading" } | { status: "changed"; since: CommitId; changes: AnchorChange[] };

/** Where an open note's lines are at the tip. */
export type NoteDrift =
  | { status: "current" }
  | { status: "loading" }
  | { status: "moved"; start: LineNumber; end: LineNumber }
  | { status: "changed" };

interface Context {
  tour: ShallowRef<Tour | null>;
  tip: Ref<CommitId | null>;
  located: ShallowRef<Located | null>;
  progress: Ref<Progress>;
  openNotes: ComputedRef<Note[]>;
  current: ComputedRef<Entry | undefined>;
  /** Colours a file at a commit, as the tour state does for its own diffs. */
  highlight: (file: RepoFile, commit: CommitId, code: string | null) => void;
}

/**
 * The review across new commits: the tour keeps describing the commit it was
 * written for, and this follows the branch past it, step by step. Diffs
 * between any two commits are read on demand and kept by range.
 */
export function createDelta({ tour, tip, located, progress, openNotes, current, highlight }: Context) {
  const since = shallowRef<Since | null>(null);
  const ranges = shallowReactive(new Map<RangeKey, RangeState>());

  /** The branch moved on from the tour's commit without rewriting history. */
  const active = computed(() => Boolean(tour.value && tip.value && tip.value !== tour.value.head_sha && since.value?.linear));
  /** The branch moved on, but its history no longer contains the tour's commit. */
  const rewritten = computed(() => Boolean(tour.value && tip.value && tip.value !== tour.value.head_sha && since.value && !since.value.linear));

  async function loadSince() {
    const [reviewed, at, head] = [tour.value, located.value, tip.value];
    since.value = null;
    if (!reviewed || !at || !head || head === reviewed.head_sha) return;
    try {
      const found = await api.branchSince(at.root, reviewed.head_sha, head);
      if (tip.value === head && tour.value === reviewed) since.value = found;
    } catch {
      // Without it there's no delta, only the tour.
    }
  }

  function range(from: CommitId, to: CommitId, file: RepoFile): ParsedDiff | null {
    const state = ranges.get(rangeKey(from, to, file));
    return state?.status === "ready" ? state.diff : null;
  }

  function requestRange(from: CommitId, to: CommitId, file: RepoFile) {
    const key = rangeKey(from, to, file);
    const at = located.value;
    if (ranges.has(key) || !at) return;
    ranges.set(key, { status: "loading" });
    api.fileDiff(at.root, from, to, file).then(
      (read) => {
        if ("Err" in read.diff) return ranges.set(key, { status: "error", message: read.diff.Err });
        ranges.set(key, { status: "ready", diff: parseFile(read.diff.Ok, read.lines) });
        highlight(file, to, read.lines);
        highlight(file, from, read.base_lines);
      },
      (e) => ranges.set(key, { status: "error", message: String(e) }),
    );
  }

  /** The commit a step was last reviewed at; the tour's when never or before any new commit. */
  const reviewedAt = (step: StepId): CommitId => progress.value.seen?.[step] ?? tour.value!.head_sha;
  /** Anchors on the head side; removed lines live at the base, which new commits don't change. */
  const headAnchors = (anchors: Anchor[]) => anchors.filter((a) => a.side !== "old");

  /** The ranges the deltas need, so they can be read before they're asked for. */
  const needed = computed(() => {
    const reviewed = tour.value;
    const head = tip.value;
    if (!active.value || !reviewed || !head) return [];
    const wanted: [CommitId, CommitId, RepoFile][] = [];
    for (const step of reviewed.steps) {
      const at = reviewedAt(step.id);
      if (at === head) continue;
      for (const anchor of headAnchors(step.anchors)) {
        if (at !== reviewed.head_sha) wanted.push([reviewed.head_sha, at, anchor.file]);
        wanted.push([at, head, anchor.file]);
      }
    }
    for (const note of openNotes.value) {
      if (note.lines && note.lines.side === "new" && note.head_sha !== head) wanted.push([note.head_sha, head, note.lines.file]);
    }
    if (current.value?.id === "since") for (const file of since.value?.files ?? []) wanted.push([reviewed.head_sha, head, file.file]);
    return wanted;
  });
  watch(needed, (all) => all.forEach(([from, to, file]) => requestRange(from, to, file)), { immediate: true });

  function anchorChange(anchor: Anchor, at: CommitId, head: CommitId): AnchorChange | null | "loading" {
    const reviewed = tour.value!;
    let region = { start: anchor.start, end: anchor.end };
    if (at !== reviewed.head_sha) {
      const before = range(reviewed.head_sha, at, anchor.file);
      if (!before) return "loading";
      region = coverLines(before.hunks, anchor.start, anchor.end);
    }
    const after = range(at, head, anchor.file);
    if (!after) return "loading";
    const hunks = hunksChanging(after.hunks, region.start, region.end);
    return hunks.length ? { file: anchor.file, from: at, to: head, hunks } : null;
  }

  const steps = computed(() => {
    const deltas = new Map<StepId, StepDelta>();
    const reviewed = tour.value;
    const head = tip.value;
    if (!reviewed) return deltas;
    for (const step of reviewed.steps) {
      const at = active.value && head ? reviewedAt(step.id) : head;
      if (!active.value || !head || at === head) {
        deltas.set(step.id, { status: "same" });
        continue;
      }
      const found = headAnchors(step.anchors).map((anchor) => anchorChange(anchor, at!, head));
      const changes = found.filter((c): c is AnchorChange => c !== null && c !== "loading");
      // Two anchors in one file can point at the same changed hunk; show it once.
      const unique = changes.filter((c, i) => changes.findIndex((d) => d.file === c.file && d.from === c.from && String(d.hunks) === String(c.hunks)) === i);
      deltas.set(
        step.id,
        found.includes("loading") ? { status: "loading" } : unique.length ? { status: "changed", since: at!, changes: unique } : { status: "same" },
      );
    }
    return deltas;
  });

  const changedSteps = computed(() => [...steps.value].filter(([, d]) => d.status === "changed").map(([id]) => id));

  function noteDrift(note: Note): NoteDrift {
    const head = tip.value;
    if (!active.value || !head || !note.lines || note.lines.side === "old" || note.head_sha === head) return { status: "current" };
    const diff = range(note.head_sha, head, note.lines.file);
    if (!diff) return { status: "loading" };
    const moved = moveLines(diff.hunks, note.lines.start, note.lines.end);
    return moved === "changed" ? { status: "changed" } : { status: "moved", ...moved };
  }

  return { since, active, rewritten, loadSince, range, steps, changedSteps, noteDrift };
}

export type Delta = ReturnType<typeof createDelta>;
