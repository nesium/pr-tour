import type { Anchor, Brand, Entry, Tour } from "./types";

/** What the reviewer searches for, trimmed and lower-cased; never empty. */
export type SearchQuery = Brand<string, "SearchQuery">;

export function searchQuery(raw: string): SearchQuery | null {
  const query = raw.trim().toLowerCase();
  return query ? (query as SearchQuery) : null;
}

/** The code an anchor shows, or null while its diff is loading. */
export type CodeOf = (anchor: Anchor) => string[] | null;

/** Whether the entry's text, file names or shown code contain the query. */
export function entryMatches(tour: Tour, entry: Entry, query: SearchQuery, codeOf: CodeOf): boolean {
  return textsOf(tour, entry, codeOf).some((text) => text.toLowerCase().includes(query));
}

function textsOf(tour: Tour, entry: Entry, codeOf: CodeOf): string[] {
  const anchored = (anchor: Anchor) => [anchor.file, ...(codeOf(anchor) ?? [])];
  if ("step" in entry) {
    const { title, why, check, anchors } = entry.step;
    return [title, why, check ?? "", ...anchors.flatMap(anchored)];
  }
  if (entry.id === "overview") {
    return [tour.intent, ...tour.reading_order.flatMap((r) => [r.file, r.why])];
  }
  if (entry.id === "uncovered") return [];
  return tour.concerns.flatMap((c) => [c.text, ...(c.anchor ? anchored(c.anchor) : [])]);
}
