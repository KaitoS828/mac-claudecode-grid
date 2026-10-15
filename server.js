const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID, randomBytes, timingSafeEqual, createHash } = require('crypto');
const pty = require('node-pty');
const readline = require('readline');
const { execFile } = require('child_process');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.CC_GRID_PORT) || 3032;
const enc = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');
const ROOTS = (process.env.CC_GRID_ROOTS || path.join(os.homedir(), 'dev')).split(path.delimiter).filter(Boolean).map((r) => (r.startsWith('~') ? path.join(os.homedir(), r.slice(1)) : r));
const WORKTREES = process.env.CC_GRID_WORKTREES || path.join(os.homedir(), '.cc-grid', 'worktrees');
const REMOTE = process.env.CC_GRID_REMOTE === '1';
const BIND = process.env.CC_GRID_BIND || '0.0.0.0';
const AUDIT = path.join(__dirname, '.audit.log');
function audit(action, detail, req) {
  try {
    const who = req ? (req.socket.remoteAddress || '?') : 'server';
    if (fs.existsSync(AUDIT) && fs.statSync(AUDIT).size > 2 * 1024 * 1024) fs.renameSync(AUDIT, `${AUDIT}.1`);
    fs.appendFileSync(AUDIT, `${new Date().toISOString()} ${who} ${action} ${detail || ''}\n`, { mode: 0o600 });
  } catch {}
}
const MAX_BUF = 200000;
const sessions = new Map();
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const STORE = path.join(__dirname, 'sessions.json');
let seq = 0;

let restoring = false;
const BACKUP_DIR = path.join(__dirname, '.backup');

function save(reason = '') {
  if (restoring) return;
  const list = [...sessions.values()].filter((s) => !s.trash).map((s) => ({ id: s.id, name: s.name, cwd: s.cwd, sid: s.sid, worktree: s.worktree, check: s.check }));
  const text = JSON.stringify(list);
  let prev = '';
  try { prev = fs.readFileSync(STORE, 'utf8'); } catch {}
  if (prev === text) return;
  try {
    if (prev && prev !== '[]') {
      fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(BACKUP_DIR, `sessions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), prev, { mode: 0o600 });
      const olds = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('sessions-')).sort();
      for (const f of olds.slice(0, Math.max(0, olds.length - 30))) fs.rmSync(path.join(BACKUP_DIR, f));
    }
    const tmp = `${STORE}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, STORE);
  } catch (e) {
    audit('save-failed', String(e.message || e).slice(0, 120));
    return;
  }
  audit('save', `${reason} sessions=${list.length} (was ${prev ? (() => { try { return JSON.parse(prev).length; } catch { return '?'; } })() : 0})`);
}

function create({ cwd, name, cmd, id: fixedId, sid: oldSid, worktree, check }) {
  const id = fixedId || String(++seq);
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const term = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: dir, env: process.env,
  });
  const sid = oldSid || randomUUID();
  const s = { id, sid, name: name || (dir === os.homedir() ? '~' : path.basename(dir)), cwd: dir, term, buf: '', clients: new Set(), alive: true, busy: 0, lastData: Date.now(), worktree, check: check || '', wasBusy: false, anoms: [], samples: [], screen: new HeadlessTerminal({ cols: 100, rows: 30, scrollback: 200, allowProposedApi: true }) };
  term.onData((d) => {
    s.lastData = Date.now();
    if (/to interrupt/.test(d)) s.busy = Date.now();
    s.screen.write(d);
    s.buf = (s.buf + d).slice(-MAX_BUF);
    for (const ws of s.clients) ws.send(d);
  });
  term.onExit(() => {
    s.alive = false;
    for (const ws of s.clients) ws.send(`\r\n\x1b[90m[${settings.lang === 'en' ? 'process exited' : 'プロセス終了'}]\x1b[0m\r\n`);
  });
  sessions.set(id, s);
  save('create');
  setTimeout(() => s.alive && term.write((cmd || (oldSid ? `claude --resume ${sid} || claude --session-id ${sid}` : `claude --session-id ${sid}`)) + '\r'), 400);
  return s;
}

