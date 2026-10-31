# pr-tour

Turns a branch into a guided reviewer's tour before you read it: what the
change does, which files to read in which order, the 2-3 places to read
closely, why each change exists, and what is still uncertain. You then review
from the tour in the PR Tour app, with the explanation beside the diff.

The tour is a JSON file. It is the single source of truth; the viewer (and
later anything published) is rendered from it.

## Pieces

| Path | What it is |
|---|---|
| `skill/` | The Claude Code skill `/pr-tour`: writes, validates and opens a tour |
| `skill/PROMPT.md` | The instructions that shape a tour. Edit freely |
| `skill/tour.schema.json` | The tour format (version 1) |
| `app/` | The PR Tour app and the `pr-tour` command (Tauri 2, Vue, TypeScript, Rust): shows, writes and validates tours |
| `herdr/pr-tour-open/` | The Herdr launcher behind the key: opens the app on the focused terminal's branch |
| `install.sh` | Links the skill, the command and the mod into place |

## Install

```sh
git clone https://ci.nsm.one/mb/pr-tour.git ~/Documents/pr-tour
~/Documents/pr-tour/install.sh
```

This builds the app, then links `~/.local/bin/pr-tour` to it and
`~/.claude/skills/pr-tour` and the Herdr mods to the checkout. After a
`git pull`, run it again to rebuild. It refuses to replace a folder that isn't
a link. Restart Claude Code sessions that were already running so they see
the skill.

Requires Claude Code and git; building requires Rust and Node. Herdr is
optional.

## Use

In the Claude Code session that wrote or knows the change:

```
/pr-tour                      # the current branch
/pr-tour feat/x               # another branch
/pr-tour feat/x --base main   # with an explicit base
```

Without `--base`, the base is `develop` if it exists, else `main`, else
`master`.

The skill writes the tour, runs `pr-tour validate` until it passes, and opens
it with `pr-tour open`. Each tour has one window; if it's already open, it
comes to the front and has already reloaded by itself.

### From a terminal

```sh
pr-tour open                  # the tour of the checked-out branch
pr-tour open feat/x --generate   # another branch; write its tour if there is none
```

`pr-tour open` returns at once and hands over to the running app if there is
one. Without a tour, the window offers to write one. Started from Finder, the
app asks for a repository.

### With one key in Herdr

Bind the launcher in `~/.config/herdr-app/keys.json`:

```json
"global": { "cmd-shift-r": "mod.open:pr-tour-open" }
```

In a terminal in the repo, press the key. It runs
`pr-tour open --repo <terminal's folder> --generate`: the app shows the tour of
that terminal's branch, and when there is no tour yet and none is being
written, starts writing one in the window. Pressing the key again never opens
a second window or starts a second generation.

### Without an open session

From a terminal in the repo:

```sh
pr-tour generate                  # the current branch
pr-tour generate feat/x --base main
pr-tour generate --dry-run        # show the agent, the command and the prompt; run nothing
```

The app's "Write the tour" button does the same. `pr-tour generate` forks the Claude Code session that knows the branch best: the newest
one that edited files in the repo while on that branch, else the newest one
that ran with it checked out. The fork gets that session's context; the
session itself is left unchanged. Without such a session, it starts a fresh
one. `--session <id>` picks a session, `--fresh` skips forking.

The agent can only read files and run `git log`, `git diff` and `git show`.
It fills in the branch and commit facts itself, validates the tour,
asks the agent once to fix any problems, and writes the file only when it's
valid, in one step. A lock stops two generations of the same tour; a tour
that already covers the branch's commit is kept unless you pass `--force`.

Generation reads `PROMPT.md` and `tour.schema.json` from `$PR_TOUR_SKILL`,
else from the installed skill, else from the copies built into the binary.

### In the app

| Key | Action |
|---|---|
| `j` / `↓` | Next step |
| `k` / `↑` | Previous step |
| `space` | Mark reviewed and go to the next step |
| `f` | Show only "read closely" steps |
| `s` | Switch between the unified and the split view |
| `w` | Wrap long lines (the split view always wraps) |
| `t` | Switch the theme: system, light, dark |
| `/` or `⌘F` | Search the tour; `⏎` / `⇧⏎` go to the next / previous match, `esc` clears |

