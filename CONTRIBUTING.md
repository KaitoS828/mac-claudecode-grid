# Contributing

Issues and pull requests are welcome.

## Set up

1. Fork and clone the repository, then `npm install`.
2. `npm start` and open http://127.0.0.1:3032.
3. `npm test` runs the parser and server tests (`node --test`).

## Where things are

| Path | What |
| --- | --- |
| `server.js` | HTTP, WebSocket, PTY sessions, usage scan, search, remote guard |
| `lib/parse.js` | Reads the terminal screen: status line, usage bars, permission prompts |
| `public/index.html` | The grid UI |
| `public/m.html` | The phone approval page |
| `test/` | `parse.test.js` for the screen parsers, `server.test.js` for the server |
| `docs/reference.md` | Configuration, HTTP API, files on disk |

## Guidelines

- Keep changes small and focused. Describe how you verified them in the PR.
- If you change how prompts or the status line are detected, add or update a case in `test/parse.test.js`. This is the part most likely to break when Claude Code changes its wording.
- Anything that widens what remote mode can do needs a reason in the PR. Read [SECURITY.md](SECURITY.md) first.
- If you change an environment variable or an API route, update the README and `docs/reference.md` too.
- Do not commit `sessions.json`, `sets.json`, `.audit.log` or `.remote-token`. They are in `.gitignore`.

## Commit messages

Use a prefix: `feat` / `fix` / `docs` / `refactor` / `chore`.

## Reporting a vulnerability

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
