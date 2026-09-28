/* tests/privacy.test.js — 公開してよいフォルダ（repo）に、個人の情報が入っていないか
 *   ../private/denylist.txt（公開しない）に書いた語を、repo の全ファイルから探す。
 *   CI（GitHub上）では private が無いので飛ばす。手元と commit 前（pre-commit フック）で効く。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./lib.js');
const REPO = path.join(__dirname, '..');
const DENY = path.join(REPO, '..', 'private', 'denylist.txt');

function denyWords() {
  if (!fs.existsSync(DENY)) return null;
  return fs.readFileSync(DENY, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.name === '.git' || e.name === 'node_modules') return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (!/\.(png|jpg|ico)$/i.test(e.name)) out.push(p);
  });
  return out;
}

test('repo の中に denylist の語が無い', () => {
  const words = denyWords();
  if (!words) return;
  const hits = [];
  walk(REPO, []).forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    words.forEach((w) => { if (s.includes(w)) hits.push(path.relative(REPO, f) + ' ← ' + w.slice(0, 2) + '…'); });
  });
  assert.deepEqual(hits, []);
});
