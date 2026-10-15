<p align="center">
  <img src="public/logo.svg" width="72" height="72" alt="CC Grid logo">
</p>

<h1 align="center">mac-claudecode-grid</h1>

<p align="center">
  <b>Many Claude Code sessions&nbsp;&nbsp;|&nbsp;&nbsp;One browser tab&nbsp;&nbsp;|&nbsp;&nbsp;Approve from your phone</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jsbbshsahs-beep/mac-claudecode-grid?style=flat-square&labelColor=16181d&color=2ea44f" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-2ea44f?style=flat-square&labelColor=16181d" alt="Node.js 18 or newer">
  <img src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-2ea44f?style=flat-square&labelColor=16181d" alt="macOS and Linux">
  <a href="https://github.com/jsbbshsahs-beep/mac-claudecode-grid/stargazers"><img src="https://img.shields.io/github/stars/jsbbshsahs-beep/mac-claudecode-grid?style=flat-square&logo=github&labelColor=16181d&color=2ea44f" alt="Stars"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#features">Features</a> · <a href="#usage">Usage</a> · <a href="#remote-mode-phone">Remote mode</a> · <a href="#faq">FAQ</a> · <a href="docs/reference.md">Reference</a> · <a href="README.ja.md">日本語</a>
</p>

> **Unofficial.** CC Grid is an independent community project. It is not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic. Provided as-is, use at your own risk.

