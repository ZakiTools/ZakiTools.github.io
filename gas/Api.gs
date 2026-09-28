/* =====================================================================
 * Api.gs — アプリからの受け取り口（ウェブアプリ）
 *   すべて POST（Content-Type: text/plain）で、本文は JSON：{v, op, key, deviceId, deviceName, appVersion, writer, ...}
 *   応答はいつも {ok, apiVersion, serverTime, ...}。本文やキーはログに出さない。
 *   op：ping（状態）／push（控えを送る）／list（世代の一覧）／get（1つ読む）／review（今すぐレビュー）
 * ===================================================================== */
var APP_URL = 'https://zakitools.github.io/';
var MAX_BODY = 5 * 1024 * 1024;
var BLOCKING_FORCE = { other_device: 1, restore: 1, all: 1 };

function doGet() {
  return ContentService.createTextOutput('タイムバケットの控えの受け取り口は動いています（データはここには出しません）。');
}

function doPost(e) {
  var out;
  try {
    var raw = e && e.postData ? e.postData.contents : '';
    if (raw.length > MAX_BODY) out = { ok: false, error: 'too_large' };
    else {
      var body = null;
      try { body = JSON.parse(raw); } catch (err) { body = null; }
      out = body ? route_(body) : { ok: false, error: 'bad_request' };
    }
  } catch (err) {
    var msg = String(err && err.message || err);
    out = { ok: false, error: /quota|storage|容量/i.test(msg) ? 'quota' : 'server', message: msg.slice(0, 200) };
  }
  out.apiVersion = LOGIC.API_VERSION;
  out.serverTime = new Date().toISOString();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(b) {
  if (!auth_(b.key)) return { ok: false, error: 'auth' };
  switch (b.op) {
    case 'ping': return ping_(b);
    case 'push': return withLock_(function () { return push_(b); });
    case 'list': return { ok: true, files: listFiles_(b.kind === 'advice' ? 'advice' : b.kind === 'all' ? 'all' : 'gen') };
    case 'get': return get_(b);
    case 'review': return review_(b);
    default: return { ok: false, error: 'bad_request' };
  }
}

// 秘密キーの照合。正しいキーはいつでも通す（失敗が続いても、自分の端末の控えは止めない）。
// キーは約240ビットの乱数なので総当たりでは当たらない。失敗の数は「知らせる」ために数える
function auth_(key) {
  var ok = LOGIC.constantEq(key, prop_('DWZ_KEY', ''));
  if (ok) return true;
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('authfail') || '0');
  if (fails <= 30) {
    Utilities.sleep(500);
    cache.put('authfail', String(fails + 1), 3600);
    if (fails + 1 === 31) { try { MailApp.sendEmail(me_(), 'タイムバケット｜接続の失敗が続いています', '秘密キーの違う接続が1時間に30回を超えました。心当たりが無ければ、GAS のエディタで rotateKey を実行してキーを作り直してください。'); } catch (e) {} }
  }
  return ok;
}
function me_() { return Session.getEffectiveUser().getEmail(); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  for (var i = 0; i < 3; i++) {
    if (lock.tryLock(10000)) { try { return fn(); } finally { lock.releaseLock(); } }
  }
  return { ok: false, error: 'busy' };
}

// アプリのレビューの設定（頻度・金額を見せるか）。控えを送れない間も、ping とレビューの時に届く
function applyMeta_(meta) {
  if (!meta || typeof meta !== 'object') return;
  if (['weekly', 'monthly', 'off'].indexOf(meta.reviewFrequency) >= 0) setProp_('REVIEW_FREQ', meta.reviewFrequency);
  if (typeof meta.reviewIncludeMoney === 'boolean') setProp_('REVIEW_MONEY', meta.reviewIncludeMoney ? '1' : '0');
}

