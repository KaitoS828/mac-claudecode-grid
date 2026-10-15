const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CJK = /[぀-ヿ㐀-鿿]/;
const load = (lang) => {
  const g = { document: { documentElement: { dataset: { lang } }, addEventListener() {} }, MutationObserver: class { observe() {} } };
  g.window = g;
  new Function('window', 'document', 'MutationObserver', fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8'))(g, g.document, g.MutationObserver);
  return g.tr;
};

test('english mode translates every Japanese UI string in the pages', () => {
  const tr = load('en');
  const missing = [];
  for (const f of ['public/index.html', 'public/m.html']) {
    fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\n').forEach((l, i) => {
      if (!CJK.test(l) || /^\s*(\/\/|<!--)/.test(l)) return;
      for (const m of l.replace(/\$\{[^}]*\}/g, '\0').matchAll(/[^\0'"`<>]*[぀-ヿ一-鿿][^\0'"`<>]*/g)) {
        const s = m[0].replace(/\\n/g, '\n').trim();
        if (s && s !== '日本語' && CJK.test(tr(s))) missing.push(`${f}:${i + 1} ${s}`);
      }
    });
  }
  assert.deepStrictEqual(missing, []);
});

test('japanese mode leaves strings untouched', () => {
  assert.strictEqual(load('ja')('確認待ち'), '確認待ち');
});

test('translation keeps interpolated names and numbers', () => {
  assert.strictEqual(load('en')('「api」が待機状態になりました'), '"api" is now idle');
});
