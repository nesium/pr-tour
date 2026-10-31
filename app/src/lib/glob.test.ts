import { describe, expect, it } from "vitest";
import { globMatches } from "./glob";
import type { RepoFile } from "./types";

const hit = (glob: string, file: string) => globMatches(glob, file as RepoFile);

// The same cases as src-tauri/src/glob.rs: the viewer and the validator must agree.
describe("globMatches", () => {
  it("matches plain paths only themselves", () => {
    expect(hit("app/Cargo.lock", "app/Cargo.lock")).toBe(true);
    expect(hit("app/Cargo.lock", "app/src/Cargo.lock")).toBe(false);
  });

  it("keeps a star in its folder", () => {
    expect(hit("icons/*.png", "icons/32x32.png")).toBe(true);
    expect(hit("icons/*.png", "icons/ios/32x32.png")).toBe(false);
    expect(hit("*.md", "README.md")).toBe(true);
    expect(hit("*.md", "docs/README.md")).toBe(false);
  });

  it("lets a double star cross folders, or match none", () => {
    expect(hit("**/*.lock", "Cargo.lock")).toBe(true);
    expect(hit("**/*.lock", "app/src-tauri/Cargo.lock")).toBe(true);
    expect(hit("app/src-tauri/icons/**", "app/src-tauri/icons/ios/AppIcon.png")).toBe(true);
    expect(hit("app/src-tauri/icons/**", "app/src-tauri/src/main.rs")).toBe(false);
  });

  it("makes a question mark one character but no slash", () => {
    expect(hit("v?.json", "v1.json")).toBe(true);
    expect(hit("a?b", "a/b")).toBe(false);
  });
});
