/* tools/privacy-scan.js — commit の直前に、公開してはいけない語が入っていないかを調べる
 *   .git/hooks/pre-commit から呼ばれる。../private/denylist.txt が無ければ何もしない。
 *   見つかったら commit を止める（終了コード 1）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const DENY = path.join(REPO, '..', 'private', 'denylist.txt');
if (!fs.existsSync(DENY)) process.exit(0);
const words = fs.readFileSync(DENY, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
const hits = [];
for (const f of staged) {
  if (/\.(png|jpg|ico)$/i.test(f)) continue;
  let s;
  try { s = git(['show', ':' + f]); } catch (e) { continue; }
  for (const w of words) if (s.includes(w)) hits.push(f + '（' + w.slice(0, 2) + '…）');
}
if (hits.length) {
  console.error('公開してはいけない語が見つかったので commit を止めました：\n  ' + hits.join('\n  '));
  process.exit(1);
}
