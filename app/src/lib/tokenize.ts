import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, type BundledLanguage } from "shiki/langs";
import { bundledThemes } from "shiki/themes";
import type { HighlightedLines } from "./highlight";

const THEMES = { light: "github-light", dark: "github-dark" } as const;

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<BundledLanguage>();

function ready(): Promise<HighlighterCore> {
  // The JavaScript engine needs no WebAssembly, so the page's CSP stays strict.
  highlighter ??= createHighlighterCore({
    themes: [bundledThemes[THEMES.light](), bundledThemes[THEMES.dark]()],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

/** A whole file's lines as tokens coloured for both themes. */
export async function tokenize(language: BundledLanguage, code: string): Promise<HighlightedLines> {
  const core = await ready();
  if (!loaded.has(language)) {
    await core.loadLanguage(bundledLanguages[language]());
    loaded.add(language);
  }
  const { tokens } = core.codeToTokens(code, { lang: language, themes: THEMES, defaultColor: "light" });
  return tokens.map((line) =>
    line.map((token) => ({
      text: token.content,
      light: token.htmlStyle?.color ?? token.color,
      dark: token.htmlStyle?.["--shiki-dark"],
    })),
  );
}
