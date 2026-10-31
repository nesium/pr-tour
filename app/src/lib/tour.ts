import type { Entry, RepoFile, Step, Tour } from "./types";

export type ParsedTour = { tour: Tour } | { problem: string };

/**
 * Accepts what the viewer needs to draw. The full check is the validator's,
 * whose problems the viewer shows alongside.
 */
export function parseTour(text: string): ParsedTour {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { problem: `Tour is not valid JSON: ${(e as Error).message}` };
  }
  const tour = value as Partial<Tour> | null;
  if (tour?.version !== 1 || !Array.isArray(tour.steps) || !Array.isArray(tour.concerns) || !Array.isArray(tour.reading_order)) {
    return { problem: "Tour has an unknown format (expected version 1)" };
  }
  if (!tour.steps.every((s) => Array.isArray(s?.anchors) && s.anchors.length > 0)) {
    return { problem: "Every step needs at least one anchor" };
  }
  return { tour: tour as Tour };
}

/** `withSince`: the branch moved past the tour, so "Since the tour" follows the overview. */
export function entries(tour: Tour, closelyOnly: boolean, withSince = false): Entry[] {
  const steps = tour.steps.filter((s) => !closelyOnly || s.tag === "read_closely");
  const since: Entry[] = withSince ? [{ id: "since" }] : [];
  return [{ id: "overview" }, ...since, ...steps.map((step) => ({ id: step.id, step })), { id: "concerns" }, { id: "uncovered" }];
}

export function anchoredFiles(tour: Tour): RepoFile[] {
  const files = [...tour.steps.flatMap((s) => s.anchors.map((a) => a.file)), ...tour.concerns.flatMap((c) => (c.anchor ? [c.anchor.file] : []))];
  return [...new Set(files)];
}

export function filesOf(tour: Tour, entry: Entry): RepoFile[] {
  if ("step" in entry) return entry.step.anchors.map((a) => a.file);
  if (entry.id === "concerns") return tour.concerns.flatMap((c) => (c.anchor ? [c.anchor.file] : []));
  // The uncovered page's files come from the diff's stat, which the tour state holds.
  return [];
}

export const isStep = (entry: Entry): entry is { id: Step["id"]; step: Step } => "step" in entry;
