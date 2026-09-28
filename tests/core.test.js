/* tests/core.test.js — 日付・年齢・バケツ・今年の注力・窓・容量・本の意図チェック */
'use strict';
const { test, assert, core, makeDoc, ctx, TODAY } = require('./lib.js');
const D = core();

/* ---------- 日付と年齢 ---------- */
test('誕生日の前日と当日で年齢が変わる', () => {
  assert.equal(D.ageOn('1991-03-10', '2026-03-09'), 34);
  assert.equal(D.ageOn('1991-03-10', '2026-03-10'), 35);
});
test('2/29 生まれは平年なら 3/1 に1つ年をとる（2100年はうるう年ではない）', () => {
  assert.equal(D.ageOn('2000-02-29', '2001-02-28'), 0);
  assert.equal(D.ageOn('2000-02-29', '2001-03-01'), 1);
  assert.equal(D.ageOn('2000-02-29', '2004-02-29'), 4);
  assert.equal(D.ageOn('2000-02-29', '2100-02-28'), 99);
  assert.equal(D.ageOn('2000-02-29', '2100-03-01'), 100);
  assert.equal(D.isLeap(2100), false);
  assert.equal(D.isLeap(2000), true);
});
test('A歳の1年は、誕生日から次の誕生日の前日まで', () => {
  assert.deepEqual(D.ageYear('1991-03-10', 35), { from: '2026-03-10', to: '2027-03-09', days: 365 });
  assert.deepEqual(D.ageYear('2000-02-29', 1), { from: '2001-03-01', to: '2002-02-28', days: 365 });
  const y3 = D.ageYear('2000-02-29', 3);
  assert.equal(y3.from, '2003-03-01');
  assert.equal(y3.to, '2004-02-28');
});
test('壊れた日付は受け付けない', () => {
  assert.equal(D.parseYmd('2026-02-30'), null);
  assert.equal(D.parseYmd('2026/09/28'), null);
  assert.equal(D.ageOn('abc', TODAY), null);
});
test('日付の足し算・引き算（月末・年末をまたぐ）', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(D.daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(D.endOfMonth('2027-02-01'), '2027-02-28');
});

/* ---------- バケツ ---------- */
test('バケツの名前（5年・10年）', () => {
  assert.equal(D.bucketLabel(25, 5), '20代後半');
  assert.equal(D.bucketLabel(30, 5), '30代前半');
  assert.equal(D.bucketLabel(30, 10), '30代');
});
test('今のバケツから終点までを並べる', () => {
  const doc = makeDoc();
  const c = ctx(doc);
  assert.equal(c.A, 25);
  assert.equal(c.bStart, 25);
  assert.equal(c.bEnd, 29);
  const bs = D.lifeBuckets(c);
  assert.equal(bs[0].label, '20代後半');
  assert.equal(bs[0].isNow, true);
  assert.equal(bs[bs.length - 1].start, 90);   // 終点95 → 94歳を含む 90〜94 まで
  doc.settings.bucketYears = 10;
  const bs10 = D.lifeBuckets(ctx(doc));
  assert.equal(bs10[0].label, '20代');
  assert.equal(bs10[bs10.length - 1].start, 90);
});
test('生年月日が無ければ計算の前提（ctx）は作らない', () => {
  const doc = D.newDoc();
  assert.equal(D.ctxOf(doc, TODAY), null);
});

/* ---------- 今年の注力 ---------- */
function place(doc, fields) { const it = D.newItem(fields); doc.items.push(it); return it; }

