---
paths:
  - "memory/**/*.md"
---
# Rules for memory/

- `memory/MEMORY.md` is an index, not a dump. Max 200 lines. One line per fact or one link per topic note.
- Topic notes (`memory/people.md`, `memory/projects.md`, `memory/decisions.md`, or one file per entity) hold detail. Use `type: memory` and the full frontmatter schema.
- Each fact carries `as_of` and `confidence`. Owner statements are `stated`; your inferences are `medium` or `speculation` and must say so inline, for example `(inferred from [[Daily/2026-10-12]])`.
- Superseded facts stay in the file under a `## History` heading with the date they stopped being true. Never silently overwrite.
- A stale memory is not permission. If a memory says the owner wanted X last month, confirm before acting on it today.
