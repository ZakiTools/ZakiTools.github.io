/* =====================================================================
 * Store.gs — マイドライブの「タイムバケット（消さないで）」フォルダへの保存と世代の管理
 *
 *   タイムバケット（消さないで）/
 *     README_このフォルダについて.txt … 形式・復元のしかた（アプリが無くても読める）
 *     current.json                   … 最新。アプリの書き出しと同じ形なので、そのまま取り込める
 *     tables.json / packet.json      … 読む用の表の材料／Claude のレビューの材料（アプリが作る）
 *     generations/2026/…json         … 日付付きの世代（14日すべて／90日は1日1個／月1個は永久）
 *     advice/…json                   … Claude のレビュー
 *     preforce/ premigrate/ preupdate/ … 上書き・形の変更・版の変更の直前のコピー（永久）
 *     タイムバケット 読む用（スプレッドシート）
 * ===================================================================== */
var FOLDER_NAME = 'タイムバケット（消さないで）';
var SHEET_NAME = 'タイムバケット 読む用';
var README_NAME = 'README_このフォルダについて.txt';

function props_() { return PropertiesService.getScriptProperties(); }
function prop_(k, d) { var v = props_().getProperty(k); return v == null ? d : v; }
function setProp_(k, v) { props_().setProperty(k, String(v)); }
function propJson_(k, d) { try { var v = props_().getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function setPropJson_(k, v) { props_().setProperty(k, JSON.stringify(v)); }

// フォルダ（ID を覚えておく。失くしたら同じ名前のフォルダを探す）
function rootFolder_() {
  var id = prop_('FOLDER_ID', '');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) { setProp_('FOLDER_ID', f.getId()); return f; } }
  return null;
}
function childFolder_(parent, name, create) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return create ? parent.createFolder(name) : null;
}
function findFile_(folder, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}
function writeFile_(folder, name, text) {
  var f = findFile_(folder, name);
  if (f) { f.setContent(text); return f; }
  return folder.createFile(name, text, 'application/json');
}
function readText_(folder, name) { var f = findFile_(folder, name); return f ? f.getBlob().getDataAsString('UTF-8') : null; }

// 本人がフォルダ・最新・スプレッドシートをゴミ箱に入れていないか（入れたままだと30日後に消える）
function storeTrashed_() {
  var id = prop_('FOLDER_ID', '');
  if (!id) return false;
  // Drive の一時的なエラーを「ゴミ箱」と取り違えない：1回やり直し、「見つからない」以外は投げる（アプリは後で送り直す）
  for (var i = 0; i < 2; i++) {
    try {
      if (DriveApp.getFolderById(id).isTrashed()) return true;
      var sid = prop_('SHEET_ID', '');
      if (sid && DriveApp.getFileById(sid).isTrashed()) return true;
      return false;
    } catch (e) {
      var msg = String(e && e.message || e);
      if (/not found|見つかりません|No item with the given ID|does not exist/i.test(msg)) return true;   // 完全に消された
      if (i === 1) throw e;
      Utilities.sleep(1000);
    }
  }
  return false;
}

// 永久に残すコピー（上書き・形の変更・版の変更の直前）
function copyCurrentTo_(dirName, label) {
  var root = rootFolder_();
  var cur = findFile_(root, 'current.json');
  if (!cur) return null;
  var dir = childFolder_(root, dirName, true);
  var name = LOGIC.genName(new Date().toISOString(), Number(prop_('SERVER_REV', '0')), label || dirName);
  return dir.createFile(name, cur.getBlob().getDataAsString('UTF-8'), 'application/json');
}

// 世代を1つ作る（10分未満の間隔では作らない・1日24個まで。手動の時も上限は守る）
function maybeGeneration_(text, rev, device, reason) {
  var now = Date.now();
  var last = Number(prop_('LAST_GEN_AT', '0'));
  var today = new Date(now).toISOString().slice(0, 10);
  var cnt = propJson_('GEN_COUNT', { day: today, n: 0 });
  if (cnt.day !== today) cnt = { day: today, n: 0 };
  if (cnt.n >= 24) return null;
  if (reason !== 'manual' && now - last < 10 * 60000) return null;
  var root = rootFolder_();
  var gens = childFolder_(root, 'generations', true);
  var year = childFolder_(gens, today.slice(0, 4), true);
  var name = LOGIC.genName(new Date(now).toISOString(), rev, device);
  year.createFile(name, text, 'application/json');
  setProp_('LAST_GEN_AT', now);
  cnt.n++; setPropJson_('GEN_COUNT', cnt);
  return 'generations/' + today.slice(0, 4) + '/' + name;
}

