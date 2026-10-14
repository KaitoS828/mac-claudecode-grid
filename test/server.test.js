const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 3098;
let proc;
let dir;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-grid-test-'));
  const root = path.join(__dirname, '..');
  proc = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: dir,
    env: { ...process.env, CC_GRID_PORT: String(PORT), HOME: dir, CC_GRID_ROOTS: dir },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('serves the UI and the SVG logo', async () => {
  const page = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.strictEqual(page.status, 200);
  const logo = await fetch(`http://127.0.0.1:${PORT}/logo.svg`);
  assert.strictEqual(logo.headers.get('content-type'), 'image/svg+xml');
});

test('lists project directories under CC_GRID_ROOTS', async () => {
  fs.mkdirSync(path.join(dir, 'proj-a'));
  const dirs = await (await fetch(`http://127.0.0.1:${PORT}/api/dirs`)).json();
  assert.ok(dirs.includes(path.join(dir, 'proj-a')));
});