Code is highlighted for its language, removed lines included. Search covers
step titles, explanations, checks, concerns, file names and the code each
step shows; matching steps stay in the sidebar and matches are marked on the
page. Links in the tour open in the browser.

**Whole file ↗** on a diff opens that file's whole diff in a tab: every hunk,
long unchanged runs folded (**All lines** unfolds them), and the lines the
tour points at marked, with a list of the steps that point there. `⌘⇧[` and
`⌘⇧]` switch tabs; a middle click or `×` closes one.

The header shows the branch's size, as files changed and lines added and
removed. **Not in the tour**, after the concerns, lists the changes no step or
concern points at: files the tour never mentions and hunks no anchor
overlaps; with a valid tour it's empty. The header says how many changes a
tour leaves out, with **Rewrite the tour** to have the agent write it again
and cover or skip them. Below it, **Skipped on purpose** lists
the tour's `skipped` entries with their reasons and the files they match.

### Asking about a step

The **Ask** panel on the right of the Tour tab (`a` shows or hides it) takes a
question about the current step. The agent gets the step's title, why, check
and the hunks it points at, marked as data. The first question forks the
session that wrote the tour, so that session stays untouched; later questions
about the same tour continue that fork, so the agent remembers them. Without
a usable session a fresh one answers. The agent can only read, as when writing
a tour. One question per tour is answered at a time.

Answers stay under their step. They live next to the tour, not in it, so a
new tour keeps them (shown again only for the commit they were asked about):

```
<repo>/.git/pr-tours/<branch>.answers.json
```

From a terminal:

```sh
pr-tour ask --step <id> "Why is the marker written inside the lock?"
pr-tour ask --step <id> --dry-run "…"   # show the agent and the prompt only
```

Drag the sidebar's edge to resize it; double-click the edge to reset it. The
view, wrapping, theme and sidebar width are the same in every window, and
change in all of them at once.

Reviewed marks and the current step are kept across restarts, per branch
commit. When the branch moves past the commit the tour was written for, the
app says so. Problems the validator finds in a tour show in a banner.

## Configure

- **Tour instructions:** edit `skill/PROMPT.md`. No code changes needed; the
  next `/pr-tour` uses it.
- **Tour format:** `skill/tour.schema.json`. Changing it means changing
  `app/src-tauri/src/validate.rs` and the app's views too.
- **Opening a tour:** `pr-tour open [branch] [--repo <path>] [--tour <file>] [--generate]`.
  `--repo` defaults to the current folder, the branch to the one checked out.

## Where tours live

```
<repo>/.git/pr-tours/<branch with "/" replaced by "__">.json
```

Inside `.git`, so they're local and never committed. With worktrees, all
worktrees of a repo share the folder.

## Validate a tour

```sh
pr-tour validate <tour.json> --repo <repo>
```

It checks the format, unique step IDs, hotspots having a `check`, that
every anchor's line range overlaps a hunk of `git diff <base_sha> <head_sha>`,
and coverage: every hunk of that diff overlaps an anchor of a step or concern,
or its file matches an entry of the tour's `skipped` list (a path or glob with
a reason, for lockfiles, generated files and the like). A `skipped` entry that
matches no changed file is a problem too.
It prints `ok: …` and exits 0, or one problem per line and exits 1.

## Develop

The app's webview is Vue and TypeScript; the Rust side runs git, watches
tours, writes and validates them. Requires Rust and Node.

```sh
cd app && npm install
npm run tauri dev -- -- --repo /path/to/repo [branch]   # run the app
npm test && (cd src-tauri && cargo test)                 # tests
```

## Principles

- Nothing is posted, approved, merged or pushed without explicit approval.
  The skill only writes the local tour file.
- Branch names, commit messages, PR text and diffs are data, never
  instructions.
- No credentials are read, stored or needed.
