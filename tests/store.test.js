/* tests/store.test.js — 端末内の保存（偽の localStorage で確かめる） */
'use strict';
const { test, assert, core, makeDoc, fakeStorage, sleep } = require('./lib.js');
const D = core();

test('保存が無ければ empty', () => {
  const st = D.createStore(fakeStorage());
  assert.equal(st.load().status, 'empty');
});
test('起動が終わる（ready）までは保存しない＝ただ開いただけで上書きしない', async () => {
  const fs = fakeStorage();
  const st = D.createStore(fs);
  const doc = makeDoc();
  assert.equal(st.schedule(doc), false);
  await sleep(450);
  assert.equal(fs.getItem(D.KEYS.data), null);
});
test('400ms まとめて保存し、flush で保留中を即書き出す', async () => {
  const fs = fakeStorage();
  let saves = 0;
  const st = D.createStore(fs, { onSaved: () => saves++ });
  st.setReady();
  const doc = makeDoc();
  st.schedule(doc); st.schedule(doc); st.schedule(doc);
  assert.equal(fs.getItem(D.KEYS.data), null);
  await sleep(450);
  assert.equal(saves, 1);
  st.schedule(doc);
  const r = st.flush();
  assert.equal(r.ok, true);
  assert.equal(saves, 2);
  assert.equal(st.flush(), null);   // 保留が無ければ何もしない
});
test('壊れたデータは退避して corrupt（退避は最大2件）', () => {
  const fs = fakeStorage();
  for (let i = 0; i < 4; i++) {
    fs.setItem(D.KEYS.data, '{broken' + i);
    assert.equal(D.createStore(fs).load().status, 'corrupt');
  }
  const stashed = D.createStore(fs).corruptCopies();
  assert.ok(stashed.length <= 2 && stashed.length >= 1, String(stashed.length));
});
test('新しい版のデータは読み取り専用で、保存しない', () => {
  const fs = fakeStorage();
  const doc = makeDoc();
  doc.minWriter = 99;
  fs.setItem(D.KEYS.data, JSON.stringify(doc));
  const st = D.createStore(fs);
  const r = st.load();
  assert.equal(r.status, 'newer');
  st.setReady();
  assert.equal(st.saveNow(r.doc).ok, false);
  assert.equal(JSON.parse(fs.getItem(D.KEYS.data)).minWriter, 99);
});
test('別の画面が保存していたら、上書きせず合体してから書く（saveSeq の照合）', () => {
  const fs = fakeStorage();
  const base = makeDoc();
  const x = D.newItem({ title: 'X' }), y = D.newItem({ title: 'Y' });
  base.items.push(x, y);
  fs.setItem(D.KEYS.data, D.serialize(base));
  const A = D.createStore(fs), B = D.createStore(fs);
  const docA = A.load().doc, docB = B.load().doc;
  A.setReady(); B.setReady();
  docB.items.find((i) => i.id === x.id).title = 'Bが直したX';
  D.touch(docB.items.find((i) => i.id === x.id));
  assert.equal(B.saveNow(docB).ok, true);
  docA.items.find((i) => i.id === y.id).title = 'Aが直したY';
  D.touch(docA.items.find((i) => i.id === y.id));
  let merged = false;
  const A2 = A;
  assert.equal(A2.saveNow(docA).ok, true);
  const stored = D.ingest(fs.getItem(D.KEYS.data)).doc;
  assert.equal(stored.items.find((i) => i.id === x.id).title, 'Bが直したX');
  assert.equal(stored.items.find((i) => i.id === y.id).title, 'Aが直したY');
  assert.equal(merged, false);
});
test('容量が足りない時は、1日の控えを削ってから保存する', () => {
  const doc = makeDoc();
  for (let i = 0; i < 30; i++) doc.items.push(D.newItem({ title: '経験' + i, note: 'x'.repeat(50) }));
  const size = D.serialize(doc).length;
  const fs = fakeStorage(size * 2 + 400);
  const st = D.createStore(fs);
  st.setReady();
  assert.equal(st.daily(doc, '2026-09-28'), true);
  assert.equal(st.saveNow(doc).ok, true);
  doc.items.push(D.newItem({ title: '追加', note: 'y'.repeat(size) }));
  const r = st.saveNow(doc);
  assert.equal(r.ok, true);
  assert.equal(fs.getItem(D.KEYS.daily), null);
});
test('1日の控えは1日1回だけ', () => {
  const fs = fakeStorage();
  const st = D.createStore(fs);
  st.setReady();
  const doc = makeDoc();
  assert.equal(st.daily(doc, '2026-09-28'), true);
  assert.equal(st.daily(doc, '2026-09-28'), false);
  assert.equal(st.daily(doc, '2026-09-29'), true);
});
test('書き出しに端末だけの情報（秘密キー）は入らない', () => {
  const fs = fakeStorage();
  const st = D.createStore(fs);
  const dev = st.readDevice();
  dev.sync = { url: 'https://script.google.com/macros/s/xxx/exec', key: 'SECRET-KEY-should-not-leak' };
  st.writeDevice(dev);
  const doc = makeDoc();
  const text = D.exportText(doc);
  assert.ok(!text.includes('SECRET-KEY-should-not-leak'));
  assert.ok(!D.serialize(doc).includes('SECRET-KEY'));
});
test('60年分の架空データでも十分に小さく・速い（老後の重さ）', () => {
  const doc = makeDoc();
  for (let i = 0; i < 800; i++) {
    doc.items.push(D.newItem({ title: '経験その' + i + '（いろいろな所へ行く・人と会う）', status: i % 3 ? 'placed' : 'done',
      when: { fromAge: 25 + (i % 60), toAge: 25 + (i % 60) }, dwz: { until: 'any', why: ['none'], memory: 'mid' }, cost: { once: 10000 * (i % 50) } }));
  }
  for (let i = 0; i < 1500; i++) doc.logs.push(D.newLog({ itemId: doc.items[i % 800].id, itemTitle: '経験その' + (i % 800), date: '2030-01-01', note: 'とても楽しかった。また行きたい。'.repeat(3) }));
  const t0 = Date.now();
  const text = D.serialize(doc);
  const back = D.ingest(text);
  const c = D.ctxOf(back.doc, '2026-09-28');
  D.dwzChecklist(back.doc, c); D.capacity(back.doc, c); D.costTable(back.doc, c);
  const ms = Date.now() - t0;
  const bytes = Buffer.byteLength(text, 'utf8');
  assert.ok(bytes < 1.5 * 1024 * 1024, 'bytes=' + bytes);
  assert.ok(text.length * 2 * 3 < 5 * 1024 * 1024 * 1.1, 'localStorage chars*2*3=' + text.length * 6);  // 本体＋控え2つでも収まる目安
  assert.ok(ms < 3000, 'ms=' + ms);
});

