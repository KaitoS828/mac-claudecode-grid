const test = require('node:test');
const assert = require('node:assert');
const { Terminal } = require('@xterm/headless');
const { hud, askInfo } = require('../lib/parse');

const screenWith = async (text) => {
  const screen = new Terminal({ cols: 100, rows: 30, allowProposedApi: true });
  await new Promise((r) => screen.write(text, r));
  return { screen };
};

test('hud reads usage bars, context and model', () => {
  const buf = '\x1b[32mModel: Opus | 5h:[###---] 42%(1h30m) | wk:[#-----] 7%(3d2h) | ctx:[##----] 18%\x1b[0m';
  assert.deepStrictEqual(hud({ buf }), {
    h5: { pct: 42, reset: '1h30m' },
    wk: { pct: 7, reset: '3d2h' },
    ctxPct: 18,
    model: 'Opus',
  });
});

test('hud returns empty values when no status line is present', () => {
  assert.deepStrictEqual(hud({ buf: 'plain output' }), { h5: null, wk: null, ctxPct: null, model: null });
});

test('askInfo detects a numbered permission prompt', async () => {
  const s = await screenWith('Do you want to proceed?\r\n\r\n ❯ 1. Yes\r\n   2. No\r\n\r\nEsc to cancel\r\n');
  const info = askInfo(s);
  assert.strictEqual(info.question, 'Do you want to proceed?');
  assert.deepStrictEqual(info.options, [{ n: 1, label: 'Yes', title: 'Yes' }, { n: 2, label: 'No', title: 'No' }]);
  assert.match(info.fp, /^[0-9a-f]{16}$/);
});

test('askInfo ignores a plain numbered list without a cancel hint', async () => {
  assert.strictEqual(askInfo(await screenWith('Steps:\r\n1. one\r\n2. two\r\n')), null);
});

test('askInfo handles descriptions and separators between options', async () => {
  const s = await screenWith('Which task?\r\n\r\n ❯ 1. Fix UI\r\n     details\r\n   2. Other\r\n   3. Type something.\r\n──────────\r\n   4. Chat about this\r\n\r\nEnter to select · Esc to cancel\r\n');
  const info = askInfo(s);
  assert.deepStrictEqual(info.options.map((o) => o.n), [1, 2, 3, 4]);
  assert.strictEqual(info.options[0].title, 'Fix UI');
});

test('askInfo does not treat a busy screen as a prompt', async () => {
  assert.strictEqual(askInfo(await screenWith('1. foo\r\n2. bar\r\nesc to interrupt\r\n')), null);
});