function ping_(b) {
  try { applyMeta_(b.meta); } catch (e) {}
  var root = rootFolder_();
  return {
    ok: true,
    serverRev: Number(prop_('SERVER_REV', '0')),
    docId: prop_('DOC_ID', null),
    savedAt: prop_('LAST_PUSH_AT', null),
    docSavedAt: prop_('DOC_SAVED_AT', null),
    lastPushDevice: prop_('LAST_PUSH_DEVICE', null),
    lastPushDeviceName: prop_('LAST_PUSH_DEVICE_NAME', null),
    minWriter: Number(prop_('MIN_WRITER', '1')),
    trashed: storeTrashed_(),
    folderUrl: root ? root.getUrl() : null,
    sheetUrl: prop_('SHEET_ID', '') ? 'https://docs.google.com/spreadsheets/d/' + prop_('SHEET_ID', '') + '/edit' : null,
    advice: prop_('LAST_ADVICE_NAME', '') ? { name: prop_('LAST_ADVICE_NAME', ''), at: prop_('LAST_REVIEW_AT', null) } : null,
    review: { freq: prop_('REVIEW_FREQ', 'weekly'), hasKey: !!prop_('ANTHROPIC_API_KEY', ''), lastAt: prop_('LAST_REVIEW_AT', null), lastError: prop_('LAST_REVIEW_ERROR', null) },
    lastDailyOkAt: prop_('LAST_DAILY_OK', null)
  };
}

function push_(b) {
  var doc = b.doc;
  if (!doc || typeof doc !== 'object' || doc.app !== 'dwz-timebucket') return { ok: false, error: 'bad_request' };
  var force = BLOCKING_FORCE[b.force] ? b.force : null;
  var rev = Number(prop_('SERVER_REV', '0'));
  var minWriter = Number(prop_('MIN_WRITER', '1'));
  var docId = prop_('DOC_ID', '');
  var device = String(b.deviceId || '').slice(0, 64);
  var deviceName = String(b.deviceName || '').slice(0, 40);

  // 関所（上から順に）
  if (Number(b.writer || 1) < minWriter) return { ok: false, error: 'client_old', minWriter: minWriter };
  if (storeTrashed_()) return { ok: false, error: 'store_trashed' };
  if (docId && doc.docId !== docId && force !== 'all') return { ok: false, error: 'doc_mismatch', docId: docId };
  if (rev > 0 && Number(b.baseRev) !== rev && prop_('LAST_PUSH_DEVICE', '') !== device && !force) {
    return { ok: false, error: 'other_device', serverRev: rev, lastPushDeviceName: prop_('LAST_PUSH_DEVICE_NAME', null), savedAt: prop_('LAST_PUSH_AT', null) };
  }
  var counts = LOGIC.countIds(doc);
  var gone = docId ? LOGIC.shrunk(propJson_('COUNTS', {}), counts) : [];
  if (gone.length && force !== 'restore' && force !== 'all') return { ok: false, error: 'shrink', collections: gone };
  if (LOGIC.futureStamp(doc, Date.now()) && !force) return { ok: false, error: 'clock_future' };

  // 直前のコピー（永久）
  if (force) {
    copyCurrentTo_('preforce', force);
    if (force === 'all') { try { MailApp.sendEmail(me_(), 'タイムバケット｜クラウドの控えを上書きしました', '端末「' + deviceName + '」の内容でクラウドの控えを上書きしました。上書き前の内容は Drive の preforce フォルダに残っています。'); } catch (e) {} }
  }
  if (Number(doc.schemaVersion || 1) > Number(prop_('SCHEMA_VERSION', '1'))) copyCurrentTo_('premigrate', 'schema' + doc.schemaVersion);
  var lastApp = prop_('LAST_APP_VERSION', '');
  if (lastApp && b.appVersion && lastApp !== String(b.appVersion)) copyCurrentTo_('preupdate', 'v' + lastApp);

  // 保存
  var newRev = rev + 1;
  var now = new Date().toISOString();
  var stored = { _server: { rev: newRev, savedAt: now, device: deviceName } };
  Object.keys(doc).forEach(function (k) { stored[k] = doc[k]; });
  var text = JSON.stringify(stored, null, 1);
  var root = rootFolder_();
  writeFile_(root, 'current.json', text);
  var gen = maybeGeneration_(text, newRev, deviceName, b.reason);
  if (b.tables) { writeFile_(root, 'tables.json', JSON.stringify(b.tables)); setProp_('TABLES_DIRTY', '1'); }
  if (b.packet) writeFile_(root, 'packet.json', JSON.stringify(b.packet));

  var p = props_();
  p.setProperties({
    SERVER_REV: String(newRev), DOC_ID: String(doc.docId || ''), MIN_WRITER: String(Math.max(minWriter, Number(doc.minWriter || 1))),
    SCHEMA_VERSION: String(Math.max(Number(prop_('SCHEMA_VERSION', '1')), Number(doc.schemaVersion || 1))),
    LAST_PUSH_AT: now, DOC_SAVED_AT: String(doc.savedAt || ''), LAST_PUSH_DEVICE: device, LAST_PUSH_DEVICE_NAME: deviceName,
    LAST_APP_VERSION: String(b.appVersion || ''), COUNTS: JSON.stringify(counts)
  });
  applyMeta_(b.meta);
  // ここから先は「おまけ」の記録。失敗しても、保存できたことは正しく返す
  try { noteDevice_(device, deviceName); } catch (e) {}
  try { logSync_([now, deviceName, newRev, force ? 'push（上書き：' + force + '）' : 'push', gen ? '世代を作成' : '']); } catch (e) {}
  return { ok: true, serverRev: newRev, savedAt: now, generation: gen };
}

