---
paths:
  - "raw/**"
---
# Rules for raw/

- `raw/` is immutable. You may create a file here (web clipping, transcript, export) but never edit or delete one.
- Name: `YYYY-MM-DD Title.md`. Frontmatter `type: source`, `source: <URL or origin>`, `created`.
- A raw file is not knowledge until `/ingest` has turned it into wiki pages and an `index.md` line. Raw files are never linked from `memory/`.
