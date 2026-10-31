import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BranchName, CommitId, LockPath, RepoFile, RepoRoot, TourPath, ToursFolder } from "./types";

export interface Launch {
  repo: string | null;
  branch: BranchName | null;
  tour: TourPath | null;
  problem: string | null;
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
  launch: () => invoke<Launch>("launch"),
  locate: (repo: string, branch: BranchName | null, tour: TourPath | null) => invoke<Located>("locate", { repo, branch, tour }),
  readTour: (path: TourPath) => invoke<TourFile>("read_tour", { path }),
  validateTour: (root: RepoRoot, path: TourPath) => invoke<string[]>("validate_tour", { root, path }),
  branchTip: (root: RepoRoot, branch: BranchName) => invoke<CommitId | null>("branch_tip", { root, branch }),
  fileDiff: (root: RepoRoot, base: CommitId, head: CommitId, file: RepoFile) => invoke<FileDiff>("file_diff", { root, base, head, file }),
  watchTour: (path: TourPath) => invoke<void>("watch_tour", { path }),
  onTourChanged: (handler: () => void): Promise<UnlistenFn> => listen("tour-changed", handler),
};
