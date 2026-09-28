/* tests/sync.test.js — クラウドの控え（v1.1）と Claude のレビューの、アプリ側の約束ごと
 *   ・レビューの材料に、名前・生年月日・メモ・写真・思い出の一言が入らない（金額は許可した時だけ）
 *   ・読む用の表・レビューの取り込み・初めてつなぐ時の判断
 *   ・秘密キーは書き出しにもクラウドの文書にも入らない／アプリは Claude API を直接呼ばない */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, assert, core, makeDoc, ctx, fakeStorage, BIRTH } = require('./lib.js');
const D = core();
const app = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');

// 架空の人と経験（テスト専用の名前・メモ）
function sample() {
  const doc = makeDoc({ leave: 20, hours: 30 });
  const mom = D.newPerson({ name: 'テスト花子', relation: 'parent', birthYear: 1970, note: '秘密のメモP' });
  doc.people.push(mom);
  const trip = D.newItem({ title: '海外旅行', status: 'placed', when: { fromAge: 25, toAge: 25 }, note: '秘密のメモI', withIds: [mom.id],
    cost: { once: 400000, perYear: null }, leaveDays: 7, dwz: { until: '60s', why: ['people'], memory: 'high', reason: '' } });
  const book = D.newItem({ title: '100冊読む', status: 'placed', when: { fromAge: 25, toAge: 25 }, dwz: { until: 'any', why: ['none'], memory: 'low', reason: '今年やりたい' } });
  doc.items.push(trip, book);
  doc.logs.push(D.newLog({ itemId: trip.id, itemTitle: '海外旅行', date: '2026-05-03', feel: 3, note: '秘密の一言L', link: 'https://photos.example.com/secret' }));
  return { doc, trip, book, mom };
}

test('レビューの材料：名前・生年月日・メモ・写真・思い出の一言は入らない', () => {
  const { doc } = sample();
  const text = JSON.stringify(D.reviewPacket(doc, ctx(doc), false));
  ['テスト花子', BIRTH, '秘密のメモP', '秘密のメモI', '秘密の一言L', 'photos.example.com'].forEach((w) => assert.ok(!text.includes(w), w + ' が入っている'));
  assert.ok(text.includes('海外旅行') && text.includes('100冊読む'), '題名は入る');
  assert.ok(text.includes('今年やりたい'), '置いた理由は入る（自動運転の点検に使う）');
  assert.ok(text.includes('"parent"'), '一緒にやる人は続柄だけ');
});
test('レビューの材料：金額は許可した時だけ', () => {
  const { doc } = sample();
  const off = JSON.stringify(D.reviewPacket(doc, ctx(doc), false));
  const on = JSON.stringify(D.reviewPacket(doc, ctx(doc), true));
  assert.ok(!off.includes('400000') && !/"cost"|costThisYear/.test(off));
  assert.ok(on.includes('400000'));
});
test('レビューの材料：項目の id・3問の答え・チェックリスト・今年の容量が入る', () => {
  const { doc, trip } = sample();
  const p = D.reviewPacket(doc, ctx(doc), false);
  const it = p.items.find((i) => i.id === trip.id);
  assert.ok(it && it.dwz && it.dwz.until === '60s');
  assert.ok(p.thisYear.focus.includes(trip.id));
  assert.ok(p.checklist.length >= 10);
  assert.equal(p.thisYear.capacity.leaveDaysPerYear, 20);
  assert.equal(p.age, 25);
});

test('読む用の表：7枚そろい、見出しと各行の列の数が一致する', () => {
  const { doc } = sample();
  D.addAdvice(doc, { id: 'adv-1', at: '2026-09-27T00:00:00Z', overall: 'よい', items: [] });
  const t = D.sheetTables(doc, ctx(doc));
  assert.deepEqual(t.sheets.map((s) => s.name), ['今年', '人生の地図', '経験と土台', '思い出', '大切な人', '本の意図チェック', 'Claudeのレビュー']);
  t.sheets.forEach((s) => s.rows.forEach((r) => assert.equal(r.length, s.header.length, s.name)));
  assert.equal(t.sheets[0].rows.length, 2);
});

