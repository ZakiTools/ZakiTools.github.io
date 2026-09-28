/* tests/gas.test.js — GAS（自分の Google の控え係）の「計算だけ」の部分を Node で確かめる
 *   Logic.gs と ReviewPrompt.gs を vm でそのまま読み込む（Google のサービスは使わない部分）。
 *   Drive やメールを使う部分（Api.gs など）は、構文と「やってはいけない書き方」が無いことだけを見る。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, assert, core } = require('./lib.js');
const D = core();
const GAS = path.join(__dirname, '..', 'gas');
const read = (f) => fs.readFileSync(path.join(GAS, f), 'utf8');

const box = {};
vm.createContext(box);
vm.runInContext(read('Logic.gs'), box, { filename: 'Logic.gs' });
vm.runInContext(read('ReviewPrompt.gs'), box, { filename: 'ReviewPrompt.gs' });
const L = box.LOGIC;
const DAY = 86400000;
const NOW = Date.parse('2026-09-29T00:00:00Z');
const URL_OK = 'https://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec';
const KEY = 'k'.repeat(43);

test('GAS のファイルはすべて構文が正しい／appsscript.json の公開範囲', () => {
  fs.readdirSync(GAS).filter((f) => f.endsWith('.gs')).forEach((f) => { new vm.Script(read(f), { filename: f }); });
  const m = JSON.parse(read('appsscript.json'));
  assert.equal(m.timeZone, 'Asia/Tokyo');
  assert.equal(m.runtimeVersion, 'V8');
  assert.equal(m.webapp.access, 'ANYONE_ANONYMOUS');     // 秘密キーで照合する前提
  assert.equal(m.webapp.executeAs, 'USER_DEPLOYING');    // 自分のドライブに書く
});
test('GAS は本文やキーをログに出さない／キーをコードに書かない', () => {
  fs.readdirSync(GAS).filter((f) => f.endsWith('.gs')).forEach((f) => {
    const s = read(f);
    assert.ok(!/console\.log/.test(s), f + ' に console.log');
    (s.match(/Logger\.log\([^;]*/g) || []).forEach((l) => assert.ok(!/postData|contents|\bb\.doc|DWZ_KEY'\)\s*[,)]|ANTHROPIC_API_KEY'\)\s*[,)]/.test(l), f + '：' + l.slice(0, 60)));
    assert.ok(!/sk-ant-/.test(s), f + ' に API キーらしき文字');
  });
});