CC Grid is a browser dashboard that runs several [Claude Code](https://claude.com/claude-code) sessions side by side in a grid. You see at a glance which session is working, which one is waiting for you, and how many tokens each has used. When a session stops to ask for permission, you can answer from your phone.

```bash
git clone https://github.com/jsbbshsahs-beep/mac-claudecode-grid.git
cd mac-claudecode-grid && npm install && npm start
# open http://127.0.0.1:3032
```

> The UI is currently in Japanese.

## Why not just open more terminal windows?

You can. It works until you run four sessions and one of them has been waiting for a "yes" for twenty minutes, or two of them edit the same file. CC Grid is built around those two problems.

| | Separate terminals | CC Grid |
| :--- | :--- | :--- |
| Which session needs me? | Click through every window | Waiting panels are highlighted |
| Two sessions in one folder | Nothing warns you | A badge warns you, and a worktree option avoids it |
| Token use per session | Run `/cost` in each one | Summed live from the conversation logs |
| Restart your machine | Re-open everything by hand | Layouts restore every session with `claude --resume` |
| Permission prompt while away | Wait until you are back | Answer from your phone on the LAN |
| "Where did I do that?" | Scroll back, or give up | Full-text search over past conversations and commits |

## Features

**Sessions**

- Run several `claude` sessions in one tab. Each panel is a real PTY (`node-pty`) rendered with xterm.js, so it behaves like a normal terminal.
- Sessions survive a server restart and resume with `claude --resume <session-id>`. A closed panel can be undone for 15 seconds.
- Start a session in any folder under your project roots, or give an absolute path.
- Optional **git worktree per session** (`git worktree add -b grid/...`) so parallel sessions never touch the same files.
- Drag panels to reorder them. Upload a file (up to 50 MB) and its path is handed to the session.

**Monitoring**

- Per-session status: working, idle, or waiting for your answer, read from the terminal text.
- Token usage (input, output, cache read) summed from the logs in `~/.claude/projects`.
- Status-line values (usage bars, context, model) shown next to the panel.
- Per-session **check command**: save a shell command such as `npm test`, run it from the panel, and see running / OK / NG.
- Git diff viewer for each session's folder.

**Tasks and hand-off**

- A **Tasks** view lists, per panel, why it is stuck (waiting for your answer, anomaly, check failed, working, or done), the pending question and options, remaining to-do items from Claude's own todo list, and the last prompt and reply.
- A personal **to-do list** in the same view, saved to `todos.json`.
- **Broadcast** the same instruction to several panels at once (panels that are waiting for an answer are skipped).
- **Auto-save** (off by default): when a panel's context passes 70 / 80 / 90 % and it is idle, it is asked to write `STATE.md` / `LOG.md` so work can resume later.
- **Today's work**: prompts and replies per panel for the day, read from the conversation logs. Uses no tokens.

**History and layouts**

- Full-text search over past conversations and `git log` messages in your project folders.
- Save the open panels as a named **layout** and restore it later. Sessions that are already running are skipped.

**Phone and LAN**

- Remote mode serves a small approval page at `/m`. Token-protected, private-IP only, with an audit log.

## Requirements

- Node.js 18 or later
- [Claude Code](https://claude.com/claude-code) installed and available as `claude` on your `PATH`
- macOS or Linux
- `git`, only for worktrees, the diff viewer and commit search

`node-pty` ships prebuilt binaries for common platforms. If none matches yours, `npm install` compiles it, which needs a C++ toolchain.

## Quick start

```bash
git clone https://github.com/jsbbshsahs-beep/mac-claudecode-grid.git
cd mac-claudecode-grid
npm install
npm start
```

Open http://127.0.0.1:3032. There is nothing else to set up.

<details>
<summary>Change the port or the project folders</summary>

```bash
CC_GRID_PORT=4000 CC_GRID_ROOTS="$HOME/work:$HOME/oss" npm start
```

All variables are in [Configuration](#configuration).

</details>

## Usage

1. **Add a session.** Pick a folder from the list (every sub-folder of your `CC_GRID_ROOTS`, plus your home directory), optionally name it, and tick the worktree option if you want an isolated branch.
2. **Work in the panel.** It is a normal terminal. CC Grid types `claude --session-id <uuid>` for you, or `claude --resume <uuid>` for a restored session.
3. **Watch the grid.** Panels that need an answer are highlighted. Token counts and the status line update live.
4. **Set a check command** on a panel (for example `npm test`) and run it whenever you want a quick pass or fail.
5. **Save a layout** before you shut down. Restore it later to bring every panel back with its original session.
6. **Search** past conversations and commits when you cannot remember where something was done.

Closing a panel moves it to the trash for 15 seconds, then kills the process. Undo within that window to bring it back.

## Remote mode (phone)

```bash
npm run start:remote
```

A URL with a one-time token is printed at startup. Open it on a phone on the same network. The token is kept in a cookie. Then open `/m` for the approval view.

| A remote client can | A remote client cannot |
| :--- | :--- |
| See sessions, their state and a redacted tail of the screen | Choose "don't ask again" style options (refused by the server) |
| Answer a pending numbered prompt, or press Esc | Connect from a public IP address |

Each answer is matched to a fingerprint of the prompt that was on screen. A stale tap on an old prompt is refused instead of answering a new one. Every action goes to `.audit.log`.

> **Read [SECURITY.md](SECURITY.md) before you turn this on.** The server gives shell access to whoever holds the token. If you need access from outside your LAN, use a VPN such as Tailscale. Never port-forward it.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CC_GRID_PORT` | `3032` | HTTP port |
| `CC_GRID_ROOTS` | `~/dev` | Directories whose sub-folders are offered as project choices (separate several with `:`) |
| `CC_GRID_WORKTREES` | `~/.cc-grid/worktrees` | Where git worktrees are created |
| `CC_GRID_REMOTE` | unset | Set to `1` to enable remote (LAN) mode |
| `CC_GRID_BIND` | `0.0.0.0` | Bind address in remote mode. Local mode always binds `127.0.0.1` |
| `CC_GRID_LANG` | `en` | Initial UI language (`en` or `ja`). Can also be changed in the settings menu |

## FAQ

<details>
<summary><b>Does it send my code or conversations anywhere?</b></summary>

No. CC Grid is a local Node.js server. It reads `~/.claude/projects` on your machine and talks to nothing else. Claude Code itself still talks to Anthropic as usual.

</details>

<details>
<summary><b>Do I need an API key?</b></summary>

No. CC Grid only starts the `claude` command you already have. It uses whatever login Claude Code uses.

</details>

<details>
<summary><b>Is it safe to leave running?</b></summary>

Local mode binds to `127.0.0.1` only, so only programs on your machine can reach it. Still, it gives shell access to anything that can connect, so do not put it behind a reverse proxy or port-forward. See [SECURITY.md](SECURITY.md).

</details>

<details>
<summary><b>Why did a panel close immediately, or show <code>posix_spawnp failed</code>?</b></summary>

The `node-pty` helper lost its execute bit. Run `npm install` again (the `postinstall` script restores it), or `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`.

</details>

<details>
<summary><b>Why is <code>claude: command not found</code> in a panel?</b></summary>

Each panel starts a login shell (`$SHELL -l`), so `claude` must be on the `PATH` your shell profile sets up, not only on the one in the terminal where you started CC Grid.

</details>

<details>
<summary><b>Panels never show "waiting for input".</b></summary>

Detection reads Claude Code's screen text, and a Claude Code update may have changed it. See [Known limitations](#known-limitations).

</details>

<details>
<summary><b>The phone cannot connect.</b></summary>

Start with `npm run start:remote`, make sure the phone is on the same network, and open the full URL with the token the first time. Public IP addresses are always refused.

</details>

<details>
<summary><b>Does it work on Windows?</b></summary>

Not supported. Panels run `$SHELL -l`, and the project is only tested on macOS and Linux.

</details>

## How it works

- **Server** (`server.js`): one Node.js process with plain `http` and `ws`. Each session is a login shell started with `node-pty`, which then runs `claude`.
- **Screen model**: an `@xterm/headless` terminal mirrors each PTY, so the server can read what is on screen with no browser attached.
- **State detection** (`lib/parse.js`): reads that screen to find the status line, usage bars and numbered permission prompts.
- **Token usage**: scans the JSONL conversation logs in `~/.claude/projects`.
- **UI** (`public/index.html`): plain JavaScript with xterm.js and its fit addon. `public/m.html` is the phone view.

The HTTP API and the files CC Grid writes to disk are listed in the [reference](docs/reference.md).

## Development

```bash
npm install
npm start          # http://127.0.0.1:3032
npm test           # node --test
```

Tests cover the screen parsers and basic server behavior. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Known limitations

CC Grid detects "waiting for input" and permission prompts by reading the terminal text that Claude Code prints (for example `to interrupt`, numbered option lists with `Esc to cancel`, and the status line). A Claude Code update that changes this wording can break detection. The parsers live in [`lib/parse.js`](lib/parse.js) and are covered by `npm test`.

Other limits:

- The UI is Japanese only.
- Windows is not supported.
- Local mode has no login. It relies on binding to loopback.

## Security

CC Grid exposes a shell. Local mode binds to `127.0.0.1` only. Remote mode adds a one-time token, a private-IP check, redaction and an audit log. Details and how to report a vulnerability are in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
