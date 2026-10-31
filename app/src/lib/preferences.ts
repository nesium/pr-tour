import { load, type Store } from "@tauri-apps/plugin-store";

export type DiffView = "unified" | "split";

/** How diffs look, the same for every tour. */
export interface Preferences {
  diffView: DiffView;
  /** Wrap long lines in the unified view; the split view always wraps. */
  wrap: boolean;
}

const KEY = "preferences";
const DEFAULTS: Preferences = { diffView: "unified", wrap: false };

let store: Promise<Store> | null = null;
const opened = () => (store ??= load("settings.json", { autoSave: 200, defaults: {} }));

export async function readPreferences(): Promise<Preferences> {
  return { ...DEFAULTS, ...((await (await opened()).get<Partial<Preferences>>(KEY)) ?? {}) };
}

export async function writePreferences(preferences: Preferences) {
  await (await opened()).set(KEY, preferences);
}
