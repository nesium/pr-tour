import { describe, expect, it } from "vitest";
import { languageFor } from "./languages";
import type { RepoFile } from "./types";

const of = (path: string) => languageFor(path as RepoFile);

describe("languageFor", () => {
  it("knows extensions that are Shiki ids or aliases", () => {
    expect(of("src/lib/diff.ts")).toBe("typescript");
    expect(of("src-tauri/src/main.rs")).toBe("rust");
    expect(of("Sources/App.swift")).toBe("swift");
    expect(of("scripts/release.py")).toBe("python");
    expect(of("README.md")).toBe("markdown");
    expect(of("src/App.vue")).toBe("vue");
  });

  it("knows files by name and extensions Shiki doesn't alias", () => {
    expect(of("Dockerfile")).toBe("docker");
    expect(of("ios/Podfile")).toBe("ruby");
    expect(of("Sources/Crisp/Crisp.h")).toBe("c");
    expect(of("Sources/Crisp/Bridge.m")).toBe("objective-c");
    expect(of("ci/build.yml")).toBe("yaml");
  });

  it("shows unknown and opaque files plain", () => {
    expect(of("LICENSE")).toBeNull();
    expect(of(".gitignore")).toBeNull();
    expect(of("App.xcodeproj/project.pbxproj")).toBeNull();
    expect(of("package-lock.lock")).toBeNull();
    expect(of("data.unknownext")).toBeNull();
  });
});
