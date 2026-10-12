---
paths:
  - "Daily/**/*.md"
---
# Rules for Daily/

- File name is `YYYY-MM-DD.md` in the owner's timezone. Create from `templates/daily.md` if missing.
- Everything the owner wrote is theirs. Do not rewrite, reorder or "clean up" their text.
- Your additions go under `## Jarvis` (briefs, checkpoints, summaries), newest at the bottom.
- Tasks use `- [ ]`. Do not tick tasks on the owner's behalf unless they told you they did them.
- Prefer `obsidian daily:append content="..."` when Obsidian is running so the daily-notes plugin resolves the file. Fall back to appending to the file directly.
