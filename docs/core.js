/* =====================================================================
 * core.js — タイムバケットの「頭脳」
 *
 *   画面（DOM）に一切さわらない、計算とデータの関数だけを集めたファイル。
 *   ブラウザでは window.DWZ、Node（テスト）では require('./core.js') で使う。
 *   「今日」は引数で受け取る（テストで好きな日付を試せるように）。
 *
 *   章立て
 *     0. 定数
 *     1. 小道具（ID・時刻・型の確認）
 *     2. 日付と年齢（Date に頼らず "YYYY-MM-DD" の文字列で計算する）
 *     3. 記録の既定値と作成・操作
 *     4. 読み込みの関所 ingest（起動・取り込み・復元はすべてここを通る）
 *     5. データの形の移行 MIGRATIONS
 *     6. 合体 mergeDocs（同じスマホの別画面が保存していた時用）
 *     7. 計算（バケツ・今年の注力・窓・回数・容量・本の意図チェック）
 *     8. 端末内の保存 createStore
 *     9. 書き出し・下書きの取り込み
 * ===================================================================== */
(function (root) {
  'use strict';

  /* =====================================================================
   * 0. 定数
   * ===================================================================== */
  var APP_NAME = 'dwz-timebucket';     // データの「名札」。別アプリのJSONを取り込まないため
  var APP_VERSION = '1.0.0';           // アプリの版（sw.js の VERSION と必ず一致させる）
  var SCHEMA_VERSION = 1;              // データの「形」の版。意味が変わる時だけ +1
  var MIN_WRITER = 1;                  // このデータに書き込んでよいアプリの最低段階
  var WRITER_LEVEL = 1;                // このアプリ自身の段階（項目を足した版で +1）
  var EPOCH0 = '1970-01-01T00:00:00.000Z';  // 「既定値のまま」の印。本物の編集に必ず負ける時刻

  var KEYS = {
    data: 'dwz-data',                  // 正本（人生データ1冊）
    device: 'dwz-device',              // この端末だけの情報（書き出しに含めない）
    prev: 'dwz-prev',                  // 取り込み・復元・移行の直前の控え
    daily: 'dwz-daily',                // 1日1回の控え
    dailyDay: 'dwz-daily-day',         // その控えを取った日
    corrupt: 'dwz-data-corrupt-'       // 読めなかったデータの退避先（最大2件）
  };

  var DEFAULTS = { planEndAge: 95, bodyFreeUntilAge: 75, hardBodyUntilAge: 50, bucketYears: 5 };

  // 平均寿命は「参考表示」だけに使う（計画の終点の設定画面のみ）
  var LIFE_TABLE = { male: 81.35, female: 87.33, source: '令和7年簡易生命表（厚生労働省・2026年7月公表）' };

  var CATEGORIES = ['旅', '体を動かす', '人と過ごす', '学ぶ', 'つくる', '味わう', '与える', '挑戦'];

  // 『DIE WITH ZERO』日本語版の9つのルール（章題）。指摘の根拠として番号を添える
  var RULES = {
    1: '「今しかできないこと」に投資する',
    2: '一刻も早く経験に金を使う',
    3: 'ゼロで死ぬ',
    4: '人生最後の日を意識する',
    5: '子どもには死ぬ「前」に与える',
    6: '年齢にあわせて「金、健康、時間」を最適化する',
    7: 'やりたいことの「賞味期限」を意識する',
    8: '45〜60歳に資産を取り崩し始める',
    9: '大胆にリスクを取る'
  };

  // 本の意図チェック：問い1「何歳まで同じくらい楽しめる？」の答え → 窓の終わりの年齢
  var UNTIL_AGE = { '30s': 39, '40s': 49, '60s': 69 };
  var UNTIL_LABEL = { '30s': '30代まで', '40s': '40代まで', '60s': '60代まで', any: '何歳でも' };
  // 問い2「今やる理由は？」のうち、時期に縛りがある理由
  var TIME_SENSITIVE = ['body', 'people', 'stage', 'era'];
  var WHY_LABEL = {
    body: '体力がいる', people: '一緒にやりたい人の年齢・状況', stage: '今の自分の状況（身軽・自由な時間）',
    era: '時代・場所・機会が今だけ', none: '特にない'
  };
  var MEMORY_LABEL = { high: 'きっと何度も思い出す', mid: 'たぶん', low: 'あまり' };

  // 思いつきを助ける問いかけ。from〜to：その年代の季節（バケツ）が空っぽの時に出す目安（無ければどの年代でも）
  var PROMPTS = [
    { text: '体が一番よく動く今のうちに、やっておきたいことは？', to: 39 },
    { text: '親や家族と一緒にしておきたいことは？' },
    { text: '10年後の自分が「あの時やってよかった」と言いそうなことは？' },
    { text: '一度は行ってみたい国・街は？' },
    { text: '失うものが少ない今だからこそ、挑戦してみたいことは？', to: 44 },
    { text: '友達や仲間と一緒にやりたいことは？' },
    { text: '作ってみたいもの・書いてみたいものは？' },
    { text: '一生に一度は味わってみたいものは？' },
    { text: '誰かのためにお金や時間を使うとしたら、何をする？' },
    { text: '子どもの頃の自分が喜びそうなことは？' },
    { text: '毎年の季節ごとに、繰り返しやりたいことは？' },
    { text: '人生で一度は見てみたい景色は？' },
    { text: '40代・50代で楽しみたい、落ち着いた楽しみは？', from: 40, to: 59 },
    { text: '仕事が一段落した後、時間ができたらやりたいことは？', from: 55, to: 69 },
    { text: '60代の自分が、体の動くうちに行っておきたい所は？', from: 60, to: 69 },
    { text: '70代になっても続けていたい楽しみは？', from: 70 },
    { text: '若い人や家族に、生きているうちに渡したいもの・伝えたいことは？', from: 60 }
  ];
  // その年代の季節向けの問いかけを1つ選ぶ（同じ季節には毎回同じ問い）
  function promptFor(age) {
    function inRange(p) { return (p.from == null || age >= p.from) && (p.to == null || age <= p.to); }
    var specific = PROMPTS.filter(function (p) { return p.from != null && inRange(p); });
    var general = PROMPTS.filter(function (p) { return p.from == null && inRange(p); });
    var list = specific.concat(specific).concat(general);   // その年代向けの問いを2倍の重みで
    return list[Math.floor(age / 5) % list.length];
  }

  // 汎用の例（後半の年代の例も入れる＝「後半が空っぽ」対策）
  var EXAMPLES = [
    { title: 'オーロラを見に行く', category: '旅', body: 'normal' },
    { title: 'フルマラソンを走り切る', category: '体を動かす', body: 'hard' },
    { title: '親を温泉旅行に連れて行く', category: '与える', body: 'normal' },
    { title: '海外で1か月暮らしてみる', category: '旅', body: 'normal' },
    { title: 'ダイビングの資格を取って海に潜る', category: '体を動かす', body: 'hard' },
    { title: '自分の本（電子書籍）を1冊つくる', category: 'つくる', body: 'light' },
    { title: '副業や小さな商売を一度やってみる', category: '挑戦', body: 'light' },
    { title: '一生に一度の特別なレストランへ行く', category: '味わう', body: 'light' },
    { title: '毎年どこかに寄付をする', category: '与える', body: 'light' },
    { title: '50代で友人とゆっくり船旅をする', category: '旅', body: 'light' },
    { title: '60代で季節の花を育てる暮らしを楽しむ', category: '味わう', body: 'light' },
    { title: '70代で、若い人に自分の経験を話す場をつくる', category: '与える', body: 'light' }
  ];

  /* =====================================================================
   * 1. 小道具
   * ===================================================================== */
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function int(v, d) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : d; }
  function str(v, d) { return typeof v === 'string' ? v : d; }        // 空文字も正しい値として残す
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 重複しない乱数ID（UUID）。古い環境では getRandomValues で代わりを作る
  function uuid() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }

  // 更新時刻：必ず前の値より新しくする（端末の時計が戻っていても、自分の編集が負けないように）
  function nowIso(prev) {
    var t = Date.now();
    var p = prev ? Date.parse(prev) : NaN;
    if (isFinite(p) && t <= p) t = p + 1;
    return new Date(t).toISOString();
  }
  // 時刻の書式をそろえる（"…Z" と "….000Z" を文字で比べると勝ち負けが逆になるため）
  function normIso(v) {
    if (typeof v !== 'string') return EPOCH0;
    var t = Date.parse(v);
    return isFinite(t) ? new Date(t).toISOString() : EPOCH0;
  }
  function isoNewer(a, b) { return Date.parse(a || EPOCH0) > Date.parse(b || EPOCH0); }

  // 画面に文字を出す時の安全策（HTMLとして解釈させない）。app.js は基本 textContent を使う
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // リンクは https だけを通す（javascript: などを防ぐ）
  function safeLink(s) {
    if (typeof s !== 'string') return '';
    var t = s.trim();
    return /^https:\/\/[^\s]+$/i.test(t) ? t : '';
  }

  /* =====================================================================
   * 2. 日付と年齢
   *   new Date('YYYY-MM-DD') は UTC として解釈される罠があるので使わない。
   *   年・月・日の数字として比べる。
   * ===================================================================== */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function parseYmd(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function fmtYmd(o) { return o.y + '-' + pad2(o.m) + '-' + pad2(o.d); }
  function isYmd(s) { return parseYmd(s) !== null; }
  function cmpObj(a, b) { return a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d; }
  // 2/29 生まれは、平年なら 3/1 を誕生日として扱う（年齢の数え方の決め事。ここ1か所に書く）
  function birthdayIn(b, y) {
    if (b.m === 2 && b.d === 29 && !isLeap(y)) return { y: y, m: 3, d: 1 };
    return { y: y, m: b.m, d: b.d };
  }
  function ageOn(birthStr, dayStr) {
    var b = parseYmd(birthStr), d = parseYmd(dayStr);
    if (!b || !d) return null;
    var a = d.y - b.y;
    if (cmpObj(d, birthdayIn(b, d.y)) < 0) a--;
    return a;
  }
  function addDays(dayStr, n) {
    var d = parseYmd(dayStr);
    var x = new Date(Date.UTC(d.y, d.m - 1, d.d) + n * 86400000);
    return fmtYmd({ y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() });
  }
  function daysBetween(a, b) {
    var x = parseYmd(a), y = parseYmd(b);
    return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
  }
  // 「A歳の1年」＝ A歳の誕生日 〜 次の誕生日の前日（例：2000-11-15 生まれの25歳 = 2025-11-15〜2026-11-14）
  function ageYear(birthStr, A) {
    var b = parseYmd(birthStr);
    var from = fmtYmd(birthdayIn(b, b.y + A));
    var next = fmtYmd(birthdayIn(b, b.y + A + 1));
    return { from: from, to: addDays(next, -1), days: daysBetween(from, next) };
  }
  // 端末の「今日」（ローカルの日付）。旅行中は現地の日付になる
  function todayYmd() {
    var n = new Date();
    return fmtYmd({ y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() });
  }
  function endOfMonth(dayStr) {
    var d = parseYmd(dayStr);
    return fmtYmd({ y: d.y, m: d.m, d: daysInMonth(d.y, d.m) });
  }
  // "2027-02-01" → "2027年2月"、"2026-11-02" → "2026年11月2日"
  function jpDate(s, precision) {
    var d = parseYmd(s);
    if (!d) return '';
    return precision === 'month' ? d.y + '年' + d.m + '月' : d.y + '年' + d.m + '月' + d.d + '日';
  }
  function shortDate(s) { var d = parseYmd(s); return d ? d.m + '/' + d.d : ''; }

  /* =====================================================================
   * 3. 記録の既定値と作成・操作
   *   どの記録も id（UUID）・createdAt・updatedAt・deletedAt（墓標）を持つ。
   *   既定値と同じ項目は保存時に省く（容量節約）。読み込み時に既定値で埋め戻す。
   * ===================================================================== */
  function PROFILE_DEFAULTS() {
    return { birthDate: null, planEndAge: DEFAULTS.planEndAge, bodyFreeUntilAge: DEFAULTS.bodyFreeUntilAge,
      hardBodyUntilAge: DEFAULTS.hardBodyUntilAge, lifeTableRef: null };
  }
  function SETTINGS_DEFAULTS() {
    return { bucketYears: DEFAULTS.bucketYears, leaveDaysPerYear: null, freeHoursPerWeek: null, fontScale: 1,
      showSummers: true, simpleMode: false, categories: CATEGORIES.slice(),
      reviewFrequency: 'weekly', reviewIncludeMoney: false };
  }
  function ITEM_DEFAULTS() {
    return {
      kind: 'exp', title: '', note: '', category: '', status: 'idea', origin: 'user',
      when: { fromAge: null, toAge: null, date: null, endDate: null, precision: 'day' },
      window: { startAge: null, endAge: null }, body: 'normal', lastChance: false,
      withIds: [], needsIds: [], parentId: null,
      days: null, leaveDays: null, hoursPerWeek: null, hoursEach: null,
      cost: { once: null, perYear: null },
      repeat: null, give: null, risk: null,
      goal: '', goalDate: null, nextStep: '', pillar: null,
      letgo: null, prevWhen: null, hint: null, dwz: null, draftKey: null
    };
  }
  function LOG_DEFAULTS() {
    return { itemId: null, itemTitle: '', date: null, endDate: null, feel: null, note: '', link: '', withIds: [], later: [] };
  }
  function PERSON_DEFAULTS() {
    return { name: '', relation: 'other', birthYear: null, birthDate: null, goOutUntilAge: null,
      meetPerYear: null, onCalendar: false, note: '', draftKey: null };
  }
  function YEARPLAN_DEFAULTS() {
    return { age: null, word: '', override: { leaveDays: null, freeHoursPerWeek: null, budgetYen: null } };
  }
  var TYPE_DEFAULTS = {
    items: ITEM_DEFAULTS, logs: LOG_DEFAULTS, people: PERSON_DEFAULTS, yearPlans: YEARPLAN_DEFAULTS
  };
  var SINGLETONS = ['profile', 'settings', 'money'];
  var KNOWN_ARRAYS = ['items', 'logs', 'people', 'assets', 'yearPlans', 'reviews', 'advice'];

  function stamp(rec, t) {
    rec.createdAt = t; rec.updatedAt = t; rec.deletedAt = null;
    return rec;
  }
  function newDoc() {
    var t = nowIso();
    var doc = {
      app: APP_NAME, schemaVersion: SCHEMA_VERSION, minWriter: MIN_WRITER, docId: uuid(), saveSeq: uuid(),
      createdAt: t, savedAt: t,
      profile: stamp(Object.assign({ id: 'profile' }, PROFILE_DEFAULTS()), EPOCH0),
      settings: stamp(Object.assign({ id: 'settings' }, SETTINGS_DEFAULTS()), EPOCH0),
      money: null,
      items: [], logs: [], people: [], assets: [], yearPlans: [], reviews: [], advice: []
    };
    return doc;
  }
  // 記録を「今変えた」ことにする（更新時刻を必ず進める）
  function touch(rec, deviceId) {
    rec.updatedAt = nowIso(rec.updatedAt);
    if (deviceId) rec.by = deviceId;
    return rec;
  }
  function newItem(fields) {
    var it = Object.assign(ITEM_DEFAULTS(), clone(fields || {}));
    it.id = uuid();
    stamp(it, nowIso());
    return normalizeItem(it);
  }
  function newLog(fields) {
    var lg = Object.assign(LOG_DEFAULTS(), clone(fields || {}));
    lg.id = uuid();
    stamp(lg, nowIso());
    return normalizeLog(lg);
  }
  function newPerson(fields) {
    var p = Object.assign(PERSON_DEFAULTS(), clone(fields || {}));
    p.id = uuid();
    stamp(p, nowIso());
    return normalizePerson(p);
  }
  function live(arr) { return (arr || []).filter(function (r) { return r && !r.deletedAt; }); }
  function byId(arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  // 削除＝墓標にする（中身は残す。ゴミ箱から戻せる）
  function removeRec(rec, deviceId) { rec.deletedAt = nowIso(); touch(rec, deviceId); return rec; }
  function restoreRec(rec, deviceId) { rec.deletedAt = null; touch(rec, deviceId); return rec; }

  // 年ごとの計画（ひとこと）。id は年齢から決まる（2台で作っても重複しない）
  function yearPlan(doc, A) { return byId(doc.yearPlans, 'year-' + A); }
  function ensureYearPlan(doc, A) {
    var yp = yearPlan(doc, A);
    if (!yp) {
      yp = Object.assign({ id: 'year-' + A }, YEARPLAN_DEFAULTS());
      yp.age = A;
      stamp(yp, nowIso());
      doc.yearPlans.push(yp);
    }
    return yp;
  }

  /* =====================================================================
   * 4. 読み込みの関所 ingest
   *   名札 → 版の確認 → 移行 → 補完（型が違えば既定値）→ 知らない項目は残す
   *   アプリより新しい版のデータは「読み取り専用」で開く（壊さないため）
   * ===================================================================== */
  function normalizeTimes(rec) {
    rec.createdAt = normIso(rec.createdAt);
    rec.updatedAt = normIso(rec.updatedAt);
    rec.deletedAt = rec.deletedAt ? normIso(rec.deletedAt) : null;
    if (typeof rec.id !== 'string' || !rec.id) rec.id = uuid();
    return rec;
  }
  function fillDefaults(rec, defaults) {
    // 既定値で埋める。知らない項目（将来の版が足した物）は消さずにそのまま残す
    Object.keys(defaults).forEach(function (k) { if (!(k in rec)) rec[k] = clone(defaults[k]); });
    return rec;
  }
  function numOrNull(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function intOrNull(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null; }
  function ymdOrNull(v) { return isYmd(v) ? v : null; }
  function idArr(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : []; }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }

  function normalizeItem(o) {
    var it = isObj(o) ? o : {};
    fillDefaults(it, ITEM_DEFAULTS());
    normalizeTimes(it);
    it.kind = oneOf(it.kind, ['exp', 'theme'], 'exp');
    it.title = str(it.title, '').slice(0, 200);
    it.note = str(it.note, '');
    it.category = str(it.category, '');
    it.status = oneOf(it.status, ['idea', 'placed', 'done', 'letgo'], 'idea');
    it.origin = oneOf(it.origin, ['user', 'draft', 'example'], 'user');
    var w = isObj(it.when) ? it.when : {};
    it.when = Object.assign({}, w, {
      fromAge: intOrNull(w.fromAge), toAge: intOrNull(w.toAge), date: ymdOrNull(w.date), endDate: ymdOrNull(w.endDate),
      precision: oneOf(w.precision, ['day', 'month'], 'day')
    });
    if (it.when.endDate && it.when.date && it.when.endDate < it.when.date) it.when.endDate = null;
    var win = isObj(it.window) ? it.window : {};
    it.window = Object.assign({}, win, { startAge: intOrNull(win.startAge), endAge: intOrNull(win.endAge) });
    it.body = oneOf(it.body, ['light', 'normal', 'hard'], 'normal');
    it.lastChance = !!it.lastChance;
    it.withIds = idArr(it.withIds);
    it.needsIds = idArr(it.needsIds);
    it.parentId = typeof it.parentId === 'string' && it.parentId ? it.parentId : null;
    ['days', 'leaveDays', 'hoursPerWeek', 'hoursEach'].forEach(function (k) {
      var v = numOrNull(it[k]); it[k] = v != null && v >= 0 ? v : null;
    });
    var c = isObj(it.cost) ? it.cost : {};
    it.cost = Object.assign({}, c, { once: intOrNull(c.once), perYear: intOrNull(c.perYear) });
    if (it.repeat != null) {
      var r = isObj(it.repeat) ? it.repeat : {};
      var per = numOrNull(r.perYear), fa = intOrNull(r.fromAge);
      it.repeat = (per != null && per > 0 && fa != null) ? Object.assign({}, r, { perYear: per, fromAge: fa, toAge: intOrNull(r.toAge) }) : null;
    }
    if (it.give != null) {
      var g = isObj(it.give) ? it.give : {};
      it.give = Object.assign({}, g, { toIds: idArr(g.toIds), toText: str(g.toText, '') });
    }
    if (it.risk != null) {
      var rk = isObj(it.risk) ? it.risk : {};
      it.risk = Object.assign({}, rk, { worst: str(rk.worst, ''), prep: str(rk.prep, '') });
    }
    it.goal = str(it.goal, '');
    it.goalDate = ymdOrNull(it.goalDate);
    it.nextStep = str(it.nextStep, '');
    it.pillar = oneOf(it.pillar, ['body', 'work', 'money', 'people', 'learn', 'other'], null);
    if (it.letgo != null) {
      var lg = isObj(it.letgo) ? it.letgo : {};
      it.letgo = Object.assign({}, lg, { date: ymdOrNull(lg.date), reason: str(lg.reason, '') });
    }
    if (it.prevWhen != null && !isObj(it.prevWhen)) it.prevWhen = null;
    if (it.hint != null && !isObj(it.hint)) it.hint = null;
    if (it.dwz != null) {
      var z = isObj(it.dwz) ? it.dwz : {};
      it.dwz = Object.assign({}, z, {
        until: oneOf(z.until, ['30s', '40s', '60s', 'any'], null),
        why: Array.isArray(z.why) ? z.why.filter(function (x) { return WHY_LABEL[x]; }) : [],
        memory: oneOf(z.memory, ['high', 'mid', 'low'], null),
        reason: str(z.reason, ''),
        at: z.at ? normIso(z.at) : null
      });
    }
    it.draftKey = typeof it.draftKey === 'string' ? it.draftKey : null;
    return it;
  }
  function normalizeLog(o) {
    var lg = isObj(o) ? o : {};
    fillDefaults(lg, LOG_DEFAULTS());
    normalizeTimes(lg);
    lg.itemId = typeof lg.itemId === 'string' ? lg.itemId : null;
    lg.itemTitle = str(lg.itemTitle, '');
    lg.date = ymdOrNull(lg.date);
    lg.endDate = ymdOrNull(lg.endDate);
    lg.feel = oneOf(lg.feel, [1, 2, 3], null);
    lg.note = str(lg.note, '').slice(0, 2000);
    lg.link = safeLink(lg.link);
    lg.withIds = idArr(lg.withIds);
    lg.later = Array.isArray(lg.later) ? lg.later.filter(isObj).map(function (x) {
      return Object.assign({}, x, { date: ymdOrNull(x.date), text: str(x.text, '') });
    }) : [];
    return lg;
  }
  function normalizePerson(o) {
    var p = isObj(o) ? o : {};
    fillDefaults(p, PERSON_DEFAULTS());
    normalizeTimes(p);
    p.name = str(p.name, '').slice(0, 60);
    p.relation = oneOf(p.relation, ['parent', 'sibling', 'partner', 'child', 'friend', 'pet', 'other'], 'other');
    p.birthYear = intOrNull(p.birthYear);
    p.birthDate = ymdOrNull(p.birthDate);
    p.goOutUntilAge = intOrNull(p.goOutUntilAge);
    p.meetPerYear = numOrNull(p.meetPerYear);
    p.onCalendar = !!p.onCalendar;
    p.note = str(p.note, '');
    return p;
  }
  function normalizeYearPlan(o) {
    var y = isObj(o) ? o : {};
    fillDefaults(y, YEARPLAN_DEFAULTS());
    normalizeTimes(y);
    y.age = intOrNull(y.age);
    y.word = str(y.word, '').slice(0, 200);
    var ov = isObj(y.override) ? y.override : {};
    y.override = Object.assign({}, ov, { leaveDays: numOrNull(ov.leaveDays), freeHoursPerWeek: numOrNull(ov.freeHoursPerWeek), budgetYen: intOrNull(ov.budgetYen) });
    return y;
  }
  function normalizeGeneric(o) { var r = isObj(o) ? o : {}; return normalizeTimes(r); }
  var NORMALIZERS = { items: normalizeItem, logs: normalizeLog, people: normalizePerson, yearPlans: normalizeYearPlan };

  function normalizeProfile(o) {
    var p = isObj(o) ? o : {};
    fillDefaults(p, PROFILE_DEFAULTS());
    p.id = 'profile';
    normalizeTimes(p);
    p.id = 'profile';
    p.birthDate = ymdOrNull(p.birthDate);
    p.planEndAge = clamp(int(p.planEndAge, DEFAULTS.planEndAge), 60, 120);
    p.bodyFreeUntilAge = clamp(int(p.bodyFreeUntilAge, DEFAULTS.bodyFreeUntilAge), 30, 110);
    p.hardBodyUntilAge = clamp(int(p.hardBodyUntilAge, DEFAULTS.hardBodyUntilAge), 20, 100);
    p.lifeTableRef = oneOf(p.lifeTableRef, ['male', 'female'], null);
    return p;
  }
  function normalizeSettings(o) {
    var s = isObj(o) ? o : {};
    fillDefaults(s, SETTINGS_DEFAULTS());
    s.id = 'settings';
    normalizeTimes(s);
    s.id = 'settings';
    s.bucketYears = oneOf(s.bucketYears, [5, 10], 5);
    var lv = numOrNull(s.leaveDaysPerYear); s.leaveDaysPerYear = lv != null && lv >= 0 ? lv : null;
    var fh = numOrNull(s.freeHoursPerWeek); s.freeHoursPerWeek = fh != null && fh >= 0 ? fh : null;
    s.fontScale = oneOf(s.fontScale, [1, 1.15, 1.3, 1.5], 1);
    s.showSummers = s.showSummers !== false;
    s.simpleMode = !!s.simpleMode;
    s.categories = Array.isArray(s.categories) ? s.categories.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 30) : CATEGORIES.slice();
    if (!s.categories.length) s.categories = CATEGORIES.slice();
    s.reviewFrequency = oneOf(s.reviewFrequency, ['weekly', 'monthly', 'off'], 'weekly');
    s.reviewIncludeMoney = !!s.reviewIncludeMoney;
    return s;
  }

  // 同じ id が重複していたら、新しい方を残す
  function dedupe(arr) {
    var map = {}, order = [];
    arr.forEach(function (r) {
      var cur = map[r.id];
      if (!cur) { map[r.id] = r; order.push(r.id); }
      else if (isoNewer(r.updatedAt, cur.updatedAt)) map[r.id] = r;
    });
    return order.map(function (id) { return map[id]; });
  }

  function normalizeDoc(doc) {
    doc.app = APP_NAME;
    if (typeof doc.docId !== 'string' || !doc.docId) doc.docId = uuid();
    if (typeof doc.saveSeq !== 'string' || !doc.saveSeq) doc.saveSeq = uuid();
    doc.createdAt = normIso(doc.createdAt);
    doc.savedAt = normIso(doc.savedAt);
    doc.profile = normalizeProfile(doc.profile);
    doc.settings = normalizeSettings(doc.settings);
    if (doc.money != null && !isObj(doc.money)) doc.money = null;
    if (doc.money) { doc.money.id = 'money'; normalizeTimes(doc.money); doc.money.id = 'money'; }
    // 既知の配列＋知らない配列（将来の版が足した物）も含めて整える
    var keys = KNOWN_ARRAYS.slice();
    Object.keys(doc).forEach(function (k) { if (Array.isArray(doc[k]) && keys.indexOf(k) < 0) keys.push(k); });
    keys.forEach(function (k) {
      var arr = Array.isArray(doc[k]) ? doc[k] : [];
      var norm = NORMALIZERS[k] || normalizeGeneric;
      doc[k] = dedupe(arr.filter(isObj).map(function (r) { return norm(r); }));
    });
    return doc;
  }

  function ingest(input) {
    var data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, reason: 'parse' }; }
    }
    if (!isObj(data)) return { ok: false, reason: 'shape' };
    if (data.app !== APP_NAME) return { ok: false, reason: 'app' };
    var sv = int(data.schemaVersion, 1), mw = int(data.minWriter, 1);
    var readOnly = sv > SCHEMA_VERSION || mw > WRITER_LEVEL;
    var doc = clone(data);
    delete doc._readme; delete doc.exportedAt; delete doc.appVersion;   // 書き出し用の付け足しは捨てる
    var migrated = false;
    if (!readOnly) {
      for (var v = sv; v < SCHEMA_VERSION; v++) {
        if (MIGRATIONS[v]) { doc = MIGRATIONS[v](doc); migrated = true; }
      }
      doc.schemaVersion = SCHEMA_VERSION;
      doc.minWriter = Math.max(mw, MIN_WRITER);
    }
    normalizeDoc(doc);
    return { ok: true, doc: doc, readOnly: readOnly, migrated: migrated, fromVersion: sv };
  }

  /* =====================================================================
   * 5. データの形の移行（古い形 → 新しい形）
   *   MIGRATIONS[n] は「版 n → n+1」。updatedAt には触れない。同じ入力なら必ず同じ出力。
   *   追加したら fixtures/vN.json と SCHEMA.md も必ず更新する。
   * ===================================================================== */
  var MIGRATIONS = {};

  /* =====================================================================
   * 6. 合体（同じスマホの「アプリ画面」と「Chromeのタブ」が別々に保存した時用）
   *   記録ごとに updatedAt が新しい方を採る。知らない配列も残す。
   * ===================================================================== */
  function mergeDocs(a, b) {
    var out = clone(a);
    SINGLETONS.forEach(function (k) {
      if (b[k] && (!a[k] || isoNewer(b[k].updatedAt, a[k].updatedAt))) out[k] = clone(b[k]);
    });
    var keys = [];
    [a, b].forEach(function (d) { Object.keys(d).forEach(function (k) { if (Array.isArray(d[k]) && keys.indexOf(k) < 0) keys.push(k); }); });
    keys.forEach(function (k) {
      var map = {}, order = [];
      (a[k] || []).forEach(function (r) { map[r.id] = r; order.push(r.id); });
      (b[k] || []).forEach(function (r) {
        var m = map[r.id];
        if (!m) { map[r.id] = r; order.push(r.id); }
        else if (isoNewer(r.updatedAt, m.updatedAt)) map[r.id] = r;
      });
      out[k] = order.map(function (id) { return clone(map[id]); });
    });
    Object.keys(b).forEach(function (k) { if (!(k in out)) out[k] = clone(b[k]); });
    return out;
  }

  /* =====================================================================
   * 7. 計算
   * ===================================================================== */

  // --- 7-0. 計算の前提（ctx）をまとめて作る。生年月日が無ければ null ---
  function ctxOf(doc, today) {
    var p = doc.profile, s = doc.settings;
    if (!p || !isYmd(p.birthDate) || !isYmd(today)) return null;
    var A = ageOn(p.birthDate, today);
    if (A == null || A < 0) return null;
    var size = s.bucketYears || 5;
    var bStart = Math.floor(A / size) * size;
    return {
      today: today, birth: p.birthDate, A: A, size: size, bStart: bStart, bEnd: bStart + size - 1,
      planEnd: p.planEndAge, bodyAge: p.bodyFreeUntilAge, hardAge: p.hardBodyUntilAge,
      year: ageYear(p.birthDate, A)
    };
  }

  // --- 7-1. バケツ ---
  function bucketOf(age, size) { var s = Math.floor(age / size) * size; return { start: s, end: s + size - 1 }; }
  function bucketLabel(start, size) {
    if (size === 10) return start + '代';
    var dec = Math.floor(start / 10) * 10;
    return dec + '代' + (start % 10 === 0 ? '前半' : '後半');
  }
  // 今のバケツから、計画の終点（の手前の年）を含むバケツまで
  function lifeBuckets(ctx) {
    var out = [];
    var last = bucketOf(Math.max(ctx.A, ctx.planEnd - 1), ctx.size).start;
    for (var s = ctx.bStart; s <= last; s += ctx.size) {
      out.push({ start: s, end: s + ctx.size - 1, label: bucketLabel(s, ctx.size), isNow: s === ctx.bStart });
    }
    return out;
  }
  // ある年齢の誕生日まで、あと約何年か（小数を四捨五入）
  function yearsUntilAge(ctx, age) {
    var b = parseYmd(ctx.birth);
    var target = fmtYmd(birthdayIn(b, b.y + age));
    return Math.max(0, Math.round(daysBetween(ctx.today, target) / 365.25));
  }
  function yearProgress(ctx) {
    var done = daysBetween(ctx.year.from, ctx.today);
    return clamp(done / ctx.year.days, 0, 1);
  }

  // --- 7-2. 項目の時期 ---
  // 項目が置かれている年齢の範囲 [from, to]（日付があれば日付の年齢）。未配置なら null
  function itemRange(it, ctx) {
    var w = it.when || {};
    if (w.date) {
      var a = ageOn(ctx.birth, w.date);
      var b = w.endDate ? ageOn(ctx.birth, w.endDate) : a;
      return [a, Math.max(a, b)];
    }
    if (it.repeat) return [it.repeat.fromAge, Math.max(it.repeat.fromAge, repeatEnd(it, ctx))];
    if (w.fromAge == null) return null;
    return [w.fromAge, w.toAge == null ? w.fromAge : Math.max(w.fromAge, w.toAge)];
  }
  function placedAge(it, ctx) { var r = itemRange(it, ctx); return r ? r[0] : null; }
  // 日付の「実施日の最後」（月までしか決めていない時は、その月の末日）
  function lastDay(it) {
    var w = it.when || {};
    if (!w.date) return null;
    if (w.endDate) return w.endDate;
    return w.precision === 'month' ? endOfMonth(w.date) : w.date;
  }
  function whenLabel(it, ctx) {
    var w = it.when || {};
    if (w.date) {
      var s = w.precision === 'month' ? jpDate(w.date, 'month') : shortDate(w.date);
      if (w.precision !== 'month' && parseYmd(w.date).y !== parseYmd(ctx.today).y) s = jpDate(w.date);
      if (w.endDate) s += '〜' + shortDate(w.endDate);
      return s;
    }
    if (it.repeat) {
      var r = it.repeat;
      var per = r.perYear >= 1 ? '年' + (Math.round(r.perYear * 10) / 10) + '回' : Math.round(1 / r.perYear) + '年に1回';
      return per + '・' + r.fromAge + '〜' + repeatEnd(it, ctx) + '歳';
    }
    if (w.fromAge == null) return '時期は未定';
    var to = w.toAge == null ? w.fromAge : w.toAge;
    if (w.fromAge === to) return w.fromAge + '歳の1年';
    if (it.kind === 'theme') return w.fromAge + '〜' + to + '歳';
    var b = bucketOf(w.fromAge, ctx.size);
    // 季節（バケツ）の残り全部なら「20代後半のどこかで」、それ以外は年齢で
    if (b.end === to && (w.fromAge === b.start || w.fromAge === ctx.A)) return bucketLabel(b.start, ctx.size) + 'のどこかで';
    return w.fromAge + '〜' + to + '歳のどこかで';
  }

  // --- 7-3. 今年（A歳の1年）の注力。保存せず毎回計算する ---
  function yearFocus(doc, ctx, A) {
    if (A == null) A = ctx.A;
    var yr = A === ctx.A ? ctx.year : ageYear(ctx.birth, A);
    var out = [];
    live(doc.items).forEach(function (it) {
      if (it.status !== 'placed' && it.status !== 'done') return;
      var w = it.when || {};
      if (w.date) {
        if (w.date >= yr.from && w.date <= yr.to) out.push({ item: it, why: 'date' });
        return;
      }
      if (it.repeat) {
        if (it.status === 'placed' && it.repeat.fromAge <= A && A <= repeatEnd(it, ctx)) out.push({ item: it, why: 'repeat' });
        return;
      }
      if (w.fromAge == null) return;
      var to = w.toAge == null ? w.fromAge : w.toAge;
      if (it.kind === 'theme') {
        if (it.status === 'placed' && w.fromAge <= A && A <= to) out.push({ item: it, why: 'theme' });
        return;
      }
      if (w.fromAge === A && to === A) out.push({ item: it, why: 'year' });
    });
    var rank = { date: 0, year: 1, theme: 2, repeat: 3 };
    out.sort(function (x, y) {
      if (rank[x.why] !== rank[y.why]) return rank[x.why] - rank[y.why];
      if (x.why === 'date') return x.item.when.date < y.item.when.date ? -1 : x.item.when.date > y.item.when.date ? 1 : 0;
      return x.item.createdAt < y.item.createdAt ? -1 : 1;
    });
    return out;
  }
  // 「この季節のどこかで」：年は決めていないが、今の季節（バケツ）に重なっている経験
  function seasonSomewhere(doc, ctx) {
    return live(doc.items).filter(function (it) {
      if (it.kind !== 'exp' || it.status !== 'placed' || it.repeat) return false;
      var w = it.when || {};
      if (w.date || w.fromAge == null) return false;
      var to = w.toAge == null ? w.fromAge : w.toAge;
      if (w.fromAge === to) return false;
      return w.fromAge <= ctx.bEnd && to >= ctx.A;
    });
  }
  // 誕生日を過ぎて「前の年に置いたまま」の経験（年を決めた物・範囲が過去に終わった物）
  //   土台は「1年だけ」置いた物だけ戻す（範囲を決めた土台は、その範囲で終わるのが本人の計画なので戻さない）
  function rolloverCandidates(doc, ctx) {
    return live(doc.items).filter(function (it) {
      if (it.status !== 'placed' || it.repeat) return false;
      var w = it.when || {};
      if (w.date || w.fromAge == null) return false;
      var to = w.toAge == null ? w.fromAge : w.toAge;
      if (it.kind === 'theme' && w.fromAge !== to) return false;
      return to < ctx.A;
    });
  }
  // 自動で「この季節のどこかで」に戻す（件数は出さない。1行だけ知らせる）
  function applyRollover(doc, ctx, deviceId) {
    var moved = rolloverCandidates(doc, ctx);
    moved.forEach(function (it) {
      it.prevWhen = clone(it.when);
      it.when = { fromAge: ctx.A, toAge: ctx.bEnd, date: null, endDate: null, precision: 'day' };
      touch(it, deviceId);
    });
    return moved.map(function (it) { return it.id; });
  }
  // 「行ってきましたか？」：日付が過ぎたのに、まだ思い出が無い経験
  function dueMemories(doc, ctx) {
    return live(doc.items).filter(function (it) {
      if (it.kind !== 'exp' || it.status !== 'placed' || it.repeat) return false;
      var ld = lastDay(it);
      return ld != null && ld < ctx.today;
    }).sort(function (a, b) { return a.when.date < b.when.date ? -1 : 1; });
  }

  // --- 7-4. 窓（賞味期限） ---
  function effEnd(it, ctx) {
    if (it.window && it.window.endAge != null) return it.window.endAge;
    if (it.body === 'hard') return ctx.hardAge;
    if (it.body === 'light') return ctx.planEnd;
    return ctx.bodyAge;
  }
  function repeatEnd(it, ctx) {
    var e = effEnd(it, ctx);
    return it.repeat && it.repeat.toAge != null ? Math.min(it.repeat.toAge, e) : e;
  }
  function windowInfo(it, ctx) {
    if (it.kind !== 'exp' || it.status === 'done' || it.status === 'letgo') return null;
    if (it.repeat && repeatEnd(it, ctx) < ctx.A) return null;   // 回数を数え終えた回数型は「窓」の話ではない
    var end = it.repeat ? repeatEnd(it, ctx) : effEnd(it, ctx);
    var A = ctx.A;
    var yearsLeft = end - A;
    var placed = it.repeat ? null : placedAge(it, ctx);
    var warn = A < 40 ? 5 : 8;
    var state = 'open';
    if (yearsLeft < 0) state = 'passed';
    else if (placed != null && placed > end) state = 'outside';
    else if (it.window && it.window.startAge != null && placed != null && placed < it.window.startAge) state = 'notYet';
    else if (yearsLeft <= warn) state = 'closing';
    return { end: end, yearsLeft: yearsLeft, state: state };
  }
  function windowText(info) {
    if (!info) return '';
    if (info.state === 'passed') return '窓を過ぎました（' + info.end + '歳ごろまで）';
    if (info.state === 'outside') return '窓の外に置かれています（' + info.end + '歳ごろまで）';
    if (info.state === 'closing') return info.yearsLeft === 0 ? '今年が最後の窓です' : '窓が閉じるまで あと約' + info.yearsLeft + '年';
    if (info.state === 'notYet') return 'まだ早いかもしれません';
    return '窓は' + info.end + '歳ごろまで';
  }
  // ホームの「窓が閉じかけ」：閉じかけ・窓の外・過ぎた・体力がいるのに時期が決まっていない物
  function closingList(doc, ctx) {
    var out = [];
    live(doc.items).forEach(function (it) {
      if (it.kind !== 'exp' || (it.status !== 'idea' && it.status !== 'placed')) return;
      var w = windowInfo(it, ctx);
      if (!w) return;
      var hit = w.state === 'closing' || w.state === 'outside' || w.state === 'passed';
      var hardIdea = it.status === 'idea' && it.body === 'hard' && w.state === 'open';
      if (hit || hardIdea) out.push({ item: it, info: w, hardIdea: hardIdea && !hit });
    });
    // 過ぎた物は後ろへ（本当に閉じかけている物を先に見せる）
    out.sort(function (a, b) {
      var pa = a.info.state === 'passed' ? 1 : 0, pb = b.info.state === 'passed' ? 1 : 0;
      return pa - pb || a.info.yearsLeft - b.info.yearsLeft;
    });
    return out;
  }

  // --- 7-5. 回数と思い出の配当 ---
  function childrenOf(doc, parentId) {
    return live(doc.items).filter(function (it) { return it.parentId === parentId && it.status !== 'letgo'; });
  }
  function inYear(dateStr, yr) { return !!dateStr && dateStr >= yr.from && dateStr <= yr.to; }
  // その年（A歳の1年）に入る「1回」（子）の数。日付で置いた子も「◯歳の1年」に置いた子も数える
  function kidsInYear(doc, pid, A, ctx) {
    var yr = A === ctx.A ? ctx.year : ageYear(ctx.birth, A);
    return childrenOf(doc, pid).filter(function (k) {
      if (k.status !== 'placed' && k.status !== 'done') return false;
      var w = k.when || {};
      return w.date ? inYear(w.date, yr) : (w.fromAge === A && (w.toAge == null || w.toAge === A));
    }).length;
  }
  function usedThisYear(doc, it, ctx) {
    var own = live(doc.logs).filter(function (l) { return l.itemId === it.id && inYear(l.date, ctx.year); }).length;
    return kidsInYear(doc, it.id, ctx.A, ctx) + own;
  }
  function repeatRemaining(doc, it, ctx) {
    if (!it.repeat) return null;
    var end = repeatEnd(it, ctx);
    var years = Math.max(0, end - Math.max(ctx.A, it.repeat.fromAge) + 1);
    return Math.max(0, Math.round(it.repeat.perYear * years - usedThisYear(doc, it, ctx)));
  }
  function dividendYears(ctx, fromAge) {
    return Math.max(0, ctx.planEnd - Math.max(ctx.A, fromAge == null ? ctx.A : fromAge));
  }
  function summersLeft(ctx) { return Math.max(0, ctx.bodyAge - ctx.A); }

  // --- 7-6. 容量（A歳の1年）。上限を超えても止めない。事実だけを返す ---
  function capacity(doc, ctx, A) {
    if (A == null) A = ctx.A;
    var yr = A === ctx.A ? ctx.year : ageYear(ctx.birth, A);
    var items = doc.items;
    var leaveUsed = 0, leaveMissing = 0, hours = 0, hoursMissing = 0, cost = 0, give = 0, costMissing = 0;
    yearFocus(doc, ctx, A).forEach(function (f) {
      var it = f.item;
      var occ = 1;
      if (it.repeat) occ = Math.max(0, it.repeat.perYear - kidsInYear(doc, it.id, A, ctx));
      // occ が0でも、週の時間と毎年の費用は数え続ける（1回ごとの分だけを飛ばす）
      var parent = it.parentId ? byId(items, it.parentId) : null;
      // 休み（子が未入力なら親の1回分を使う）
      if (it.kind === 'exp') {
        var lv = it.leaveDays != null ? it.leaveDays : (parent && parent.leaveDays != null ? parent.leaveDays : null);
        // 未入力として数えるのは、休みが要りそうな物だけ（旅・何日もかかる物・回数型とその1回）
        var needsLeave = it.category === '旅' || !!(it.when && it.when.endDate) || !!it.repeat || !!parent;
        if (occ > 0) { if (lv == null) { if (needsLeave) leaveMissing++; } else leaveUsed += lv * occ; }
      }
      // 週の時間
      if (it.hoursPerWeek != null) {
        var ratio = 1;
        if (it.kind === 'theme' && it.goalDate && inYear(it.goalDate, yr)) ratio = clamp(daysBetween(yr.from, it.goalDate) / yr.days, 0, 1);
        hours += it.hoursPerWeek * ratio;
      }
      if (it.hoursEach != null && occ > 0) hours += it.hoursEach * occ / 52;
      if (it.kind === 'theme' && it.hoursPerWeek == null) hoursMissing++;
      // お金（与えるは別に小計）
      var c = it.cost || {};
      var once = c.once != null ? c.once : (parent && parent.cost && parent.cost.once != null ? parent.cost.once : null);
      var amt = 0, known = false;
      if (once != null) { amt += once * occ; known = true; }
      if (c.perYear != null) { amt += c.perYear; known = true; }
      if (!known && it.kind === 'exp' && occ > 0) costMissing++;
      if (it.give || it.category === '与える') give += amt; else cost += amt;
    });
    var s = doc.settings, yp = yearPlan(doc, A), ov = yp ? yp.override : {};
    var leaveCap = ov && ov.leaveDays != null ? ov.leaveDays : s.leaveDaysPerYear;
    var hoursCap = ov && ov.freeHoursPerWeek != null ? ov.freeHoursPerWeek : s.freeHoursPerWeek;
    return {
      leave: { used: leaveUsed, cap: leaveCap, missing: leaveMissing },
      hours: { used: Math.round(hours * 10) / 10, cap: hoursCap, missing: hoursMissing },
      cost: { total: cost + give, exp: cost, give: give, missing: costMissing }
    };
  }

  // 年・バケツ別の予定費用（お金の前提が無くても出せる表）
  function costTable(doc, ctx) {
    var perAge = {};
    function add(age, key, amt) {
      if (age < ctx.A || age >= ctx.planEnd || !amt) return;
      var r = perAge[age] || (perAge[age] = { exp: 0, theme: 0, give: 0 });
      r[key] += amt;
    }
    live(doc.items).forEach(function (it) {
      if (it.status !== 'placed') return;
      var c = it.cost || {};
      var parent = it.parentId ? byId(doc.items, it.parentId) : null;
      var once = c.once != null ? c.once : (parent && parent.cost && parent.cost.once != null ? parent.cost.once : null);
      var key = (it.give || it.category === '与える') ? 'give' : it.kind === 'theme' ? 'theme' : 'exp';
      var r = itemRange(it, ctx);
      if (!r) return;
      var from = Math.max(ctx.A, r[0]), to = r[1], a;
      if (it.repeat) {
        for (a = from; a <= to; a++) {
          var occ = Math.max(0, it.repeat.perYear - kidsInYear(doc, it.id, a, ctx));
          if (once != null) add(a, key, Math.round(once * occ));
          if (c.perYear != null) add(a, key, c.perYear);
        }
        return;
      }
      if (once != null) {
        var span = Math.max(1, to - from + 1);
        if (it.when.date || r[0] === r[1]) add(r[0], key, once);
        else for (a = from; a <= to; a++) add(a, key, Math.round(once / span));
      }
      if (c.perYear != null) for (a = from; a <= to; a++) add(a, key, c.perYear);
    });
    var buckets = lifeBuckets(ctx).map(function (b) {
      var row = { label: b.label, start: b.start, end: b.end, exp: 0, theme: 0, give: 0 };
      for (var a = b.start; a <= b.end; a++) if (perAge[a]) { row.exp += perAge[a].exp; row.theme += perAge[a].theme; row.give += perAge[a].give; }
      row.total = row.exp + row.theme + row.give;
      return row;
    });
    var years = [];
    for (var a = ctx.A; a <= ctx.bEnd; a++) {
      var p = perAge[a] || { exp: 0, theme: 0, give: 0 };
      years.push({ age: a, exp: p.exp, theme: p.theme, give: p.give, total: p.exp + p.theme + p.give });
    }
    return { years: years, buckets: buckets };
  }

  // 大切な人の、ある時期（自分が age 歳の年）の年齢
  function personAgeAt(p, ctx, age) {
    if (p.birthYear == null) return null;
    var myYear = parseYmd(ctx.birth).y + age;
    return myYear - p.birthYear;
  }

  // --- 7-7. 本の意図チェック（置く時） ---
  //   target = { fromAge, toAge } または { date }。返り値は指摘の配列（空なら「合っています」）
  function isAnytime(it) {
    var z = it.dwz;
    if (!z || z.until !== 'any') return false;
    return !(z.why || []).some(function (w) { return TIME_SENSITIVE.indexOf(w) >= 0; });
  }
  function untilText(it, end) {
    var z = it.dwz;
    if (z && z.until && z.until !== 'any') return UNTIL_LABEL[z.until];
    return end + '歳ごろまで';
  }
  function dwzCheck(it, target, ctx) {
    var out = [];
    var z = it.dwz || {};
    var tFrom = target.date ? ageOn(ctx.birth, target.date) : target.fromAge;
    if (tFrom == null) return out;
    var end = effEnd(it, ctx);
    var why = z.why || [];
    // R1 いつでもできる物を、若い今の季節に置こうとしている
    var hasNext = ctx.bEnd + 1 < ctx.planEnd;
    if (it.kind === 'exp' && isAnytime(it) && tFrom <= ctx.bEnd && !target.repeat && hasNext && ctx.A < ctx.hardAge) {
      var nextLabel = bucketLabel(ctx.bEnd + 1, ctx.size);
      out.push({ id: 'R1', level: 'nudge', rule: 'ルール1・7',
        text: 'これは' + nextLabel + 'でも、その先でもできそうです。本の考え方では、若い時期は「今しかできない経験」に優先して使います。',
        actions: ['later', 'theme', 'anyway'] });
    }
    // R2 窓の外（答えた年齢より後に置こうとしている）
    if (it.kind === 'exp' && tFrom > end) {
      out.push({ id: 'R2', level: 'warn', rule: 'ルール7',
        text: '「' + untilText(it, end) + '」の経験を' + tFrom + '歳の時期に置こうとしています（窓の外）。' });
    } else if (it.kind === 'exp' && it.body === 'hard' && tFrom >= ctx.hardAge) {
      // R3 体力がいる経験を後半に
      out.push({ id: 'R3', level: 'warn', rule: 'ルール6',
        text: '体力がいる経験です。' + ctx.hardAge + '歳ごろまでの、体がよく動く時期に置くのがおすすめです。' });
    }
    // R4 人の理由があるのに「誰と」が未入力
    if (why.indexOf('people') >= 0 && !(it.withIds && it.withIds.length)) {
      out.push({ id: 'R4', level: 'info', rule: 'ルール5・7', text: '「誰と」を結ぶと、その時期のその人の年齢が見えます。' });
    }
    // R5 期限のある経験を後ろへずらす（思い出の配当が短くなる）
    var basis = placedAge(it, ctx);
    if (basis == null || basis < ctx.A) basis = ctx.A;
    if (it.kind === 'exp' && z.until && z.until !== 'any' && tFrom > basis && tFrom <= end) {
      out.push({ id: 'R5', level: 'info', rule: 'ルール2',
        text: '早いほど思い出の配当が長く続きます（約' + dividendYears(ctx, basis) + '年 → 約' + dividendYears(ctx, tFrom) + '年）。' });
    }
    // R6 思い出に残りにくいのに高い
    var once = it.cost && it.cost.once;
    if (z.memory === 'low' && once != null && once >= 100000) {
      out.push({ id: 'R6', level: 'info', rule: 'ルール1',
        text: '思い出に残りにくいものに大きな額を使う予定です。本当にやりたいことか、一度考えてみませんか。' });
    }
    return out;
  }
  // 3問の答えを項目に反映する（窓・体力も連動）
  function applyDwzAnswers(it, answers) {
    var z = Object.assign({}, it.dwz || {}, {
      until: oneOf(answers.until, ['30s', '40s', '60s', 'any'], null),
      why: (answers.why || []).filter(function (x) { return WHY_LABEL[x]; }),
      memory: oneOf(answers.memory, ['high', 'mid', 'low'], null),
      at: nowIso()
    });
    if (z.why.indexOf('none') >= 0 && z.why.length > 1) z.why = z.why.filter(function (x) { return x !== 'none'; });
    it.dwz = z;
    if (z.until && UNTIL_AGE[z.until]) it.window = Object.assign({}, it.window, { endAge: UNTIL_AGE[z.until] });
    else if (z.until === 'any') it.window = Object.assign({}, it.window, { endAge: null });
    if (z.why.indexOf('body') >= 0) it.body = 'hard';
    else if (z.until === 'any' && it.body === 'hard') it.body = 'normal';
    if (z.until === 'any' && z.why.indexOf('body') < 0) it.body = 'light';
    return it;
  }
  function hasDwz(it) { return !!(it.dwz && it.dwz.until); }

  // --- 7-8. 全体の本の意図チェックリスト（点数は出さない）---
  function dwzChecklist(doc, ctx) {
    var items = live(doc.items);
    var exps = items.filter(function (i) { return i.kind === 'exp' && i.status !== 'letgo'; });
    var res = [];
    function ids(arr) { return arr.map(function (i) { return i.id; }); }

    // C1 今の季節を「いつでもできること」が占めていないか
    var young = exps.filter(function (i) {
      if (i.status !== 'placed' || i.repeat) return false;
      var r = itemRange(i, ctx);
      return r && r[0] <= ctx.bEnd && r[1] >= ctx.A && isAnytime(i);
    });
    var noReason = young.filter(function (i) { return !(i.dwz && i.dwz.reason); });
    res.push({ id: 'C1', ok: noReason.length === 0, rule: 'ルール1・7',
      title: '今の季節を「いつでもできること」が占めていない',
      detail: young.length ? '今の季節に置いた「何歳でもできる」経験：' + young.length + '件（理由つき ' + (young.length - noReason.length) + '件）' : '問題ありません',
      itemIds: ids(noReason.length ? noReason : young) });

    // C2 窓が閉じかけ・窓の外の経験が、置かれないままになっていないか
    var c2 = exps.filter(function (i) {
      var w = windowInfo(i, ctx);
      if (!w) return false;
      if (i.status === 'idea') return w.state === 'closing' || w.state === 'passed';
      return w.state === 'outside' || w.state === 'passed';
    });
    res.push({ id: 'C2', ok: c2.length === 0, rule: 'ルール7',
      title: '窓が閉じかけ・窓の外の経験を、そのままにしていない',
      detail: c2.length ? c2.length + '件あります' : '問題ありません', itemIds: ids(c2) });

    // C3 体力がいる経験を後半に置いていないか
    var c3 = exps.filter(function (i) {
      if (i.status !== 'placed' || i.body !== 'hard') return false;
      var a = placedAge(i, ctx);
      return a != null && a >= ctx.hardAge;
    });
    res.push({ id: 'C3', ok: c3.length === 0, rule: 'ルール6',
      title: '体力がいる経験を、体がよく動く時期に置いている',
      detail: c3.length ? ctx.hardAge + '歳以降に置いた体力のいる経験：' + c3.length + '件' : '問題ありません', itemIds: ids(c3) });

    // C4 ずっと先の人生（後半）が空っぽではないか
    var lateAge = Math.max(50, ctx.A + 15);
    var hasLate = exps.some(function (i) {
      if (i.status !== 'placed') return false;
      var r = itemRange(i, ctx);
      return r && r[1] >= lateAge;
    });
    res.push({ id: 'C4', ok: ctx.planEnd <= lateAge ? 'na' : hasLate, rule: 'ルール7',
      title: lateAge + '歳以降の人生にも、経験が置かれている',
      detail: hasLate ? '置かれています' : '後半の季節が空っぽです。静かな楽しみも季節ごとにあります', itemIds: [] });

    // C5 経験につながっていない土台（惰性になっていないか）
    var themes = items.filter(function (i) { return i.kind === 'theme' && i.status === 'placed'; });
    var used = {};
    exps.forEach(function (e) { (e.needsIds || []).forEach(function (id) { used[id] = true; }); });
    var c5 = themes.filter(function (t) { return !used[t.id]; });
    res.push({ id: 'C5', ok: themes.length === 0 ? 'na' : c5.length === 0, rule: 'ルール6',
      title: '土台（習慣・準備）が、支える経験とつながっている',
      detail: c5.length ? 'どの経験のための土台か決まっていない物：' + c5.length + '件' : (themes.length ? 'つながっています' : '土台はまだありません'),
      itemIds: ids(c5) });

    // C6 与える（時期を決めて置いた物だけを数える＝「効果が大きい時に」）
    function timed(i) { return i.status === 'placed' || i.status === 'done'; }
    var gives = items.filter(function (i) { return i.give || i.category === '与える'; });
    var hasGive = gives.some(timed);
    res.push({ id: 'C6', ok: hasGive, rule: 'ルール5',
      title: '「与える」（親との時間・贈り物・寄付など）を、時期を決めて置いている',
      detail: hasGive ? '置いています' : (gives.length ? '候補にはあります。いつ与えるのが一番効果が大きいか、時期を決めてみませんか' : '生きているうちに、効果が大きい時に与えるのが本の考え方です'),
      itemIds: gives.filter(function (i) { return i.status === 'idea'; }).map(function (i) { return i.id; }) });

    // C7 挑戦
    var risks = items.filter(function (i) { return i.risk || i.category === '挑戦'; });
    var hasRisk = risks.some(timed);
    res.push({ id: 'C7', ok: hasRisk, rule: 'ルール9',
      title: '「挑戦」（失うものが少ない今こそ）を、時期を決めて置いている',
      detail: hasRisk ? '置いています' : (risks.length ? '候補にはあります。失うものが少ない時期に置いてみませんか' : '大きなリスクは、失うものが少ない時期に取るのが本の考え方です'),
      itemIds: risks.filter(function (i) { return i.status === 'idea'; }).map(function (i) { return i.id; }) });

    // C8 この1年で思い出を残しているか
    var since = addDays(ctx.today, -365);
    var recent = live(doc.logs).some(function (l) { return l.date && l.date >= since; });
    var young180 = daysBetween(doc.createdAt.slice(0, 10), ctx.today) < 180;
    res.push({ id: 'C8', ok: recent ? true : (young180 ? 'na' : false), rule: 'ルール2',
      title: 'この1年で、思い出を残している',
      detail: recent ? '残しています' : (young180 ? '使い始めたばかりです' : 'この1年、思い出の記録がありません'), itemIds: [] });

    // C9 休みを経験に使えそうか
    var cap = capacity(doc, ctx);
    var c9;
    if (cap.leave.cap == null) c9 = { ok: 'na', detail: '年間の休みの日数を入れると確認できます' };
    else if (cap.leave.used < cap.leave.cap * 0.5 && cap.leave.missing > 0) c9 = { ok: 'na', detail: '休みの日数が未入力の経験が' + cap.leave.missing + '件あります。項目の「時間と休み」で入れると確認できます' };
    else if (cap.leave.used < cap.leave.cap * 0.5) c9 = { ok: false, detail: '今年の休み' + cap.leave.cap + '日のうち、経験に使う予定は' + cap.leave.used + '日です。経験に回せる休みがあります' };
    else c9 = { ok: true, detail: '今年の休み' + cap.leave.cap + '日のうち' + cap.leave.used + '日を経験に使う予定です' };
    res.push({ id: 'C9', ok: c9.ok, rule: 'ルール6', title: '今年の休みを、経験に使えそう', detail: c9.detail, itemIds: [] });

    // C10 3問に答えていない配置済みの経験
    var c10 = exps.filter(function (i) { return i.status === 'placed' && !hasDwz(i); });
    res.push({ id: 'C10', ok: c10.length === 0, rule: 'ルール7',
      title: '置いた経験すべてで、本の3つの問いに答えている',
      detail: c10.length ? c10.length + '件がまだです' : '答えています', itemIds: ids(c10) });

    return res;
  }

  /* =====================================================================
   * 8. 端末内の保存 createStore
   *   タスクスライムの「保存の3点セット」を引き継ぐ：
   *     ① 起動が終わるまで保存しない（ready ゲート）＝ただ開いただけで上書きしない
   *     ② 400ms まとめて保存（連続した変更を1回に）
   *     ③ 画面が裏に回る/閉じる瞬間に保留中を即書き出し（flush）
   *   さらに：別の画面が保存していたら合体してから書く（saveSeq の照合）
   * ===================================================================== */
  function stripDefaults(rec, defaults) {
    var out = {};
    Object.keys(rec).forEach(function (k) {
      if (k in defaults && same(rec[k], defaults[k])) return;   // 既定値と同じ項目は省く
      if (k === 'deletedAt' && rec[k] == null) return;
      if (k === 'by') return;
      out[k] = rec[k];
    });
    return out;
  }
  function compactDoc(doc) {
    var out = {};
    Object.keys(doc).forEach(function (k) {
      var v = doc[k];
      if (Array.isArray(v) && TYPE_DEFAULTS[k]) {
        var d = TYPE_DEFAULTS[k]();
        out[k] = v.map(function (r) { return stripDefaults(r, d); });
      } else out[k] = v;
    });
    return out;
  }
  function serialize(doc) { return JSON.stringify(compactDoc(doc)); }
  function peekSeq(raw) { var m = /"saveSeq":"([^"]+)"/.exec(raw || ''); return m ? m[1] : null; }

  function createStore(storage, hooks) {
    hooks = hooks || {};
    var ready = false, timer = null, pending = null, lastSeq = null, readOnly = false;
    function read(key) { try { return storage.getItem(key); } catch (e) { return null; } }
    function keysWith(prefix) {
      var ks = [];
      try { for (var i = 0; i < storage.length; i++) { var k = storage.key(i); if (k && k.indexOf(prefix) === 0) ks.push(k); } } catch (e) {}
      return ks.sort();
    }
    function pruneCorrupt(keep) {
      var ks = keysWith(KEYS.corrupt);
      while (ks.length > keep) { try { storage.removeItem(ks.shift()); } catch (e) { break; } }
    }
    function stashCorrupt(raw) {
      pruneCorrupt(1);
      try { storage.setItem(KEYS.corrupt + new Date().toISOString(), raw); } catch (e) {}
    }
    function load() {
      var raw = read(KEYS.data);
      if (raw == null) return { status: 'empty' };
      var r = ingest(raw);
      if (!r.ok) { stashCorrupt(raw); return { status: 'corrupt', reason: r.reason }; }
      lastSeq = r.doc.saveSeq;
      readOnly = r.readOnly;
      if (r.migrated) { try { storage.setItem(KEYS.prev, raw); } catch (e) {} }   // 移行の直前を控えておく
      return { status: r.readOnly ? 'newer' : 'ok', doc: r.doc, migrated: r.migrated };
    }
    function writeData(text) {
      try { storage.setItem(KEYS.data, text); return true; }
      catch (e) {
        // 容量が足りない時：控え（daily）→ 古い退避 の順に削ってもう一度
        try { storage.removeItem(KEYS.daily); storage.removeItem(KEYS.dailyDay); } catch (e2) {}
        pruneCorrupt(0);
        try { storage.setItem(KEYS.data, text); return true; } catch (e3) { return false; }
      }
    }
    function saveNow(doc) {
      if (readOnly) return { ok: false, reason: 'readOnly' };
      var cur = read(KEYS.data);
      if (cur != null && lastSeq != null) {
        var curSeq = peekSeq(cur);
        if (curSeq && curSeq !== lastSeq) {
          // 別の画面（アプリ／Chromeのタブ）が保存していた → 上書きせず合体してから書く
          var r = ingest(cur);
          if (r.ok) {
            if (r.readOnly) { readOnly = true; if (hooks.onReadOnly) hooks.onReadOnly(); return { ok: false, reason: 'newer' }; }
            var merged = mergeDocs(doc, r.doc);
            Object.keys(doc).forEach(function (k) { delete doc[k]; });
            Object.assign(doc, merged);
            if (hooks.onMerged) hooks.onMerged(doc);
          }
        }
      }
      doc.saveSeq = uuid();
      doc.savedAt = nowIso(doc.savedAt);
      var text = serialize(doc);
      if (!writeData(text)) { if (hooks.onError) hooks.onError('quota'); return { ok: false, reason: 'quota' }; }
      lastSeq = doc.saveSeq;
      return { ok: true, bytes: text.length };
    }
    function schedule(doc) {
      if (!ready || readOnly) return false;
      pending = doc;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        var d = pending; pending = null;
        var r = saveNow(d);
        if (hooks.onSaved) hooks.onSaved(r);
      }, 400);
      return true;
    }
    function flush() {
      if (!timer) return null;
      clearTimeout(timer); timer = null;
      var d = pending; pending = null;
      var r = saveNow(d);
      if (hooks.onSaved) hooks.onSaved(r);
      return r;
    }
    function writePrev(doc) {
      // 読み取り専用（新しい版のデータ）の時は、丸めた形ではなく生の文字をそのまま控える
      if (readOnly) { var raw = read(KEYS.data); if (raw == null) return false; try { storage.setItem(KEYS.prev, raw); return true; } catch (e) { return false; } }
      try { storage.setItem(KEYS.prev, serialize(doc)); return true; } catch (e) { return false; }
    }
    function readRaw() { return read(KEYS.data); }
    function readPrev() { var raw = read(KEYS.prev); return raw ? ingest(raw) : null; }
    function daily(doc, today) {
      if (!ready || readOnly) return false;          // 起動が終わる前・読み取り専用では、控えを上書きしない
      if (read(KEYS.dailyDay) === today) return false;
      try { storage.setItem(KEYS.daily, serialize(doc)); storage.setItem(KEYS.dailyDay, today); return true; } catch (e) { return false; }
    }
    function readDaily() { var raw = read(KEYS.daily); return raw ? { day: read(KEYS.dailyDay), result: ingest(raw) } : null; }
    function corruptCopies() { return keysWith(KEYS.corrupt).map(function (k) { return { key: k, raw: read(k) }; }); }
    function usage() {
      var total = 0;
      try { for (var i = 0; i < storage.length; i++) { var k = storage.key(i); var v = storage.getItem(k) || ''; if (k && k.indexOf('dwz-') === 0) total += (k.length + v.length) * 2; } } catch (e) {}
      return total;   // バイト（localStorage は1文字2バイトで数える）
    }
    function readDevice() {
      var raw = read(KEYS.device);
      var d = null;
      try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
      if (!isObj(d)) d = {};
      if (typeof d.deviceId !== 'string') d.deviceId = uuid();
      return d;
    }
    function writeDevice(d) { try { storage.setItem(KEYS.device, JSON.stringify(d)); return true; } catch (e) { return false; } }
    return {
      load: load, saveNow: saveNow, schedule: schedule, flush: flush,
      setReady: function (v) { ready = v !== false; }, isReady: function () { return ready; },
      isReadOnly: function () { return readOnly; }, setReadOnly: function (v) { readOnly = !!v; },
      resetSeq: function (seq) { lastSeq = seq; },
      writePrev: writePrev, readPrev: readPrev, readRaw: readRaw, daily: daily, readDaily: readDaily,
      corruptCopies: corruptCopies, usage: usage, readDevice: readDevice, writeDevice: writeDevice,
      pending: function () { return !!timer; }
    };
  }

  /* =====================================================================
   * 9. 書き出し・下書きの取り込み
   * ===================================================================== */
  var README = 'このファイルは「タイムバケット」（『DIE WITH ZERO』の考え方で人生の時期ごとに経験を置くアプリ）の人生データです。' +
    '中身は JSON 形式の文字です。アプリの設定→データを守る→取り込み で、このファイルから元に戻せます。' +
    'アプリが無くても、items（経験と土台）・logs（思い出）・people（大切な人）を読めば中身が分かります。';

  // 書き出し用の文字（端末だけの情報＝同期の秘密キーなどは含めない）
  function exportText(doc) {
    var o = { _readme: README, exportedAt: nowIso(), appVersion: APP_VERSION };
    var c = compactDoc(doc);
    Object.keys(c).forEach(function (k) { o[k] = c[k]; });
    return JSON.stringify(o, null, 1);
  }
  function exportFileName(today) { return 'timebucket-backup-' + today + '.txt'; }

  // 下書きパック（Claude が用意した候補）を候補箱に入れる。同じ下書きは二度入れない
  function importDrafts(doc, input) {
    var data = input;
    if (typeof input === 'string') { try { data = JSON.parse(input); } catch (e) { return { ok: false, reason: 'parse' }; } }
    if (!isObj(data) || data.app !== 'dwz-timebucket-drafts' || !Array.isArray(data.items)) return { ok: false, reason: 'app' };
    var seen = {};
    (doc.items || []).forEach(function (i) { if (i.draftKey) seen[i.draftKey] = i.id; });
    (doc.people || []).forEach(function (p) { if (p.draftKey) seen['person:' + p.draftKey] = p.id; });
    var added = 0, skipped = 0, created = [];
    (Array.isArray(data.people) ? data.people : []).forEach(function (p) {
      if (!isObj(p) || !p.key) return;
      if (seen['person:' + p.key]) { skipped++; return; }
      var np = newPerson({ name: str(p.name, ''), relation: p.relation, draftKey: p.key });
      doc.people.push(np); seen['person:' + p.key] = np.id; added++;
    });
    data.items.forEach(function (d) {
      if (!isObj(d) || !d.key || !d.title) return;
      if (seen[d.key]) { skipped++; return; }
      var it = newItem({
        kind: d.kind === 'theme' ? 'theme' : 'exp', title: str(d.title, ''), note: str(d.note, ''), category: str(d.category, ''),
        body: d.body, origin: 'draft', status: 'idea', draftKey: d.key,
        goal: str(d.goal, ''), pillar: d.pillar || null,
        hint: isObj(d.hint) ? clone(d.hint) : null
      });
      it._parentKey = d.parentKey || null;
      it._withKeys = Array.isArray(d.withKeys) ? d.withKeys : [];
      it._needKeys = Array.isArray(d.needsKeys) ? d.needsKeys : [];
      doc.items.push(it); seen[d.key] = it.id; created.push(it); added++;
    });
    created.forEach(function (it) {
      if (it._parentKey && seen[it._parentKey]) it.parentId = seen[it._parentKey];
      it.withIds = it._withKeys.map(function (k) { return seen['person:' + k]; }).filter(Boolean);
      it.needsIds = it._needKeys.map(function (k) { return seen[k]; }).filter(Boolean);
      delete it._parentKey; delete it._withKeys; delete it._needKeys;
    });
    return { ok: true, added: added, skipped: skipped };
  }

  // 下書きの案（休み・時間・費用・目標日）のうち、まだ入っていない物を項目に入れる（置いた後にだけ使う）
  function hintExtras(it) {
    var hnt = it.hint || {}, out = {};
    if (hnt.leaveDays != null && it.leaveDays == null) out.leaveDays = hnt.leaveDays;
    if (hnt.hoursPerWeek != null && it.hoursPerWeek == null) out.hoursPerWeek = hnt.hoursPerWeek;
    if (hnt.goalDate && !it.goalDate && isYmd(hnt.goalDate)) out.goalDate = hnt.goalDate;
    if (isObj(hnt.cost) && hnt.cost.once != null && (!it.cost || it.cost.once == null)) out.costOnce = int(hnt.cost.once, null);
    if (isObj(hnt.cost) && hnt.cost.perYear != null && (!it.cost || it.cost.perYear == null)) out.costPerYear = int(hnt.cost.perYear, null);
    return out;
  }
  function applyHintExtras(it) {
    var x = hintExtras(it);
    if (x.leaveDays != null) it.leaveDays = x.leaveDays;
    if (x.hoursPerWeek != null) it.hoursPerWeek = x.hoursPerWeek;
    if (x.goalDate) it.goalDate = x.goalDate;
    if (x.costOnce != null || x.costPerYear != null) it.cost = Object.assign({}, it.cost, x.costOnce != null ? { once: x.costOnce } : {}, x.costPerYear != null ? { perYear: x.costPerYear } : {});
    return it;
  }

  // 数字の見せ方
  function yen(n) {
    if (n == null) return '';
    if (Math.abs(n) >= 10000) return (Math.round(n / 1000) / 10).toLocaleString('ja-JP') + '万円';
    return n.toLocaleString('ja-JP') + '円';
  }

  /* ---------- 外へ出す ---------- */
  var DWZ = {
    APP_NAME: APP_NAME, APP_VERSION: APP_VERSION, SCHEMA_VERSION: SCHEMA_VERSION, MIN_WRITER: MIN_WRITER, WRITER_LEVEL: WRITER_LEVEL,
    EPOCH0: EPOCH0, KEYS: KEYS, DEFAULTS: DEFAULTS, LIFE_TABLE: LIFE_TABLE, CATEGORIES: CATEGORIES, RULES: RULES,
    UNTIL_AGE: UNTIL_AGE, UNTIL_LABEL: UNTIL_LABEL, WHY_LABEL: WHY_LABEL, MEMORY_LABEL: MEMORY_LABEL, TIME_SENSITIVE: TIME_SENSITIVE,
    PROMPTS: PROMPTS, EXAMPLES: EXAMPLES, promptFor: promptFor,
    // 小道具
    uuid: uuid, nowIso: nowIso, normIso: normIso, isoNewer: isoNewer, esc: esc, safeLink: safeLink, clone: clone, yen: yen,
    // 日付
    isLeap: isLeap, parseYmd: parseYmd, fmtYmd: fmtYmd, isYmd: isYmd, ageOn: ageOn, addDays: addDays, daysBetween: daysBetween,
    ageYear: ageYear, todayYmd: todayYmd, endOfMonth: endOfMonth, jpDate: jpDate, shortDate: shortDate,
    // 記録
    newDoc: newDoc, newItem: newItem, newLog: newLog, newPerson: newPerson, touch: touch, live: live, byId: byId,
    removeRec: removeRec, restoreRec: restoreRec, yearPlan: yearPlan, ensureYearPlan: ensureYearPlan,
    ITEM_DEFAULTS: ITEM_DEFAULTS,
    // 関所・移行・合体
    ingest: ingest, normalizeItem: normalizeItem, MIGRATIONS: MIGRATIONS, mergeDocs: mergeDocs,
    // 計算
    ctxOf: ctxOf, bucketOf: bucketOf, bucketLabel: bucketLabel, lifeBuckets: lifeBuckets, yearsUntilAge: yearsUntilAge,
    yearProgress: yearProgress, itemRange: itemRange, placedAge: placedAge, lastDay: lastDay, whenLabel: whenLabel,
    yearFocus: yearFocus, seasonSomewhere: seasonSomewhere, rolloverCandidates: rolloverCandidates, applyRollover: applyRollover,
    dueMemories: dueMemories, effEnd: effEnd, repeatEnd: repeatEnd, windowInfo: windowInfo, windowText: windowText,
    closingList: closingList, childrenOf: childrenOf, repeatRemaining: repeatRemaining, dividendYears: dividendYears,
    summersLeft: summersLeft, kidsInYear: kidsInYear, capacity: capacity, costTable: costTable, personAgeAt: personAgeAt,
    isAnytime: isAnytime, dwzCheck: dwzCheck, applyDwzAnswers: applyDwzAnswers, hasDwz: hasDwz, dwzChecklist: dwzChecklist,
    // 保存・書き出し
    compactDoc: compactDoc, serialize: serialize, createStore: createStore, exportText: exportText, exportFileName: exportFileName,
    importDrafts: importDrafts, hintExtras: hintExtras, applyHintExtras: applyHintExtras
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DWZ;
  else root.DWZ = DWZ;
})(typeof window !== 'undefined' ? window : globalThis);
