#!/bin/sh
# Builds the PR Tour app, links it as `pr-tour`, and links the skill into
# Claude Code. Safe to run again, e.g. after a `git pull`.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)

for tool in git cargo npm; do
  command -v "$tool" >/dev/null || { echo "install.sh needs $tool (git, Rust and Node) to build the app" >&2; exit 1; }
done
command -v claude >/dev/null || echo "note: Claude Code (claude) is not on your PATH; PR Tour needs it to write tours" >&2
(cd "$repo/app" && npm ci --silent && npx tauri build --no-bundle)

link() {
  source=$1
  target=$2
  if [ -L "$target" ]; then
    ln -sfn "$source" "$target"
  elif [ -e "$target" ]; then
    echo "skipped: $target exists and is not a link" >&2
    return 1
  else
    mkdir -p "$(dirname "$target")"
    ln -s "$source" "$target"
  fi
  echo "linked: $target -> $source"
}

link "$repo/skill" "$HOME/.claude/skills/pr-tour"
link "$repo/app/src-tauri/target/release/pr-tour" "$HOME/.local/bin/pr-tour"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "note: add $HOME/.local/bin to your PATH to use pr-tour in a terminal" >&2 ;;
esac
echo "Done. Restart running Claude Code sessions so they see /pr-tour."
