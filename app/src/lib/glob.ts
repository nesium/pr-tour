import type { RepoFile } from "./types";

/**
 * Matches a tour's `skipped` file globs the way the validator does
 * (src-tauri/src/glob.rs): `*` within one folder, `**` across folders (`**\/`
 * also matching no folder), `?` one character other than `/`.
 */
export function globMatches(glob: string, file: RepoFile): boolean {
  return matches([...glob], [...file]);
}

function matches(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [first, second, third] = pattern;
  if (first === "*" && second === "*" && third === "/") {
    const rest = pattern.slice(3);
    return matches(rest, path) || path.some((c, i) => c === "/" && matches(rest, path.slice(i + 1)));
  }
  if (first === "*" && second === "*") {
    const rest = pattern.slice(2);
    return path.some((_, i) => matches(rest, path.slice(i))) || matches(rest, []);
  }
  if (first === "*") {
    const rest = pattern.slice(1);
    const folderEnd = path.includes("/") ? path.indexOf("/") : path.length;
    for (let i = 0; i <= folderEnd; i++) if (matches(rest, path.slice(i))) return true;
    return false;
  }
  if (first === "?") return path.length > 0 && path[0] !== "/" && matches(pattern.slice(1), path.slice(1));
  return path[0] === first && matches(pattern.slice(1), path.slice(1));
}