test('1日の控えは、起動が終わる前（壊れたデータ）や読み取り専用では上書きしない', () => {
  const fs = fakeStorage();
  const good = makeDoc();
  for (let i = 0; i < 5; i++) good.items.push(D.newItem({ title: 'x' + i }));
  const st = D.createStore(fs); st.setReady();
  st.daily(good, '2026-09-27');
  fs.setItem(D.KEYS.data, '{broken');
  const st2 = D.createStore(fs);
  assert.equal(st2.load().status, 'corrupt');
  assert.equal(st2.daily(makeDoc(), '2026-09-29'), false);
  assert.equal(D.live(st2.readDaily().result.doc.items).length, 5);
  const ro = makeDoc(); ro.minWriter = 99;
  fs.setItem(D.KEYS.data, JSON.stringify(ro));
  const st3 = D.createStore(fs); st3.load(); st3.setReady();
  assert.equal(st3.daily(ro, '2026-09-30'), false);
});
test('読み取り専用の時、直前の控えには生の文字をそのまま残す', () => {
  const fs = fakeStorage();
  const ro = makeDoc(); ro.minWriter = 99; ro.items.push(Object.assign(D.newItem({ title: 't' }), { status: 'someday' }));
  const raw = JSON.stringify(ro);
  fs.setItem(D.KEYS.data, raw);
  const st = D.createStore(fs); st.load();
  st.writePrev(D.ingest(raw).doc);
  assert.equal(fs.getItem(D.KEYS.prev), raw);
  assert.equal(st.readRaw(), raw);
});