// 世代・レビュー・永久コピーの一覧（新しい順）
function listFiles_(kind) {
  var root = rootFolder_();
  var out = [];
  function add(dirName, sub) {
    var d = childFolder_(root, dirName, false);
    if (!d) return;
    var dirs = sub ? (function () { var a = [], it = d.getFolders(); while (it.hasNext()) { var y = it.next(); if (!y.isTrashed()) a.push(y); } return a; })() : [d];
    dirs.forEach(function (dir) {
      var it = dir.getFiles();
      while (it.hasNext()) {
        var f = it.next();
        if (f.isTrashed()) continue;
        var name = f.getName();
        out.push({ name: dirName + '/' + (sub ? dir.getName() + '/' : '') + name, kind: dirName, savedAt: new Date(LOGIC.parseGenTime(name) || f.getLastUpdated().getTime()).toISOString(), size: f.getSize() });
      }
    });
  }
  if (kind === 'advice') add('advice', false);
  else {
    add('generations', true);
    if (kind === 'all') { ['preforce', 'premigrate', 'preupdate', 'birthday'].forEach(function (d) { add(d, false); }); }
  }
  out.sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; });
  return out.slice(0, 300);
}

// 名前から中身を読む（フォルダの外は読まない）
function readByName_(name) {
  var parts = LOGIC.safeName(name);
  if (!parts) return null;
  var f = rootFolder_();
  for (var i = 0; i < parts.length - 1; i++) { f = childFolder_(f, parts[i], false); if (!f) return null; }
  return readText_(f, parts[parts.length - 1]);
}

// 世代の整理（毎日）。要らない物はゴミ箱へ（完全には消さない＝30日は戻せる）
function pruneGenerations_() {
  var root = rootFolder_();
  var gens = childFolder_(root, 'generations', false);
  if (!gens) return 0;
  var files = [];
  var ys = gens.getFolders();
  while (ys.hasNext()) {
    var y = ys.next();
    if (y.isTrashed()) continue;
    var it = y.getFiles();
    while (it.hasNext()) { var f = it.next(); if (f.isTrashed()) continue; var t = LOGIC.parseGenTime(f.getName()); if (t != null) files.push({ name: f.getName(), t: t, file: f }); }
  }
  var keep = LOGIC.pickGenerationsToKeep(files, Date.now());
  var n = 0;
  files.forEach(function (x) { if (!keep[x.name]) { x.file.setTrashed(true); n++; } });
  return n;
}

function writeReadme_(root) {
  var text = [
    'このフォルダは「タイムバケット」（『DIE WITH ZERO』の考え方で、人生の季節ごとに経験を置く自分用アプリ）の控えです。',
    'アプリ（https://zakitools.github.io/）が、変更のたびに自動で送っています。消さないでください。',
    '',
    '■ 中身',
    '・current.json … 最新の人生データ（JSON という文字の形式）。アプリの［設定 → ファイルから取り込む］でそのまま戻せます。',
    '・generations … 日付付きの世代。14日以内はすべて、90日までは1日1個、それより古いものは月1個を残します。',
    '・advice … Claude のレビュー。',
    '・preforce / premigrate / preupdate … 上書き・データの形の変更・アプリの版の変更の直前のコピー（消さずに残します）。',
    '・タイムバケット 読む用 … PC で見るためのスプレッドシート（閲覧専用。ここを直してもアプリには戻りません）。',
    '',
    '■ アプリが無くなっても',
    'current.json をテキストで開けば、items（経験と土台）・logs（思い出）・people（大切な人）の中身が読めます。'
  ].join('\n');
  var f = findFile_(root, README_NAME);
  if (f) f.setContent(text); else root.createFile(README_NAME, text, 'text/plain');
}
