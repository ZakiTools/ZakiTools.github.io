/* =====================================================================
 * Review.gs — Claude のレビュー（週1の自動＋アプリのボタン）
 *
 *   ・材料（packet.json）はアプリが作って送ってくる（名前・生年月日・メモ・写真は含まない。金額は許可した時だけ）
 *   ・前回と材料が同じ（指紋が一致）なら、API を呼ばない＝料金がかからない
 *   ・API キーは「プロジェクトの設定 → スクリプト プロパティ」の ANTHROPIC_API_KEY にだけ置く（本人が貼る）
 *   ・Claude API（Messages API）を UrlFetchApp で直接呼ぶ（GAS には公式の道具＝SDK が無いため）
 *   ・結果は Drive の advice/ に保存し、概要をメールで送る。アプリは ping で新着を知って取り込む
 * ===================================================================== */

// 時間トリガー（毎週日曜の朝）から呼ばれる
function reviewJob() {
  var freq = prop_('REVIEW_FREQ', 'weekly');
  if (!LOGIC.reviewDue(freq, new Date())) return;
  var lock = LockService.getUserLock();            // ボタンでのレビューと重ならないように（Api.gs の review_ と同じ鍵）
  if (!lock.tryLock(0)) return;
  try { runReview_({ force: false, source: 'weekly' }); } finally { lock.releaseLock(); }
}

function runReview_(opts) {
  var key = prop_('ANTHROPIC_API_KEY', '');
  if (!key) { setProp_('LAST_REVIEW_ERROR', 'no_api_key'); return { ok: false, error: 'no_api_key' }; }
  var root = rootFolder_();
  var packetText = root ? readText_(root, 'packet.json') : null;
  if (!packetText) return { ok: false, error: 'no_packet' };
  var packet = JSON.parse(packetText);
  if (prop_('REVIEW_MONEY', '0') !== '1') { LOGIC.stripMoney(packet); packetText = JSON.stringify(packet); }
  var hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, packetText, Utilities.Charset.UTF_8));
  if (hash === prop_('LAST_REVIEW_HASH', '') && !opts.force) {
    return { ok: false, error: 'unchanged', name: prop_('LAST_ADVICE_NAME', null) };
  }
  var res = callClaude_(key, reviewUserText(packetText));
  if (!res.ok) { setProp_('LAST_REVIEW_ERROR', res.error + (res.message ? '：' + res.message : '')); return res; }

  var nowIso = new Date().toISOString();
  var advice = res.advice;
  advice.id = 'adv-' + nowIso;
  advice.at = nowIso;
  advice.source = 'api';
  advice.model = res.model;
  advice.packetHash = hash;
  advice.usage = res.usage;
  advice.costUsd = LOGIC.costUsd(res.usage, res.model);
  advice.createdAt = nowIso; advice.updatedAt = nowIso; advice.deletedAt = null;
  var dir = childFolder_(root, 'advice', true);
  var name = LOGIC.genName(nowIso, Number(prop_('SERVER_REV', '0')), 'claude');
  dir.createFile(name, JSON.stringify(advice, null, 1), 'application/json');
  props_().setProperties({ LAST_REVIEW_HASH: hash, LAST_REVIEW_AT: nowIso, LAST_ADVICE_NAME: 'advice/' + name, LAST_REVIEW_ERROR: '' });
  logSync_([nowIso, 'Claude', '', 'レビュー（' + opts.source + '）', advice.costUsd != null ? '約$' + advice.costUsd : '']);
  try {
    var mail = LOGIC.adviceMail(advice, packet, APP_URL, Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    MailApp.sendEmail(me_(), mail.subject, mail.body);
  } catch (e) {}
  return { ok: true, name: 'advice/' + name, advice: advice };
}

// PC の Claude Code が advice/ に置いたレビューにも気づく（15分ごとの見回り sheetJob から呼ぶ）。
// 名前が時刻で始まるので、名前の大きい物が新しい。アプリは次の ping で新着として取り込む
function adviceScan_() {
  var root = rootFolder_();
  var dir = root ? childFolder_(root, 'advice', false) : null;
  if (!dir) return;
  var newest = '', it = dir.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var n = f.getName();
    if (LOGIC.parseGenTime(n) != null && /\.json$/.test(n) && n > newest) newest = n;
  }
  var cur = prop_('LAST_ADVICE_NAME', '').replace(/^advice\//, '');
  if (newest && newest > cur) setProp_('LAST_ADVICE_NAME', 'advice/' + newest);
}

// Claude API を呼ぶ。model：claude-opus-5／考える深さは adaptive／返事は決まった形の JSON（structured outputs）
// fallbacks:"default"＝安全のために回答を断った時、別のモデルで自動的にやり直す設定
// 混雑（429・5xx）ですぐ返ってきた時は、20秒待って1回だけやり直す（全体で GAS の6分に収まる範囲で）。
// 将来 fallbacks の試験機能が終わって 400 になったら、それを外してやり直す
function callClaude_(key, userText) {
  var useFallback = true, started = Date.now(), res;
  for (var attempt = 0; attempt < 2; attempt++) {
    res = callClaudeOnce_(key, userText, useFallback);
    if (res.ok || attempt === 1) break;
    var quick = Date.now() - started < 60000;
    if (res.code === 400 && useFallback && /fallback/i.test(res.message || '')) { useFallback = false; continue; }
    if (quick && (res.code === 429 || res.code >= 500)) { Utilities.sleep(20000); continue; }
    break;
  }
  delete res.code;
  return res;
}

function callClaudeOnce_(key, userText, useFallback) {
  var payload = {
    model: REVIEW_MODEL,
    max_tokens: REVIEW_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: REVIEW_EFFORT, format: { type: 'json_schema', schema: ADVICE_SCHEMA } },
    system: REVIEW_PROMPT,
    messages: [{ role: 'user', content: userText }]
  };
  var headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (useFallback) { payload.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeoutSeconds: 300
    });
  } catch (e) {
    return { ok: false, error: 'network', message: String(e && e.message || e).slice(0, 200) };
  }
  var code = resp.getResponseCode();
  var body;
  try { body = JSON.parse(resp.getContentText()); } catch (e) { return { ok: false, error: 'bad_response', code: code, message: 'HTTP ' + code }; }
  var apiMsg = String(body && body.error && body.error.message || '').slice(0, 200);
  if (code === 401) return { ok: false, error: 'bad_api_key', code: code };
  if (code === 429) return { ok: false, error: 'rate_limited', code: code };
  if (code >= 400) return { ok: false, error: 'api_error', code: code, message: 'HTTP ' + code + ' ' + apiMsg };
  var parsed = LOGIC.parseAdviceResponse(body);
  if (!parsed.ok) return parsed;
  return { ok: true, advice: parsed.advice, model: body.model || REVIEW_MODEL, usage: body.usage || null };
}
