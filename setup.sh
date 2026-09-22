#!/usr/bin/env bash
set -euo pipefail

# Opus/Sonnet Adaptive Orchestrator — installer
# Installs the orchestrator skill, the /no-subagents toggle, and the model-pinned
# subagent definitions (Haiku reader, Sonnet workers) into a target project.
# Optionally appends AGENTS.md routing instructions, wires the vendored
# orchestrator-budget cost plugin, and records the checkpoint-store choice.
# Does not clobber unrelated config.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$SCRIPT_DIR/skills/adaptive-orchestrator/SKILL.md"
NOSUB_SRC="$SCRIPT_DIR/skills/no-subagents/SKILL.md"
AGENTS_SRC="$SCRIPT_DIR/AGENTS.md"
AGENTS_DIR_SRC="$SCRIPT_DIR/agents"
PLUGIN_SRC="$SCRIPT_DIR/plugin"

print_usage() {
  echo "Usage: ./setup.sh [--target <path>] [--global] [--checkpoints beads|markdown]"
  echo ""
  echo "  --target <path>          Install into this project directory (default: prompt)"
  echo "  --global                 Also install skill + agents globally to ~/.claude/"
  echo "  --checkpoints <store>    Checkpoint store: 'beads' or 'markdown' (default: prompt)"
  echo ""
  echo "Without --target, the script prompts for a directory."
}

# Portable lowercase (macOS ships bash 3.2, which has no ${var,,}).
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

GLOBAL=false
TARGET=""
CHECKPOINTS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --global) GLOBAL=true; shift ;;
    --checkpoints) CHECKPOINTS="$2"; shift 2 ;;
    --help|-h) print_usage; exit 0 ;;
    *) echo "Unknown option: $1"; print_usage; exit 1 ;;
  esac
done

# GUI (non-interactive) mode: driven by env vars, never calls read.
NONINTERACTIVE="${GUI_NONINTERACTIVE:-0}"
OVERWRITE="${GUI_OVERWRITE:-0}"

# want_component <token>: true if token should be installed given GUI_COMPONENTS
# (present in the list, or list empty/unset = install all).
want_component() {
  local token="$1" list="${GUI_COMPONENTS:-}"
  [[ -z "$list" ]] && return 0
  case ",$list," in
    *",$token,"*) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ -z "$TARGET" ]]; then
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    TARGET="$PWD"
  else
    read -rp "Target project directory (Enter for current directory): " TARGET
    TARGET="${TARGET:-$PWD}"
  fi
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

# --- helper: copy a skill dir without clobbering silently --------------------

