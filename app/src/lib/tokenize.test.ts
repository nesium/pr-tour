import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";

describe("tokenize", () => {
  it("keeps every line's text and colours tokens for both themes", async () => {
    const code = "const a = 1;\n/* starts\n   ends */ let b = `x`;";
    const lines = await tokenize("typescript", code);
    expect(lines.map((l) => l.map((t) => t.text).join(""))).toEqual(code.split("\n"));
    const keyword = lines[0].find((t) => t.text === "const")!;
    expect(keyword.light).toMatch(/^#/);
    expect(keyword.dark).toMatch(/^#/);
    expect(keyword.light).not.toBe(keyword.dark);
  });

  it("carries state across lines, so a comment's second line is a comment", async () => {
    const lines = await tokenize("typescript", "/* one\ntwo */ x");
    const two = lines[1].find((t) => t.text.includes("two"))!;
    const one = lines[0].find((t) => t.text.includes("one"))!;
    expect(two.light).toBe(one.light);
  });

  it("loads further languages on demand", async () => {
    const lines = await tokenize("rust", "fn main() {}");
    expect(lines[0].length).toBeGreaterThan(1);
  });
});