test('今年の注力は4つの条件で決まり、候補・手放した・削除は入らない', () => {
  const doc = makeDoc();
  const c = ctx(doc);   // 25歳の1年 = 2025-11-15〜2026-11-14
  const dated = place(doc, { title: '旅', status: 'placed', when: { date: '2026-11-02', endDate: '2026-11-06' } });
  const year = place(doc, { title: '年', status: 'placed', when: { fromAge: 25, toAge: 25 } });
  const theme = place(doc, { title: '土台', kind: 'theme', status: 'placed', when: { fromAge: 25, toAge: 27 } });
  const rep = place(doc, { title: '海外', status: 'placed', repeat: { perYear: 1, fromAge: 25, toAge: 75 } });
  place(doc, { title: '候補', status: 'idea' });
  place(doc, { title: '手放した', status: 'letgo', when: { fromAge: 25, toAge: 25 } });
  const del = place(doc, { title: '削除', status: 'placed', when: { fromAge: 25, toAge: 25 } });
  D.removeRec(del);
  place(doc, { title: 'どこかで', status: 'placed', when: { fromAge: 25, toAge: 29 } });
  const f = D.yearFocus(doc, c).map((x) => x.item.title);
  assert.deepEqual(f, ['旅', '年', '土台', '海外']);
  assert.ok(dated && year && theme && rep);
  const s = D.seasonSomewhere(doc, c).map((i) => i.title);
  assert.deepEqual(s, ['どこかで']);
});
test('誕生日を過ぎたら、前の年に置いたままの経験を「この季節のどこかで」に戻す', () => {
  const doc = makeDoc();
  const it = place(doc, { title: '前の年', status: 'placed', when: { fromAge: 24, toAge: 24 } });
  const c = ctx(doc);
  const moved = D.applyRollover(doc, c);
  assert.deepEqual(moved, [it.id]);
  assert.equal(it.when.fromAge, 25);
  assert.equal(it.when.toAge, 29);
  assert.equal(it.prevWhen.fromAge, 24);
  assert.deepEqual(D.applyRollover(doc, c), []);   // 2回目は何もしない
});
test('「行ってきましたか？」は日付を過ぎた物だけ（月だけ決めた物は月末まで待つ）', () => {
  const doc = makeDoc();
  place(doc, { title: '過ぎた', status: 'placed', when: { date: '2026-09-01' } });
  place(doc, { title: '今月', status: 'placed', when: { date: '2026-09-01', precision: 'month' } });
  place(doc, { title: '先', status: 'placed', when: { date: '2026-11-02' } });
  assert.deepEqual(D.dueMemories(doc, ctx(doc)).map((i) => i.title), ['過ぎた']);
});

/* ---------- 窓 ---------- */
test('窓：体力の既定（きつい50・ふつう75・軽い＝終点）と状態', () => {
  const doc = makeDoc();
  const c = ctx(doc);
  const hard = D.newItem({ body: 'hard' });
  const normal = D.newItem({ body: 'normal' });
  const light = D.newItem({ body: 'light' });
  assert.equal(D.effEnd(hard, c), 50);
  assert.equal(D.effEnd(normal, c), 75);
  assert.equal(D.effEnd(light, c), 95);
  assert.equal(D.windowInfo(hard, c).state, 'open');
  const late = D.newItem({ body: 'hard', status: 'placed', when: { fromAge: 55, toAge: 55 } });
  assert.equal(D.windowInfo(late, c).state, 'outside');
  const doc46 = makeDoc({ birth: '1980-01-01' });
  const c46 = ctx(doc46);
  assert.equal(c46.A, 46);
  assert.equal(D.windowInfo(hard, c46).state, 'closing');     // 40歳以上は8年前から
  assert.equal(D.windowInfo(D.newItem({ window: { endAge: 40 } }), c46).state, 'passed');
});
test('ホームの「窓が閉じかけ」には、体力がいるのに時期未定の物も入る', () => {
  const doc = makeDoc();
  place(doc, { title: 'マラソン', body: 'hard', status: 'idea' });
  place(doc, { title: '散歩', body: 'light', status: 'idea' });
  const list = D.closingList(doc, ctx(doc));
  assert.deepEqual(list.map((x) => x.item.title), ['マラソン']);
  assert.equal(list[0].hardIdea, true);
});