test('レビューの取り込み：同じ id は二度入らない／最新と項目ごとのひとこと', () => {
  const { doc, trip } = sample();
  assert.equal(D.addAdvice(doc, { id: 'adv-a', at: '2026-09-20T00:00:00Z', overall: '古い', items: [{ itemId: trip.id, comment: '古いひとこと' }] }), true);
  assert.equal(D.addAdvice(doc, { id: 'adv-a', at: '2026-09-20T00:00:00Z', overall: '古い' }), false);
  D.addAdvice(doc, { id: 'adv-b', at: '2026-09-27T00:00:00Z', overall: '新しい', items: [{ itemId: 'other', comment: 'x' }] });
  assert.equal(doc.advice.length, 2);
  assert.equal(D.latestAdvice(doc).overall, '新しい');
  assert.equal(D.adviceForItem(doc, trip.id).entry.comment, '古いひとこと', '新しい方に無ければ、前のひとことを出す');
  assert.equal(D.adviceForItem(doc, 'none'), null);
  assert.equal(D.addAdvice(doc, null), false);
});
test('レビューは保存・読み込みを通っても残る（知らない項目も捨てない）', () => {
  const { doc } = sample();
  D.addAdvice(doc, { id: 'adv-x', at: '2026-09-27T00:00:00Z', overall: '感想', praise: ['良い'], items: [], questions: ['問い'], model: 'claude-opus-5', costUsd: 0.1 });
  const r = D.ingest(D.exportText(doc));
  assert.equal(r.ok, true);
  const a = D.byId(r.doc.advice, 'adv-x');
  assert.equal(a.overall, '感想');
  assert.equal(a.model, 'claude-opus-5');
});
test('クラウドの文書（_server 付き）をそのまま取り込める', () => {
  const { doc } = sample();
  const stored = Object.assign({ _server: { rev: 3, savedAt: '2026-09-28T00:00:00Z', device: 'Android' } }, D.syncDoc(doc));
  const r = D.ingest(JSON.stringify(stored));
  assert.equal(r.ok, true);
  assert.equal(r.doc._server, undefined);
  assert.equal(r.doc.docId, doc.docId);
  assert.equal(D.live(r.doc.items).length, 2);
});

test('初めてつなぐ時の判断', () => {
  const { doc } = sample();
  doc.savedAt = '2026-09-28T10:00:00.000Z';
  const empty = D.newDoc();
  assert.equal(D.firstConnect({ serverRev: 0 }, doc), 'push', 'クラウドが空なら送る');
  assert.equal(D.firstConnect({ serverRev: 5, docId: 'other' }, empty), 'restore', 'この端末が空ならクラウドから戻す');
  assert.equal(D.firstConnect({ serverRev: 5, docId: 'other' }, doc), 'ask-other-doc', '別の人生データは本人に聞く');
  assert.equal(D.firstConnect({ serverRev: 5, docId: doc.docId, savedAt: '2026-09-28T09:00:00.000Z' }, doc), 'push', '端末の方が新しい');
  assert.equal(D.firstConnect({ serverRev: 5, docId: doc.docId, savedAt: '2026-09-28T10:00:00.000Z' }, doc), 'push', '同じ内容');
  assert.equal(D.firstConnect({ serverRev: 5, docId: doc.docId, savedAt: '2026-09-28T11:00:00.000Z' }, doc), 'ask-cloud-newer', 'クラウドの方が新しい');
});

