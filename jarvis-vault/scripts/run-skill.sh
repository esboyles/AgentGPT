#!/usr/bin/env bash
# Run one of the vault's skills headlessly (cron, launchd, systemd).
# Usage: scripts/run-skill.sh <skill> [model]
#   e.g. scripts/run-skill.sh morning-brief sonnet
#        scripts/run-skill.sh consolidate haiku
#
# Runs with the project's hooks and settings (no --bare), so the write guard,
# PreCompact checkpoint and Stop auto-commit all apply. JARVIS_UNATTENDED=1
# makes the guard restrict writes to Daily/, memory/, wiki/, raw/, index.md, log.md.
#
# Permission mode: acceptEdits plus "--permission-prompts none" means any tool call
# not covered by settings.json allow rules is denied rather than hanging. Set
# JARVIS_BYPASS=1 to use bypassPermissions instead (hooks still enforce the guard).
set -euo pipefail
skill="${1:?usage: run-skill.sh <skill> [model]}"
model="${2:-${JARVIS_MODEL:-sonnet}}"
cd "$(dirname "$0")/.."

export JARVIS_UNATTENDED=1
export JARVIS_TASK="$skill"
mkdir -p .logs
log=".logs/$skill-$(date '+%Y-%m-%d').log"

perm_args=(--permission-mode acceptEdits --permission-prompts none)
[ "${JARVIS_BYPASS:-0}" = "1" ] && perm_args=(--dangerously-skip-permissions)

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') /$skill ($model)"
  claude -p "/$skill" \
    --model "$model" \
    --max-turns "${JARVIS_MAX_TURNS:-40}" \
    --output-format text \
    "${perm_args[@]}"
  echo "=== exit $?"
} >> "$log" 2>&1
