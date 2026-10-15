# Reference

Details that do not fit in the [README](../README.md).

## Contents

- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Files written to disk](#files-written-to-disk)
- [Remote mode behavior](#remote-mode-behavior)
- [Layouts](#layouts)
- [Check commands](#check-commands)
- [Worktrees](#worktrees)

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CC_GRID_PORT` | `3032` | HTTP port |
| `CC_GRID_ROOTS` | `~/dev` | Directories whose sub-folders are offered as project choices. Separate several with `:`. A leading `~` is expanded |
| `CC_GRID_WORKTREES` | `~/.cc-grid/worktrees` | Where git worktrees are created |
| `CC_GRID_REMOTE` | unset | Set to `1` to enable remote (LAN) mode. `npm run start:remote` does this |
| `CC_GRID_BIND` | `0.0.0.0` | Bind address in remote mode. Local mode always binds `127.0.0.1` |
| `CC_GRID_LANG` | `en` | Initial UI language (`en` or `ja`) |

Hidden folders (names starting with `.`) are not offered as project choices.

## HTTP API

The UI is a thin client over a small JSON API. It is **not a stable public API** and may change between versions. In remote mode every request needs the token cookie. `:id` is the numeric session id from `GET /api/sessions`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/sessions` | List live sessions with state, tokens, status line, worktree and check status |
| `POST /api/sessions` | Create a session. Body: `cwd` (absolute path), `name`, `worktree` (bool), `sid` (UUID, to resume), `check` |
| `PATCH /api/sessions/:id` | Rename a session or change its check command |
| `DELETE /api/sessions/:id` | Move to trash. The process is killed after 15 seconds |
| `POST /api/sessions/:id/undo` | Restore a trashed session within those 15 seconds |
| `GET /api/sessions/:id/diff` | `git status`, `diff --stat` and `diff HEAD` for the session's folder (diff capped at 300,000 characters) |
| `GET /api/sessions/:id/last` | Last assistant message |
| `GET /api/sessions/:id/screen` | Last 30 lines of the screen. Redacted in remote mode |
| `POST /api/sessions/:id/key` | Answer a pending prompt. Body: `key` (`1` to `9`, or `esc`) and `fp` (fingerprint from `askInfo`) |
| `POST /api/sessions/:id/send` | Type text into the session. Body: `text`, `enter` |
| `GET /api/sessions/:id/check` | Read the check command and its last result |
| `POST /api/sessions/:id/check` | Set (`cmd`) and/or run (`run: true`) the check command |
| `POST /api/upload?name=...` | Upload a file (max 50 MB). Returns `{ path }` |
| `GET /api/sets` | List saved layouts |
| `POST /api/sets` | Save the open panels as a layout. Body: `name`, `themes` |
| `DELETE /api/sets?name=...` | Delete a layout |
| `POST /api/sets/restore` | Restore a layout. Body: `name`. Returns `created` and `skipped` |
| `GET /api/tasks` | Per session: pending question and options, todo items, last prompt and reply. Local only |
| `GET /api/today` | Today's prompts and reply counts per session, plus to-dos completed today. Local only |
| `GET /api/todos` | List to-dos |
| `POST /api/todos` | Add a to-do. Body: `text`, `panel` |
| `POST /api/todos/:id` | Update a to-do. Body: `done` and/or `text` |
| `DELETE /api/todos/:id` | Delete a to-do |
| `GET /api/settings` | Read settings (`autoSave`, `lang`) |
| `POST /api/settings` | Change settings. Body: `autoSave` (`0`, `70`, `80`, `90`) and/or `lang` (`en`, `ja`) |
| `GET /api/usage` | Token usage summary (`?wait=1` waits for the log scan) |
| `GET /api/search?q=...` | Search conversations and commits. Needs 2 or more characters |
| `GET /api/dirs` | Project folders offered in the UI |
| `GET /m` | Phone approval page |
| `WS /ws?id=...` | Terminal stream for one session. Loopback only |

## Files written to disk

| File | What | Notes |
| --- | --- | --- |
| `sessions.json` | Sessions to bring back after a restart | |
| `sets.json` | Saved layouts | |
| `todos.json` | To-do list (`todos.json.bak` is the previous version) | |
| `settings.json` | Auto-save threshold and UI language | |
| `.audit.log` | Create, delete, undo, key, check actions | mode `0600` |
| `.remote-token` | Remote-mode token | mode `0600` |
| `.backup/` | Backups of the files above | |
| `~/.cc-grid/worktrees/` | Git worktrees created from the UI | Change with `CC_GRID_WORKTREES` |
| `$TMPDIR/cc-grid-uploads/` | Uploaded files | Directory mode `0700`, files `0600` |

All of the files inside the project folder are in `.gitignore`.

## Remote mode behavior

- Requests must carry the token cookie. Open the printed URL once to set it. Comparison is constant-time.
- Only loopback and private-network addresses are accepted. Public IPs are refused.
- `GET /api/sessions` returns a reduced view. The screen tail is passed through a redaction filter that masks common API key formats and `password`, `secret`, `token`, `authorization` assignments.
- `POST .../key` is accepted only while a numbered prompt is on screen, and only when `fp` matches that prompt.
- Options that mean "don't ask again", "always allow" or similar are refused from remote clients. Choose them at your computer.
- Every action is appended to `.audit.log` with a `remote` or `local` tag.

## Layouts

A layout stores each panel's name, folder, session id, worktree and check command. Restoring a layout starts `claude --resume <sid>` in each folder. If a session with the same id is already running, it is skipped, and the response reports how many were skipped.

## Check commands

A check command is a shell command saved on a panel. Running it executes `/bin/zsh -lc "<command>"` in the session's folder and reports running, OK (exit 0) or NG, with the last 80 lines of output. It is stopped after 3 minutes. The command is stored in `sessions.json` and in layouts, and is limited to 500 characters. `/bin/zsh` must exist, which is the case on macOS and most Linux setups with zsh installed.

## Worktrees

When you tick the worktree option, CC Grid runs `git worktree add -b grid/<name> <path>` from the repository root of the chosen folder and starts the session in the matching sub-folder of the new worktree. Worktrees are not removed when you close the panel. Remove them yourself with `git worktree remove`.
