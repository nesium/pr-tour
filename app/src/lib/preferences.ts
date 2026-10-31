import type { UnlistenFn } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { ThemeChoice } from "./theme";

export type DiffView = "unified" | "split";

/** How the app looks, the same in every window and for every tour. */
export interface Preferences {
  diffView: DiffView;
  /** Wrap long lines in the unified view; the split view always wraps. */
  wrap: boolean;
  theme: ThemeChoice;
  /** In CSS pixels, within SIDEBAR_WIDTH. */
  sidebarWidth: number;
}

export const SIDEBAR_WIDTH = { min: 180, max: 520 };
export const DEFAULT_PREFERENCES: Preferences = { diffView: "unified", wrap: false, theme: "system", sidebarWidth: 250 };

const KEY = "preferences";

let store: Promise<Store> | null = null;
const opened = () => (store ??= load("settings.json", { autoSave: 200, defaults: {} }));
const complete = (saved: Partial<Preferences> | undefined): Preferences => ({ ...DEFAULT_PREFERENCES, ...(saved ?? {}) });

export async function readPreferences(): Promise<Preferences> {
  return complete(await (await opened()).get<Partial<Preferences>>(KEY));
}

export async function writePreferences(preferences: Preferences) {
  await (await opened()).set(KEY, preferences);
}

/** Calls back when any window changes the preferences, this one included. */
export async function onPreferencesChanged(callback: (preferences: Preferences) => void): Promise<UnlistenFn> {
  return (await opened()).onKeyChange<Partial<Preferences>>(KEY, (saved) => callback(complete(saved)));
}
