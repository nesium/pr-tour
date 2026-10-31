import { load, type Store } from "@tauri-apps/plugin-store";
import type { BranchName, CommitId, Progress, ProgressKey, RepoRoot } from "./types";

const FRESH: Progress = { done: {}, current: "overview" };

let store: Promise<Store> | null = null;
const opened = () => (store ??= load("progress.json", { autoSave: 200, defaults: {} }));

/** Progress belongs to one commit: a new head is a new review. */
export const progressKey = (root: RepoRoot, branch: BranchName, head: CommitId) => `${root}#${branch}#${head}` as ProgressKey;

export async function readProgress(key: ProgressKey): Promise<Progress> {
  return { ...FRESH, ...((await (await opened()).get<Progress>(key)) ?? {}) };
}

export async function writeProgress(key: ProgressKey, progress: Progress) {
  await (await opened()).set(key, progress);
}