/* ---------- 回数と容量 ---------- */
test('回数型：あと約N回（今年の子の項目を差し引く・親子で二重に数えない）', () => {
  const doc = makeDoc({ leave: 20, hours: 30 });
  const c = ctx(doc);
  const parent = place(doc, { title: '海外旅行', status: 'placed', repeat: { perYear: 1, fromAge: 25, toAge: 75 }, leaveDays: 5, cost: { once: 300000 } });
  assert.equal(D.repeatRemaining(doc, parent, c), 51);     // 25〜75歳で51回
  place(doc, { title: '旅行A', status: 'placed', parentId: parent.id, when: { date: '2026-11-02', endDate: '2026-11-06' }, cost: { once: 450000 } });
  assert.equal(D.repeatRemaining(doc, parent, c), 50);
  const cap = D.capacity(doc, c);
  assert.equal(cap.leave.used, 5);              // 子の休みが未入力 → 親の1回分（5日）。親は今年の枠を使い切り
  assert.equal(cap.leave.cap, 20);
  assert.equal(cap.cost.exp, 450000);
});
test('容量：土台の週時間は目標日までの割合で数える／未入力は件数で返す', () => {
  const doc = makeDoc({ hours: 30 });
  const c = ctx(doc);   // 25歳の1年 2025-11-15〜2026-11-14（365日）
  place(doc, { title: '体づくり', kind: 'theme', status: 'placed', when: { fromAge: 25, toAge: 25 }, hoursPerWeek: 3, goalDate: '2026-05-15' });
  place(doc, { title: '旅', category: '旅', status: 'placed', when: { fromAge: 25, toAge: 25 } });
  place(doc, { title: '読書', status: 'placed', when: { fromAge: 25, toAge: 25 } });   // 休みが要らない物は未入力に数えない
  const cap = D.capacity(doc, c);
  assert.ok(cap.hours.used > 1.4 && cap.hours.used < 1.6, String(cap.hours.used));
  assert.equal(cap.leave.missing, 1);
  assert.equal(cap.cost.missing, 2);
});
test('費用の表：年・バケツ別に合計し、与えるは別の列', () => {
  const doc = makeDoc();
  const c = ctx(doc);
  place(doc, { title: '旅', status: 'placed', when: { fromAge: 26, toAge: 26 }, cost: { once: 300000 } });
  place(doc, { title: '親と温泉', category: '与える', status: 'placed', when: { fromAge: 27, toAge: 27 }, cost: { once: 100000 } });
  place(doc, { title: '季節のどこか', status: 'placed', when: { fromAge: 30, toAge: 34 }, cost: { once: 500000 } });
  const t = D.costTable(doc, c);
  assert.equal(t.years.find((y) => y.age === 26).exp, 300000);
  assert.equal(t.years.find((y) => y.age === 27).give, 100000);
  const b30 = t.buckets.find((b) => b.start === 30);
  assert.equal(b30.exp, 500000);
});
test('思い出の配当の年数', () => {
  const c = ctx(makeDoc());
  assert.equal(D.dividendYears(c, 25), 70);
  assert.equal(D.dividendYears(c, 30), 65);
  assert.equal(D.dividendYears(c, 20), 70);    // 過去の年齢は今から数える
});

/* ---------- 本の意図チェック（置く時） ---------- */
function answered(fields, answers) { return D.applyDwzAnswers(D.newItem(fields), answers); }

test('「100冊読む」（何歳でも・理由が特にない）を今年に置くと R1、30代に置くと出ない', () => {
  const doc = makeDoc();
  const c = ctx(doc);
  const it = answered({ title: '100冊読む' }, { until: 'any', why: ['none'], memory: 'mid' });
  const nowIds = D.dwzCheck(it, { fromAge: 25, toAge: 25 }, c).map((x) => x.id);
  assert.ok(nowIds.includes('R1'), nowIds.join());
  const r1 = D.dwzCheck(it, { fromAge: 25, toAge: 25 }, c).find((x) => x.id === 'R1');
  assert.match(r1.text, /30代前半/);
  const laterIds = D.dwzCheck(it, { fromAge: 30, toAge: 34 }, c).map((x) => x.id);
  assert.ok(!laterIds.includes('R1'), laterIds.join());
});
test('時期に縛りがある理由があれば、何歳でもでも R1 は出ない', () => {
  const c = ctx(makeDoc());
  const it = answered({ title: '親と旅行' }, { until: 'any', why: ['people'], memory: 'high' });
  assert.ok(!D.dwzCheck(it, { fromAge: 25, toAge: 25 }, c).some((x) => x.id === 'R1'));
});
test('R2 窓の外／R3 体力（窓の中でも50歳以降なら）', () => {
  const c = ctx(makeDoc());
  const a = answered({ title: 'スノボ' }, { until: '40s', why: ['body'], memory: 'high' });
  assert.ok(D.dwzCheck(a, { fromAge: 55, toAge: 55 }, c).some((x) => x.id === 'R2'));
  const b = answered({ title: '登山' }, { until: '60s', why: ['body'], memory: 'high' });
  const ids = D.dwzCheck(b, { fromAge: 55, toAge: 55 }, c).map((x) => x.id);
  assert.ok(ids.includes('R3') && !ids.includes('R2'), ids.join());
});
test('R4 人の理由があるのに誰とが空／R5 期限のある経験を後ろへ／R6 思い出に残りにくいのに高い', () => {
  const c = ctx(makeDoc());
  const p = answered({ title: '親と' }, { until: '60s', why: ['people'], memory: 'high' });
  assert.ok(D.dwzCheck(p, { fromAge: 26, toAge: 26 }, c).some((x) => x.id === 'R4'));
  const r5 = D.dwzCheck(p, { fromAge: 35, toAge: 35 }, c).find((x) => x.id === 'R5');
  assert.ok(r5);
  assert.match(r5.text, /約70年 → 約60年/);
  const r6 = answered({ title: '高い物', cost: { once: 150000 } }, { until: 'any', why: ['era'], memory: 'low' });
  assert.ok(D.dwzCheck(r6, { fromAge: 26, toAge: 26 }, c).some((x) => x.id === 'R6'));
});
test('3問の答えで窓と体力が連動する', () => {
  const a = answered({}, { until: '30s', why: ['body', 'none'], memory: 'high' });
  assert.equal(a.window.endAge, 39);
  assert.equal(a.body, 'hard');
  assert.deepEqual(a.dwz.why, ['body']);        // 「特にない」は他の理由と一緒には残さない
  const b = answered({}, { until: 'any', why: ['none'], memory: 'mid' });
  assert.equal(b.window.endAge, null);
  assert.equal(b.body, 'light');
  assert.equal(D.isAnytime(b), true);
});

