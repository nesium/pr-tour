import { bundledLanguagesInfo, type BundledLanguage } from "shiki/langs";
import type { RepoFile } from "./types";

const BY_NAME: Record<string, BundledLanguage> = {
  dockerfile: "docker",
  makefile: "make",
  "cmakelists.txt": "cmake",
  podfile: "ruby",
  gemfile: "ruby",
  rakefile: "ruby",
  fastfile: "ruby",
  brewfile: "ruby",
  justfile: "just",
};

// Extensions that aren't a language id or alias in Shiki.
const BY_EXTENSION: Record<string, BundledLanguage> = {
  h: "c",
  m: "objective-c",
  mm: "objective-cpp",
  hpp: "cpp",
  hh: "cpp",
  cc: "cpp",
  cxx: "cpp",
  mjs: "javascript",
  cjs: "javascript",
  zsh: "shellscript",
  bash: "shellscript",
  plist: "xml",
  storyboard: "xml",
  xib: "xml",
  entitlements: "xml",
  gradle: "groovy",
  kts: "kotlin",
  yml: "yaml",
};

// Look like a language to Shiki, but highlighting them only adds noise.
const PLAIN = new Set(["pbxproj", "lock"]);

const known = new Map<string, BundledLanguage>();
for (const info of bundledLanguagesInfo) {
  for (const name of [info.id, ...(info.aliases ?? [])]) {
    if (!known.has(name)) known.set(name, info.id as BundledLanguage);
  }
}

/** The grammar for a file, or null to show it plain. */
export function languageFor(file: RepoFile): BundledLanguage | null {
  const name = file.split("/").pop()!.toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1);
  if (PLAIN.has(extension)) return null;
  return BY_EXTENSION[extension] ?? known.get(extension) ?? null;
}
