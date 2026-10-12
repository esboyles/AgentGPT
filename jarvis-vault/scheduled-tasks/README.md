# Claude Desktop scheduled tasks

Alternative to cron/launchd when you run Claude Desktop (Cowork) on the machine that holds the vault. Desktop tasks run with local file access while the app is open and the machine is awake.

Copy each folder here to `~/.claude/scheduled-tasks/<name>/` and set the schedule, folder (this vault) and model in the app's Edit form (the file holds only `name`, `description` and the prompt). Presets: Hourly, Daily, Weekdays, Weekly.

Known issue at time of writing: Desktop tasks may re-prompt for folder and connector permissions on every run (anthropics/claude-code issue 47180). If that bites, use `scripts/run-skill.sh` with cron or launchd instead.