test('秘密キーは書き出しにもクラウドの文書にも入らない（端末の情報に置く）', () => {
  const st = fakeStorage();
  const store = D.createStore(st, {});
  const dev = store.readDevice();
  dev.sync = { url: 'https://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec', key: 'SECRETKEY-' + 'z'.repeat(40), enabled: true };
  store.writeDevice(dev);
  const { doc } = sample();
  assert.ok(!D.exportText(doc).includes('SECRETKEY'));
  assert.ok(!JSON.stringify(D.syncDoc(doc)).includes('SECRETKEY'));
  assert.ok(!JSON.stringify(D.reviewPacket(doc, ctx(doc), true)).includes('SECRETKEY'));
});
test('アプリ：GAS へは text/plain の POST で、キーは本文に入れる（URL に付けない）／Claude API を直接呼ばない', () => {
  assert.ok(/method: 'POST', headers: \{ 'Content-Type': 'text\/plain/.test(app));
  assert.ok(!/[?&]key=/.test(app), 'URL にキーを付けている');
  assert.ok(!/api\.anthropic\.com|x-api-key|ANTHROPIC_API_KEY/.test(app), 'アプリから Claude API を呼んでいる');
  assert.ok(!/localStorage\.setItem\([^)]*key/.test(app));
});
test('アプリ：Claude の提案は自動で反映しない（項目を開く・時期を変えるは本人が押す）', () => {
  const m = /function openAdviceSheet[\s\S]*?\n  function adviceCard/.exec(app);
  assert.ok(m);
  assert.ok(!/commit\(/.test(m[0]), 'レビューの画面から直接データを書き換えている');
  assert.ok(/openPlaceSheet\(/.test(m[0]), '時期を変える時は配置シート（本の意図チェック）を通す');
});
test('アプリ：クラウドの上書き（force: all）は「上書き」と入力した時だけ', () => {
  const m = /function forceOverwrite[\s\S]*?\n  }\n/.exec(app);
  assert.ok(m);
  assert.ok(/v !== '上書き'/.test(m[0]));
  assert.equal((app.match(/force: 'all'/g) || []).length, 1, 'force: all を送る所は1か所だけ');
});

/* ---- v1.1 の点検で見つかった事故の再発防止 ---- */
test('「元に戻す」で消える記録は墓標として残る（記録の数が減らない＝クラウドの関所に止められない）', () => {
  const { doc } = sample();
  const before = JSON.stringify(doc);
  const added = D.newItem({ title: '足してすぐ取り消す' });
  doc.items.push(added);
  doc.logs.push(D.newLog({ itemId: added.id, date: '2026-09-01' }));
  const r = D.ingest(before);
  D.tombstoneMissing(doc, r.doc, 'dev1');
  const t = D.byId(r.doc.items, added.id);
  assert.ok(t && t.deletedAt && t.undone, '墓標になっている');
  assert.equal(D.live(r.doc.items).length, 2, '画面には出ない');
  assert.equal(r.doc.items.length, doc.items.length, '件数は減らない');
  assert.equal(r.doc.logs.length, doc.logs.length);
  const back = D.ingest(D.exportText(r.doc));
  assert.equal(D.byId(back.doc.items, added.id).undone, true, '保存しても印が残る（ゴミ箱に出さないため）');
});
test('アプリ：送信の結果で、開いているシートを全部は作り直さない（書きかけの文字を守る）', () => {
  const m = /function pushNow[\s\S]*?\n  }\n/.exec(app);
  assert.ok(m);
  assert.ok(!/refreshSheets\(\)/.test(m[0]), 'pushNow の中で refreshSheets() を呼んでいる');
  assert.ok(/refreshSyncViews\(\)/.test(m[0]));
});
test('アプリ：レビューは最新の材料を送れた時だけ頼む／設定コードの貼り直しでクラウドの版を勝手に引き継がない', () => {
  const rv = /function requestReview[\s\S]*?\n  }\n/.exec(app)[0];
  assert.ok(/!pr \|\| !pr\.ok/.test(rv));
  const ss = /function setupSync[\s\S]*?\n  }\n/.exec(app)[0];
  assert.ok(/res\.lastPushDevice === device\.deviceId/.test(ss));
});
