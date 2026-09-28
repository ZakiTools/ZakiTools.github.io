/* tests/intent.test.js — 意図ガード：本の意図から外れる作りになっていないかを機械的に確かめる */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, assert, core, makeDoc, ctx } = require('./lib.js');
const D = core();
const DOCS = path.join(__dirname, '..', 'docs');
const app = fs.readFileSync(path.join(DOCS, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');

function region(name) {
  const m = new RegExp('/\\*<' + name + '>\\*/([\\s\\S]*?)/\\*</' + name + '>\\*/').exec(app);
  assert.ok(m, 'region not found: ' + name);
  return m[1];
}

test('ホーム（今年タブ）は資産の計算を呼ばない（主役は経験と残り時間）', () => {
  const now = region('render-now');
  assert.ok(!/simulate|assetTotal|netWorth|assetPeak/.test(now));
});
test('思いつきシートと配置シートに費用の入力欄が無い（お金を考えずに書き出す・置く）', () => {
  assert.ok(!/cost/.test(region('idea-sheet')), 'idea-sheet に cost がある');
  assert.ok(!/cost/.test(region('place-sheet')), 'place-sheet に cost がある');
});
test('今年の注力に個数の上限が無い（重さは容量で見る）', () => {
  assert.ok(!/MAX_FOCUS|focusLimit|FOCUS_MAX/.test(app + fs.readFileSync(path.join(DOCS, 'core.js'), 'utf8')));
  const doc = makeDoc();
  for (let i = 0; i < 12; i++) doc.items.push(D.newItem({ title: '経験' + i, status: 'placed', when: { fromAge: 25, toAge: 25 } }));
  assert.equal(D.yearFocus(doc, ctx(doc)).length, 12);
});
test('思い出の手応えはちょうど3段階（細かい点数化はしない）', () => {
  assert.equal(D.newLog({ feel: 4 }).feel, null);
  assert.equal(D.newLog({ feel: 3 }).feel, 3);
  assert.ok(/\[\[1, 'よかった'\], \[2, 'とてもよかった'\], \[3, '人生の宝'\]\]/.test(app));
});
test('画面の言葉に ToDo・カウントダウン系の語が無い', () => {
  const banned = ['達成率', 'ストリーク', '連続記録', 'カウントダウン', '持ち越し', '未達成', 'やり残し', '寿命まで', '死まで'];
  banned.forEach((w) => {
    assert.ok(!app.includes(w), 'app.js に「' + w + '」');
    assert.ok(!html.includes(w), 'index.html に「' + w + '」');
  });
  assert.ok(!html.includes('user-scalable=no'), 'ピンチで拡大できるようにする');
});
test('「はみ出し」は休みと時間のメーターだけ（お金には使わない）', () => {
  const m = /function meterView[\s\S]*?\n  }\n/.exec(app);
  assert.ok(m);
  const outside = app.replace(m[0], '');
  assert.ok(!outside.includes('はみ出し'), 'meterView の外に「はみ出し」がある');
});
test('手放した件数を画面に出さない', () => {
  assert.ok(!/手放した[^'"]{0,6}(件数|\d+件)|letgo\S*\.length/.test(app));
});
test('チェックリストに点数や割合は無い', () => {
  const doc = makeDoc();
  D.dwzChecklist(doc, ctx(doc)).forEach((c) => {
    assert.ok(!('score' in c) && !('percent' in c));
    assert.ok([true, false, 'na'].includes(c.ok));
    assert.ok(/^ルール/.test(c.rule), '本のルール番号を添える');
  });
});
test('下書きは全部「候補」で入り、費用は入らない（private の下書きパックがあれば実物で確かめる）', () => {
  const p = path.join(__dirname, '..', '..', 'private', 'starter-drafts.txt');
  if (!fs.existsSync(p)) return;   // CI では private が無いので飛ばす
  const doc = makeDoc();
  const r = D.importDrafts(doc, fs.readFileSync(p, 'utf8'));
  assert.equal(r.ok, true);
  assert.ok(doc.items.length > 0);
  doc.items.forEach((i) => {
    assert.equal(i.status, 'idea');
    assert.equal(i.origin, 'draft');
    assert.equal(i.cost.once, null);
    assert.equal(i.when.fromAge, null);
    assert.equal(i.when.date, null);
  });
});
test('「与える」「挑戦」は時期を決めて置いた時だけ✓（候補だけでは✓にしない）', () => {
  const doc = makeDoc();
  doc.items.push(D.newItem({ title: '親と温泉', category: '与える', status: 'idea' }));
  const c6 = D.dwzChecklist(doc, ctx(doc)).find((x) => x.id === 'C6');
  assert.equal(c6.ok, false);
  doc.items[0].status = 'placed'; doc.items[0].when = { fromAge: 26, toAge: 26, date: null, endDate: null, precision: 'day' };
  assert.equal(D.dwzChecklist(doc, ctx(doc)).find((x) => x.id === 'C6').ok, true);
});
test('問いかけは、その年代の季節に合う物を選ぶ', () => {
  const p60 = D.promptFor(60).text, p25 = D.promptFor(25).text;
  assert.ok(!/40代・50代/.test(p60), p60);
  assert.ok(!/70代/.test(p25), p25);
});
test('人生タブのチェックの行に件数の集計を出さない', () => {
  assert.ok(!/'✓' \+ okN|'△' \+ ngN/.test(app));
});
test('候補から回数型にする時も、本の3つの問いと判定を通る（抜け道が無い）', () => {
  assert.ok(/if \(it\.status === 'idea'\) openPlaceSheet\(id, \{ target: \{ fromAge: ctx\.A/.test(app));
});
