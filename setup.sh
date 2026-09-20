#!/usr/bin/env bash
set -euo pipefail

# Opus/Sonnet Adaptive Orchestrator — installer
# Copies the adaptive-orchestrator skill and optionally appends AGENTS.md
# routing instructions to a target project. Does not clobber unrelated config.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$SCRIPT_DIR/skills/adaptive-orchestrator/SKILL.md"
AGENTS_SRC="$SCRIPT_DIR/AGENTS.md"

print_usage() {
  echo "Usage: ./setup.sh [--target <path>] [--global]"
  echo ""
  echo "  --target <path>   Install into this project directory (default: prompt)"
  echo "  --global          Also install skill globally to ~/.claude/skills/"
  echo ""
  echo "Without --target, the script prompts for a directory."
}

GLOBAL=false
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --global) GLOBAL=true; shift ;;
    --help|-h) print_usage; exit 0 ;;
    *) echo "Unknown option: $1"; print_usage; exit 1 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  read -rp "Target project directory (Enter for current directory): " TARGET
  TARGET="${TARGET:-$PWD}"
fi

TARGET="$(eval echo "$TARGET")"  # expand ~

if [[ ! -d "$TARGET" ]]; then
  echo "Error: '$TARGET' is not a directory." >&2
  exit 1
fi

if [[ "$(realpath "$TARGET")" == "$(realpath "$SCRIPT_DIR")" ]]; then
  echo "Error: target must be a different project, not this repository." >&2
  exit 1
fi

echo ""
echo "Installing adaptive orchestrator into: $TARGET"
echo ""

# --- skill installation into project ---

SKILL_DEST="$TARGET/.claude/skills/adaptive-orchestrator"
mkdir -p "$SKILL_DEST"

if [[ -f "$SKILL_DEST/SKILL.md" ]]; then
  read -rp "  $SKILL_DEST/SKILL.md already exists. Overwrite? [y/N] " CONFIRM
  if [[ "${CONFIRM,,}" != "y" ]]; then
    echo "  Skipped skill."
  else
    cp "$SKILL_SRC" "$SKILL_DEST/SKILL.md"
    echo "  Replaced: $SKILL_DEST/SKILL.md"
  fi
else
  cp "$SKILL_SRC" "$SKILL_DEST/SKILL.md"
  echo "  Installed: $SKILL_DEST/SKILL.md"
fi

# --- AGENTS.md append ---

AGENTS_DEST="$TARGET/AGENTS.md"
ROUTING_MARKER="# Adaptive orchestration"

if [[ -f "$AGENTS_DEST" ]]; then
  if grep -q "$ROUTING_MARKER" "$AGENTS_DEST"; then
    echo "  Routing rules already present in $AGENTS_DEST — skipped."
  else
    read -rp "  Append routing rules to existing $AGENTS_DEST? [Y/n] " CONFIRM
    if [[ "${CONFIRM,,}" == "n" ]]; then
      echo "  Skipped AGENTS.md."
    else
      {
        echo ""
        echo "---"
        echo ""
        cat "$AGENTS_SRC"
      } >> "$AGENTS_DEST"
      echo "  Appended routing rules to: $AGENTS_DEST"
    fi
  fi
else
  cp "$AGENTS_SRC" "$AGENTS_DEST"
  echo "  Created: $AGENTS_DEST"
fi

# --- optional global install ---

if $GLOBAL; then
  GLOBAL_SKILL="$HOME/.claude/skills/adaptive-orchestrator"
  mkdir -p "$GLOBAL_SKILL"
  if [[ -f "$GLOBAL_SKILL/SKILL.md" ]]; then
    read -rp "  ~/.claude/skills/adaptive-orchestrator/SKILL.md exists. Overwrite? [y/N] " CONFIRM
    if [[ "${CONFIRM,,}" == "y" ]]; then
      cp "$SKILL_SRC" "$GLOBAL_SKILL/SKILL.md"
      echo "  Replaced: $GLOBAL_SKILL/SKILL.md"
    else
      echo "  Skipped global skill."
    fi
  else
    cp "$SKILL_SRC" "$GLOBAL_SKILL/SKILL.md"
    echo "  Installed globally: $GLOBAL_SKILL/SKILL.md"
  fi
fi

echo ""
echo "Done. In any Claude Code session in '$TARGET', invoke the skill with:"
echo "  /adaptive-orchestrator"
echo ""
echo "Or add AGENTS.md routing rules to the project CLAUDE.md for automatic activation."
