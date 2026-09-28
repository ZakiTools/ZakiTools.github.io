/* =====================================================================
 * Logic.gs — Google のサービスを使わない「計算だけ」の関数
 *   Node のテスト（tests/gas.test.js）でも、そのまま読み込んで確かめられる。
 *   GAS は人生データの中身をほとんど知らない（名札・背番号・件数・時刻だけを見る）。
 * ===================================================================== */
var LOGIC = (function () {
  'use strict';

  var API_VERSION = 1;
  var DAY = 86400000;

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  // 世代ファイルの名前：2026-09-29T03-12-45Z_r000123_Android.json
  function genName(iso, rev, device) {
    var t = String(iso).replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
    var dev = String(device || 'device').replace(/[^A-Za-z0-9ぁ-んァ-ヶ一-龠ー_-]/g, '').slice(0, 20) || 'device';
    return t + '_r' + pad(rev, 6) + '_' + dev + '.json';
  }
  function parseGenTime(name) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(String(name));
    if (!m) return null;
    var t = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + 'Z');
    return isFinite(t) ? t : null;
  }

  // 世代の残し方：最新20個／14日以内はすべて／90日までは1日1個／それより古いものは月1個を永久に
  function pickGenerationsToKeep(files, nowMs) {
    var list = files.filter(function (f) { return f && typeof f.t === 'number'; })
      .slice().sort(function (a, b) { return b.t - a.t; });
    var keep = {}, day = {}, month = {};
    list.forEach(function (f, i) {
      var age = nowMs - f.t;
      var iso = new Date(f.t).toISOString();
      var d = iso.slice(0, 10), mo = iso.slice(0, 7);
      // 残した物は、その日・その月の「1個」にも数える（余分に残さない）
      if (i < 20 || age <= 14 * DAY) { keep[f.name] = true; day[d] = true; month[mo] = true; return; }
      if (age <= 90 * DAY) {
        if (!day[d]) { day[d] = true; month[mo] = true; keep[f.name] = true; }
        return;
      }
      if (!month[mo]) { month[mo] = true; keep[f.name] = true; }
    });
    return keep;
  }

  // 種類ごとの記録の数（墓標＝消した印も数える）。消しても数は減らないので、減ったら「空で上書き」の疑い
  function countIds(doc) {
    var out = {};
    Object.keys(doc || {}).forEach(function (k) {
      var v = doc[k];
      if (!Array.isArray(v)) return;
      out[k] = v.filter(function (r) { return r && typeof r === 'object' && typeof r.id === 'string'; }).length;
    });
    return out;
  }
  function shrunk(prev, next) {
    var bad = [];
    Object.keys(prev || {}).forEach(function (k) { if ((next[k] || 0) < prev[k]) bad.push(k); });
    return bad;
  }
  // 1日以上未来の更新時刻を持つ記録があるか（端末の時計が大きく進んでいる）
  function futureStamp(doc, nowMs) {
    var limit = nowMs + DAY, hit = false;
    function chk(r) { if (!r || typeof r !== 'object') return; var t = Date.parse(r.updatedAt); if (isFinite(t) && t > limit) hit = true; }
    Object.keys(doc || {}).forEach(function (k) {
      var v = doc[k];
      if (Array.isArray(v)) v.forEach(chk); else if (v && typeof v === 'object') chk(v);
    });
    return hit;
  }

  // 取り出してよいファイル名（フォルダの外や、知らない場所は拒否）
  var DIRS = ['generations', 'advice', 'preforce', 'premigrate', 'preupdate', 'birthday'];
  function safeName(name) {
    if (name === 'current') return ['current.json'];
    if (typeof name !== 'string' || name.length > 200) return null;
    if (/\\|\.\.|^\//.test(name)) return null;
    var parts = name.split('/');
    if (parts.length < 2 || parts.length > 3 || DIRS.indexOf(parts[0]) < 0) return null;
    if (!/^[^\/]+\.json$/.test(parts[parts.length - 1])) return null;
    return parts;
  }

  // スプレッドシートに書く1マス：数式として動かないように、先頭の = + - @ には ' を付ける
  function escapeCell(v) {
    if (v == null) return '';
    if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
    var s = String(v);
    if (s.length > 45000) s = s.slice(0, 45000) + '…';
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
  }

  // 秘密キーの照合（1文字ずつ全部比べる）
  function constantEq(a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a || a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  // 設定コード：dwz1. ＋ {u:ウェブアプリのURL, k:秘密キー} を base64url にした文字
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64urlAscii(s) {
    var out = '', i = 0;
    while (i < s.length) {
      var a = s.charCodeAt(i++), b = s.charCodeAt(i++), c = s.charCodeAt(i++);
      var n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (isNaN(b) ? '' : B64[(n >> 6) & 63]) + (isNaN(c) ? '' : B64[n & 63]);
    }
    return out;
  }
  function encodeSetupCode(url, key) { return 'dwz1.' + b64urlAscii(JSON.stringify({ u: url, k: key })); }

  // 週1／月1（その月の最初の7日の間）／止める
  function reviewDue(freq, date) {
    if (freq === 'off') return false;
    if (freq === 'monthly') return date.getDate() <= 7;
    return true;
  }

  // Claude API の料金（1Mトークンあたりのドル。2026年の公式の表）。知らないモデルは Opus 5 と同じで見積もる
  var RATES = { 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-sonnet-5': [2, 10] };
  function costUsd(usage, model) {
    if (!usage) return null;
    var r = RATES[model] || RATES['claude-opus-5'];
    var inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    return Math.round((inTok * r[0] + (usage.output_tokens || 0) * r[1]) / 1e6 * 10000) / 10000;
  }

  // 「金額も Claude に見せる」がオフの時は、材料から金額を取り除く（アプリの送った材料が古くても守る）
  function stripMoney(packet) {
    if (!packet || typeof packet !== 'object') return packet;
    (packet.items || []).forEach(function (i) { if (i) delete i.cost; });
    if (packet.thisYear && packet.thisYear.capacity) delete packet.thisYear.capacity.costThisYear;
    return packet;
  }

  // Claude API の応答から、レビューを取り出して形を確かめる
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function parseAdviceResponse(api) {
    if (!api || typeof api !== 'object') return { ok: false, error: 'bad_response' };
    if (api.type === 'error') return { ok: false, error: 'api_error', message: str(api.error && api.error.message, 300) };
    if (api.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
    if (api.stop_reason === 'max_tokens') return { ok: false, error: 'max_tokens' };
    var text = (api.content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    var a;
    try { a = JSON.parse(text); } catch (e) { return { ok: false, error: 'bad_json' }; }
    if (!a || typeof a.overall !== 'string' || !Array.isArray(a.items) || !Array.isArray(a.praise) || !Array.isArray(a.questions)) return { ok: false, error: 'bad_shape' };
    var items = a.items.filter(function (x) { return x && typeof x.itemId === 'string' && typeof x.comment === 'string'; }).slice(0, 12).map(function (x) {
      return { itemId: x.itemId.slice(0, 80), comment: str(x.comment, 800), suggestion: str(x.suggestion, 400), rule: str(x.rule, 40) };
    });
    return { ok: true, advice: {
      overall: str(a.overall, 2000),
      praise: a.praise.filter(function (x) { return typeof x === 'string'; }).slice(0, 5).map(function (x) { return x.slice(0, 400); }),
      items: items,
      questions: a.questions.filter(function (x) { return typeof x === 'string'; }).slice(0, 5).map(function (x) { return x.slice(0, 300); })
    } };
  }

  // レビューのメール（題名・本文）。項目の題名はレビューに渡した材料から引く
  function adviceMail(advice, packet, appUrl, dateStr) {
    var titles = {};
    ((packet && packet.items) || []).forEach(function (i) { titles[i.id] = i.title; });
    var lines = [];
    lines.push('Claude からのレビューが届きました（' + dateStr + '）。', '');
    lines.push('■ 全体への感想', advice.overall, '');
    if (advice.praise.length) { lines.push('■ 良いところ'); advice.praise.forEach(function (p) { lines.push('・' + p); }); lines.push(''); }
    if (advice.items.length) {
      lines.push('■ 項目へのひとこと');
      advice.items.forEach(function (x) {
        lines.push('・' + (titles[x.itemId] || '（項目）') + (x.rule ? '（' + x.rule + '）' : ''));
        lines.push('  ' + x.comment);
        if (x.suggestion) lines.push('  提案：' + x.suggestion);
      });
      lines.push('');
    }
    if (advice.questions.length) { lines.push('■ 問いかけ'); advice.questions.forEach(function (q) { lines.push('・' + q); }); lines.push(''); }
    lines.push('アプリで開く：' + appUrl);
    lines.push('', '（提案は自動では反映されません。決めるのはあなたです）');
    return { subject: 'タイムバケット｜Claude のレビュー（' + dateStr + '）', body: lines.join('\n') };
  }

  return {
    API_VERSION: API_VERSION, genName: genName, parseGenTime: parseGenTime, pickGenerationsToKeep: pickGenerationsToKeep,
    countIds: countIds, shrunk: shrunk, futureStamp: futureStamp, safeName: safeName, escapeCell: escapeCell,
    constantEq: constantEq, encodeSetupCode: encodeSetupCode, reviewDue: reviewDue, costUsd: costUsd,
    parseAdviceResponse: parseAdviceResponse, adviceMail: adviceMail, stripMoney: stripMoney
  };
})();
