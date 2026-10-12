---
paths:
  - "wiki/**/*.md"
---
# Rules for wiki/

- One page per entity, concept, project or decision. Title Case filenames, no dates in names.
- Page skeleton: frontmatter, one-paragraph summary, `## Facts` (dated, sourced bullets), `## Related` (wikilinks), `## Sources` (links to `raw/` or daily notes).
- Decision pages use `type: decision`, `status: active | superseded`, and a `## Rationale` section. They appear automatically in `Decisions.base`.
- Every wiki page must be reachable from `index.md` and from at least one other page.
- Before creating a page, search for an existing one under a different name. Prefer adding an alias in frontmatter (`aliases: []`) to creating a duplicate.
