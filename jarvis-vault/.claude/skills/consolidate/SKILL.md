---
name: consolidate
description: Nightly consolidation. Promote durable facts from recent daily notes into memory/ and wiki/, refresh index.md, and log the changes. Use at end of day or on a schedule.
disable-model-invocation: true
---
# Consolidate

Goal: the daily notes stay as they were written; everything durable in them ends up in `memory/` or `wiki/`, with sources, so future sessions find it without reading the logs.

## Steps
1. Read `index.md`, `memory/MEMORY.md`, and the `Daily/` notes from the last 3 days (or since the last `consolidate` entry in `log.md`, whichever is longer).
2. Extract candidates: new facts about the owner or their preferences, people, projects and their state changes, decisions, deadlines. Skip anything transient (a single day's mood, a task already done) and anything already recorded.
3. For each candidate, find the target page (search first). Then:
   - Owner facts and preferences → the right `memory/` topic note, with `as_of: <daily note date>`, `source: [[Daily/YYYY-MM-DD]]`, `confidence: stated`. Add a one-line pointer to `memory/MEMORY.md` only if it is something every session should know.
   - People, projects, concepts → `wiki/` pages (create from `templates/wiki-page.md` if missing).
   - Decisions → `wiki/<Decision>.md` from `templates/decision.md`; mark any decision it replaces `status: superseded` and set `supersedes`.
4. When a fact contradicts an existing one, keep both: move the old one to `## History` with its end date, put the new one under `## Current`.
5. Update `modified` on every page you touched. Add `index.md` lines for new pages. If `memory/MEMORY.md` exceeds 180 lines, move the least-used detail into topic notes and leave links.
6. Append a `consolidate` entry to `log.md`: pages created, pages updated, facts superseded, and anything you were unsure about as `- [ ] confirm: ...` so the owner can resolve it in tomorrow's brief.
7. Do not run `/push`. The Stop hook commits; the owner reviews with `git log -p` and pushes.

## Rules
- Never rewrite the owner's text in `Daily/`.
- Never invent a fact to fill a template field; leave `TBD`.
- If a daily note contains what looks like a credential, do not copy it anywhere; note `- [ ] confirm: possible secret in Daily/<date>` in the log entry.
