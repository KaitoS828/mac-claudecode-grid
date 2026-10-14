const { createHash } = require('crypto');

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
function hud(s) {
  const t = s.buf.slice(-6000).replace(ANSI, '');
  const last = (re) => { let m, r = null; const g = new RegExp(re, 'g'); while ((m = g.exec(t))) r = m; return r; };
  const h5 = last(/5h:\[[#\-]*\]\s*(\d+)%(?:\(([0-9dhms ]+)\))?/);
  const wk = last(/wk:\[[#\-]*\]\s*(\d+)%(?:\(([0-9dhms ]+)\))?/);
  const cx = last(/ctx:\[[#\-]*\]\s*(\d+)%/);
  const md = last(/Model:\s*([^|\n]+?)\s*(?:\||\n|$)/);
  return {
    h5: h5 && { pct: +h5[1], reset: h5[2] || '' },
    wk: wk && { pct: +wk[1], reset: wk[2] || '' },
    ctxPct: cx ? +cx[1] : null,
    model: md ? md[1] : null,
  };
}


function askInfo(s) {
  const b = s.screen.buffer.active;
  const lines = [];
  for (let i = b.baseY; i < b.baseY + s.screen.rows; i++) {
    const l = b.getLine(i);
    lines.push(l ? l.translateToString(true) : '');
  }
  const optRe = /^\s*[❯>]?\s*(\d+)\.\s+(.+)$/;
  let first = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (optRe.test(lines[i])) first = i;
    else if (first !== -1 && lines[i].trim() !== '') break;
    else if (first !== -1) break;
  }
  if (first === -1) return null;
  const options = [];
  let last = first;
  for (let i = first; i < lines.length; i++) {
    const m = lines[i].match(optRe);
    if (m) { options.push({ n: Number(m[1]), label: m[2].trim() }); last = i; }
    else if (lines[i].trim() === '') break;
    else if (options.length) options[options.length - 1].label += ` ${lines[i].trim()}`;
  }
  if (options.length < 2 || options[0].n !== 1) return null;
  if (!lines.slice(last + 1, last + 8).some((l) => /Esc to cancel|esc to/i.test(l))) return null;
  let start = first;
  let blank = 0;
  while (start > 0 && first - start < 14) {
    if (lines[start - 1].trim() === '') { if (++blank > 1) break; } else blank = 0;
    start--;
  }
  const question = lines.slice(start, first).join('\n').replace(/^\n+|\n+$/g, '').replace(/^[ \t]*[─━│┃╭╮╰╯┌┐└┘]+.*$/gm, '').trim();
  return { question, options, fp: createHash('sha1').update(question + JSON.stringify(options)).digest('hex').slice(0, 16) };
}

module.exports = { hud, askInfo };
