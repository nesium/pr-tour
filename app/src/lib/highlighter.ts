import { MAX_HIGHLIGHT_CHARS, type HighlightedLines, type HighlightRequest, type HighlightResponse } from "./highlight";
import type { RepoFile } from "./types";

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (response: HighlightResponse) => void>();

function started(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);
  };
  return worker;
}

/** The file's lines with colours, or null when it has no known language or is too long. */
export async function highlightFile(file: RepoFile, code: string): Promise<HighlightedLines | null> {
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  const id = nextId++;
  const request: HighlightRequest = { id, file, code: code.replace(/\n$/, "") };
  const response = await new Promise<HighlightResponse>((resolve) => {
    waiting.set(id, resolve);
    started().postMessage(request);
  });
  return "lines" in response ? response.lines : null;
}
