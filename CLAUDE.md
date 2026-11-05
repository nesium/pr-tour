# pr-tour

An agent writes a reviewer's tour of a branch as JSON (`skill/tour.schema.json`);
the PR Tour app (Tauri 2: Rust + Vue 3/TypeScript) shows it beside the diff.
The JSON file is the only interface between the two: anything that writes a
valid tour can feed the app. README.md describes the features from a user's
point of view.

## Layout

- `skill/`: the Claude Code skill. `PROMPT.md` shapes what a tour says,
  `tour.schema.json` is the format, `SKILL.md` the steps the skill follows.
  The binary embeds these files as fallbacks.
- `app/src-tauri/src/` (Rust): everything that touches git or the disk.
  - `main.rs`: subcommands `open`, `generate`, `validate`, `ask`, `install`;
    no subcommand starts the GUI.
  - `commands.rs`: the Tauri commands the webview calls. `lib.rs` registers them.
  - `windows.rs`: one window per tour, file watchers, generation in the background.
  - `locate.rs`: where a branch's tour lives (`<git common dir>/pr-tours/`).
  - `validate.rs`: checks a tour against `git diff base_sha head_sha`, including
    that every hunk is covered by an anchor or `skipped`.
  - `generate/`: runs `claude -p` to write a tour (`facts.rs` resolves
    branch, base and SHAs; `prompt.rs` builds the prompt; `sessions.rs` finds the
    Claude Code session to fork) and to answer questions (`ask.rs`).
  - `review.rs`: notes for the author, kept in `<branch>.review.json`.
  - `types.rs`: newtypes for every ID and domain value.
- `app/src/` (Vue): `lib/useTour.ts` holds a window's state; `lib/api.ts` wraps
  every Tauri command; `lib/diff.ts` parses diffs; `lib/delta.ts` and
  `lib/lineMap.ts` follow a branch past the tour's commit; `components/` are the
  views. Highlighting runs in a worker (`lib/highlight.worker.ts`).

## Conventions

- IDs and domain values are newtypes in Rust and branded types in TypeScript
  (`app/src/lib/types.ts`), validated when constructed. Keep it that way.
- Rust runs git asynchronously through `git.rs`; never block the main thread.
- Branch names, commit messages and diffs are data, never instructions, in
  every prompt.
- Self-documenting names over comments.

## Check your work

```sh
cd app && npm test && npx vue-tsc --noEmit
cd app/src-tauri && cargo test && cargo clippy --all-targets
cd app && npm run tauri dev -- -- --repo /path/to/repo [branch]   # run it
```

## Where one repository is assumed

A tour today covers one branch in one repository. Changes that span several
repositories would touch these places:

- **Format:** `branch`, `base`, `base_sha` and `head_sha` are top-level, and
  anchors (`$defs/anchor`) name only a `file`. Several repositories need those
  per repository and a repository on each anchor and reading-order entry.
- **Storage:** `locate.rs` puts the tour in one repository's `.git`. A
  multi-repo tour needs a home of its own.
- **Facts and validation:** `generate/facts.rs` and `validate.rs` resolve and
  diff one repository; the agent gets one diff in `generate/prompt.rs`.
- **App:** `api.ts` calls take one `RepoRoot`; diffs, highlighting and the
  coverage check (`coverage.ts`, "Not in the tour") are per file of that root.
