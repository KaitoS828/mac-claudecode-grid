# mac-claudecode-grid

> **Unofficial.** CC Grid is an independent community project. It is not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic. Provided as-is, use at your own risk.

A browser dashboard that runs multiple [Claude Code](https://claude.com/claude-code) sessions side by side in a grid, with live status, token usage, history search and a phone-friendly remote view.

> The UI is currently in Japanese.

## Features

- Run several `claude` sessions in one browser tab (each is a real PTY via `node-pty` + xterm.js)
- Sessions persist across restarts and resume with `claude --resume`
- Optional git worktree per session
- Token usage and activity summary read from `~/.claude/projects`
- Search past conversations and commits
- Remote mode for monitoring and answering prompts from a phone on your LAN

## Requirements

- Node.js 18+
- [Claude Code](https://claude.com/claude-code) installed and on your `PATH`
- macOS or Linux

## Quick start

```bash
git clone https://github.com/jsbbshsahs-beep/mac-claudecode-grid.git
cd mac-claudecode-grid
npm install
npm start
```

Open http://127.0.0.1:3032.

## Configuration

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `CC_GRID_PORT` | `3032` | HTTP port |
| `CC_GRID_ROOTS` | `~/dev` | Directories whose sub-folders are offered as project choices (separate several with `:`) |
| `CC_GRID_WORKTREES` | `~/.cc-grid/worktrees` | Where git worktrees are created |
| `CC_GRID_REMOTE` | unset | Set to `1` to enable remote (LAN) mode |
| `CC_GRID_BIND` | `0.0.0.0` | Bind address in remote mode |

## Remote mode

```bash
npm run start:remote
```

A URL with a one-time token is printed at startup. **Read [SECURITY.md](SECURITY.md) first**: the server gives shell access to whoever holds the token.

## Known limitations

CC Grid detects "waiting for input" and permission prompts by reading the terminal text that Claude Code prints (e.g. `to interrupt`, numbered option lists with `Esc to cancel`, and the status line). A Claude Code update that changes this wording can break detection. The parsers live in [`lib/parse.js`](lib/parse.js) and are covered by `npm test`.

## License

[MIT](LICENSE)