test('世代の名前：時刻と版と端末が入り、時刻を読み戻せる', () => {
  const n = L.genName('2026-09-29T03:12:45.123Z', 123, 'Android');
  assert.equal(n, '2026-09-29T03-12-45Z_r000123_Android.json');
  assert.equal(L.parseGenTime(n), Date.parse('2026-09-29T03:12:45Z'));
  assert.equal(L.parseGenTime('README.txt'), null);
  assert.ok(!/[\/\\. ]/.test(L.genName('2026-09-29T03:12:45Z', 1, '../x y').replace(/\.json$/, '')));
});
test('世代の残し方：最新20個・14日以内すべて・90日まで1日1個・それより古いものは月1個', () => {
  const files = [];
  // 1時間ごとに400日分
  for (let h = 0; h < 400 * 24; h += 1) { const t = NOW - h * 3600000; files.push({ name: 'g' + h, t }); }
  const keep = L.pickGenerationsToKeep(files, NOW);
  const kept = files.filter((f) => keep[f.name]);
  assert.ok(files.filter((f) => NOW - f.t <= 14 * DAY).every((f) => keep[f.name]), '14日以内が全部残る');
  const days = {}, months = {};
  kept.filter((f) => NOW - f.t > 14 * DAY && NOW - f.t <= 90 * DAY).forEach((f) => { const d = new Date(f.t).toISOString().slice(0, 10); days[d] = (days[d] || 0) + 1; });
  assert.ok(Object.values(days).every((n) => n === 1), '15〜90日は1日1個');
  kept.filter((f) => NOW - f.t > 90 * DAY).forEach((f) => { const m = new Date(f.t).toISOString().slice(0, 7); months[m] = (months[m] || 0) + 1; });
  assert.ok(Object.values(months).every((n) => n === 1), '90日より前は月1個');
  // 古い物しか無くても、最新20個は必ず残る
  const old = Array.from({ length: 30 }, (_, i) => ({ name: 'o' + i, t: NOW - 500 * DAY - i * 60000 }));
  assert.equal(Object.keys(L.pickGenerationsToKeep(old, NOW)).length, 20);
});
test('件数の関所：墓標も数え、減った種類を返す', () => {
  const a = { items: [{ id: 'a' }, { id: 'b', deletedAt: '2026-01-01T00:00:00Z' }], logs: [{ id: 'l' }], profile: { id: 'p' } };
  assert.deepEqual(JSON.parse(JSON.stringify(L.countIds(a))), { items: 2, logs: 1 });
  assert.deepEqual(Array.from(L.shrunk({ items: 2, logs: 1 }, { items: 2, logs: 0 })), ['logs']);
  assert.deepEqual(Array.from(L.shrunk({ items: 2 }, { items: 3 })), []);
  assert.deepEqual(Array.from(L.shrunk({ items: 2, people: 1 }, { items: 2 })), ['people']);   // 種類ごと消えても気づく
});
test('時計の関所：1日以上未来の更新時刻だけを拒む', () => {
  const soon = new Date(NOW + 3600000).toISOString(), far = new Date(NOW + 2 * DAY).toISOString();
  assert.equal(L.futureStamp({ items: [{ updatedAt: soon }] }, NOW), false);
  assert.equal(L.futureStamp({ items: [{ updatedAt: far }] }, NOW), true);
  assert.equal(L.futureStamp({ profile: { updatedAt: far } }, NOW), true);
});
test('読み出せるファイル名：控えのフォルダの中だけ', () => {
  assert.deepEqual(Array.from(L.safeName('current')), ['current.json']);
  assert.deepEqual(Array.from(L.safeName('generations/2026/x.json')), ['generations', '2026', 'x.json']);
  assert.deepEqual(Array.from(L.safeName('advice/x.json')), ['advice', 'x.json']);
  ['../x.json', 'generations/../x.json', '/generations/x.json', 'secret/x.json', 'x.json', 'generations/x.txt', 'generations\\x.json', 'a/b/c/d.json', null, 5]
    .forEach((n) => assert.equal(L.safeName(n), null, String(n)));
});
test('スプレッドシートの1マス：数式として動かない', () => {
  assert.equal(L.escapeCell('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.equal(L.escapeCell('+1'), "'+1");
  assert.equal(L.escapeCell('-5'), "'-5");
  assert.equal(L.escapeCell('@x'), "'@x");
  assert.equal(L.escapeCell('ふつう'), 'ふつう');
  assert.equal(L.escapeCell(12), '12');
  assert.equal(L.escapeCell(null), '');
});
test('秘密キーの照合', () => {
  assert.equal(L.constantEq(KEY, KEY), true);
  assert.equal(L.constantEq(KEY, KEY.slice(0, -1) + 'x'), false);
  assert.equal(L.constantEq('', ''), false);
  assert.equal(L.constantEq(null, KEY), false);
});
test('設定コード：GAS が作った物をアプリが読める（往復）／壊れた物は読まない', () => {
  const code = L.encodeSetupCode(URL_OK, KEY);
  assert.ok(code.startsWith('dwz1.'));
  assert.deepEqual(D.parseSetupCode(code), { url: URL_OK, key: KEY });
  assert.deepEqual(D.parseSetupCode('  設定コード：\n' + code.slice(0, 20) + '\n' + code.slice(20) + '  '), { url: URL_OK, key: KEY }, 'メールの改行や前後の文字');
  assert.equal(D.parseSetupCode(L.encodeSetupCode('https://evil.example.com/exec', KEY)), null, 'GAS 以外の住所');
  assert.equal(D.parseSetupCode(L.encodeSetupCode(URL_OK, 'short')), null, '短いキー');
  assert.equal(D.parseSetupCode('dwz1.!!!'), null);
  assert.equal(D.parseSetupCode(''), null);
});
test('レビューの頻度：週1は毎回・月1は月の最初の7日・止めるは呼ばない', () => {
  assert.equal(L.reviewDue('weekly', new Date(2026, 8, 27)), true);
  assert.equal(L.reviewDue('monthly', new Date(2026, 9, 4)), true);
  assert.equal(L.reviewDue('monthly', new Date(2026, 9, 11)), false);
  assert.equal(L.reviewDue('off', new Date(2026, 9, 4)), false);
});
test('料金の目安（1Mトークンあたり Opus 5 は $5 / $25）', () => {
  assert.equal(L.costUsd({ input_tokens: 10000, output_tokens: 4000 }, 'claude-opus-5'), 0.15);
  assert.equal(L.costUsd(null, 'claude-opus-5'), null);
  assert.equal(L.costUsd({ input_tokens: 1000000, output_tokens: 0 }, 'unknown'), 5);
});

function apiText(obj, extra) { return Object.assign({ type: 'message', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }] }, extra || {}); }
const GOOD = { overall: '全体として…', praise: ['良い'], items: [{ itemId: 'i1', comment: 'c', suggestion: 's', rule: 'ルール7' }], questions: ['問い'] };
test('Claude の応答：断られた・途中で切れた・形が違う時は保存しない', () => {
  assert.equal(L.parseAdviceResponse(apiText(GOOD, { stop_reason: 'refusal' })).error, 'refusal');
  assert.equal(L.parseAdviceResponse(apiText(GOOD, { stop_reason: 'max_tokens' })).error, 'max_tokens');
  assert.equal(L.parseAdviceResponse({ type: 'message', content: [{ type: 'text', text: '{壊れ' }] }).error, 'bad_json');
  assert.equal(L.parseAdviceResponse(apiText({ overall: 'x' })).error, 'bad_shape');
  assert.equal(L.parseAdviceResponse({ type: 'error', error: { message: 'overloaded' } }).error, 'api_error');
  assert.equal(L.parseAdviceResponse(null).error, 'bad_response');
});
test('Claude の応答：正しい形なら取り出し、長さと件数をそろえる', () => {
  const r = L.parseAdviceResponse(apiText(GOOD));
  assert.equal(r.ok, true);
  assert.equal(r.advice.overall, '全体として…');
  assert.equal(r.advice.items[0].rule, 'ルール7');
  const many = Object.assign({}, GOOD, { items: Array.from({ length: 30 }, (_, i) => ({ itemId: 'i' + i, comment: 'x'.repeat(5000), suggestion: '', rule: '' })), praise: Array(9).fill('p') });
  const r2 = L.parseAdviceResponse(apiText(many));
  assert.equal(r2.advice.items.length, 12);
  assert.equal(r2.advice.items[0].comment.length, 800);
  assert.equal(r2.advice.praise.length, 5);
});
test('レビューのメール：項目は題名で書き、id は出さない', () => {
  const m = L.adviceMail(GOOD, { items: [{ id: 'i1', title: '海外旅行' }] }, 'https://example.github.io/', '2026-09-29');
  assert.ok(m.subject.includes('2026-09-29'));
  assert.ok(m.body.includes('海外旅行'));
  assert.ok(!m.body.includes('i1'));
  assert.ok(m.body.includes('決めるのはあなた'));
});
test('レビューの設定：モデル・決まった形（すべて必須・余分な項目なし）・投資の助言をしない', () => {
  assert.equal(box.REVIEW_MODEL, 'claude-opus-5');
  function walk(s, where) {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, where);
      assert.deepEqual(Array.from(s.required).sort(), Object.keys(s.properties).sort(), where);
      Object.keys(s.properties).forEach((k) => walk(s.properties[k], where + '.' + k));
    } else if (s.type === 'array') walk(s.items, where + '[]');
  }
  walk(box.ADVICE_SCHEMA, 'ADVICE_SCHEMA');
  assert.ok(/投資・保険・金融商品の助言はしない/.test(box.REVIEW_PROMPT));
  assert.ok(/点数・達成率[^。]*しない/.test(box.REVIEW_PROMPT), '点数や達成率を使わないと書いてある');
  const Review = read('Review.gs');
  assert.ok(/thinking: \{ type: 'adaptive' \}/.test(Review));
  assert.ok(!/budget_tokens/.test(Review), 'Opus 5 では budget_tokens は使えない');
  assert.ok(/muteHttpExceptions: true/.test(Review));
});

test('金額を見せない設定の時は、GAS 側でも材料から金額を取り除く', () => {
  const p = { thisYear: { capacity: { costThisYear: 5, leaveDaysUsed: 3 } }, items: [{ id: 'a', cost: { once: 1 } }, { id: 'b' }] };
  L.stripMoney(p);
  assert.equal(JSON.stringify(p).includes('cost'), false);
  assert.equal(p.thisYear.capacity.leaveDaysUsed, 3);
  assert.ok(/stripMoney/.test(read('Review.gs')));
});
test('正しいキーは、失敗が続いた後でも通す（自分の端末の控えを止めない）', () => {
  const s = read('Api.gs');
  const m = /function auth_[\s\S]*?\n}\n/.exec(s)[0];
  assert.ok(m.indexOf('if (ok) return true') < m.indexOf("cache.get('authfail')"), 'キーの照合より先に失敗の数で断っている');
});
