#!/usr/bin/env bash
# One-time setup for a fresh copy of this vault. Safe to re-run.
# Usage: ./scripts/setup.sh   (run from the vault root)
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(pwd -P)"
echo "Vault: $root"

# 1. Own git repo (git is the undo layer; the Stop hook commits here).
if ! git rev-parse --show-toplevel >/dev/null 2>&1 || [ "$(git rev-parse --show-toplevel)" != "$root" ]; then
  git init -q
  echo "Initialised git repo."
fi

# 2. Hooks must be executable.
chmod +x .claude/hooks/*.sh scripts/*.sh

# 3. Point Claude Code's auto memory into the vault (absolute path required).
local_settings=".claude/settings.local.json"
if [ ! -f "$local_settings" ]; then
  sed "s#/ABSOLUTE/PATH/TO/jarvis-vault#$root#" .claude/settings.local.json.example > "$local_settings"
  echo "Wrote $local_settings (autoMemoryDirectory -> $root/memory)."
fi

# 4. Tooling checks.
for tool in claude git rg jq; do
  if command -v "$tool" >/dev/null 2>&1; then echo "ok   $tool"; else echo "MISSING $tool"; fi
done
if command -v obsidian >/dev/null 2>&1; then
  echo "ok   obsidian CLI"
else
  echo "note obsidian CLI not on PATH: enable it in Obsidian > Settings > General > Command line interface (requires Obsidian 1.12.7+)"
fi

# 5. First commit if there is nothing yet.
if ! git rev-parse HEAD >/dev/null 2>&1; then
  git add -A && git commit -qm "jarvis: initial vault" && echo "Initial commit made."
fi

cat <<'MSG'

Next steps (inside `claude` started in this folder):
  /plugin marketplace add kepano/obsidian-skills
  /plugin install obsidian@obsidian-skills        (choose "project" scope)
  Edit memory/MEMORY.md: fill in name, timezone, role.
Then open this folder as a vault in Obsidian.
MSG
