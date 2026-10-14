# Security

mac-claudecode-grid spawns login shells (`$SHELL -l`) and exposes them over HTTP/WebSocket. Anyone who can reach the server can run arbitrary commands as the user running it.

## Default (local) mode

- Binds to `127.0.0.1` only.
- Do not put it behind a reverse proxy or port-forward without adding your own authentication.

## Remote mode (`CC_GRID_REMOTE=1`)

- Intended for use from a phone on the same trusted LAN.
- A random one-time token is generated at each start and printed to the console. Requests without the token cookie are rejected, and requests from public IPs are blocked.
- Never expose this port to the internet. Use a VPN (e.g. Tailscale) if you need access from outside.
- Actions are recorded in `.audit.log` (permissions `0600`).

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
