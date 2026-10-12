---
name: push
description: Commit the vault and push it to the remote. Use when the owner says "push", "sync the vault" or "save to git".
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git add *) Bash(git commit *) Bash(git log *) Bash(git diff *)
---
# Push

1. `git status --porcelain`. If clean and nothing is ahead of upstream, say so and stop.
2. Stage everything except Obsidian workspace files (the `.gitignore` already excludes them) and commit with a message that lists the folders touched, for example `jarvis: update wiki (3), memory (1), Daily (2)`.
3. Show `git log --oneline @{u}..` so the owner sees what will be pushed.
4. Run `git push`. This is an "ask" permission on purpose; confirm with the owner when prompted.
5. If push is rejected (non-fast-forward), do not force. Run `git pull --rebase`, resolve conflicts by keeping both sides' content in the note, and push again.