/* ---------- 全体チェックリスト ---------- */
test('チェックリスト：理由なしの「いつでもできる」、与える・挑戦なし、3問未回答を指摘', () => {
  const doc = makeDoc({ leave: 20 });
  const c = ctx(doc);
  const it = answered({ title: '100冊', status: 'placed', when: { fromAge: 25, toAge: 25 } }, { until: 'any', why: ['none'], memory: 'mid' });
  doc.items.push(it);
  doc.items.push(D.newItem({ title: '未回答', status: 'placed', when: { fromAge: 26, toAge: 26 } }));
  const list = D.dwzChecklist(doc, c);
  const get = (id) => list.find((x) => x.id === id);
  assert.equal(get('C1').ok, false);
  assert.equal(get('C6').ok, false);
  assert.equal(get('C7').ok, false);
  assert.equal(get('C10').ok, false);
  assert.equal(get('C9').ok, false);            // 休み20日のうち経験に使う予定0日
  it.dwz.reason = '今の仕事に直結するから';
  assert.equal(D.dwzChecklist(doc, c).find((x) => x.id === 'C1').ok, true);
  assert.ok(list.every((x) => !('score' in x)));  // 点数は出さない
});

/* ---------- 関所・保存の形・合体 ---------- */
test('関所：別アプリのJSONは拒否、新しい版は読み取り専用', () => {
  assert.equal(D.ingest('{"app":"other"}').ok, false);
  assert.equal(D.ingest('not json').reason, 'parse');
  const doc = makeDoc();
  const newer = Object.assign({}, doc, { schemaVersion: 2 });
  assert.equal(D.ingest(JSON.stringify(newer)).readOnly, true);
  const newerWriter = Object.assign({}, doc, { minWriter: 2 });
  assert.equal(D.ingest(JSON.stringify(newerWriter)).readOnly, true);
});
test('関所：知らない項目・知らない配列は捨てずに残す', () => {
  const doc = makeDoc();
  const it = D.newItem({ title: 'x' });
  it.futureField = { a: 1 };
  doc.items.push(it);
  doc.futureArray = [{ id: 'f1', v: 1 }];
  doc.futureScalar = 'keep';
  const r = D.ingest(JSON.stringify(doc));
  assert.deepEqual(r.doc.items[0].futureField, { a: 1 });
  assert.equal(r.doc.futureArray[0].v, 1);
  assert.equal(r.doc.futureScalar, 'keep');
});
test('関所：時刻の書式をそろえ、同じIDは新しい方を残す', () => {
  const doc = makeDoc();
  const a = D.newItem({ title: '古い' });
  const b = Object.assign({}, a, { title: '新しい', updatedAt: '2999-01-01T00:00:00Z' });
  a.updatedAt = '2020-01-01T00:00:00Z';
  doc.items = [a, b];
  const r = D.ingest(JSON.stringify(doc));
  assert.equal(r.doc.items.length, 1);
  assert.equal(r.doc.items[0].title, '新しい');
  assert.equal(r.doc.items[0].updatedAt, '2999-01-01T00:00:00.000Z');
});
test('保存の形：既定値を省いても、読み込むと元どおり', () => {
  const doc = makeDoc();
  doc.items.push(D.newItem({ title: 'x', status: 'placed', when: { fromAge: 26, toAge: 26 } }));
  doc.logs.push(D.newLog({ itemId: doc.items[0].id, date: '2026-09-01', note: '楽しかった' }));
  const text = D.serialize(doc);
  assert.ok(text.length < JSON.stringify(doc).length);
  const back = D.ingest(text).doc;
  assert.deepEqual(back.items[0], doc.items[0]);
  assert.deepEqual(back.logs[0], doc.logs[0]);
});
test('合体：記録ごとに新しい方を採り、知らない配列も残す', () => {
  const a = makeDoc();
  const x = D.newItem({ title: 'A側' });
  a.items.push(x);
  const b = D.clone(a);
  b.items[0].title = 'B側で直した';
  b.items[0].updatedAt = D.nowIso(b.items[0].updatedAt);
  b.items.push(D.newItem({ title: 'Bだけ' }));
  b.extra = [{ id: 'e', updatedAt: D.EPOCH0 }];
  const m = D.mergeDocs(a, b);
  assert.equal(m.items.find((i) => i.id === x.id).title, 'B側で直した');
  assert.equal(m.items.length, 2);
  assert.equal(m.extra.length, 1);
});
test('更新時刻は必ず前より新しくなる（時計が戻っていても）', () => {
  const future = '2999-01-01T00:00:00.000Z';
  assert.ok(D.isoNewer(D.nowIso(future), future));
});

