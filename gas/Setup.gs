/* =====================================================================
 * Setup.gs — 初めの準備と、毎日の見回り
 *
 *   エディタで実行する関数（上の「実行する関数を選択」から選ぶ）
 *     setup()          … 最初に1回。フォルダ・スプレッドシート・秘密キー・時間トリガーを用意する。何度実行しても同じ結果
 *     sendSetupCode()  … アプリに貼る「設定コード」を自分宛てにメールで送る
 *     rotateKey()      … 秘密キーを作り直す（漏れたかもしれない時・スマホを失くした時）。新しい設定コードを送る
 *     selfCheck()      … 状態を確認して、実行ログに出す
 *   ウェブアプリの住所は Config.gs の DWZ_DEPLOYMENT_ID から作る（Config.gs は公開しない手元の道具が作る）
 * ===================================================================== */
function setup() {
  var p = props_();
  if (!p.getProperty('DWZ_KEY')) p.setProperty('DWZ_KEY', newKey_());
  var root = rootFolder_() || DriveApp.createFolder(FOLDER_NAME);
  setProp_('FOLDER_ID', root.getId());
  writeReadme_(root);
  childFolder_(root, 'generations', true);
  childFolder_(root, 'advice', true);       // PC の Claude Code もここにレビューを置く
  var ss = spreadsheet_();
  if (!ss) {
    var existing = findFile_(root, SHEET_NAME);
    ss = existing ? SpreadsheetApp.openById(existing.getId()) : SpreadsheetApp.create(SHEET_NAME);
    if (!existing) DriveApp.getFileById(ss.getId()).moveTo(root);
    setProp_('SHEET_ID', ss.getId());
  }
  if (p.getProperty('SERVER_REV') == null) p.setProperty('SERVER_REV', '0');
  // 前の GAS プロジェクトの控え（current.json）が残っていたら、番号と件数を引き継ぐ。
  // そうしないと関所が空のままで、空のスマホからの最初の控えがそのまま上書きしてしまう
  if (Number(p.getProperty('SERVER_REV')) === 0) {
    var curText = readText_(root, 'current.json');
    if (curText) {
      try {
        var cur = JSON.parse(curText), sv = cur._server || {};
        p.setProperties({
          SERVER_REV: String(sv.rev || 1), DOC_ID: String(cur.docId || ''), COUNTS: JSON.stringify(LOGIC.countIds(cur)),
          MIN_WRITER: String(cur.minWriter || 1), DOC_SAVED_AT: String(cur.savedAt || ''), LAST_PUSH_AT: String(sv.savedAt || ''),
          LAST_PUSH_DEVICE: 'previous-project', LAST_PUSH_DEVICE_NAME: String(sv.device || '前の控え')
        });
      } catch (e) {}
    }
  }
  installTriggers_();
  Logger.log('準備ができました。次に sendSetupCode を実行して、設定コードをメールで受け取ってください。');
}

function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

// 時間トリガーは、同じ物を全部消してから1本ずつ作る（重複しないように）
function installTriggers_() {
  var names = ['dailyJob', 'sheetJob', 'reviewJob'];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(5).create();
  ScriptApp.newTrigger('sheetJob').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('reviewJob').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
}

function webAppUrl_() {
  if (typeof DWZ_DEPLOYMENT_ID === 'string' && DWZ_DEPLOYMENT_ID) return 'https://script.google.com/macros/s/' + DWZ_DEPLOYMENT_ID + '/exec';
  return null;
}

function sendSetupCode() {
  var url = webAppUrl_();
  if (!url) throw new Error('ウェブアプリの住所がまだありません（Claude が公開した後に実行してください）');
  var key = prop_('DWZ_KEY', '');
  if (!key) throw new Error('先に setup を実行してください');
  var code = LOGIC.encodeSetupCode(url, key);
  MailApp.sendEmail(me_(), 'タイムバケット｜設定コード', [
    'タイムバケットの「自分の Google への控え」の設定コードです。',
    '',
    'アプリの［設定 → 同期 → 設定コードを貼る］に、下の1行をそのまま貼ってください。',
    '',
    code,
    '',
    '・この1行は、あなたの控えの鍵です。人に見せないでください。',
    '・機種変更の時も、新しいスマホで同じ1行を貼れば、クラウドから復元できます。このメールは消さずに残しておくと便利です。',
    '・漏れたかもしれない時は、GAS のエディタで rotateKey を実行すると、新しいコードが届きます（古いコードは使えなくなります）。'
  ].join('\n'));
  Logger.log('設定コードをメールで送りました。');
}

function rotateKey() {
  setProp_('DWZ_KEY', newKey_());
  sendSetupCode();
}

function selfCheck() {
  var root = rootFolder_();
  Logger.log(JSON.stringify({
    folder: !!root, sheet: !!spreadsheet_(), key: !!prop_('DWZ_KEY', ''), webApp: !!webAppUrl_(),
    serverRev: prop_('SERVER_REV', '0'), lastPush: prop_('LAST_PUSH_AT', null), apiKey: !!prop_('ANTHROPIC_API_KEY', ''),
    reviewFreq: prop_('REVIEW_FREQ', 'weekly'), lastReview: prop_('LAST_REVIEW_AT', null), lastReviewError: prop_('LAST_REVIEW_ERROR', null),
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); })
  }, null, 1));
}

// 毎日5時：世代の整理・ゴミ箱の確認・長く送られてこない時の知らせ・表の書き直しのやり直し
function dailyJob() {
  try { pruneGenerations_(); } catch (e) {}
  var trashed = false;
  try { trashed = storeTrashed_(); } catch (e) {}
  if (trashed) {
    try { MailApp.sendEmail(me_(), 'タイムバケット｜控えのフォルダがゴミ箱にあります', 'Google ドライブの「' + FOLDER_NAME + '」（またはスプレッドシート）がゴミ箱に入っています。30日たつと完全に消えるので、ゴミ箱から戻してください。'); } catch (e) {}
  }
  var last = Date.parse(prop_('LAST_PUSH_AT', '') || '');
  var mailed = Date.parse(prop_('LAST_NOSYNC_MAIL', '') || '');
  var now = Date.now();
  if (isFinite(last) && now - last > 30 * 86400000 && (!isFinite(mailed) || now - mailed > 30 * 86400000)) {
    try {
      MailApp.sendEmail(me_(), 'タイムバケット｜30日以上、控えが届いていません', 'スマホのアプリから30日以上、控えが届いていません。アプリを開いてみてください。もしアプリのデータが消えていたら、アプリの［以前のデータを復元する → クラウドから］で戻せます。');
      setProp_('LAST_NOSYNC_MAIL', new Date().toISOString());
    } catch (e) {}
  }
  if (prop_('TABLES_DIRTY', '0') === '1') sheetJob();
  setProp_('LAST_DAILY_OK', new Date().toISOString());
}
