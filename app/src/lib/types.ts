// Branded types: structurally a string or number, but not interchangeable with
// one another. Values get their brand at the boundaries (IPC, tour parsing).
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CommitId = Brand<string, "CommitId">;
export type BranchName = Brand<string, "BranchName">;
/** A file in the repository, relative to its root, as diffs name it. */
export type RepoFile = Brand<string, "RepoFile">;
export type StepId = Brand<string, "StepId">;
export type RepoRoot = Brand<string, "RepoRoot">;
export type ToursFolder = Brand<string, "ToursFolder">;
export type TourPath = Brand<string, "TourPath">;
export type LockPath = Brand<string, "LockPath">;
/** 1-based line number in one side of a diff. */
export type LineNumber = Brand<number, "LineNumber">;
/** Index into a file's row list, not a line number. */
export type RowIndex = Brand<number, "RowIndex">;
export type HunkIndex = Brand<number, "HunkIndex">;
/** Identifies one anchor's diff box on a page, e.g. `parse-diff-0`. */
export type AnchorKey = Brand<string, "AnchorKey">;
/** One side of one file: `<file>#old` or `<file>#new`. Highlighted lines are kept under it. */
export type HighlightKey = Brand<string, "HighlightKey">;
/** One tour of one commit in one repository; review progress is stored under it. */
export type ProgressKey = Brand<string, "ProgressKey">;

/** One question in a tour's answers file. */
export type AnswerId = Brand<string, "AnswerId">;
export type SessionId = Brand<string, "SessionId">;
/** One note in a branch's review file. */
export type NoteId = Brand<string, "NoteId">;

export type Side = "old" | "new";
export type StepTag = "read_closely" | "skim";
/** "uncovered" lists the changes no step or concern points at. */
export type EntryId = StepId | "overview" | "concerns" | "uncovered";

export interface Anchor {
  file: RepoFile;
  side?: Side;
  start: LineNumber;
  end: LineNumber;
}

export interface Step {
  id: StepId;
  tag: StepTag;
  hotspot?: boolean;
  title: string;
  why: string;
  check?: string;
  anchors: Anchor[];
}

export interface Concern {
  text: string;
  anchor?: Anchor;
}

/** Something the tour leaves out on purpose; `file` may be a glob. */
export interface Skipped {
  file: string;
  why: string;
}

export interface Tour {
  version: 1;
  branch: BranchName;
  base: BranchName;
  base_sha: CommitId;
  head_sha: CommitId;
  author?: { agent?: string; session?: string };
  created_at?: string;
  intent: string;
  reading_order: { file: RepoFile; why: string }[];
  steps: Step[];
  concerns: Concern[];
  skipped?: Skipped[];
}

export interface AnswerEntry {
  id: AnswerId;
  step: StepId;
  /** The commit the tour was for when asked; answers about an older tour aren't shown. */
  head_sha: CommitId;
  question: string;
  status: "pending" | "done" | "error";
  asked_at: string;
  answer?: string;
  answered_at?: string;
}

export interface Answers {
  version: number;
  session?: SessionId;
  entries: AnswerEntry[];
}

/** "change": the author should change something. "remark": to know, no action needed. */
export type NoteKind = "change" | "remark";

export interface NoteLines {
  file: RepoFile;
  side: Side;
  start: LineNumber;
  end: LineNumber;
}

export interface Note {
  id: NoteId;
  step: StepId;
  /** The commit reviewed when the note was written; its lines refer to it. */
  head_sha: CommitId;
  kind: NoteKind;
  text: string;
  lines?: NoteLines;
  status: "open" | "resolved";
  created_at: string;
  /** When the note was last copied for the author. */
  sent_at?: string;
  resolved_at?: string;
}

/** The reviewer's notes on a branch, kept across commits and tours. */
export interface Review {
  version: number;
  notes: Note[];
}

export type ReviewChange =
  | { op: "add"; step: StepId; head_sha: CommitId; kind: NoteKind; text: string; lines: NoteLines | null }
  | { op: "edit"; id: NoteId; text: string }
  | { op: "resolve"; id: NoteId; resolved: boolean }
  | { op: "delete"; id: NoteId }
  | { op: "sent"; ids: NoteId[] };

export interface Progress {
  done: Partial<Record<StepId, true>>;
  current: EntryId;
}

export type Entry = { id: "overview" } | { id: "concerns" } | { id: "uncovered" } | { id: StepId; step: Step };

export const anchorKey = (entry: EntryId | `concern-${number}` | `uncovered-${string}`, index: number) => `${entry}-${index}` as AnchorKey;
export const shortCommit = (sha: CommitId | null | undefined) => (sha ?? "").slice(0, 7);
export const highlightKey = (file: RepoFile, side: Side) => `${file}#${side}` as HighlightKey;
