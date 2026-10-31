import type { RepoFile } from "./types";

/** One coloured piece of a line: its text and its colour in each theme. */
export interface Token {
  text: string;
  light?: string;
  dark?: string;
}

export type HighlightedLines = Token[][];

export interface HighlightRequest {
  id: number;
  file: RepoFile;
  code: string;
}

/** `lines` is null when the file has no known language. */
export type HighlightResponse = { id: number; lines: HighlightedLines | null } | { id: number; error: string };

/** Beyond this, a file is shown plain: highlighting it would take longer than reading it. */
export const MAX_HIGHLIGHT_CHARS = 400_000;