/* ---------- 書き出し・下書き ---------- */
test('書き出し：説明文つき、取り込むと同じ中身', () => {
  const doc = makeDoc();
  doc.items.push(D.newItem({ title: '旅' }));
  const text = D.exportText(doc);
  assert.match(text, /_readme/);
  const r = D.ingest(text);
  assert.equal(r.ok, true);
  assert.equal(r.doc.docId, doc.docId);
  assert.equal(r.doc.items[0].title, '旅');
  assert.equal(D.exportFileName('2026-09-28'), 'timebucket-backup-2026-09-28.txt');
});
test('下書き：すべて候補（idea）で入り、費用は入らず、2回目は増えない', () => {
  const doc = makeDoc();
  const pack = {
    app: 'dwz-timebucket-drafts', v: 1,
    people: [{ key: 'p1', name: '親', relation: 'parent' }],
    items: [
      { key: 'trip', title: '海外旅行', hint: { repeat: { perYear: 1, fromAge: 25, toAge: 75 }, cost: { once: 300000 } } },
      { key: 'us', title: '旅行A', parentKey: 'trip', withKeys: ['p1'], hint: { date: '2026-11-02' } }
    ]
  };
  const r = D.importDrafts(doc, JSON.stringify(pack));
  assert.equal(r.added, 3);
  assert.ok(doc.items.every((i) => i.status === 'idea' && i.origin === 'draft' && i.cost.once == null));
  const tripA = doc.items.find((i) => i.title === '旅行A');
  assert.equal(tripA.parentId, doc.items.find((i) => i.title === '海外旅行').id);
  assert.equal(tripA.withIds.length, 1);
  assert.equal(D.importDrafts(doc, JSON.stringify(pack)).added, 0);
});
test('安全：文字のエスケープと https だけのリンク', () => {
  assert.equal(D.esc('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(D.safeLink('javascript:alert(1)'), '');
  assert.equal(D.safeLink('http://example.com'), '');
  assert.equal(D.safeLink(' https://photos.app.goo.gl/abc '), 'https://photos.app.goo.gl/abc');
});

/* ---------- 2026-09-28 のレビューで直した所（再発防止） ---------- */
test('回数型：子を「◯歳の1年」で置いても、休み・費用・残り回数を二重に数えない', () => {
  const doc = makeDoc({ leave: 20 });
  const c = ctx(doc);
  const parent = place(doc, { title: '海外旅行', status: 'placed', repeat: { perYear: 1, fromAge: 25, toAge: 75 }, leaveDays: 5, cost: { once: 300000 } });
  place(doc, { title: '旅行B', status: 'placed', parentId: parent.id, when: { fromAge: 25, toAge: 25 } });
  const cap = D.capacity(doc, c);
  assert.equal(cap.leave.used, 5);
  assert.equal(cap.cost.total, 300000);
  assert.equal(D.repeatRemaining(doc, parent, c), 50);
  assert.equal(D.costTable(doc, c).years.find((y) => y.age === 25).exp, 300000);
});
test('回数型：今年の回数を子で使い切っても、親の週の時間と毎年の費用は数える', () => {
  const doc = makeDoc({ hours: 30 });
  const c = ctx(doc);
  const parent = place(doc, { title: '山', status: 'placed', repeat: { perYear: 1, fromAge: 25 }, hoursPerWeek: 2, cost: { once: 50000, perYear: 120000 } });
  place(doc, { title: '山の1回', status: 'placed', parentId: parent.id, when: { date: '2026-11-02' } });
  const cap = D.capacity(doc, c);
  assert.equal(cap.hours.used, 2);
  assert.equal(cap.cost.total, 50000 + 120000);   // 子の1回（親の once を使う）＋親の毎年の費用
});
test('回数型の範囲は窓の終わりで切る（費用表・チェックリストが窓の後を数えない）', () => {
  const doc = makeDoc();
  const c = ctx(doc);
  const it = D.applyDwzAnswers(D.newItem({ title: '海外', status: 'placed', repeat: { perYear: 1, fromAge: 25, toAge: 75 }, cost: { once: 300000 } }), { until: '40s', why: ['stage'], memory: 'high' });
  doc.items.push(it);
  assert.deepEqual(D.itemRange(it, c), [25, 49]);
  const t = D.costTable(doc, c);
  assert.equal(t.buckets.find((b) => b.start === 50).total, 0);
  assert.equal(D.dwzChecklist(doc, c).find((x) => x.id === 'C4').ok, false);
});
test('C1：季節に置いた「いつでもできる」経験は、その季節の2年目でも指摘する', () => {
  const doc = makeDoc();
  const it = D.applyDwzAnswers(D.newItem({ title: '100冊', status: 'placed', when: { fromAge: 25, toAge: 29 } }), { until: 'any', why: ['none'], memory: 'mid' });
  doc.items.push(it);
  assert.equal(D.dwzChecklist(doc, ctx(doc, '2026-09-28')).find((x) => x.id === 'C1').ok, false);
  assert.equal(D.dwzChecklist(doc, ctx(doc, '2027-12-01')).find((x) => x.id === 'C1').ok, false);
});
test('数え終わった回数型は「窓」の一覧に出ず、過ぎた物は後ろに並ぶ', () => {
  const doc = makeDoc({ birth: '1980-01-01' });   // 46歳
  const c = ctx(doc);
  place(doc, { title: '終わった回数型', status: 'placed', repeat: { perYear: 1, fromAge: 25, toAge: 38 } });
  place(doc, { title: '過ぎた', status: 'idea', window: { endAge: 40 } });
  place(doc, { title: '閉じかけ', status: 'idea', body: 'hard' });
  const list = D.closingList(doc, c).map((x) => x.item.title);
  assert.deepEqual(list, ['閉じかけ', '過ぎた']);
});
test('R1 は回数型の置き先・体力の目安を過ぎた年齢・最後の季節では出さない', () => {
  const young = ctx(makeDoc());
  const it = D.applyDwzAnswers(D.newItem({ title: '散歩' }), { until: 'any', why: ['none'], memory: 'mid' });
  assert.ok(!D.dwzCheck(it, { fromAge: 25, toAge: 75, repeat: { perYear: 1, fromAge: 25 } }, young).some((x) => x.id === 'R1'));
  const old = ctx(makeDoc({ birth: '1960-01-01' }));   // 66歳
  assert.ok(!D.dwzCheck(it, { fromAge: old.A, toAge: old.A }, old).some((x) => x.id === 'R1'));
});
test('C9：休みの日数が未入力の経験があって少なく見える時は「確かめられない」にする', () => {
  const doc = makeDoc({ leave: 20 });
  place(doc, { title: '旅', category: '旅', status: 'placed', when: { date: '2026-11-02', endDate: '2026-11-06' } });
  assert.equal(D.dwzChecklist(doc, ctx(doc)).find((x) => x.id === 'C9').ok, 'na');
});
test('1年だけ置いた土台は誕生日を過ぎたら季節に戻す／範囲を決めた土台は戻さない', () => {
  const doc = makeDoc();
  const one = place(doc, { title: '読書習慣', kind: 'theme', status: 'placed', when: { fromAge: 24, toAge: 24 } });
  const range = place(doc, { title: '体づくり', kind: 'theme', status: 'placed', when: { fromAge: 22, toAge: 24 } });
  const ids = D.applyRollover(doc, ctx(doc));
  assert.deepEqual(ids, [one.id]);
  assert.equal(range.when.toAge, 24);
});
