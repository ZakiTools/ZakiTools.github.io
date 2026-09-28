/* tests/release.test.js — 公開する前の確認（版番号・ファイル・構文・凍結サンプル） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, assert, core } = require('./lib.js');
const D = core();
const DOCS = path.join(__dirname, '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

test('アプリの版（core.js）と Service Worker の版（sw.js）が一致', () => {
  const m = /const VERSION = '([^']+)'/.exec(read('sw.js'));
  assert.ok(m);
  assert.equal(m[1], D.APP_VERSION);
});
test('Service Worker が入れるファイルがすべて実在する', () => {
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(read('sw.js'));
  const list = m[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  assert.ok(list.includes('./') && list.includes('./index.html'));
  list.filter((u) => u !== './').forEach((u) => assert.ok(fs.existsSync(path.join(DOCS, u)), u + ' が無い'));
});
test('manifest が読めて、住所は相対・アイコンが実在する', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url.startsWith('./'));
  m.icons.forEach((i) => assert.ok(fs.existsSync(path.join(DOCS, i.src)), i.src));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});
test('JS の構文が正しい', () => {
  ['core.js', 'app.js', 'rescue.js', 'sw.js'].forEach((f) => { new vm.Script(read(f), { filename: f }); });
});
test('index.html は rescue → core → app の順に読み込む', () => {
  const s = read('index.html');
  const a = s.indexOf('src="rescue.js"'), b = s.indexOf('src="core.js"'), c = s.indexOf('src="app.js"');
  assert.ok(a > 0 && a < b && b < c);
});
test('凍結サンプル（fixtures）が今の版で読めて、中身が保たれる', () => {
  const dir = path.join(__dirname, 'fixtures');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 1);
  files.forEach((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const r = D.ingest(raw);
    assert.equal(r.ok, true, f);
    assert.equal(r.readOnly, false, f);
    const src = JSON.parse(raw);
    assert.equal(D.live(r.doc.items).length, src.items.filter((i) => !i.deletedAt).length, f);
    assert.equal(r.doc.docId, src.docId, f);
  });
});
