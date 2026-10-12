#!/usr/bin/env bash
# Stop hook: commit whatever the session changed so git is the undo layer.
# Never blocks; always exits 0.
set -u
root="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$root" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
# Only stage vault content, never app state or secrets (also covered by .gitignore).
git add -A -- . ':!.obsidian/workspace.json' ':!.obsidian/workspace-mobile.json' >/dev/null 2>&1
if git diff --cached --quiet; then
  exit 0
fi
stamp="$(date '+%Y-%m-%d %H:%M')"
label="session"
[ "${JARVIS_UNATTENDED:-0}" = "1" ] && label="unattended${JARVIS_TASK:+ $JARVIS_TASK}"
git commit -q -m "jarvis: $label checkpoint $stamp" >/dev/null 2>&1 || true
exit 0
