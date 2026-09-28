/* =====================================================================
 * Sheet.gs — PC で見るための「読む用」スプレッドシート（一方通行）
 *   表の中身はアプリが作って送ってくる（tables.json）。GAS はそのまま書き写すだけ。
 *   15分ごとの時間トリガーで、変わっていた時だけ書く（送信の処理を重くしないため）。
 *   ここを手で直してもアプリには戻らない（各シートは編集しようとすると警告が出る）。
 * ===================================================================== */
function sheetJob() {
  try { adviceScan_(); } catch (e) {}
  if (prop_('TABLES_DIRTY', '0') !== '1') return;
  var root = rootFolder_();
  if (!root) return;
  // 先に印を消してから読む（書いている間に新しい控えが届いたら、印がまた付いて次の回に書く）
  setProp_('TABLES_DIRTY', '0');
  try {
    var text = readText_(root, 'tables.json');
    if (!text) return;
    writeTables_(JSON.parse(text));
    setProp_('SHEET_ERROR', '');
  } catch (e) {
    setProp_('TABLES_DIRTY', '1');
    setProp_('SHEET_ERROR', String(e && e.message || e).slice(0, 200));
  }
}

function spreadsheet_() {
  var id = prop_('SHEET_ID', '');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  return null;
}

function writeTables_(tables) {
  var ss = spreadsheet_();
  if (!ss) return;
  writeSheet_(ss, 'はじめに', ['タイムバケット 読む用（閲覧専用）'], [
    ['このスプレッドシートは、アプリから自動で上書きされます。ここを直してもアプリには戻りません。'],
    ['中身の正本は、同じフォルダの current.json と、スマホのアプリです。'],
    ['最終更新：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')]
  ]);
  (tables && tables.sheets || []).forEach(function (t) {
    if (!t || typeof t.name !== 'string' || !Array.isArray(t.header)) return;
    if (t.name === 'はじめに' || t.name === '同期の記録') return;
    writeSheet_(ss, t.name.slice(0, 50), t.header, t.rows || []);
  });
  var log = propJson_('SYNC_LOG', []).slice().reverse();
  writeSheet_(ss, '同期の記録', ['日時（UTC）', '端末', '版', 'できごと', 'メモ'], log);
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
}

function writeSheet_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  var all = [header].concat(rows);
  var width = all.reduce(function (m, r) { return Math.max(m, (r || []).length); }, 1);
  var values = all.map(function (r) {
    var row = [];
    for (var i = 0; i < width; i++) row.push(LOGIC.escapeCell(r && r[i]));
    return row;
  });
  var range = sh.getRange(1, 1, values.length, width);
  range.setNumberFormat('@');           // 日付などに勝手に変換されないよう、すべて文字として
  range.setValues(values);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setWarningOnly(true);
}