function findLog(s) {
  if (s.logPath && fs.existsSync(s.logPath)) return s.logPath;
  const guess = path.join(PROJECTS, s.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${s.sid}.jsonl`);
  if (fs.existsSync(guess)) return (s.logPath = guess);
  try {
    for (const d of fs.readdirSync(PROJECTS)) {
      const p = path.join(PROJECTS, d, `${s.sid}.jsonl`);
      if (fs.existsSync(p)) return (s.logPath = p);
    }
  } catch {}
  return null;
}

function tokens(s) {
  const p = findLog(s);
  if (!p) return { ctx: 0, out: 0, inp: 0 };
  const t = s.tok || (s.tok = { off: 0, byId: new Map(), last: null, tools: [], prompts: [], seen: new Set(), todos: null, asst: '', asstAt: 0, userAt: 0 });
  const size = fs.statSync(p).size;
  if (size > t.off) {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - t.off);
    fs.readSync(fd, buf, 0, buf.length, t.off);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const end = text.lastIndexOf('\n') + 1;
    t.off += Buffer.byteLength(text.slice(0, end));
    for (const line of text.slice(0, end).split('\n')) {
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        const m = j.message;
        if (m && m.usage && m.id) { t.byId.set(m.id, m.usage); t.last = m.id; }
        if (m && Array.isArray(m.content) && j.type === 'assistant') {
          for (const c of m.content) {
            if (c.type === 'text' && c.text && c.text.trim()) { t.asst = c.text.trim().slice(-600); t.asstAt = Date.parse(j.timestamp) || t.asstAt; }
            if (c.type === 'tool_use' && c.name === 'TodoWrite' && Array.isArray(c.input && c.input.todos)) t.todos = c.input.todos.map((x) => ({ text: String(x.content || '').slice(0, 160), status: x.status }));
            if (c.type === 'tool_use' && c.id && !t.seen.has(c.id)) {
              t.seen.add(c.id);
              t.tools.push(`${c.name}:${JSON.stringify(c.input).slice(0, 300)}`);
              if (t.tools.length > 12) t.tools.shift();
            }
          }
        }
        if (j.type === 'user' && !j.isMeta && j.uuid && !t.seen.has(j.uuid) && m) {
          t.seen.add(j.uuid);
          const txt = typeof m.content === 'string' ? m.content : Array.isArray(m.content) && m.content.every((c) => c.type === 'text') ? m.content.map((c) => c.text).join('') : '';
          if (txt.trim().length > 4) { t.userAt = Date.parse(j.timestamp) || t.userAt; t.prompts.push(txt.trim().slice(0, 200)); if (t.prompts.length > 8) t.prompts.shift(); }
        }
      } catch {}
    }
  }
  let out = 0, inp = 0;
  for (const u of t.byId.values()) {
    out += u.output_tokens || 0;
    inp += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  const l = t.byId.get(t.last) || {};
  const ctx = (l.input_tokens || 0) + (l.cache_creation_input_tokens || 0) + (l.cache_read_input_tokens || 0);
  return { ctx, out, inp };
}

const files = new Map();
const msgs = new Map();
let scanning = null;
const dayKey = (t) => new Date(t).toLocaleDateString('sv');

async function scanFile(p, st) {
  let off = files.get(p) || 0;
  if (st.size <= off) return;
  const fd = await fs.promises.open(p, 'r');
  try {
    const CH = 16 * 1024 * 1024;
    let carry = '';
    while (off < st.size) {
      const len = Math.min(CH, st.size - off);
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, off);
      off += len;
      const text = carry + buf.toString('utf8');
      const cut = text.lastIndexOf('\n');
      const body = cut === -1 ? '' : text.slice(0, cut);
      carry = cut === -1 ? text : text.slice(cut + 1);
      for (const line of body.split('\n')) {
        if (!line.includes('"usage"')) continue;
        try {
          const d = JSON.parse(line);
          const m = d.message;
          if (!m || !m.usage || !m.id || !d.timestamp) continue;
          const u = m.usage;
          msgs.set(m.id, {
            day: dayKey(d.timestamp),
            proj: path.basename(path.dirname(p)),
            inp: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
            out: u.output_tokens || 0,
            cr: u.cache_read_input_tokens || 0,
          });
        } catch {}
      }
      await new Promise((r) => setImmediate(r));
    }
    files.set(p, off - Buffer.byteLength(carry));
  } finally {
    await fd.close();
  }
}

async function scanAll() {
  if (scanning) return scanning;
  scanning = (async () => {
    const cutoff = Date.now() - 16 * 86400000;
    let dirs = [];
    try { dirs = fs.readdirSync(PROJECTS); } catch {}
    for (const d of dirs) {
      let list = [];
      try { list = fs.readdirSync(path.join(PROJECTS, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of list) {
        const p = path.join(PROJECTS, d, f);
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs >= cutoff) await scanFile(p, st);
        } catch {}
      }
    }
  })().finally(() => { scanning = null; });
  return scanning;
}

const projName = (d) => {
  for (const r of [...ROOTS, os.homedir()].sort((a, b) => b.length - a.length)) {
    const e = enc(r);
    if (d === e) return '~';
    if (d.startsWith(`${e}-`)) return d.slice(e.length + 1);
  }
  return d;
};

function usageSummary() {
  const days = [];
  for (let i = 13; i >= 0; i--) days.push({ date: dayKey(Date.now() - i * 86400000), inp: 0, out: 0, cr: 0 });
  const idx = new Map(days.map((d, i) => [d.date, i]));
  const weekStart = days[7].date;
  const proj = new Map();
  for (const r of msgs.values()) {
    const i = idx.get(r.day);
    if (i === undefined) continue;
    days[i].inp += r.inp; days[i].out += r.out; days[i].cr += r.cr;
    if (r.day >= weekStart) {
      const k = projName(r.proj);
      const p = proj.get(k) || { name: k, inp: 0, out: 0 };
      p.inp += r.inp; p.out += r.out;
      proj.set(k, p);
    }
  }
  const byProject = [...proj.values()].sort((a, b) => b.inp + b.out - (a.inp + a.out)).slice(0, 10);
  return { days, byProject, scanning: !!scanning };
}

const TODOS = path.join(__dirname, 'todos.json');
const readTodos = () => { try { return JSON.parse(fs.readFileSync(TODOS, 'utf8')); } catch { return []; } };
const writeTodos = (l) => {
  try { fs.copyFileSync(TODOS, `${TODOS}.bak`); } catch {}
  fs.writeFileSync(`${TODOS}.tmp`, JSON.stringify(l, null, 1), { mode: 0o600 });
  fs.renameSync(`${TODOS}.tmp`, TODOS);
};
const SETTINGS = path.join(__dirname, 'settings.json');
let settings = { autoSave: 0, lang: process.env.CC_GRID_LANG === 'ja' ? 'ja' : 'en' };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) }; } catch {}
const AUTO_PROMPTS = { en: 'Context is running low. So that work can resume after an interruption, update STATE.md (current status, next steps, open questions) and LOG.md (what was done, decisions made) at the project root and save them. Then wait without starting new work.', ja: 'コンテキストが残り少なくなっています。作業が途切れても再開できるよう、プロジェクト直下の STATE.md(現在地・次にやること・未解決)と LOG.md(今回やったこと・決めたこと)を更新して保存してください。保存したら、新しい作業は始めずに待機してください。' };
const SETS = path.join(__dirname, 'sets.json');
const readSets = () => { try { return JSON.parse(fs.readFileSync(SETS, 'utf8')); } catch { return []; } };
const writeSets = (l) => fs.writeFileSync(SETS, JSON.stringify(l, null, 1), { mode: 0o600 });

const { hud, askInfo } = require('./lib/parse');

function gitOut(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (err, out) => resolve(err ? null : out));
  });
}


function screenLines(s) {
  const b = s.screen.buffer.active;
  const out = [];
  for (let i = b.baseY; i < b.baseY + s.screen.rows; i++) {
    const l = b.getLine(i);
    out.push(l ? l.translateToString(true) : '');
  }
  return out;
}

function screenTail(s, n = 24) {
  const lines = screenLines(s);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-n).join('\n');
}

function sendText(s, text, enter) {
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  s.term.write(`\x1b[200~${text}\x1b[201~`);
  if (enter) setTimeout(() => s.alive && s.term.write('\r'), 250);
}

function lastAssistant(s) {
  const p = findLog(s);
  if (!p) return null;
  const size = fs.statSync(p).size;
  const len = Math.min(size, 4 * 1024 * 1024);
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    try {
      const j = JSON.parse(lines[i]);
      if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) continue;
      const text = j.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (text) return { text, at: j.timestamp };
    } catch {}
  }
  return null;
}

function runCheck(s, cmd) {
  if (s.checking) return;
  const c = cmd || s.check;
  if (!c) return;
  s.checking = true;
  const t0 = Date.now();
  execFile('/bin/zsh', ['-lc', c], { cwd: s.cwd, timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    const tail = `${stdout}${stderr}`.split('\n').slice(-80).join('\n');
    s.checkResult = { ok: !err, code: err ? (err.code ?? 'error') : 0, at: new Date().toISOString(), ms: Date.now() - t0, cmd: c, tail };
    s.checking = false;
  });
}

const SPIKE = { out: 150000, inp: 2000000, ms: 5 * 60 * 1000 };
const STALL_MS = 90 * 1000;

function tick() {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (!s.alive) continue;
    const busyNow = now - s.busy < 2500;
    if (busyNow) {
      if (!s.wasBusy) s.busySince = now;
      s.wasBusy = true;
    } else if (s.wasBusy && now - s.busy >= 4000) {
      s.wasBusy = false;
      s.lastDoneAt = now;
      if (s.check && now - s.busySince > 5000) runCheck(s);
    }
    if (!s.sampleAt || now - s.sampleAt >= 15000) {
      s.sampleAt = now;
      const t = tokens(s);
      s.samples.push({ t: now, out: t.out, inp: t.inp });
      while (s.samples.length && now - s.samples[0].t > 30 * 60 * 1000) s.samples.shift();
    }
    const anoms = [];
    const visible = screenLines(s).join('\n');
    if (/to interrupt/.test(visible) && now - s.lastData > STALL_MS) anoms.push('無反応');
    const base = s.samples.find((x) => now - x.t <= SPIKE.ms);
    const cur = s.samples[s.samples.length - 1];
    if (base && cur && (cur.out - base.out >= SPIKE.out || cur.inp - base.inp >= SPIKE.inp)) anoms.push('トークン急増');
    const t = s.tok;
    if (t) {
      const last5 = t.tools.slice(-5);
      if (last5.length === 5 && last5.every((x) => x === last5[0])) anoms.push('同じ操作を反復');
      const lp = t.prompts[t.prompts.length - 1];
      if (lp && t.prompts.slice(-6).filter((x) => x === lp).length >= 3) anoms.push('同じ指示を反復');
    }
    s.anoms = anoms;
    if (settings.autoSave && !busyNow && !s.wasBusy && s.cwd !== os.homedir()) {
      const c = hud(s).ctxPct;
      if (c != null && c < 50) s.autoSaved = 0;
      else if (c != null && c >= settings.autoSave && !s.autoSaved && !askInfo(s)) {
        s.autoSaved = now;
        s.autoSavedAt = now;
        s.autoSaveCtx = c;
        sendText(s, AUTO_PROMPTS[settings.lang] || AUTO_PROMPTS.en, true);
        audit('auto-save', `${s.id} ctx=${c}%`);
      }
    }
  }
}
setInterval(tick, 1000);

function slug(x) {
  return (x || 'work').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'work';
}

async function makeWorktree(cwd, name) {
  const root = (await gitOut(cwd, ['rev-parse', '--show-toplevel']))?.trim();
  if (!root) return { error: 'gitリポジトリではありません' };
  const sl = `${slug(name)}-${Date.now().toString(36).slice(-4)}`;
  const wt = path.join(WORKTREES, path.basename(root), sl);
  const branch = `grid/${sl}`;
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const ok = await new Promise((resolve) => {
    execFile('git', ['-C', root, 'worktree', 'add', '-b', branch, wt], { timeout: 60000 }, (err) => resolve(!err));
  });
  if (!ok) return { error: 'worktreeの作成に失敗しました' };
  let rel = path.relative(fs.realpathSync(root), fs.realpathSync(cwd));
  if (rel.startsWith('..')) rel = '';
  return { cwd: path.join(wt, rel), worktree: { path: wt, branch, repo: root } };
}

function listRepos() {
  const out = [];
  for (const r of ROOTS) {
    try {
      for (const e of fs.readdirSync(r, { withFileTypes: true })) {
        const p = path.join(r, e.name);
        if (e.isDirectory() && fs.existsSync(path.join(p, '.git'))) out.push(p);
      }
    } catch {}
  }
  return out;
}

function sessionCwd(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8', 0, n).match(/"cwd":"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

function textOf(j) {
  const m = j.message;
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (!Array.isArray(m.content)) return '';
  return m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

async function searchConv(q, limit) {
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const cutoff = Date.now() - 120 * 86400000;
  const files = [];
  try {
    for (const d of fs.readdirSync(PROJECTS)) {
      for (const f of fs.readdirSync(path.join(PROJECTS, d))) {
        if (!f.endsWith('.jsonl')) continue;
        const p = path.join(PROJECTS, d, f);
        try { const st = fs.statSync(p); if (st.mtimeMs >= cutoff) files.push({ p, d, mtime: st.mtimeMs }); } catch {}
      }
    }
  } catch {}
  files.sort((x, y) => y.mtime - x.mtime);
  const out = [];
  const t0 = Date.now();
  for (const f of files) {
    if (out.length >= limit || Date.now() - t0 > 20000) break;
    let perFile = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(f.p, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.length > 3e6 || !re.test(line)) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== 'user' && j.type !== 'assistant') continue;
      const text = textOf(j);
      const m = re.exec(text);
      if (!m) continue;
      const a0 = Math.max(0, m.index - 50);
      out.push({
        sid: path.basename(f.p, '.jsonl'), project: projName(f.d), cwd: j.cwd || sessionCwd(f.p), role: j.type,
        at: j.timestamp, mtime: f.mtime,
        snippet: `${a0 > 0 ? '…' : ''}${text.slice(a0, m.index + q.length + 90).replace(/\s+/g, ' ')}`,
      });
      if (++perFile >= 2 || out.length >= limit) break;
    }
    rl.close();
  }
  return out;
}

async function search(q) {
  const convOut = await searchConv(q, 60);
  const commits = [];
  await Promise.all(listRepos().map((repo) => new Promise((resolve) => {
    execFile('git', ['-C', repo, 'log', '-i', '--fixed-strings', `--grep=${q}`, '-n', '4', '--format=%h|%ad|%s', '--date=short'], { timeout: 15000 }, (err, out) => {
      for (const l of (out || '').split('\n')) {
        const [hash, date, ...rest] = l.split('|');
        if (hash) commits.push({ repo: path.basename(repo), hash, date, subject: rest.join('|') });
      }
      resolve();
    });
  })));
  commits.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { conv: convOut.slice(0, 60), commits: commits.slice(0, 40) };
}

const REMOTE_TOKEN = REMOTE ? randomBytes(24).toString('hex') : null;
const failures = new Map();

function cookieOf(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : '';
}

function tokenOk(given) {
  if (!REMOTE_TOKEN || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(REMOTE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isLoop = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const LOOP_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

const pub = (s) => {
  const info = askInfo(s);
  const shared = [...sessions.values()].filter((x) => x !== s && x.alive && x.cwd === s.cwd).length;
  return {
    id: s.id, name: s.name, cwd: s.cwd, alive: s.alive, busyAgoMs: Date.now() - s.busy,
    ask: !!info, askInfo: info, tok: tokens(s), hud: hud(s),
    worktree: s.worktree || null, shared: s.worktree ? 0 : shared,
    check: s.check || '', checkState: s.checking ? 'run' : s.checkResult ? (s.checkResult.ok ? 'ok' : 'ng') : '',
    anoms: s.anoms || [], busySince: s.wasBusy ? s.busySince : 0, lastDoneAt: s.lastDoneAt || 0,
    autoSavedAt: s.autoSavedAt || 0, autoSaveCtx: s.autoSaveCtx || 0,
  };
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(path.extname(file) === '.html' ? data.toString().replace(/__DEFAULT_LANG__/g, settings.lang) : data);
  });
}


function isPrivateIp(ip) {
  const a = (ip || '').replace(/^::ffff:/, '');
  if (a === '::1' || /^fe80:/i.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a)) return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254);
}

const SECRET_RES = [
  [/\b(sk-[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_\-]{30,})\b/g, '[REDACTED]'],
  [/\beyJ[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, '[REDACTED]'],
  [/((?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*["']?)[^\s"']{6,}/gi, '$1[REDACTED]'],
];
const redact = (t) => SECRET_RES.reduce((x, [re, to]) => x.replace(re, to), t || '');
const PERMANENT = /don'?t ask again|do not ask again|always allow|for this session|for all|never ask|常に|今後|毎回確認しない/i;

const pubRemote = (s) => {
  const info = askInfo(s);
  return {
    id: s.id, name: s.name, alive: s.alive, busyAgoMs: Date.now() - s.busy, ask: !!info, anoms: s.anoms || [],
    askInfo: info ? { question: redact(info.question), fp: info.fp, options: info.options.map((o) => ({ n: o.n, label: redact(o.label), locked: PERMANENT.test(o.label) })) } : null,
  };
};

const readBody = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
});
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMOTE_OK = [
  ['GET', /^\/m$/], ['GET', /^\/api\/sessions$/], ['GET', /^\/api\/sessions\/\d+\/screen$/], ['POST', /^\/api\/sessions\/\d+\/key$/],
];

function guard(req, res, url) {
  const host = req.headers.host || '';
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && !['same-origin', 'none'].includes(sfs) && url.pathname !== '/m') { res.writeHead(403); res.end(); return null; }
  const origin = req.headers.origin;
  let sameOrigin = true;
  if (origin) { try { sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; } }
  if (isLoop(req)) {
    if (!LOOP_HOST.test(host) || !sameOrigin) { res.writeHead(403); res.end(); return null; }
    return { local: true };
  }
  const ip = req.socket.remoteAddress;
  const f = failures.get(ip);
  if (!REMOTE || !isPrivateIp(ip) || (f && f.n >= 8 && Date.now() - f.t < 15 * 60 * 1000)) {
    if (REMOTE) audit('remote-blocked', `${isPrivateIp(ip) ? 'locked-out' : 'public-ip'} ${url.pathname}`, req);
    res.writeHead(403); res.end(); return null;
  }
  const q = url.searchParams.get('t');
  if (q && tokenOk(q)) {
    res.writeHead(302, { 'Set-Cookie': `gt=${q}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, Location: '/m', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    audit('remote-login', 'ok', req);
    res.end();
    return null;
  }
  if (!tokenOk(cookieOf(req, 'gt'))) {
    failures.set(ip, { n: (f ? f.n : 0) + 1, t: Date.now() });
    audit('remote-auth-fail', url.pathname, req);
    res.writeHead(401); res.end(); return null;
  }
  if (!sameOrigin || !REMOTE_OK.some(([m, re]) => m === req.method && re.test(url.pathname))) { res.writeHead(403); res.end(); return null; }
  return { local: false };
}

const server = http.createServer({ maxHeaderSize: 262144 }, async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:3032 ws://localhost:3032; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const g = guard(req, res, url);
  if (!g) return;
  const P = url.pathname;
  const M = req.method;
  const remote = !g.local;

  if (P === '/m' && M === 'GET') return serveFile(res, path.join(__dirname, 'public', 'm.html'));
  if (P === '/api/tasks' && M === 'GET') {
    return json(res, [...sessions.values()].filter((x) => !x.trash).map((s) => {
      tokens(s);
      const t = s.tok || {};
      const info = askInfo(s);
      return {
        id: s.id, name: s.name, cwd: s.cwd, alive: s.alive, busy: Date.now() - s.busy < 2500, ask: info ? ((info.question.split('\n').map((l) => l.trim()).filter((l) => /[?？]$/.test(l)).pop()) || info.question.split('\n').map((l) => l.trim()).filter((l) => l && !/^□/.test(l)).pop() || '').slice(0, 120) : '', options: info ? info.options.map((o) => o.title.slice(0, 60)) : [],
        todos: t.todos || [], lastPrompt: (t.prompts || []).slice(-1)[0] || '', lastReply: t.asst || '', screenTail: t.asst ? '' : screenLines(s).filter((l) => l.trim() && !/auto mode|shortcuts|OMC|ctx:|5h:|Esc to cancel|Enter to select|^[\s─━═]+$/.test(l)).slice(-5).join('\n'),
        userAt: t.userAt || 0, replyAt: t.asstAt || 0, anoms: s.anoms || [],
        check: s.checkResult ? { ok: s.checkResult.ok } : null, lastDoneAt: s.lastDoneAt || 0,
      };
    }));
  }
  if (P === '/api/sessions' && M === 'GET') return json(res, [...sessions.values()].filter((x) => !x.trash).map(remote ? pubRemote : pub));

  if (P === '/api/sessions' && M === 'POST') {
    const b = await readBody(req);
    const spec = { cwd: typeof b.cwd === 'string' ? b.cwd.trim() : '', name: typeof b.name === 'string' ? b.name.slice(0, 80) : '' };
    if (spec.cwd && (!path.isAbsolute(spec.cwd) || !fs.existsSync(spec.cwd) || !fs.statSync(spec.cwd).isDirectory())) return json(res, { error: 'フォルダが見つかりません (絶対パスで指定してください)' }, 400);
    if (b.sid && UUID.test(b.sid)) spec.sid = b.sid;
    if (typeof b.check === 'string') spec.check = b.check.slice(0, 500);
    if (b.worktree) {
      const base = spec.cwd && fs.existsSync(spec.cwd) ? spec.cwd : os.homedir();
      const w = await makeWorktree(base, spec.name || path.basename(base));
      if (w.error) return json(res, { error: w.error }, 400);
      spec.cwd = w.cwd;
      spec.worktree = w.worktree;
      if (!spec.name) spec.name = `${path.basename(w.worktree.repo)} (${w.worktree.branch.replace('grid/', '')})`;
    }
    const created = create(spec);
    audit('create', `${created.id} ${created.cwd}${spec.worktree ? ' worktree' : ''}${spec.sid ? ' resume' : ''}`, req);
    return json(res, pub(created));
  }

  if (P === '/api/upload' && M === 'POST') {
    const dir = path.join(os.tmpdir(), 'cc-grid-uploads');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const base = path.basename(url.searchParams.get('name') || 'file').replace(/[^\w.\-]/g, '_').slice(-80) || 'file';
    const dest = path.join(dir, `${Date.now()}-${base}`);
    const out = fs.createWriteStream(dest, { mode: 0o600 });
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 50 * 1024 * 1024) { req.destroy(); out.destroy(); fs.rm(dest, () => {}); }
    });
    req.pipe(out);
    out.on('finish', () => json(res, { path: dest }));
    out.on('error', () => { res.writeHead(500); res.end(); });
    return;
  }

  if (P === '/api/settings') {
    if (M === 'GET') return json(res, settings);
    if (M === 'POST') {
      const b = await readBody(req);
      if ([0, 70, 80, 90].includes(b.autoSave)) settings.autoSave = b.autoSave;
      if (['en', 'ja'].includes(b.lang)) settings.lang = b.lang;
      fs.writeFileSync(SETTINGS, JSON.stringify(settings), { mode: 0o600 });
      audit('settings', `autoSave=${settings.autoSave} lang=${settings.lang}`);
      return json(res, settings);
    }
  }
  if (P === '/api/today' && M === 'GET') {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const start = d0.getTime();
    const days = new Set([new Date(start).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)]);
    const out = [];
    for (const s of sessions.values()) {
      if (s.trash) continue;
      const p = findLog(s);
      const r = { id: s.id, name: s.name, prompts: [], turns: 0, first: 0, last: 0 };
      if (p) {
        const ids = new Set();
        const rl = require('readline').createInterface({ input: fs.createReadStream(p, { encoding: 'utf8' }), crlfDelay: Infinity });
        for await (const line of rl) {
          const i = line.indexOf('"timestamp":"');
          if (i === -1 || !days.has(line.slice(i + 13, i + 23))) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          const at = Date.parse(j.timestamp);
          if (!(at >= start)) continue;
          const m = j.message;
          if (!m) continue;
          if (j.type === 'assistant' && m.id) ids.add(m.id);
          if (j.type === 'user' && !j.isMeta) {
            const txt = typeof m.content === 'string' ? m.content : Array.isArray(m.content) && m.content.every((c) => c.type === 'text') ? m.content.map((c) => c.text).join('') : '';
            if (txt.trim().length > 4 && !/^<(command|local-command|system)/.test(txt.trim())) r.prompts.push({ at, text: txt.trim().slice(0, 120) });
          }
          if (!r.first || at < r.first) r.first = at;
          if (at > r.last) r.last = at;
        }
        r.turns = ids.size;
      }
      if (r.prompts.length || r.turns) out.push(r);
    }
    out.sort((a, b) => b.last - a.last);
    return json(res, { start, panels: out, done: readTodos().filter((t) => t.done && t.doneAt >= start) });
  }
  if (P === '/api/todos' && M === 'GET') return json(res, readTodos());
  if (P === '/api/todos' && M === 'POST') {
    const b = await readBody(req);
    const text = String(b.text || '').trim().slice(0, 300);
    if (!text) { res.writeHead(400); return res.end(); }
    const l = readTodos();
    if (l.length >= 500) { res.writeHead(400); return res.end(); }
    const t = { id: randomBytes(6).toString('hex'), text, panel: String(b.panel || '').slice(0, 60), done: false, created: Date.now(), doneAt: 0 };
    writeTodos([...l, t]);
    audit('todo-add', t.id);
    return json(res, t, 201);
  }
  const tm = P.match(/^\/api\/todos\/([0-9a-f]{12})$/);
  if (tm) {
    const l = readTodos();
    const t = l.find((x) => x.id === tm[1]);
    if (!t) { res.writeHead(404); return res.end(); }
    if (M === 'DELETE') { writeTodos(l.filter((x) => x !== t)); audit('todo-delete', t.id); res.writeHead(204); return res.end(); }
    if (M === 'POST') {
      const b = await readBody(req);
      if (typeof b.done === 'boolean') { t.done = b.done; t.doneAt = b.done ? Date.now() : 0; }
      if (typeof b.text === 'string' && b.text.trim()) t.text = b.text.trim().slice(0, 300);
      writeTodos(l);
      return json(res, t);
    }
  }
  if (P === '/api/sets') {
    if (M === 'GET') return json(res, readSets().map((x) => ({ name: x.name, count: x.panels.length, saved: x.saved })));
    if (M === 'DELETE') {
      writeSets(readSets().filter((x) => x.name !== url.searchParams.get('name')));
      res.writeHead(204); return res.end();
    }
    if (M === 'POST') {
      const { name, themes = {} } = await readBody(req);
      if (!name) { res.writeHead(400); return res.end(); }
      const panels = [...sessions.values()].map((x) => ({ name: x.name, cwd: x.cwd, sid: x.sid, theme: themes[x.id] || '', worktree: x.worktree, check: x.check }));
      writeSets([...readSets().filter((x) => x.name !== name), { name, saved: new Date().toISOString(), panels }]);
      res.writeHead(204); return res.end();
    }
  }
  if (P === '/api/sets/restore' && M === 'POST') {
    const { name } = await readBody(req);
    const set = readSets().find((x) => x.name === name);
    const running = new Set([...sessions.values()].map((x) => x.sid));
    const created = [];
    let skipped = 0;
    for (const p of set ? set.panels : []) {
      if (running.has(p.sid)) { skipped++; continue; }
      const s = create({ cwd: p.cwd, name: p.name, sid: p.sid, worktree: p.worktree, check: p.check });
      created.push({ ...pub(s), theme: p.theme });
    }
    return json(res, { created, skipped });
  }

  if (P === '/api/usage') {
    const wait = url.searchParams.get('wait') === '1';
    const p = scanAll();
    if (wait) await p;
    return json(res, usageSummary());
  }

  if (P === '/api/search' && M === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return json(res, { conv: [], commits: [] });
    return json(res, await search(q));
  }

  if (P === '/api/dirs') {
    const dirs = [os.homedir()];
    for (const r of ROOTS) {
      try {
        for (const e of fs.readdirSync(r, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) dirs.push(path.join(r, e.name));
      } catch {}
    }
    return json(res, dirs);
  }

  const sm = P.match(/^\/api\/sessions\/(\d+)(?:\/(\w+))?$/);
  if (sm) {
    const s = sessions.get(sm[1]);
    const act = sm[2];
    if (!s) { res.writeHead(404); return res.end(); }

    if (!act && M === 'PATCH') {
      const b = await readBody(req);
      if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim().slice(0, 80);
      if (typeof b.check === 'string') { s.check = b.check.slice(0, 500); audit('check-set', `${s.id} ${s.check}`, req); }
      save('patch');
      res.writeHead(204); return res.end();
    }
    if (!act && M === 'DELETE') {
      audit('delete', `${s.id} ${s.cwd} (undo within 15s)`, req);
      if (!s.trash) {
        s.trash = Date.now();
        s.trashTimer = setTimeout(() => {
          try { s.term.kill(); } catch {}
          sessions.delete(s.id);
          audit('purge', `${s.id} ${s.cwd}`);
        }, 15000);
        save('delete');
      }
      res.writeHead(204); return res.end();
    }
    if (act === 'undo' && M === 'POST') {
      if (!s.trash) return json(res, { error: '元に戻せません' }, 409);
      clearTimeout(s.trashTimer);
      delete s.trash;
      delete s.trashTimer;
      audit('undo', `${s.id} ${s.cwd}`, req);
      save('undo');
      for (const ws of s.clients) { try { ws.close(); } catch {} }
      return json(res, pub(s));
    }
    if (act === 'diff') {
      const root = await gitOut(s.cwd, ['rev-parse', '--show-toplevel']);
      if (!root) return json(res, { repo: false });
      const [status, stat, diff] = await Promise.all([
        gitOut(s.cwd, ['status', '--short']),
        gitOut(s.cwd, ['diff', '--stat', 'HEAD']),
        gitOut(s.cwd, ['diff', 'HEAD', '--no-color']),
      ]);
      return json(res, { repo: true, root: root.trim(), status: status || '', stat: stat || '', diff: (diff || '').slice(0, 300000), truncated: (diff || '').length > 300000 });
    }
    if (act === 'last' && M === 'GET') return json(res, lastAssistant(s) || { text: '' });
    if (act === 'screen' && M === 'GET') return json(res, { text: remote ? redact(screenTail(s, 30)) : screenTail(s, 30) });
    if (act === 'key' && M === 'POST') {
      const { key, fp } = await readBody(req);
      const info = s.alive ? askInfo(s) : null;
      if (!info) return json(res, { ok: false, reason: '確認待ちではありません' }, 409);
      if (typeof fp !== 'string' || fp !== info.fp) return json(res, { ok: false, reason: '画面が更新されました。もう一度確認してください' }, 409);
      if (key === 'esc') { audit('key', `${s.id} esc ${remote ? 'remote' : 'local'}`, req); s.term.write('\x1b'); return json(res, { ok: true }); }
      const opt = /^[1-9]$/.test(key) ? info.options.find((o) => o.n === Number(key)) : null;
      if (!opt) return json(res, { ok: false }, 400);
      if (remote && PERMANENT.test(opt.label)) return json(res, { ok: false, reason: 'この選択肢(以後は確認しない系)は、スマホからは押せません' }, 403);
      audit('key', `${s.id} ${key} "${opt.label.slice(0, 60)}" ${remote ? 'remote' : 'local'}`, req);
      s.term.write(key);
      return json(res, { ok: true });
    }
    if (act === 'send' && M === 'POST') {
      const { text, enter } = await readBody(req);
      if (!s.alive || typeof text !== 'string' || !text) return json(res, { ok: false }, 400);
      sendText(s, text.slice(0, 200000), !!enter);
      return json(res, { ok: true });
    }
    if (act === 'check') {
      if (M === 'POST') {
        const b = await readBody(req);
        if (typeof b.cmd === 'string') { s.check = b.cmd.slice(0, 500); save('check'); audit('check-set', `${s.id} ${s.check}`, req); }
        if (b.run) { audit('check-run', `${s.id} ${s.check}`, req); runCheck(s); }
      }
      return json(res, { cmd: s.check, running: !!s.checking, result: s.checkResult || null });
    }
  }

  const within = (root, rel) => { const f = path.resolve(root, `.${rel.startsWith('/') ? '' : '/'}${rel}`); return f.startsWith(root + path.sep) ? f : null; };
  let file = null;
  if (P.startsWith('/vendor/xterm/')) file = within(path.join(__dirname, 'node_modules/@xterm/xterm'), P.slice(14));
  else if (P.startsWith('/vendor/fit/')) file = within(path.join(__dirname, 'node_modules/@xterm/addon-fit'), P.slice(12));
  else if (P !== '/m.html') file = within(path.join(__dirname, 'public'), P === '/' ? 'index.html' : P);
  if (!file) { res.writeHead(404); return res.end(); }
  serveFile(res, file);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host || '';
  let ok = isLoop(req) && LOOP_HOST.test(host) && new URL(req.url, 'http://x').pathname === '/ws';
  if (ok && req.headers.origin) { try { ok = new URL(req.headers.origin).host === host; } catch { ok = false; } }
  if (!ok) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  const s = sessions.get(new URL(req.url, 'http://x').searchParams.get('id'));
  if (!s) return ws.close();
  s.clients.add(ws);
  ws.send(s.buf);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!s.alive) return;
    if (msg.type === 'input' && typeof msg.data === 'string') s.term.write(msg.data);
    else if (msg.type === 'resize') {
      const cols = Math.max(2, msg.cols | 0), rows = Math.max(2, msg.rows | 0);
      s.term.resize(cols, rows);
      s.screen.resize(cols, rows);
    }
  });
  ws.on('close', () => s.clients.delete(ws));
});

if (fs.existsSync(STORE)) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) {
    audit('store-corrupt', String(e.message || e).slice(0, 100));
    try { fs.renameSync(STORE, `${STORE}.corrupt-${Date.now()}`); } catch {}
  }
  audit('startup', `stored=${list.length}`);
  restoring = true;
  for (const r of list) {
    seq = Math.max(seq, Number(r.id));
    try { create(r); } catch (e) { audit('restore-failed', `${r.id} ${String(e.message || e).slice(0, 100)}`); }
  }
  restoring = false;
}

scanAll();

server.listen(PORT, REMOTE ? BIND : '127.0.0.1', () => {
  console.log(`cc-grid: http://127.0.0.1:${PORT}`);
  if (REMOTE) {
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`remote (for phones; changes on every launch): http://${a.address}:${PORT}/m?t=${REMOTE_TOKEN}`);
  }
});
