import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeChoice = "system" | "light" | "dark";
type Theme = "light" | "dark";

/** Remembered in this webview too, so the next window starts in the right colours before the store answers. */
const CACHE_KEY = "theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let chosen: ThemeChoice = "system";

const resolve = (choice: ThemeChoice): Theme => (choice === "system" ? (systemDark.matches ? "dark" : "light") : choice);

/** Colours the page and the window's title bar; "system" follows macOS as it changes. */
export function applyTheme(choice: ThemeChoice) {
  chosen = choice;
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  void getCurrentWindow().setTheme(choice === "system" ? null : choice).catch(() => {});
  try {
    localStorage.setItem(CACHE_KEY, choice);
  } catch {
    // Without storage, the first frame may use the system colours; the store corrects it.
  }
}

export function cachedTheme(): ThemeChoice {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached === "light" || cached === "dark" || cached === "system") return cached;
  } catch {
    // Fall through to the system colours.
  }
  return "system";
}

systemDark.addEventListener("change", () => {
  if (chosen === "system") applyTheme("system");
});