install_skill() {
  local src="$1" name="$2" dest="$TARGET/.claude/skills/$2"
  mkdir -p "$dest"
  if [[ -f "$dest/SKILL.md" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      if [[ "$OVERWRITE" != "1" ]]; then
        echo "  Skipped skill '$name' (exists)."
        return
      fi
      cp "$src" "$dest/SKILL.md"
      echo "  Replaced: $dest/SKILL.md"
      return
    fi
    read -rp "  $dest/SKILL.md already exists. Overwrite? [y/N] " CONFIRM
    if [[ "$(lc "$CONFIRM")" != "y" ]]; then
      echo "  Skipped skill '$name'."
      return
    fi
    cp "$src" "$dest/SKILL.md"
    echo "  Replaced: $dest/SKILL.md"
  else
    cp "$src" "$dest/SKILL.md"
    echo "  Installed: $dest/SKILL.md"
  fi
}

# --- skills ------------------------------------------------------------------

want_component "adaptive-orchestrator" && install_skill "$SKILL_SRC" "adaptive-orchestrator"
want_component "no-subagents" && install_skill "$NOSUB_SRC" "no-subagents"

# --- subagent definitions ----------------------------------------------------

AGENTS_DEST_DIR="$TARGET/.claude/agents"
mkdir -p "$AGENTS_DEST_DIR"
for f in "$AGENTS_DIR_SRC"/*.md; do
  base="$(basename "$f")"
  token="${base%.md}"
  want_component "$token" || continue
  if [[ -f "$AGENTS_DEST_DIR/$base" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      if [[ "$OVERWRITE" != "1" ]]; then echo "  Skipped agent $base (exists)."; continue; fi
    else
      read -rp "  agent $base already exists. Overwrite? [y/N] " CONFIRM
      if [[ "$(lc "$CONFIRM")" != "y" ]]; then echo "  Skipped agent $base."; continue; fi
    fi
  fi
  cp "$f" "$AGENTS_DEST_DIR/$base"
  echo "  Installed agent: .claude/agents/$base"
done

# --- gateway model-pin -------------------------------------------------------
# On machines using a provider-style gateway, bare aliases like "model: sonnet"
# have no mapping and silently fall back to the session model, defeating cost
# tiering.  Rewrite installed agent frontmatter to the exact model IDs that the
# gateway maps, iff modelOverrides in settings.json contains those keys.

maybe_pin_gateway_models() {
  local agents_dir="$1"

  # Locate settings.json: prefer target-local, fall back to home.
  local settings=""
  if [[ -f "$TARGET/.claude/settings.json" ]]; then
    settings="$TARGET/.claude/settings.json"
  elif [[ -f "$HOME/.claude/settings.json" ]]; then
    settings="$HOME/.claude/settings.json"
  else
    return 0
  fi

  # Requires node for reliable JSON parsing.
  if ! command -v node >/dev/null 2>&1; then
    echo "  (node not found; leaving model aliases as-is)"
    return 0
  fi

  # Determine which model-family pins are available from modelOverrides keys.
  local sonnet_pin haiku_pin
  sonnet_pin="$(node -e "
    try {
      var o = JSON.parse(require('fs').readFileSync('$settings','utf8'));
      var m = o.modelOverrides || {};
      if (Object.prototype.hasOwnProperty.call(m,'claude-sonnet-4-6'))
        process.stdout.write('claude-sonnet-4-6');
    } catch(e) {}
  " 2>/dev/null)"

  haiku_pin="$(node -e "
    try {
      var o = JSON.parse(require('fs').readFileSync('$settings','utf8'));
      var m = o.modelOverrides || {};
      if (Object.prototype.hasOwnProperty.call(m,'claude-haiku-4-5'))
        process.stdout.write('claude-haiku-4-5');
    } catch(e) {}
  " 2>/dev/null)"

  # Nothing to do if neither pin resolved.
  [[ -z "$sonnet_pin" && -z "$haiku_pin" ]] && return 0

  # Rewrite frontmatter model: lines in each installed agent file.
  for f in "$agents_dir"/*.md; do
    [[ -f "$f" ]] || continue
    local base; base="$(basename "$f")"
    if [[ -n "$sonnet_pin" ]] && grep -q "^model: sonnet$" "$f" 2>/dev/null; then
      sed -i '' -e "s/^model: sonnet$/model: $sonnet_pin/" "$f"
      echo "  Pinned $base model -> $sonnet_pin (gateway modelOverrides detected)"
    elif [[ -n "$haiku_pin" ]] && grep -q "^model: haiku$" "$f" 2>/dev/null; then
      sed -i '' -e "s/^model: haiku$/model: $haiku_pin/" "$f"
      echo "  Pinned $base model -> $haiku_pin (gateway modelOverrides detected)"
    fi
  done
}

maybe_pin_gateway_models "$AGENTS_DEST_DIR"

# --- checkpoint store choice -------------------------------------------------

if [[ -z "$CHECKPOINTS" ]]; then
  echo ""
  if command -v bd >/dev/null 2>&1; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      CHECKPOINTS="beads"
      echo "  'bd' detected — using 'beads' checkpoint store."
    else
      echo "  Checkpoint store: 'beads' (bd detected — structured, dependency-aware,"
      echo "  resumable) or 'markdown' (single CHECKPOINT.md ledger, zero-dependency)."
      read -rp "  Choose [beads/markdown] (default beads): " CHECKPOINTS
      CHECKPOINTS="${CHECKPOINTS:-beads}"
    fi
  else
    echo "  'bd' (beads) not found on PATH. Using 'markdown' checkpoint ledger."
    echo "  (Install beads and re-run with --checkpoints beads to switch.)"
    CHECKPOINTS="markdown"
  fi
fi

case "$CHECKPOINTS" in
  beads|markdown) ;;
  *) echo "Error: --checkpoints must be 'beads' or 'markdown'." >&2; exit 1 ;;
esac

if [[ "$CHECKPOINTS" == "beads" ]] && ! command -v bd >/dev/null 2>&1; then
  echo "  Warning: chose 'beads' but 'bd' is not on PATH. Install it (https://github.com/steveyegge/beads) or the orchestrator will not be able to record checkpoints." >&2
fi

mkdir -p "$TARGET/.claude"
echo "$CHECKPOINTS" > "$TARGET/.claude/orchestrator-checkpoints"
echo "  Checkpoint store set to: $CHECKPOINTS (.claude/orchestrator-checkpoints)"

# --- AGENTS.md append --------------------------------------------------------

AGENTS_DEST="$TARGET/AGENTS.md"
ROUTING_MARKER="# Adaptive orchestration"

if [[ -f "$AGENTS_DEST" ]]; then
  if grep -q "$ROUTING_MARKER" "$AGENTS_DEST"; then
    echo "  Routing rules already present in $AGENTS_DEST — skipped."
  else
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      CONFIRM="y"
    else
      read -rp "  Append routing rules to existing $AGENTS_DEST? [Y/n] " CONFIRM
    fi
    if [[ "$(lc "$CONFIRM")" == "n" ]]; then
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

# --- optional cost plugin ----------------------------------------------------

echo ""
if [[ "$NONINTERACTIVE" == "1" ]]; then
  CONFIRM="${GUI_COST_HOOK:-0}"
  [[ "$CONFIRM" == "1" ]] && CONFIRM="y" || CONFIRM="n"
else
  read -rp "  Install the vendored orchestrator-budget cost plugin (provider spend + task cap)? [y/N] " CONFIRM
fi
if [[ "$(lc "$CONFIRM")" == "y" ]]; then
  PLUGIN_DEST="$TARGET/.claude/plugins/orchestrator-budget"
  if [[ -d "$PLUGIN_DEST" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      if [[ "$OVERWRITE" != "1" ]]; then echo "  Skipped plugin (exists)."; else rm -rf "$PLUGIN_DEST"; cp -R "$PLUGIN_SRC" "$PLUGIN_DEST"; echo "  Installed plugin: $PLUGIN_DEST"; fi
    else
      read -rp "  $PLUGIN_DEST exists. Overwrite? [y/N] " C2
      if [[ "$(lc "$C2")" != "y" ]]; then echo "  Skipped plugin."; else rm -rf "$PLUGIN_DEST"; cp -R "$PLUGIN_SRC" "$PLUGIN_DEST"; echo "  Installed plugin: $PLUGIN_DEST"; fi
    fi
  else
    mkdir -p "$(dirname "$PLUGIN_DEST")"
    cp -R "$PLUGIN_SRC" "$PLUGIN_DEST"
    echo "  Installed plugin: $PLUGIN_DEST"
  fi
  echo "  To enable it, add the marketplace and install:"
  echo "    /plugin marketplace add $PLUGIN_DEST"
  echo "    /plugin install orchestrator-budget"
  echo "  NOTE: run this OR the standalone spending plugin plugin, not both (duplicate hooks)."
fi

# --- optional global install -------------------------------------------------

if $GLOBAL; then
  echo ""
  echo "Installing globally to ~/.claude ..."
  GLOBAL_SKILLS="$HOME/.claude/skills"
  GLOBAL_AGENTS="$HOME/.claude/agents"
  mkdir -p "$GLOBAL_SKILLS/adaptive-orchestrator" "$GLOBAL_SKILLS/no-subagents" "$GLOBAL_AGENTS"
  cp "$SKILL_SRC" "$GLOBAL_SKILLS/adaptive-orchestrator/SKILL.md"
  cp "$NOSUB_SRC" "$GLOBAL_SKILLS/no-subagents/SKILL.md"
  for f in "$AGENTS_DIR_SRC"/*.md; do cp "$f" "$GLOBAL_AGENTS/$(basename "$f")"; done
  maybe_pin_gateway_models "$GLOBAL_AGENTS"
  echo "  Installed skill + no-subagents + agents globally."
  echo "  Merge AGENTS.md routing rules into ~/.claude/CLAUDE.md manually if you want them everywhere."
fi

echo ""
echo "Done. In any Claude Code session in '$TARGET':"
echo "  • The orchestrator routes reads to haiku-reader and implementation to sonnet-worker(-lite)."
echo "  • Invoke the skill explicitly with /adaptive-orchestrator, or add the rules to CLAUDE.md."
echo "  • Toggle delegation off/on with /no-subagents."
echo "  • Checkpoints use: $CHECKPOINTS"
echo ""
