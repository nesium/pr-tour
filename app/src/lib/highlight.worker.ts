/// <reference lib="webworker" />
// Tokenizes whole files off the main thread, so long files never stall scrolling.
// Whole files, not diff lines: a line's colours depend on what came before it.
import type { HighlightRequest, HighlightResponse } from "./highlight";
import { languageFor } from "./languages";
import { tokenize } from "./tokenize";

self.onmessage = async (event: MessageEvent<HighlightRequest>) => {
  const { id, file, code } = event.data;
  let response: HighlightResponse;
  try {
    const language = languageFor(file);
    response = { id, lines: language ? await tokenize(language, code) : null };
  } catch (e) {
    response = { id, error: String(e) };
  }
  self.postMessage(response);
};
