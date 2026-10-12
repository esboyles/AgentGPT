# Jarvis vault

An Obsidian vault pre-wired for Claude Code, built from the reference architecture in [docs/research/jarvis-sota-configs-claude-obsidian.md](../docs/research/jarvis-sota-configs-claude-obsidian.md): Claude Code as the harness, the vault as co-owned memory, git as the undo layer, hooks (not prose) as the enforcement layer, and Anthropic's own channel and scheduler surfaces on top.

```
jarvis-vault/
├── CLAUDE.md              the vault's API contract for the agent (82 lines)
├── index.md               catalog, read first every session
├── log.md                 append-only activity log
├── Decisions.base         Bases table of active decisions
├── Daily/                 one note per day; owner writes, agent appends under "## Jarvis"
├── memory/                agent-owned durable facts; MEMORY.md is the 200-line index
├── wiki/                  agent-maintained entity, concept, project, decision pages
├── raw/                   immutable sources (clippings, transcripts); create-only
├── templates/             daily, wiki-page, decision, memory-note
├── Archive/               retired material; agent cannot write here
├── .claude/
│   ├── settings.json      permissions + hooks (shared)
│   ├── settings.local.json.example   autoMemoryDirectory (per machine)
│   ├── rules/             path-scoped conventions for memory/, wiki/, Daily/, raw/
│   ├── skills/            /morning-brief /ingest /consolidate /health-audit /push
│   └── hooks/             guard-writes, precompact-checkpoint, auto-commit
├── scripts/               setup.sh, run-skill.sh, crontab + launchd examples
└── scheduled-tasks/       Claude Desktop task templates (alternative to cron)
```

## 1. Set up (10 minutes)

1. Copy this folder somewhere outside this repo, for example `~/Vaults/jarvis`, and run:
   ```bash
   cd ~/Vaults/jarvis && ./scripts/setup.sh
   ```
   It initialises a git repo, writes `.claude/settings.local.json` with the absolute path of `memory/` as Claude Code's auto-memory directory, checks for `claude`, `git`, `rg`, `jq` and the Obsidian CLI, and makes the first commit.
2. Open the folder in Obsidian (Open folder as vault). Enable **Settings → General → Command line interface** (Obsidian 1.12.7+) so `obsidian` is on your PATH. Daily notes are preconfigured to `Daily/YYYY-MM-DD` using `templates/daily.md`.
3. Start Claude Code in the vault and install the Obsidian skills:
   ```
   cd ~/Vaults/jarvis && claude
   /plugin marketplace add kepano/obsidian-skills
   /plugin install obsidian@obsidian-skills      # pick "project" scope
   ```
4. Fill in `memory/MEMORY.md` (name, timezone, role). Tell Claude "read CLAUDE.md and index.md, then introduce yourself" to confirm it picked everything up.

## 2. What the pieces do

**CLAUDE.md** holds the six sections every serious kit converges on: identity and timezone, folder map, frontmatter schema, linking rules, workflows, prohibitions. It stays under 200 lines; folder-specific detail lives in `.claude/rules/*.md`, which load only when Claude touches matching paths.

**Permissions** (`.claude/settings.json`): read-only Bash commands and `obsidian` are pre-allowed; `mv`, `git push`, `git checkout` ask; `rm`, force-push, and edits to `Archive/`, `.obsidian/`, `templates/`, the hooks and the settings file are denied. Rules use `Edit(...)`, which covers Write too, with a leading `/` so they anchor at the vault root.

**Hooks** (`.claude/hooks/`):
- `guard-writes.sh` (PreToolUse on Edit|Write): blocks writes outside the vault, to protected folders, and to existing `raw/` files. With `JARVIS_UNATTENDED=1` it allows only `Daily/`, `memory/`, `wiki/`, `raw/`, `index.md`, `log.md`.
- `precompact-checkpoint.sh` (PreCompact): appends a timestamped checkpoint to today's daily note before context is compacted, so the next window knows to re-read index and memory.
- `auto-commit.sh` (Stop): commits every session's changes. Review with `git log -p`; revert with `git revert`.