// 初めて見る端末からの控えは、メールで知らせる（知らない端末＝キーが漏れたかもしれない）
function noteDevice_(id, name) {
  var known = propJson_('KNOWN_DEVICES', {});
  if (known[id]) return;
  var ids = Object.keys(known);
  var first = ids.length === 0;
  if (ids.length >= 30) delete known[ids[0]];      // 設定の1項目の大きさの上限（9KB）を超えないように
  known[id] = name || 'device';
  setPropJson_('KNOWN_DEVICES', known);
  if (!first) { try { MailApp.sendEmail(me_(), 'タイムバケット｜新しい端末が接続しました', '端末「' + (name || '名前なし') + '」から控えが届きました。心当たりが無ければ、GAS のエディタで rotateKey を実行してキーを作り直してください。'); } catch (e) {} }
}
function logSync_(row) {
  var log = propJson_('SYNC_LOG', []);
  log.push(row);
  while (log.length > 60) log.shift();
  // 設定の1項目は9KBまで（日本語は1文字3バイト）。大きすぎたら古い行から捨てる
  while (log.length > 1 && Utilities.newBlob(JSON.stringify(log)).getBytes().length > 8000) log.shift();
  setPropJson_('SYNC_LOG', log);
}

function get_(b) {
  var text = readByName_(b.name);
  if (text == null) return { ok: false, error: 'not_found' };
  var doc;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, error: 'bad_file' }; }
  // 最新（current）の版は、ファイルの中の番号を返す（読んだ後に別の端末が送っても、ずれないように）
  var rev = b.name === 'current' && doc && doc._server && doc._server.rev ? Number(doc._server.rev) : Number(prop_('SERVER_REV', '0'));
  return { ok: true, name: b.name, doc: doc, serverRev: rev };
}

// レビューは同時に1つだけ（二度押し・日曜の自動と重なった時に、二重に料金がかからないように）。
// 控えの受け取り（ScriptLock）とは別の鍵を使うので、レビュー中も控えは受け取れる
function review_(b) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(0)) return { ok: false, error: 'busy' };
  applyMeta_(b.meta);
  try { return runReview_({ force: !!b.force, source: 'button' }); } finally { lock.releaseLock(); }
}
