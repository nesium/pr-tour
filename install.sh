#!/bin/sh
# Links the skill into Claude Code and the viewer into Herdr. Safe to run again.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)

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
link "$repo/bin/pr-tour" "$HOME/.local/bin/pr-tour"
