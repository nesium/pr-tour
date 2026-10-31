import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BranchName, CommitId, LockPath, RepoFile, RepoRoot, TourPath, ToursFolder } from "./types";

/** What this window shows: a tour, or the start window with why it opened. */
export type WindowContent = { kind: "tour"; located: Located } | { kind: "start"; message: string | null };

export interface GenerationState {
  running: boolean;
  lines: string[];
  failure: string | null;
}

export interface Located {
  root: RepoRoot;
  branch: BranchName;
  folder: ToursFolder;
  path: TourPath;
  lock: LockPath;
}

export interface TourFile {
  text: string | null;
  writing: boolean;
}

export interface FileDiff {
  diff: { Ok: string } | { Err: string };
  /** The file at head; null when binary or deleted. */
  lines: string | null;
}

export const api = {
  windowContent: () => invoke<WindowContent>("window_content"),
  openRepo: (repo: string) => invoke<void>("open_repo", { repo }),
  generationState: () => invoke<GenerationState>("generation_state"),
  startGeneration: () => invoke<void>("start_generation"),
  cancelGeneration: () => invoke<void>("cancel_generation"),
  readTour: (path: TourPath) => invoke<TourFile>("read_tour", { path }),
  validateTour: (root: RepoRoot, path: TourPath) => invoke<string[]>("validate_tour", { root, path }),
  branchTip: (root: RepoRoot, branch: BranchName) => invoke<CommitId | null>("branch_tip", { root, branch }),
  fileDiff: (root: RepoRoot, base: CommitId, head: CommitId, file: RepoFile) => invoke<FileDiff>("file_diff", { root, base, head, file }),
  // Events are sent to one window; listening on the window keeps other tours' events out.
  onTourChanged: (handler: () => void): Promise<UnlistenFn> => getCurrentWebviewWindow().listen("tour-changed", handler),
  onGeneration: (handler: (state: GenerationState) => void): Promise<UnlistenFn> =>
    getCurrentWebviewWindow().listen<GenerationState>("generation", (e) => handler(e.payload)),
  onStartChanged: (handler: () => void): Promise<UnlistenFn> => getCurrentWebviewWindow().listen("start-changed", handler),
};
