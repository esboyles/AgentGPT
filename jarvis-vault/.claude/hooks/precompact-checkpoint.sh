#!/usr/bin/env bash
# PreCompact hook: before context is compacted, leave a checkpoint in today's
# daily note so the next context window (and the owner) can see where things stood.
# Writes to the file directly so it never launches Obsidian on a headless host.
set -u
input="$(cat)"
trigger="auto"
if command -v jq >/dev/null 2>&1; then
  trigger="$(printf '%s' "$input" | jq -r '.trigger // "auto"')"
fi
root="${CLAUDE_PROJECT_DIR:-$PWD}"
today="$(date '+%Y-%m-%d')"
now="$(date '+%H:%M')"
note="$root/Daily/$today.md"
mkdir -p "$root/Daily"
if [ ! -f "$note" ]; then
  if [ -f "$root/templates/daily.md" ]; then
    sed -e "s/{{date:YYYY-MM-DD}}/$today/g" "$root/templates/daily.md" > "$note"
  else
    printf -- '---\ntype: daily\ncreated: %s\nmodified: %s\nstatus: active\n---\n# %s\n\n## Jarvis\n' "$today" "$today" "$today" > "$note"
  fi
fi
grep -q '^## Jarvis' "$note" || printf '\n## Jarvis\n' >> "$note"
printf -- '- %s context compaction checkpoint (%s). Re-read index.md, memory/MEMORY.md and this note before continuing.\n' "$now" "$trigger" >> "$note"
exit 0