**Memory**: Claude Code's auto memory is pointed at `memory/` via `autoMemoryDirectory`, so what Claude learns on its own lands in the vault next to the curated `MEMORY.md` (only the first 200 lines / 25 KB of that file load per session). Nightly `/consolidate` promotes facts from daily notes into `memory/` and `wiki/`; weekly `/health-audit` reports broken links, orphans, stale `as_of` dates and oversized memory.

**Bases**: `Decisions.base` lists every `type: decision` page by `status`. Add more `.base` files for dashboards; Claude can author them (the `obsidian-bases` skill teaches the syntax).

## 3. Schedules (proactive Jarvis)

Pick one:

- **cron / launchd on an always-on machine** (Mac mini, VPS): `scripts/run-skill.sh <skill> [model]` runs a skill headlessly with the vault's hooks active and `JARVIS_UNATTENDED=1`. See `scripts/crontab.example` and `scripts/launchd/*.plist` (replace `/ABSOLUTE/PATH/TO/jarvis-vault`). Default permission handling is `acceptEdits` plus `--permission-prompts none`, so anything not pre-allowed is denied instead of hanging; set `JARVIS_BYPASS=1` to run with `--dangerously-skip-permissions` (the write guard still applies). Logs go to `.logs/`.
- **Claude Desktop scheduled tasks**: copy `scheduled-tasks/<name>/` to `~/.claude/scheduled-tasks/` and set the schedule and folder in the app. Runs only while the app is open.
- **Cloud Routines** cannot see local files, so use them only for connector-only jobs (for example a Slack-to-Linear sweep), not for anything that writes to the vault.

Suggested cadence: `/morning-brief` weekdays 07:45 with Sonnet, `/consolidate` nightly 22:10 with Haiku, `/health-audit` Sunday 18:00 with Haiku.

## 4. Reach it from your phone

- **Remote Control**: run `claude` in the vault (in `tmux` on the always-on box) and use Remote Control from the Claude app; execution stays on your machine.
- **Telegram channel** (research preview, needs Bun):
  ```
  /plugin install telegram@claude-plugins-official
  /telegram:configure <bot token from BotFather>
  # restart:
  claude --channels plugin:telegram@claude-plugins-official
  /telegram:access pair <code>          # after DMing the bot
  /telegram:access policy allowlist     # lock it to you
  ```
- Keep the host reachable only over Tailscale. Never expose a gateway port.

## 5. Connectors and voice

Minimum useful set: Google Calendar and Gmail (read-only first) as claude.ai connectors or local MCP servers; `/morning-brief` uses whichever is present. For voice, Claude Code's `/voice` is dictation-only at the keyboard; for spoken replies or a headless box, add a local Whisper/Parakeet + Kokoro stack (for example the `voicemode` MCP server) or dictate into Telegram.

## 6. Conventions that prevent the most damage

1. `[[wikilinks]]` only, and never to a page that does not exist.
2. Search before creating.
3. Mark unknowns `TBD`; never invent facts, dates or relationships.
4. The owner's text in `Daily/` is never rewritten.
5. `raw/` is immutable; `Archive/` is off-limits; secrets never enter the vault.

## 7. Known limitations

- `.claude/` is a dot-folder, so Obsidian Sync skips it; use git (or Syncthing) to move it between machines.
- `.obsidian/workspace.json` is gitignored because it churns on every open.
- Hooks only see Edit/Write tool calls; a Bash redirect that writes a file bypasses the guard. The `rm` deny rule and git history cover that gap.
- `autoMemoryDirectory` needs an absolute path, which is why it lives in `settings.local.json` rather than the shared settings.
- Relative-path behaviour of `Edit(...)` rules depends on where `claude` is started; always start it at the vault root.
