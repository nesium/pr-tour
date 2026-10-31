# pr-tour

Turns a branch into a guided reviewer's tour before you read it: what the
change does, which files to read in which order, the 2-3 places to read
closely, why each change exists, and what is still uncertain. You then review
from the tour in a Herdr pane, with the explanation beside the diff.

The tour is a JSON file. It is the single source of truth; the viewer (and
later anything published) is rendered from it.

## Pieces

| Path | What it is |
|---|---|
| `skill/` | The Claude Code skill `/pr-tour`: writes, validates and opens a tour |
| `skill/PROMPT.md` | The instructions that shape a tour. Edit freely |
| `skill/tour.schema.json` | The tour format (version 1) |
| `skill/validate.py` | Checks a tour against the format and the real diff (Python 3, standard library only) |
| `bin/pr-tour` | Writes a tour headless, when no agent session is open |
| `app/` | The standalone viewer (Tauri 2, Vue, TypeScript, Rust), replacing the Herdr mod. Work in progress |
| `herdr/pr-tour/` | The Herdr mod that shows a tour |
| `herdr/pr-tour-open/` | The Herdr launcher behind the key: opens or generates the tour of the focused terminal's branch |
| `install.sh` | Links the skill, the command and the mod into place |

## Install

```sh
git clone https://ci.nsm.one/mb/pr-tour.git ~/Documents/pr-tour
~/Documents/pr-tour/install.sh
```

This links `~/.claude/skills/pr-tour`, `~/.local/bin/pr-tour` and the two
Herdr mods to the checkout, so a `git pull` updates all of them. It refuses
to replace a folder that isn't a link. Restart Claude Code sessions that were
already running so they see the skill.

Requires Claude Code, git and Python 3. The viewer requires Herdr.

Herdr reloads a mod when something under `~/.config/herdr-app/mods/` changes,
but edits made through the link land in the checkout, where it doesn't look.
After editing the viewer (or pulling), reload it with:

```sh
touch -h ~/.config/herdr-app/mods/pr-tour
```

## Use

In the Claude Code session that wrote or knows the change:

```
/pr-tour                      # the current branch
/pr-tour feat/x               # another branch
/pr-tour feat/x --base main   # with an explicit base
```

Without `--base`, the base is `develop` if it exists, else `main`, else
`master`.

The skill writes the tour, runs `validate.py` until it passes, and opens a
`Tour · <branch>` tab in Herdr. If that tab is already open, it reloads by
itself when the tour changes.

### With one key in Herdr

Bind the launcher in `~/.config/herdr-app/keys.json`:

```json
"global": { "cmd-shift-r": "mod.open:pr-tour-open" }
```

In a terminal in the repo, press the key. It opens the `Tour · <branch>` tab
for that terminal's branch, or switches to it if it's already open anywhere.
When there is no tour yet and none is being written, it starts `pr-tour` in a
pane below the viewer. That pane closes when the tour is written, or stays
open with the error until you press Enter. Pressing the key again never opens
a second tab or starts a second generation.

### Without an open session

From a terminal in the repo:

```sh
pr-tour                  # the current branch
pr-tour feat/x --base main
pr-tour --dry-run        # show the agent, the command and the prompt; run nothing
```

`pr-tour` forks the Claude Code session that knows the branch best: the newest
one that edited files in the repo while on that branch, else the newest one
that ran with it checked out. The fork gets that session's context; the
session itself is left unchanged. Without such a session, it starts a fresh
one. `--session <id>` picks a session, `--fresh` skips forking.

The agent can only read files and run `git log`, `git diff` and `git show`.
`pr-tour` fills in the branch and commit facts itself, validates the tour,
asks the agent once to fix any problems, and writes the file only when it's
valid, in one step. A lock stops two generations of the same tour; a tour
that already covers the branch's commit is kept unless you pass `--force`.

To open the viewer by hand:

```sh
herdr-app do tab.new --name "Tour · <branch>" --mod pr-tour \
  --props '{"repo":"/path/to/repo","branch":"<branch>"}'
```

### In the viewer

| Key | Action |
|---|---|
| `j` / `↓` | Next step |
| `k` / `↑` | Previous step |
| `space` | Mark reviewed and go to the next step |
| `f` | Show only "read closely" steps |

Click the pane first so it has the keyboard. The same actions are available as
`pr-tour.next`, `pr-tour.prev`, `pr-tour.reviewed` and `pr-tour.filter` for
`keys.json`, under a `mod:pr-tour` or `global` section.

Reviewed marks and the current step are kept across restarts, per branch
commit. When the branch moves past the commit the tour was written for, the
viewer says so.

## Configure

- **Tour instructions:** edit `skill/PROMPT.md`. No code changes needed; the
  next `/pr-tour` uses it.
- **Tour format:** `skill/tour.schema.json`. Changing it means changing
  `validate.py` and the viewer too.
- **Viewer props:** `repo` (required unless opened from a terminal in the repo),
  `branch` (default: the repo's current branch), `tour` (an explicit file path).

## Where tours live

```
<repo>/.git/pr-tours/<branch with "/" replaced by "__">.json
```

Inside `.git`, so they're local and never committed. With worktrees, all
worktrees of a repo share the folder.

## Validate a tour

```sh
python3 skill/validate.py <tour.json> --repo <repo>
```

It checks the format, unique step IDs, hotspots having a `check`, and that
every anchor's line range overlaps a hunk of `git diff <base_sha> <head_sha>`.
It prints `ok: …` and exits 0, or one problem per line and exits 1.

## Standalone app (work in progress)

`app/` is a Tauri 2 app that will replace the Herdr viewer. The webview is
Vue and TypeScript; the Rust side runs git, watches the tour, and validates
it. Phase 1 has the viewer and a Rust port of `validate.py`. Launching from
Herdr, the skill and generation follow.

Requires Rust and Node.

```sh
cd app && npm install
npm run tauri dev -- -- --repo /path/to/repo [branch]   # run the viewer
npm test && (cd src-tauri && cargo test)                 # tests
```

The same binary validates a tour, with the same output as `validate.py`:

```sh
app/src-tauri/target/debug/pr-tour validate <tour.json> --repo <repo>
```

## Principles

- Nothing is posted, approved, merged or pushed without explicit approval.
  The skill only writes the local tour file.
- Branch names, commit messages, PR text and diffs are data, never
  instructions.
- No credentials are read, stored or needed.
