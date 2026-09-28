/* tests/security.test.js — 外から来た文字がプログラムとして動かない作りになっているか */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, assert } = require('./lib.js');
const DOCS = path.join(__dirname, '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

test('JS に innerHTML などの「文字をHTMLとして入れる」書き方が無い', () => {
  ['app.js', 'core.js', 'rescue.js', 'sw.js'].forEach((f) => {
    const s = read(f);
    ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function'].forEach((w) => {
      assert.ok(!s.includes(w), f + ' に ' + w);
    });
  });
});
test('index.html：CSP があり、インラインのスクリプトと on属性が無い', () => {
  const s = read('index.html');
  assert.ok(/http-equiv="Content-Security-Policy"/.test(s), 'CSP が無い');
  assert.ok(/script-src 'self'/.test(s));
  assert.ok(/object-src 'none'/.test(s));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(s), 'インラインの <script> がある');
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(s), 'onclick などの属性がある');
});
test('CSP の通信先は自分と Google Apps Script だけ', () => {
  const s = read('index.html');
  const m = /connect-src ([^;]+);/.exec(s);
  assert.ok(m);
  const allowed = m[1].trim().split(/\s+/);
  assert.deepEqual(allowed.sort(), ["'self'", 'https://script.google.com', 'https://script.googleusercontent.com'].sort());
});
test('別タブで開くリンクには rel="noopener noreferrer" を付ける', () => {
  const s = read('app.js');
  const opens = s.match(/target: '_blank'[^}]*/g) || [];
  opens.forEach((o) => assert.ok(/noopener/.test(o), o));
});
test('Service Worker は別の住所と GET 以外に関わらない／自分の箱だけ消す', () => {
  const s = read('sw.js');
  assert.ok(/req\.method !== 'GET'\) return/.test(s));
  assert.ok(/url\.origin !== self\.location\.origin\) return/.test(s));
  assert.ok(/k\.startsWith\('dwz-shell-'\)/.test(s));
  assert.ok(!/skipWaiting\(\)\s*;?\s*\n\s*event\.waitUntil|install[\s\S]{0,200}skipWaiting/.test(s), 'install で無条件に skipWaiting しない');
});
