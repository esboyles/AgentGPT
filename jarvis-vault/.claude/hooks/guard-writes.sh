#!/usr/bin/env bash
# PreToolUse hook for Edit|Write.
# Blocks writes outside the vault and to protected folders. In unattended runs
# (JARVIS_UNATTENDED=1) it also restricts writes to the agent-owned areas.
# Exit 2 = block (stderr is shown to Claude as the reason). Exit 0 = allow.
set -u

input="$(cat)"
file_path=""
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
elif command -v python3 >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))')"
else
  echo "guard-writes: need jq or python3 to inspect the tool call; blocking." >&2
  exit 2
fi

[ -z "$file_path" ] && exit 0   # not a file write we understand; let permissions decide

root="${CLAUDE_PROJECT_DIR:-$PWD}"
root="$(cd "$root" && pwd -P)"

# Resolve to an absolute, normalised path without requiring the file to exist.
case "$file_path" in
  /*) abs="$file_path" ;;
  *)  abs="$root/$file_path" ;;
esac
dir="$(dirname "$abs")"
base="$(basename "$abs")"
if [ -d "$dir" ]; then
  abs="$(cd "$dir" && pwd -P)/$base"
fi

case "$abs" in
  "$root"/*) rel="${abs#"$root"/}" ;;
  *) echo "guard-writes: '$file_path' is outside the vault ($root). Blocked." >&2; exit 2 ;;
esac

# Always protected.
case "$rel" in
  Archive/*|.obsidian/*|.git/*|templates/*|.claude/settings.json|.claude/hooks/*)
    echo "guard-writes: '$rel' is protected (see CLAUDE.md folder map). Blocked." >&2
    exit 2 ;;
esac

# raw/ is create-only.
case "$rel" in
  raw/*)
    if [ -e "$abs" ]; then
      echo "guard-writes: raw/ is immutable; '$rel' already exists. Blocked." >&2
      exit 2
    fi ;;
esac

# Unattended runs: allowlist only.
if [ "${JARVIS_UNATTENDED:-0}" = "1" ]; then
  case "$rel" in
    Daily/*|memory/*|wiki/*|raw/*|index.md|log.md) ;;
    *)
      echo "guard-writes: unattended run may only write Daily/, memory/, wiki/, raw/, index.md, log.md. '$rel' blocked." >&2
      exit 2 ;;
  esac
fi

exit 0
