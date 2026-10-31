#!/bin/sh
# Builds the PR Tour app, links it as `pr-tour`, and links the skill into
# Claude Code and the launcher into Herdr. Safe to run again.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)

for tool in cargo npm; do
  command -v "$tool" >/dev/null || { echo "install.sh needs $tool (Rust and Node) to build the app" >&2; exit 1; }
done
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
link "$repo/herdr/pr-tour" "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/pr-tour"
link "$repo/herdr/pr-tour-open" "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/pr-tour-open"
link "$repo/app/src-tauri/target/release/pr-tour" "$HOME/.local/bin/pr-tour"
