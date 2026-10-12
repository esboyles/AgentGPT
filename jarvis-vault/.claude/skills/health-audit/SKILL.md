---
name: health-audit
description: Weekly vault health audit. Report unresolved wikilinks, orphans, dead ends, stale as_of dates, missing frontmatter and an oversized MEMORY.md. Writes a report into today's daily note. Use weekly or when the vault feels messy.
disable-model-invocation: true
---
# Health audit

Report only. This skill does not fix anything beyond trivial frontmatter `modified` stamps; it lists what needs fixing so the owner (or a later session) can decide.

## Checks
1. **Unresolved links**: `obsidian unresolved format=json verbose` if Obsidian is running; otherwise extract `[[targets]]` from `wiki/ memory/ Daily/ index.md` with `rg -o '\[\[[^\]|#]+'` and compare with `ls`-based file names.
2. **Orphans and dead ends**: `obsidian orphans` and `obsidian deadends` if running; otherwise list `wiki/` and `memory/` pages with zero inbound links from other pages or `index.md`.
3. **Index coverage**: every `wiki/*.md` and `memory/*.md` (except `MEMORY.md`) should appear in `index.md`.
4. **Stale facts**: pages with `as_of` older than 90 days and `status: active`, using `obsidian properties name=as_of format=json` or `rg -n '^as_of:'`.
5. **Frontmatter**: pages under `wiki/`, `memory/`, `raw/` missing any of `type`, `created`, `modified`, `status`.
6. **MEMORY.md size**: line count; warn above 180, fail above 200.
7. **Raw hygiene**: `raw/` files not listed under `## Raw sources` in `index.md` (never ingested).
8. **Git**: uncommitted changes (`git status --porcelain`) and unpushed commits (`git log @{u}..` if an upstream exists).

## Output
Append to today's `Daily/` note under `## Jarvis` a `### Health audit` section with one line per check: `OK`, or a count and up to 10 examples with wikilinks. End with `- [ ] fix: ...` items for anything non-trivial. Append an `audit` entry to `log.md` with the counts.
