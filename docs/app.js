/* =====================================================================
 * app.js — タイムバケットの「画面」
 *
 *   計算とデータは core.js（window.DWZ）に任せ、ここは画面を作って操作を受けるだけ。
 *   安全のため、画面に文字を出す時は必ず textContent を使う（h() 関数）。文字を HTML として解釈させる書き方は使わない。
 *
 *   章立て
 *     1. 起動の準備（保存・端末情報・テスト環境）
 *     2. 画面を作る小道具（h・トースト・シート）
 *     3. 変更の入口 commit（元に戻す・保存・再描画を1か所で）
 *     4. タブ：今年／人生／候補箱／お金と時間
 *     5. シート：思いつき・配置（本の意図チェック）・今年に置く・項目・思い出・手放す・人
 *     6. 全体チェックリスト・ゴミ箱
 *     7. 設定・書き出し・取り込み・復元・修復
 *     8. はじめての設定（ウィザード）
 *     9. PWA（Service Worker・更新の帯）と起動
 * ===================================================================== */
(function () {
  'use strict';
  var D = window.DWZ;
  if (!D) { if (window.__DWZ_RESCUE) window.__DWZ_RESCUE(); return; }

  /* =====================================================================
   * 1. 起動の準備
   * ===================================================================== */
  // 本番（github.io）以外はテスト環境：?today= で日付を試せる。本番では使えない
  var IS_TEST = !/\.github\.io$/.test(location.hostname);
  var params = new URLSearchParams(location.search);
  var TODAY_OVERRIDE = IS_TEST && D.isYmd(params.get('today')) ? params.get('today') : null;
  function today() { return TODAY_OVERRIDE || D.todayYmd(); }

  // localStorage が使えない環境（プライベートモード等）では、メモリ上の仮の箱で動かす
  var storage, storageOk = true;
  try { storage = window.localStorage; storage.setItem('dwz-probe', '1'); storage.removeItem('dwz-probe'); }
  catch (e) {
    storageOk = false;
    var mem = {};
    storage = { length: 0, key: function () { return null; }, getItem: function (k) { return k in mem ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
  }

  var saveFailed = false;
  var store = D.createStore(storage, {
    onSaved: function (r) { if (r && r.ok) { if (saveFailed) { saveFailed = false; renderAll(); } markDirty(); } },
    onError: function () { saveFailed = true; renderAll(); },
    onReadOnly: function () { readOnly = true; renderAll(); },
    onMerged: function () { recompute(); renderAll(); refreshSheets(); }
  });
  var device = store.readDevice();
  store.writeDevice(device);
  var doc = null, ctx = null, readOnly = false, lastUndo = null, rolledNotice = false, updateReady = false, swReg = null;
  var ui = { tab: 'now', inboxFilter: 'idea', search: '', pastOpen: false, somewhereOpen: false, promptsOpen: false, examplesOpen: false, inboxKind: 'exp' };
  var TAB_TITLES = { now: '今年', life: '人生', inbox: '候補箱', money: 'お金と時間' };

  function saveDevice() { store.writeDevice(device); }
  function recompute() { ctx = D.ctxOf(doc, today()); }
  function getItem(id) { return D.byId(doc.items, id); }
  function upd(rec) { D.touch(rec, device.deviceId); return rec; }
  function liveItems() { return D.live(doc.items); }
  function livePeople() { return D.live(doc.people); }

  /* =====================================================================
   * 2. 画面を作る小道具
   * ===================================================================== */
  // h('button', {class:'btn', on:{click:fn}}, ['文字', 子要素]) … 文字は必ず textContent として入る
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
        else if (k === 'style') Object.keys(v).forEach(function (s) { el.style.setProperty(s, v[s]); });
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'open' || k === 'required') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    if (kids == null || kids === false) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { append(el, c); return; }
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  function btn(label, onClick, cls, extra) {
    return h('button', Object.assign({ type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), on: { click: onClick } }, extra || {}), label);
  }
  function chip(label, pressed, onClick) {
    return h('button', { type: 'button', class: 'chip', 'aria-pressed': pressed ? 'true' : 'false', on: { click: onClick } }, label);
  }
  function seg(options, value, onPick, label) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': label || null }, options.map(function (o) {
      return h('button', { type: 'button', 'aria-pressed': o.value === value ? 'true' : 'false', on: { click: function () { onPick(o.value); } } }, o.label);
    }));
  }
  // 見出しと入力欄を結ぶ（読み上げで名前が付き、見出しをタップしても入力欄に入れる）
  var fieldSeq = 0;
  function field(label, control, hint) {
    var lbl;
    var isInput = control && /^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName);
    if (isInput) {
      if (!control.id) control.id = 'f' + (++fieldSeq);
      lbl = h('label', { class: 'lbl', for: control.id, text: label });
    } else {
      var lid = 'fl' + (++fieldSeq);
      lbl = h('div', { class: 'lbl', id: lid, text: label });
      if (control && control.setAttribute) { control.setAttribute('role', control.getAttribute('role') || 'group'); control.setAttribute('aria-labelledby', lid); }
    }
    return h('div', { class: 'field' }, [lbl, control, hint ? h('div', { class: 'xs muted', text: hint }) : null]);
  }
  // チェックボックス付きの1行（タップしやすい高さ）
  function checkLine(text, checked, onChange) {
    return h('label', { class: 'check-line' }, [h('input', { type: 'checkbox', checked: checked, on: { change: function (e) { onChange(e.target.checked); } } }), h('span', { text: text })]);
  }
  function sec(title, right) { return h('div', { class: 'sec' }, [h('h2', { text: title }), h('span', { class: 'spacer' }), right || null]); }
  function man(n) { return D.yen(n); }
  function ruleLabel(r) { return r ? '本：' + r : ''; }

  // ---- トースト（数秒で消える通知。［元に戻す］付きにもできる）----
  var toastTimer = null;
  var toastEl = document.getElementById('toast');
  function toastHost() { return openSheets.length ? openSheets[openSheets.length - 1].dlg : document.getElementById('app'); }
  function toast(msg, opts) {
    var host = toastHost();
    if (toastEl.parentNode !== host) host.appendChild(toastEl);
    toastEl.replaceChildren(h('span', { text: msg }));
    if (opts && opts.undo && lastUndo) {
      var snap = lastUndo;   // 押した時に、この通知の変更の後に別の変更が入っていたら戻さない
      toastEl.appendChild(h('button', { type: 'button', on: { click: function () {
        hideToast();
        if (snap !== lastUndo) { toast('その後に別の変更があったため、元に戻せません'); return; }
        undo();
      } } }, '元に戻す'));
    }
    if (opts && opts.action) toastEl.appendChild(h('button', { type: 'button', on: { click: function () { hideToast(); opts.action.fn(); } } }, opts.action.label));
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, (opts && (opts.undo || opts.action)) ? 6000 : 2200);
  }
  function hideToast() { toastEl.classList.remove('show'); }

  // ---- シート（<dialog> で作る。Android の戻る操作でも閉じる）----
  var openSheets = [];
  function openSheet(opts) {
    var dlg = h('dialog', { class: 'sheet' + (opts.full ? ' full' : ''), 'aria-label': typeof opts.title === 'string' ? opts.title : '' });
    var api = { dlg: dlg, close: function () { if (dlg.open) dlg.close(); }, refresh: fill };
    function fill() {
      var built;
      try { built = opts.build(api); } catch (e) { console.error(e); built = h('p', { text: '表示できませんでした' }); }
      if (built === null) { api.close(); return; }
      var title = typeof opts.title === 'function' ? opts.title() : opts.title;
      dlg.setAttribute('aria-label', title || '');
      var head = h('div', { class: 'sheet-head' }, [h('h2', { text: title }),
        opts.noClose ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', on: { click: api.close } }, '✕')]);
      var body = h('div', { class: 'sheet-body' });
      var foot = null;
      if (built && built.body !== undefined) { append(body, built.body); if (built.foot) foot = h('div', { class: 'sheet-foot' }, built.foot); }
      else append(body, built);
      var keep = dlg.scrollTop;
      var openState = {};
      Array.prototype.forEach.call(dlg.querySelectorAll('details[data-key]'), function (d) { openState[d.getAttribute('data-key')] = d.open; });
      var hadToast = toastEl.parentNode === dlg;
      dlg.replaceChildren(head, body);
      if (foot) dlg.appendChild(foot);
      if (hadToast) dlg.appendChild(toastEl);
      Array.prototype.forEach.call(dlg.querySelectorAll('details[data-key]'), function (d) { var k = d.getAttribute('data-key'); if (k in openState) d.open = openState[k]; });
      dlg.scrollTop = keep;
      if (opts.afterFill) opts.afterFill(dlg);
    }
    fill();
    dlg.addEventListener('cancel', function (e) { if (opts.noClose) e.preventDefault(); });
    dlg.addEventListener('close', function () {
      var i = openSheets.indexOf(api);
      if (i >= 0) openSheets.splice(i, 1);
      if (toastEl.parentNode === dlg) toastHost().appendChild(toastEl);
      dlg.remove();
      if (opts.onClose) opts.onClose();
      if (!openSheets.length) setTimeout(checkDayChange, 0);   // シートを閉じた後に、日付の変わり目の処理をする
    });
    // 背景（暗い所）のタップで閉じる。書きかけがあるシートでは閉じない（keepOnBackdrop）
    dlg.addEventListener('click', function (e) { if (e.target === dlg && !opts.full && !opts.noClose && !opts.keepOnBackdrop) api.close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    openSheets.push(api);
    return api;
  }
  function refreshSheets() { openSheets.slice().forEach(function (s) { s.refresh(); }); }

  function confirmSheet(title, lines, okLabel, onOk, danger) {
    openSheet({ title: title, build: function (api) {
      return { body: lines.map(function (l) { return h('p', { text: l }); }),
        foot: [btn('やめる', api.close), btn(okLabel, function () { api.close(); onOk(); }, danger ? 'btn-danger' : 'btn-accent')] };
    } });
  }
  function askText(title, value, placeholder, onSave, opts) {
    var v = value || '', first = true;
    openSheet({ title: title, keepOnBackdrop: true, build: function (api) {
      var el = (opts && opts.multi)
        ? h('textarea', { class: 'input', placeholder: placeholder || '', maxlength: '2000', on: { input: function (e) { v = e.target.value; } } }, v)
        : h('input', { class: 'input', type: 'text', value: v, placeholder: placeholder || '', maxlength: '200', enterkeyhint: 'done',
          on: { input: function (e) { v = e.target.value; }, keydown: function (e) { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); api.close(); onSave(v.trim()); } } } });
      if (first) { first = false; setTimeout(function () { try { el.focus(); } catch (e) {} }, 60); }
      return { body: [el, opts && opts.hint ? h('p', { class: 'xs muted', text: opts.hint }) : null],
        foot: [btn('やめる', api.close), btn('保存', function () { api.close(); onSave(v.trim()); }, 'btn-accent')] };
    } });
  }
  function askNumber(title, value, unit, onSave, opts) {
    var v = value == null ? '' : String(value), first = true;
    openSheet({ title: title, build: function (api) {
      var el = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: v, min: '0', step: (opts && opts.step) || 'any', 'aria-label': title,
        on: { input: function (e) { v = e.target.value; } } });
      if (first) { first = false; setTimeout(function () { try { el.focus(); } catch (e) {} }, 60); }
      var quick = (opts && opts.quick) ? h('div', { class: 'chips' }, opts.quick.map(function (q) {
        return chip(q.label || String(q), false, function () { api.close(); onSave(q.value != null ? q.value : q); });
      })) : null;
      return { body: [quick, h('div', { class: 'stepper', style: { 'margin-top': '.6rem' } }, [el, h('span', { text: unit || '' })]),
        opts && opts.hint ? h('p', { class: 'xs muted', text: opts.hint }) : null],
        foot: [opts && opts.allowClear ? btn('未入力に戻す', function () { api.close(); onSave(null); }) : btn('やめる', api.close),
          btn('保存', function () { var n = v === '' ? null : Number(v); api.close(); onSave(n == null || !isFinite(n) ? null : n); }, 'btn-accent')] };
    } });
  }
  function pickFile(onText) {
    var input = h('input', { type: 'file', style: { display: 'none' } });   // 拡張子で絞らない（Android で .txt を選べないことがあるため）
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { onText(String(reader.result)); };
      reader.onerror = function () { toast('ファイルを読めませんでした'); };
      reader.readAsText(f);
    });
    document.body.appendChild(input);
    input.click();
  }

  /* =====================================================================
   * 3. 変更の入口 commit
   *   すべての変更はここを通る：元に戻す用の控え → 変更 → 再計算 → 再描画 → 保存の予約
   * ===================================================================== */
  function commit(label, fn, opts) {
    opts = opts || {};
    if (readOnly) { toast('読み取り専用で開いています（アプリの更新が必要です）'); return false; }
    var before = JSON.stringify(doc);
    var res;
    try { res = fn(doc); } catch (e) { console.error(e); toast('うまくいきませんでした'); return false; }
    if (res === false) return false;
    lastUndo = { before: before };
    afterChange(opts.noRefresh);
    if (label) toast(label, opts.undo === false ? null : { undo: true });
    return true;
  }
  function afterChange(noRefresh) {
    applyFontScale();
    recompute();
    renderAll();
    if (!noRefresh) refreshSheets();
    store.schedule(doc);
    askPersistOnce();
  }
  function undo() {
    if (!lastUndo) return;
    var r = D.ingest(lastUndo.before);
    if (!r.ok) return;
    // 取り消しで消える記録は墓標として残す（同じ人生データの時だけ。クラウドの関所に止められないように）
    if (r.doc.docId === doc.docId) D.tombstoneMissing(doc, r.doc, device.deviceId);
    doc = r.doc;
    lastUndo = null;
    afterChange();
    toast('元に戻しました');
  }
  // ブラウザに「このデータを消さないで」と頼む（最初の保存の時に1回）
  function askPersistOnce() {
    if (device.persistAskedAt || !navigator.storage || !navigator.storage.persist) return;
    device.persistAskedAt = D.nowIso();
    saveDevice();
    navigator.storage.persist().then(function (granted) { device.persisted = !!granted; saveDevice(); }).catch(function () {});
  }

  /* =====================================================================
   * 4. タブ
   * ===================================================================== */
  function setTab(tab) {
    if (!TAB_TITLES[tab]) tab = 'now';
    var changed = ui.tab !== tab;
    ui.tab = tab;
    try { history.replaceState(null, '', location.pathname + location.search + '#' + tab); } catch (e) {}
    renderAll();
    if (changed) window.scrollTo(0, 0);
  }
  function renderAll() {
    if (!doc) return;
    document.getElementById('screenTitle').textContent = TAB_TITLES[ui.tab];
    document.getElementById('envBadge').hidden = !IS_TEST;
    renderDot();
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar [data-tab]'), function (b) {
      if (b.getAttribute('data-tab') === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.getElementById('fab').hidden = !(ui.tab === 'now' || ui.tab === 'life') || !ctx;
    var main = document.getElementById('main');
    var host = document.getElementById('inputbarHost');
    // 下の入力欄は作り直さない（連続で書く時にキーボードが閉じないように）
    if (ctx && ui.tab === 'inbox') { var bar = getInputBar(); if (host.firstChild !== bar) host.replaceChildren(bar); document.body.classList.add('has-inputbar'); }
    else { if (host.firstChild) { document.body.classList.remove('typing'); host.replaceChildren(); } document.body.classList.remove('has-inputbar'); }
    var nodes;
    if (!ctx) nodes = renderStart();
    else if (ui.tab === 'now') nodes = renderNow();
    else if (ui.tab === 'life') nodes = renderLife();
    else if (ui.tab === 'inbox') nodes = renderInbox();
    else nodes = renderMoney();
    main.replaceChildren();
    append(main, nodes);
  }
  function renderStart() {
    return h('div', { class: 'card' }, [
      h('h2', { text: 'はじめましょう' }),
      h('p', { text: '生年月日を入れると、死ぬまでの季節（5年ごとのバケツ）ができます。' }),
      btn('はじめる', function () { if (!store.isReady() && !readOnly) openRepair(); else openWizard(); }, 'btn-accent btn-block')
    ]);
  }

  // ---- 項目の1行 ----
  function symOf(it) { return it.status === 'done' ? '✓' : it.repeat ? '↻' : it.kind === 'theme' ? '◆' : '●'; }
  // 行のボタンと、横の操作ボタンは「兄弟」にする（ボタンの中にボタンを入れない）
  function itemRow(it, meta, action) {
    var main = h('button', { type: 'button', class: 'irow' + (it.status === 'done' ? ' done' : '') + (it.kind === 'theme' ? ' theme' : ''), on: { click: function () { openItemSheet(it.id); } } }, [
      h('span', { class: 'sym', 'aria-hidden': 'true', text: symOf(it) }),
      h('span', { class: 'itext' }, [h('span', { class: 'ititle', text: it.title || '（題名なし）' }), meta ? h('span', { class: 'imeta', text: meta }) : null])
    ]);
    return action ? h('div', { class: 'list-row' }, [main, action]) : main;
  }
  function focusMeta(f) {
    var it = f.item, parts = [];
    if (f.why === 'date') {
      parts.push(D.whenLabel(it, ctx));
      var days = D.daysBetween(ctx.today, it.when.date);
      if (days > 0 && days <= 60) parts.push('あと' + days + '日');
    } else if (f.why === 'repeat') {
      parts.push(D.whenLabel(it, ctx));
      var left = D.repeatRemaining(doc, it, ctx);
      if (left != null) parts.push('あと約' + left + '回');
    } else if (f.why === 'theme') {
      if (it.hoursPerWeek != null) parts.push('週' + it.hoursPerWeek + '時間');
      if (it.goalDate) parts.push('〜' + D.jpDate(it.goalDate, 'month'));
      var sup = liveItems().filter(function (e) { return e.kind === 'exp' && e.status !== 'letgo' && (e.needsIds || []).indexOf(it.id) >= 0; });
      if (sup.length) parts.push('支える経験：' + sup.map(function (e) { return e.title; }).slice(0, 3).join('・'));
    } else parts.push('今年のどこかで');
    if (it.status !== 'done') {
      var lv = it.leaveDays, c = it.cost && it.cost.once;
      if (lv != null) parts.push('休み' + lv + '日');
      if (c != null) parts.push(man(c));
    }
    return parts.join('・');
  }

  /* ---------- 4-1. 今年タブ ---------- */
  /*<render-now>*/
  function renderNow() {
    var out = [];
    var yp = D.yearPlan(doc, ctx.A);
    var prog = D.yearProgress(ctx);
    var monthsLeft = Math.max(0, Math.round((1 - prog) * 12));
    out.push(h('div', { class: 'card' }, [
      h('h2', { class: 'hero-age', text: ctx.A + '歳の1年' }),
      yp && yp.word ? h('button', { type: 'button', class: 'line-link word', on: { click: editWord } }, '「' + yp.word + '」 ✎')
        : h('button', { type: 'button', class: 'line-link', on: { click: editWord } }, '＋ 今年のひとことを書く'),
      h('div', { class: 'small muted', text: D.jpDate(ctx.year.from) + '〜' + D.jpDate(ctx.year.to) + '・残り約' + monthsLeft + 'か月' }),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(prog * 100)), 'aria-label': 'この1年の経過' },
        h('span', { style: { width: Math.round(prog * 100) + '%' } })),
      h('div', { class: 'xs muted', text: D.bucketLabel(ctx.bStart, ctx.size) + 'の季節　あと約' + D.yearsUntilAge(ctx, ctx.bEnd + 1) + '年' })
    ]));
    var banner = renderBanner();
    if (banner) out.push(banner);
    var ac = adviceCard();
    if (ac) out.push(ac);
    if (rolledNotice) {
      out.push(h('button', { type: 'button', class: 'line-link small', on: { click: function () { rolledNotice = false; setTab('life'); } } },
        '前の年に置いていた経験を「' + D.bucketLabel(ctx.bStart, ctx.size) + 'のどこかで」に戻しました ▸'));
    }

    // 今年の注力（上限なし）
    out.push(sec('今年の注力', btn('今年に置く', openYearSheet, 'btn-sm')));
    var focus = D.yearFocus(doc, ctx);
    if (!focus.length) {
      out.push(h('div', { class: 'card flat' }, [
        h('p', { class: 'small', text: ctx.A + '歳の1年に置く経験・土台を、まだ選んでいません。' }),
        btn('選ぶ', openYearSheet, 'btn-accent')
      ]));
    } else {
      out.push(h('div', { class: 'list' }, focus.map(function (f) { return itemRow(f.item, focusMeta(f)); })));
    }
    var some = D.seasonSomewhere(doc, ctx);
    if (some.length) {
      out.push(h('button', { type: 'button', class: 'line-link small', 'aria-expanded': ui.somewhereOpen ? 'true' : 'false',
        on: { click: function () { ui.somewhereOpen = !ui.somewhereOpen; renderAll(); } } },
        'この季節のどこかで：' + some.map(function (i) { return i.title; }).slice(0, 3).join('・') + (some.length > 3 ? ' ほか' : '') + (ui.somewhereOpen ? ' ▾' : ' ▸')));
      if (ui.somewhereOpen) out.push(h('div', { class: 'list' }, some.map(function (i) { return itemRow(i, D.whenLabel(i, ctx)); })));
    }

    // 窓が閉じかけ
    var closing = D.closingList(doc, ctx).slice(0, 3);
    if (closing.length) {
      out.push(sec('窓が閉じかけ'));
      out.push(h('div', { class: 'list' }, closing.map(function (x) {
        var t = x.hardIdea ? '体力がいる経験（' + x.info.end + '歳ごろまで）。まだ時期が決まっていません' : D.windowText(x.info);
        return itemRow(x.item, t);
      })));
    }

    // 今年の容量（事実だけ。上限を超えても止めない）
    var cap = D.capacity(doc, ctx);
    out.push(sec('今年の容量'));
    out.push(h('div', { class: 'card flat' }, [
      meterView('休み', cap.leave.used, cap.leave.cap, '日', cap.leave.missing ? '休みの日数が未入力の経験：' + cap.leave.missing + '件' : null,
        function () { editSetting('leaveDaysPerYear', '年間の休み（有給・夏休みなど）', '日'); }),
      meterView('週の時間', cap.hours.used, cap.hours.cap, '時間', cap.hours.missing ? '週の時間が未入力の土台：' + cap.hours.missing + '件' : null,
        function () { editSetting('freeHoursPerWeek', '1週間の自由な時間', '時間'); }),
      h('div', { class: 'meter' }, [
        h('div', { class: 'mhead' }, [h('span', { text: 'お金' }), h('span', { text: '今年の経験に使う予定 ' + man(cap.cost.total) })]),
        h('div', { class: 'note', text: (cap.cost.give ? 'うち与える ' + man(cap.cost.give) + '。' : '') + (cap.cost.missing ? '費用が未入力の経験：' + cap.cost.missing + '件。' : '') + '資産の山との照らし合わせは次の版で入ります。' })
      ])
    ]));
    out.push(h('p', { class: 'xs faint', style: { 'margin-top': '1.5rem', 'text-align': 'center' },
      text: '前回の書き出し：' + exportAgoText() + '・v' + D.APP_VERSION }));
    return out;
  }
  /*</render-now>*/
  function meterView(label, used, cap, unit, note, onEdit) {
    var right, fill = 0, over = 0, near = false;
    if (cap == null) right = used + ' / ?' + unit;
    else {
      right = used + ' / ' + cap + unit;
      if (cap > 0) {
        var ratio = used / cap;
        near = ratio >= 0.8 && ratio <= 1;
        if (ratio > 1) { fill = 100 / ratio; over = 100 - fill; right += '（はみ出し+' + Math.round((used - cap) * 10) / 10 + '）'; }
        else fill = ratio * 100;
      } else if (used > 0) { over = 100; right += '（はみ出し+' + used + '）'; }
    }
    return h('div', { class: 'meter' + (near ? ' near' : '') }, [
      h('div', { class: 'mhead' }, [h('span', { text: label }), h('span', {}, [right, cap == null ? h('button', { type: 'button', class: 'btn-ghost btn btn-sm', on: { click: onEdit } }, '入力') : null])]),
      h('div', { class: 'bar' }, [h('span', { class: 'fill', style: { width: fill + '%' } }), over ? h('span', { class: 'over', style: { width: over + '%' } }) : null]),
      note ? h('div', { class: 'note', text: note }) : null
    ]);
  }
  function editWord() {
    var yp = D.yearPlan(doc, ctx.A);
    askText(ctx.A + '歳の1年のひとこと', yp ? yp.word : '', '例：外の世界を知る年', function (v) {
      commit(null, function (d) { var y = D.ensureYearPlan(d, ctx.A); y.word = v; upd(y); });
    });
  }
  function editSetting(key, title, unit) {
    askNumber(title, doc.settings[key], unit, function (n) {
      commit(null, function (d) { d.settings[key] = n; upd(d.settings); });
    }, { allowClear: true, hint: key === 'freeHoursPerWeek' ? '平日の朝晩と休日の自由時間の合計。例：30' : '有給休暇・夏休み・年末年始など、経験に使える休みの日数' });
  }

  // 帯（同時に出すのは1枚だけ。上ほど優先）
  function renderBanner() {
    if (!storageOk) return h('div', { class: 'banner danger' }, [h('p', { text: 'このブラウザでは保存できません（プライベートモードなど）。閉じるとデータが消えます。' })]);
    if (readOnly) return h('div', { class: 'banner danger' }, [h('p', { text: '新しい版のアプリで保存されたデータです。壊さないように読み取り専用で開いています。アプリを更新してください。' }),
      btn('更新を確かめる', function () { location.reload(); }, 'btn-sm')]);
    if (!store.isReady()) return h('div', { class: 'banner danger' }, [h('p', { text: 'まだ保存していません。保存データが壊れていたので、戻し方を選んでください。' }), btn('選ぶ', openRepair, 'btn-sm btn-accent')]);
    if (saveFailed) return h('div', { class: 'banner danger' }, [h('p', { text: '保存できませんでした（空き容量など）。念のため今すぐ書き出してください。' }), btn('書き出す', function () { exportNow('share'); }, 'btn-sm btn-accent')]);
    if (updateReady) return h('div', { class: 'banner info' }, [h('p', { text: '新しい版があります。' }), btn('更新する', applyUpdate, 'btn-sm btn-accent')]);
    var sb = syncBanner();
    if (sb) return sb;
    var due = D.dueMemories(doc, ctx);
    if (due.length) {
      var it = due[0];
      return h('div', { class: 'banner ok' }, [h('p', { text: '「' + it.title + '」、行ってきましたか？' }),
        h('div', { class: 'row-actions' }, [btn('行った', function () { openMemorySheet(it.id); }, 'btn-sm btn-accent'),
          btn('時期をずらす', function () { openPlaceSheet(it.id); }, 'btn-sm'),
          btn('手放す', function () { openLetgoSheet(it.id); }, 'btn-sm')])]);
    }
    var hasData = liveItems().length > 0;
    // 自動の控えが7日以内に取れていれば、手動の書き出しの帯は出さない
    if (syncOn() && device.sync.lastOkAt && Date.now() - Date.parse(device.sync.lastOkAt) < 7 * 86400000) return null;
    var last = device.lastExportAt ? Date.parse(device.lastExportAt) : 0;
    var days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (hasData && (days == null || days >= 7)) {
      return h('div', { class: 'banner info' }, [
        h('p', { text: days == null ? 'まだスマホの外に控えがありません。Googleドライブなどに書き出しておきましょう。' : '前回の書き出しから' + days + '日たちました。スマホの外に控えを。' }),
        btn('書き出す', function () { exportNow('share'); }, 'btn-sm btn-accent')]);
    }
    return null;
  }
  function exportAgoText() {
    if (!device.lastExportAt) return 'まだ';
    var d = Math.floor((Date.now() - Date.parse(device.lastExportAt)) / 86400000);
    return d <= 0 ? '今日' : d + '日前';
  }

  /* ---------- 4-2. 人生タブ ---------- */
  function renderLife() {
    var out = [];
    out.push(h('div', { class: 'sec' }, [
      seg([{ label: '5年', value: 5 }, { label: '10年', value: 10 }], doc.settings.bucketYears, function (v) {
        commit(null, function (d) { d.settings.bucketYears = v; upd(d.settings); });
      }, 'バケツの幅'),
      h('span', { class: 'spacer' })
    ]));
    // 本の意図チェック（全体）
    var checks = D.dwzChecklist(doc, ctx);
    var ngN = checks.filter(function (c) { return c.ok === false; }).length;
    out.push(h('button', { type: 'button', class: 'irow', on: { click: openChecklist } }, [
      h('span', { class: 'sym', text: ngN ? '△' : '✓' }),
      h('span', { class: 'itext' }, [h('span', { class: 'ititle', text: '本の意図チェック' }), h('span', { class: 'imeta', text: (ngN ? '気になる所があります' : '本の考え方と合っています') + '（タップで中身）' })])
    ]));
    if (doc.settings.showSummers) {
      out.push(h('p', { class: 'xs muted', text: '体が自由に動く目安（' + ctx.bodyAge + '歳）まで、あと約' + D.summersLeft(ctx) + '回の夏' }));
    }
    // これまで（思い出）
    var logs = D.live(doc.logs).slice().sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
    if (logs.length) {
      out.push(h('button', { type: 'button', class: 'line-link', 'aria-expanded': ui.pastOpen ? 'true' : 'false', on: { click: function () { ui.pastOpen = !ui.pastOpen; renderAll(); } } },
        'これまでの思い出' + (ui.pastOpen ? ' ▾' : ' ▸')));
      if (ui.pastOpen) out.push(h('div', { class: 'list' }, logs.map(function (l) {
        var feel = l.feel === 3 ? '人生の宝' : l.feel === 2 ? 'とてもよかった' : l.feel === 1 ? 'よかった' : '';
        return h('button', { type: 'button', class: 'irow done', on: { click: function () { if (l.itemId && getItem(l.itemId)) openItemSheet(l.itemId); } } }, [
          h('span', { class: 'sym', text: '✓' }),
          h('span', { class: 'itext' }, [h('span', { class: 'ititle', text: l.itemTitle || '思い出' }),
            h('span', { class: 'imeta', text: [l.date ? D.jpDate(l.date) : '', feel, l.note ? l.note.slice(0, 60) : ''].filter(Boolean).join('・') })])
        ]);
      })));
    }
    var costs = D.costTable(doc, ctx).buckets;
    D.lifeBuckets(ctx).forEach(function (b, idx) { out.push(renderBucket(b, costs[idx])); });
    return out;
  }
  function peopleLine(b) {
    var ps = livePeople().filter(function (p) { return p.birthYear != null; });
    if (!ps.length) return null;
    var parts = ps.map(function (p) {
      var a1 = D.personAgeAt(p, ctx, Math.max(ctx.A, b.start)), a2 = D.personAgeAt(p, ctx, b.end);
      if (a1 == null || a1 > 120) return null;
      return p.name + (a1 === a2 ? a1 : a1 + '–' + a2);
    }).filter(Boolean);
    return parts.length ? h('div', { class: 'xs muted', text: parts.join('　') }) : null;
  }
  function renderBucket(b, cost) {
    var items = liveItems().filter(function (i) { return i.status === 'placed' || i.status === 'done'; });
    var kids = [];
    var head = h('div', { class: 'bhead' }, [h('h3', { text: b.label }), h('span', { class: 'xs muted', text: '（' + b.start + '〜' + b.end + '歳）' }),
      b.isNow ? h('span', { class: 'now-badge', text: 'いま・あと約' + D.yearsUntilAge(ctx, b.end + 1) + '年' }) : null]);
    var metaParts = ['思い出の配当 約' + D.dividendYears(ctx, b.start) + '年'];
    if (cost && cost.total) metaParts.push('予定費用 ' + man(cost.total));
    kids.push(head, peopleLine(b), h('div', { class: 'bmeta', text: metaParts.join('・') }));
    function inRangeExp(i, a1, a2) {
      if (i.kind !== 'exp' || i.repeat) return false;
      var r = D.itemRange(i, ctx);
      if (i.when && i.when.date) return r && r[0] >= a1 && r[0] <= a2;   // 誕生日をまたぐ日付は、始まりの年齢で
      return r && r[0] === r[1] && r[0] >= a1 && r[0] <= a2;
    }
    var rows = [];
    if (b.isNow) {
      for (var a = ctx.A; a <= b.end; a++) {
        var list = items.filter(function (i) { return inRangeExp(i, a, a); });
        rows.push(h('div', { class: 'yrow' }, [h('span', { class: 'yage', text: a + '歳' }), h('div', { class: 'ybody' },
          list.length ? h('div', { class: 'list' }, list.map(function (i) { return itemRow(i, D.whenLabel(i, ctx)); })) : h('div', { class: 'empty-note', text: '―' }))]));
      }
      var some = D.seasonSomewhere(doc, ctx);
      if (some.length) rows.push(h('div', { class: 'yrow' }, [h('span', { class: 'yage', text: '季節' }), h('div', { class: 'ybody' }, h('div', { class: 'list' }, some.map(function (i) { return itemRow(i, D.whenLabel(i, ctx)); })))]));
    } else {
      var ex = items.filter(function (i) {
        if (i.kind !== 'exp' || i.repeat) return false;
        var pa = D.placedAge(i, ctx);
        return pa != null && pa >= b.start && pa <= b.end;
      }).sort(function (x, y) { return D.placedAge(x, ctx) - D.placedAge(y, ctx); });
      if (ex.length) rows.push(h('div', { class: 'list' }, ex.map(function (i) { return itemRow(i, D.whenLabel(i, ctx)); })));
    }
    var themes = items.filter(function (i) {
      if (i.kind !== 'theme' || i.status !== 'placed') return false;
      var r = D.itemRange(i, ctx);
      return r && r[0] <= b.end && r[1] >= Math.max(b.start, ctx.A) && (b.isNow || r[0] >= b.start);
    });
    var reps = items.filter(function (i) {
      if (!i.repeat || i.status !== 'placed') return false;
      var from = Math.max(i.repeat.fromAge, ctx.A);
      return b.isNow ? (from <= b.end && D.repeatEnd(i, ctx) >= ctx.A) : (i.repeat.fromAge >= b.start && i.repeat.fromAge <= b.end);
    });
    if (themes.length || reps.length) rows.push(h('div', { class: 'list', style: { 'margin-top': '.4rem' } },
      themes.map(function (i) { return itemRow(i, D.whenLabel(i, ctx)); }).concat(reps.map(function (i) {
        var left = D.repeatRemaining(doc, i, ctx);
        return itemRow(i, D.whenLabel(i, ctx) + (left != null ? '・あと約' + left + '回' : ''));
      }))));
    if (!rows.length) {
      var p = D.promptFor(b.start);
      rows.push(h('div', { class: 'empty-note' }, [h('div', { text: 'まだ空っぽです。' }), h('div', { text: '問い：' + p.text }),
        btn('思いつきを書く', function () { openIdeaSheet(); }, 'btn-sm', { style: { 'margin-top': '.3rem' } })]));
    }
    return h('section', { class: 'card bucket' + (b.isNow ? ' now' : ''), 'aria-label': b.label }, kids.concat(rows));
  }

  /* ---------- 4-3. 候補箱タブ ---------- */
  function renderInbox() {
    var out = [];
    out.push(h('div', { class: 'chips', style: { margin: '.25rem 0 .5rem' } }, [
      chip('候補', ui.inboxFilter === 'idea', function () { ui.inboxFilter = 'idea'; renderAll(); }),
      chip('すべて', ui.inboxFilter === 'all', function () { ui.inboxFilter = 'all'; renderAll(); }),
      chip('思い出あり', ui.inboxFilter === 'done', function () { ui.inboxFilter = 'done'; renderAll(); }),
      chip('手放した', ui.inboxFilter === 'letgo', function () { ui.inboxFilter = 'letgo'; renderAll(); })
    ]));
    out.push(h('input', { class: 'input', type: 'search', placeholder: '探す（題名・メモ）', value: ui.search, 'aria-label': '探す',
      on: { input: function (e) { ui.search = e.target.value; renderInboxList(); } } }));
    out.push(h('div', { id: 'inboxList' }, inboxList()));
    return out;
  }
  function renderInboxList() { var el = document.getElementById('inboxList'); if (el) { el.replaceChildren(); append(el, inboxList()); } }
  function matchSearch(i) {
    var q = ui.search.trim();
    if (!q) return true;
    return (i.title + ' ' + i.note).toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }
  function inboxList() {
    var out = [];
    var all = liveItems().filter(matchSearch);
    if (ui.inboxFilter === 'idea') {
      var drafts = all.filter(function (i) { return i.status === 'idea' && i.origin === 'draft'; });
      if (drafts.length) {
        out.push(sec('Claudeが用意した下書き'));
        out.push(h('p', { class: 'xs muted', text: '採用するかどうかは、あなたが決めます。いらない物は消してかまいません。' }));
        out.push(h('div', { class: 'list' }, drafts.map(function (i) {
          return h('div', {}, [itemRow(i, hintText(i)), h('div', { class: 'row-actions', style: { margin: '.2rem 0 .6rem' } }, [
            btn('採用して置く', function () { openPlaceSheet(i.id); }, 'btn-sm btn-accent'),
            btn('いらない', function () { commit('下書きを消しました', function (d) { var x = D.byId(d.items, i.id); D.removeRec(x, device.deviceId); }); }, 'btn-sm')])]);
        })));
      }
      var mine = all.filter(function (i) { return i.status === 'idea' && i.origin !== 'draft'; });
      out.push(sec('思いついたこと'));
      if (!mine.length) out.push(h('p', { class: 'small muted', text: '下の欄に、死ぬまでにやりたいことを書いてみましょう。お金のことは考えずに、思いつくまま。' }));
      else out.push(h('div', { class: 'list' }, mine.map(function (i) {
        return itemRow(i, i.kind === 'theme' ? '土台' : null, h('span', { class: 'iact' }, btn('置く', function (e) { e.stopPropagation(); openPlaceSheet(i.id); }, 'btn-sm')));
      })));
      out.push(h('button', { type: 'button', class: 'line-link', 'aria-expanded': ui.promptsOpen ? 'true' : 'false', on: { click: function () { ui.promptsOpen = !ui.promptsOpen; renderInboxList(); } } }, '問いかけから考える' + (ui.promptsOpen ? ' ▾' : ' ▸')));
      if (ui.promptsOpen) out.push(h('div', { class: 'list' }, D.PROMPTS.map(function (p) {
        return h('button', { type: 'button', class: 'irow', on: { click: function () { openIdeaSheet('', p.text); } } }, [h('span', { class: 'sym', text: '？' }), h('span', { class: 'itext' }, h('span', { class: 'ititle', text: p.text }))]);
      })));
      out.push(h('button', { type: 'button', class: 'line-link', 'aria-expanded': ui.examplesOpen ? 'true' : 'false', on: { click: function () { ui.examplesOpen = !ui.examplesOpen; renderInboxList(); } } }, '例を見る' + (ui.examplesOpen ? ' ▾' : ' ▸')));
      if (ui.examplesOpen) out.push(h('div', { class: 'list' }, D.EXAMPLES.map(function (ex) {
        return h('button', { type: 'button', class: 'irow', on: { click: function () {
          commit('「' + ex.title + '」を候補箱に入れました', function (d) { d.items.push(D.newItem({ title: ex.title, category: ex.category, body: ex.body, origin: 'example' })); });
        } } }, [h('span', { class: 'sym', text: '＋' }), h('span', { class: 'itext' }, [h('span', { class: 'ititle', text: ex.title }), h('span', { class: 'imeta', text: ex.category })])]);
      })));
    } else {
      var list = all.filter(function (i) { return ui.inboxFilter === 'all' ? true : i.status === ui.inboxFilter; });
      if (!list.length) out.push(h('p', { class: 'small muted', text: 'ここにはまだ何もありません。' }));
      else out.push(h('div', { class: 'list', style: { 'margin-top': '.5rem' } }, list.map(function (i) {
        var meta = i.status === 'letgo' ? '手放した' + (i.letgo && i.letgo.reason ? '：' + i.letgo.reason : '') : i.status === 'idea' ? '候補' : ctx ? D.whenLabel(i, ctx) : '';
        return itemRow(i, meta);
      })));
    }
    return out;
  }
  function hintText(i) {
    var hnt = i.hint || {}, parts = [];
    if (hnt.date) parts.push('案：' + D.jpDate(hnt.date, hnt.precision));
    else if (hnt.fromAge != null) parts.push('案：' + (hnt.fromAge === hnt.toAge || hnt.toAge == null ? hnt.fromAge + '歳' : hnt.fromAge + '〜' + hnt.toAge + '歳'));
    if (hnt.repeat) parts.push('案：年' + hnt.repeat.perYear + '回');
    if (i.note) parts.push(i.note.slice(0, 40));
    return parts.join('・') || (i.kind === 'theme' ? '土台' : null);
  }
  // 画面下の入力欄（日本語の変換を確定する Enter では保存しない）。一度だけ作って使い回す
  var inputBarEl = null;
  function getInputBar() {
    if (inputBarEl) return inputBarEl;
    var input = h('input', { class: 'input', type: 'text', maxlength: '200', placeholder: '思いついたことを書く（お金は考えずに）', enterkeyhint: 'done', 'aria-label': '思いついたこと',
      on: {
        focus: function () { document.body.classList.add('typing'); },
        blur: function () { document.body.classList.remove('typing'); },
        keydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!e.isComposing && e.keyCode !== 229) submit(); } }
      } });
    function keepFocus(e) { e.preventDefault(); }   // 押しても入力欄からフォーカスを移さない（キーボードが閉じない・欄が跳ねない）
    var kindBtn = h('button', { type: 'button', class: 'chip',
      on: { mousedown: keepFocus, click: function () { ui.inboxKind = ui.inboxKind === 'exp' ? 'theme' : 'exp'; kindBtn.textContent = ui.inboxKind === 'exp' ? '種類：経験' : '種類：土台'; } } }, '種類：経験');
    function submit() {
      var v = input.value.trim();
      if (!v) return;
      input.value = '';
      commit('候補箱に入れました', function (d) { d.items.push(D.newItem({ title: v, kind: ui.inboxKind })); });
      input.focus();
    }
    var form = h('form', { on: { submit: function (e) { e.preventDefault(); submit(); } } }, [kindBtn, input, h('button', { type: 'submit', class: 'btn btn-accent', on: { mousedown: keepFocus } }, '追加')]);
    inputBarEl = h('div', { class: 'inputbar' }, form);
    // Android の戻る操作でキーボードだけ閉じた時は、フォーカスが残るので、画面の高さが戻ったら入力中を解く
    var vv = window.visualViewport, tallest = vv ? vv.height : window.innerHeight;
    function onResize() {
      var hgt = vv ? vv.height : window.innerHeight;
      if (hgt > tallest) tallest = hgt;
      if (document.activeElement === input && hgt >= tallest - 80) input.blur();
    }
    (vv || window).addEventListener('resize', onResize);
    return inputBarEl;
  }

  /* ---------- 4-4. お金と時間タブ ---------- */
  function renderMoney() {
    var out = [];
    out.push(h('div', { class: 'banner info' }, [h('p', { class: 'small', text: '資産の山（いつ資産が一番多くなり、どう使い切るか）の試算は、次の版で入ります。今は、時間の予算と、置いた経験の予定費用を見られます。' })]));
    out.push(sec('時間の予算'));
    var s = doc.settings;
    out.push(h('div', { class: 'card flat' }, [
      h('div', { class: 'meter' }, [h('div', { class: 'mhead' }, [h('span', { text: '年間の休み' }),
        h('span', {}, [s.leaveDaysPerYear == null ? '未入力 ' : s.leaveDaysPerYear + '日 ', btn('変える', function () { editSetting('leaveDaysPerYear', '年間の休み（有給・夏休みなど）', '日'); }, 'btn-sm btn-ghost')])])]),
      h('div', { class: 'meter' }, [h('div', { class: 'mhead' }, [h('span', { text: '1週間の自由な時間' }),
        h('span', {}, [s.freeHoursPerWeek == null ? '未入力 ' : s.freeHoursPerWeek + '時間（年' + Math.round(s.freeHoursPerWeek * 52) + '時間）', btn('変える', function () { editSetting('freeHoursPerWeek', '1週間の自由な時間', '時間'); }, 'btn-sm btn-ghost')])])])
    ]));
    var t = D.costTable(doc, ctx);
    out.push(sec('予定費用（今の円）'));
    function row(label, r) { return h('tr', {}, [h('td', { text: label }), h('td', { text: r.exp ? man(r.exp) : '―' }), h('td', { text: r.theme ? man(r.theme) : '―' }), h('td', { text: r.give ? man(r.give) : '―' }), h('td', { text: r.total ? man(r.total) : '―' })]); }
    out.push(h('div', { class: 'card flat table-wrap' }, h('table', { class: 't' }, [
      h('thead', {}, h('tr', {}, ['時期', '経験', '土台', '与える', '計'].map(function (x) { return h('th', { text: x }); }))),
      h('tbody', {}, t.years.map(function (y) { return row(y.age + '歳の1年', y); }).concat(t.buckets.slice(1).map(function (b) { return row(b.label, b); })))
    ])));
    out.push(h('p', { class: 'xs muted', text: '費用は、経験を置いた後に項目の画面で入れられます（書き出す時はお金を考えない、という本の手順のため）。' }));
    return out;
  }

  /* =====================================================================
   * 5. シート
   * ===================================================================== */

  /* ---------- 5-1. 思いつき（お金の欄は無い）---------- */
  /*<idea-sheet>*/
  var sheetDrafts = {};   // 書きかけ（シートを閉じても、アプリを開いている間は残す）
  function openIdeaSheet(prefill, placeholder) {
    var dr = sheetDrafts.idea || {};
    var title = prefill || dr.title || '', kind = dr.kind || 'exp', category = dr.category || '', first = true;
    function keep() { sheetDrafts.idea = { title: title, kind: kind, category: category }; }
    openSheet({ title: '思いついたことを書く', keepOnBackdrop: true, build: function (api) {
      var input = h('input', { class: 'input', type: 'text', value: title, maxlength: '200', enterkeyhint: 'done',
        placeholder: placeholder || '例：オーロラを見に行く（お金は考えずに）',
        'aria-label': '思いついたこと',
        on: { input: function (e) { title = e.target.value; keep(); },
          keydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!e.isComposing && e.keyCode !== 229) save(false); } } } });
      function save(toYear) {
        var v = title.trim();
        if (!v) { input.focus(); return; }
        var created = D.newItem({ title: v, kind: kind, category: category });
        delete sheetDrafts.idea;
        api.close();
        commit(toYear ? null : '候補箱に入れました', function (d) { d.items.push(created); });
        if (toYear) openPlaceSheet(created.id, { target: { fromAge: ctx.A, toAge: ctx.A }, fromFocus: true });
      }
      if (first) { first = false; setTimeout(function () { try { input.focus(); } catch (e) {} }, 60); }
      return {
        body: [input,
          field('種類', seg([{ label: '経験', value: 'exp' }, { label: '土台（習慣・準備）', value: 'theme' }], kind, function (v) { kind = v; keep(); api.refresh(); })),
          field('カテゴリ（任意）', h('div', { class: 'chips' }, doc.settings.categories.map(function (c) {
            return chip(c, category === c, function () { category = category === c ? '' : c; keep(); api.refresh(); });
          }))),
          h('p', { class: 'xs muted', text: '「いつやるか」は、候補箱の［置く］で本の問いに答えながら決めます。' })],
        foot: [btn('今年に置く', function () { save(true); }), btn('候補箱へ', function () { save(false); }, 'btn-accent')]
      };
    } });
  }
  /*</idea-sheet>*/

  /* ---------- 5-2. 配置「いつやるのが一番いい？」＋本の意図チェック ---------- */
  /*<place-sheet>*/
  function targetLabel(t) {
    if (t.date) return D.jpDate(t.date, t.precision) + (t.endDate ? '〜' + D.shortDate(t.endDate) : '');
    if (t.fromAge === t.toAge) return t.fromAge + '歳の1年';
    var b = D.bucketOf(t.fromAge, ctx.size);
    if (t.fromAge === ctx.A && t.toAge === ctx.bEnd) return 'この季節のどこかで（' + t.fromAge + '〜' + t.toAge + '歳）';
    return D.bucketLabel(b.start, ctx.size) + '（' + t.fromAge + '〜' + t.toAge + '歳）';
  }
  function whenFromTarget(t) {
    if (t.date) return { fromAge: null, toAge: null, date: t.date, endDate: t.endDate || null, precision: t.precision || 'day' };
    return { fromAge: t.fromAge, toAge: t.toAge, date: null, endDate: null, precision: 'day' };
  }
  function openPlaceSheet(id, opts) {
    opts = opts || {};
    var it0 = getItem(id);
    if (!it0 || !ctx) return;
    var needQ = it0.kind === 'exp' && (!D.hasDwz(it0) || opts.reanswer);
    var step = needQ ? 'q' : (opts.target ? 'check' : 'target');
    var ans = null, target = opts.target || null, findings = null, reasonMode = false, reason = '', dateMode = false;
    var dt = { date: '', endDate: '', month: false };
    var sheet = null;

    function place(extra) {
      extra = extra || {};
      var t = extra.target || target;
      var label;
      var ok = commit(null, function (d) {
        var x = D.byId(d.items, id);
        // 「今年に置く」から来た時だけ、外した時の戻り先を控える（毎回上書き）。それ以外は控えを消す
        x.prevWhen = opts.fromFocus ? D.clone(x.when) : null;
        if (extra.kind) x.kind = extra.kind;
        x.when = whenFromTarget(t);
        if (t.repeat) x.repeat = D.clone(t.repeat);
        if (x.status !== 'done') x.status = 'placed';
        if (x.origin === 'draft') x.origin = 'user';
        if (extra.reason) { x.dwz = Object.assign({}, x.dwz || {}, { reason: extra.reason }); }
        upd(x);
        label = D.whenLabel(x, ctx);
      });
      if (!ok) return;
      if (sheet) sheet.close();
      toast((extra.okLine ? '本の考え方と合っています ✓　' : '') + '「' + label + '」に置きました', { undo: true });
    }
    function evaluate() {
      var it = getItem(id);
      findings = it.kind === 'exp' ? D.dwzCheck(it, target, ctx) : [];
      if (!findings.length) { place({ okLine: it.kind === 'exp' }); return true; }
      step = 'check';
      return false;
    }
    // 置き先が決まっていて、問いにも答え済みなら、先に判定する（指摘が無ければシートを開かずに置く）
    if (step === 'check' && evaluate()) return null;

    sheet = openSheet({ title: function () { return step === 'q' ? '本の3つの問い' : 'いつやるのが一番いい？'; }, build: function (api) {
      var it = getItem(id);
      if (!it) return null;
      if (step === 'q') return buildQuestions(it, api);
      if (step === 'target') return buildTargets(it, api);
      return buildFindings(it, api);
    } });

    function buildQuestions(it, api) {
      if (!ans) { var z = it.dwz || {}; ans = { until: z.until || null, why: (z.why || []).slice(), memory: z.memory || null }; }
      function q(title, hint, choices) { return h('div', { class: 'q' }, [h('div', { class: 'qt', text: title }), hint ? h('div', { class: 'qh', text: hint }) : null, h('div', { class: 'chips' }, choices)]); }
      var ready = ans.until && ans.memory && ans.why.length;
      return {
        body: [
          h('p', { class: 'small muted', text: '「' + it.title + '」について、タップで答えます。答えから、本の考え方に沿っているかを一緒に確かめます。' }),
          q('① 何歳まで、同じくらい楽しめる？', '本でいう「賞味期限」。体力・一緒にやる人・状況で変わります（ルール7）',
            ['30s', '40s', '60s', 'any'].map(function (k) { return chip(D.UNTIL_LABEL[k], ans.until === k, function () { ans.until = k; api.refresh(); }); })),
          q('② 今やる理由は？（いくつでも）', '時期に縛りがあるかどうか（ルール1）',
            Object.keys(D.WHY_LABEL).map(function (k) {
              return chip(D.WHY_LABEL[k], ans.why.indexOf(k) >= 0, function () {
                if (k === 'none') ans.why = ans.why.indexOf('none') >= 0 ? [] : ['none'];
                else { ans.why = ans.why.filter(function (x) { return x !== 'none'; }); var i = ans.why.indexOf(k); if (i >= 0) ans.why.splice(i, 1); else ans.why.push(k); }
                api.refresh();
              });
            })),
          q('③ 思い出として、何度も思い出しそう？', '経験は後から何度も喜びをくれる＝思い出の配当（ルール2）',
            ['high', 'mid', 'low'].map(function (k) { return chip(D.MEMORY_LABEL[k], ans.memory === k, function () { ans.memory = k; api.refresh(); }); }))
        ],
        foot: [btn('次へ', function () {
          if (!commit(null, function (d) { var x = D.byId(d.items, id); D.applyDwzAnswers(x, ans); upd(x); })) return;
          if (target) { if (evaluate()) return; }
          else step = 'target';
          api.refresh();
        }, 'btn-accent', { disabled: !ready })]
      };
    }

    function buildTargets(it, api) {
      var end = D.effEnd(it, ctx);
      var withPeople = livePeople().filter(function (p) { return (it.withIds || []).indexOf(p.id) >= 0 && p.birthYear != null; });
      function annotate(t) {
        var parts = ['思い出の配当 約' + D.dividendYears(ctx, t.fromAge) + '年'];
        withPeople.forEach(function (p) { parts.push(p.name + D.personAgeAt(p, ctx, t.fromAge) + '歳'); });
        var outside = it.kind === 'exp' && t.fromAge > end;
        if (outside) parts.unshift('窓の外');
        return { text: parts.join('・'), outside: outside };
      }
      function tbtn(t, label, suggest) {
        var a = annotate(t);
        return h('button', { type: 'button', class: 'target' + (a.outside ? ' outside' : '') + (suggest ? ' suggest' : ''),
          on: { click: function () { target = t; if (!evaluate()) api.refresh(); } } },
          [h('span', { class: 'tl', text: label }), h('span', { class: 'tm', text: a.text })]);
      }
      var body = [];
      body.push(h('p', { class: 'small muted', text: 'お金はまだ考えなくてOK。「いつやるのが一番いいか」だけで選びます。' }));
      if (it.kind === 'exp') body.push(h('p', { class: 'xs muted', text: '窓（賞味期限）：' + end + '歳ごろまで' + (it.dwz ? '　［' + D.UNTIL_LABEL[it.dwz.until] + '］' : '') }));
      var hnt = it.hint || {};
      if (hnt.repeat && hnt.repeat.perYear > 0) {
        // 回数型の案（例：海外旅行 年1回・26〜75歳）
        var rf = Math.max(ctx.A, hnt.repeat.fromAge || ctx.A);
        var rt = hnt.repeat.toAge == null ? end : Math.min(hnt.repeat.toAge, end);
        var rtg = { fromAge: rf, toAge: Math.max(rf, rt), repeat: { perYear: hnt.repeat.perYear, fromAge: rf, toAge: hnt.repeat.toAge == null ? null : hnt.repeat.toAge } };
        var per = hnt.repeat.perYear >= 1 ? '年' + hnt.repeat.perYear + '回' : Math.round(1 / hnt.repeat.perYear) + '年に1回';
        body.push(h('div', { class: 'xs muted', text: '下書きの案（回数で数える）' }));
        body.push(tbtn(rtg, per + '・' + rtg.fromAge + '〜' + rtg.toAge + '歳', true));
      } else if (hnt.date || hnt.fromAge != null) {
        var ht = hnt.date ? { date: hnt.date, endDate: hnt.endDate || null, precision: hnt.precision || 'day', fromAge: D.ageOn(ctx.birth, hnt.date) }
          : { fromAge: hnt.fromAge, toAge: hnt.toAge == null ? hnt.fromAge : hnt.toAge };
        if (ht.fromAge != null && ht.fromAge >= ctx.A) { body.push(h('div', { class: 'xs muted', text: '下書きの案' })); body.push(tbtn(ht, targetLabel(ht), true)); }
      }
      body.push(h('div', { class: 'sec' }, h('h2', { text: '今の季節（' + D.bucketLabel(ctx.bStart, ctx.size) + '）' })));
      for (var a = ctx.A; a <= ctx.bEnd; a++) body.push(tbtn({ fromAge: a, toAge: a }, a + '歳の1年'));
      if (ctx.bEnd > ctx.A) body.push(tbtn({ fromAge: ctx.A, toAge: ctx.bEnd }, 'この季節のどこかで'));
      body.push(h('div', { class: 'sec' }, h('h2', { text: 'これからの季節' })));
      D.lifeBuckets(ctx).slice(1).forEach(function (b) { body.push(tbtn({ fromAge: b.start, toAge: b.end }, b.label)); });
      body.push(h('div', { class: 'sec' }, h('h2', { text: '日付で決める' })));
      if (!dateMode) body.push(btn('日付を入れる', function () { dateMode = true; api.refresh(); }, 'btn-sm'));
      else {
        body.push(field('いつから', h('input', { class: 'input', type: dt.month ? 'month' : 'date', value: dt.month ? dt.date.slice(0, 7) : dt.date,
          on: { change: function (e) { dt.date = dt.month ? (e.target.value ? e.target.value + '-01' : '') : e.target.value; } } })));
        body.push(h('label', { class: 'small' }, [h('input', { type: 'checkbox', checked: dt.month, on: { change: function (e) { dt.month = e.target.checked; dt.date = ''; api.refresh(); } } }), ' 月だけ決める']));
        if (!dt.month) body.push(field('いつまで（任意）', h('input', { class: 'input', type: 'date', value: dt.endDate, on: { change: function (e) { dt.endDate = e.target.value; } } })));
        body.push(btn('この日付に置く', function () {
          if (!D.isYmd(dt.date)) { toast('日付を入れてください'); return; }
          if (D.ageOn(ctx.birth, dt.date) < ctx.A && dt.date < ctx.today) { toast('過ぎた日付です。思い出として残すなら［思い出を残す］から'); return; }
          target = { date: dt.date, endDate: !dt.month && D.isYmd(dt.endDate) && dt.endDate >= dt.date ? dt.endDate : null, precision: dt.month ? 'month' : 'day' };
          if (!evaluate()) api.refresh();
        }, 'btn-accent', { style: { 'margin-top': '.5rem' } }));
      }
      return body;
    }

    function buildFindings(it, api) {
      var body = [h('p', { class: 'small', text: '置き先：' + targetLabel(target) })];
      findings.forEach(function (f) {
        body.push(h('div', { class: 'finding ' + f.level }, [h('div', { text: f.text }), h('div', { class: 'rule', text: ruleLabel(f.rule) + (f.rule ? '（' + ruleTitles(f.rule) + '）' : '') })]));
      });
      var hasR1 = findings.some(function (f) { return f.id === 'R1'; });
      var hasWarn = findings.some(function (f) { return f.level === 'warn'; });
      var foot;
      if (hasR1) {
        var later = { fromAge: ctx.bEnd + 1, toAge: ctx.bEnd + ctx.size };
        if (reasonMode) {
          body.push(field('今やる理由を1行で（必須）', h('input', { class: 'input', type: 'text', value: reason, maxlength: '120', placeholder: '例：今の仕事に直結するから',
            on: { input: function (e) { reason = e.target.value; var b = document.getElementById('reasonOk'); if (b) b.disabled = !reason.trim(); } } }),
            '理由を残すと「意識して選んだ」印になります。チェックリストと Claude のレビューにも渡します。'));
          foot = [btn('戻る', function () { reasonMode = false; api.refresh(); }),
            btn('理由を残して置く', function () { if (reason.trim()) place({ reason: reason.trim() }); }, 'btn-accent', { id: 'reasonOk', disabled: !reason.trim() })];
        } else {
          body.push(h('div', { class: 'list' }, [
            btn('後の季節に置く（' + D.bucketLabel(later.fromAge, ctx.size) + '）', function () { place({ target: later }); }, 'btn-accent btn-block'),
            btn('習慣（土台）として扱う', function () { place({ kind: 'theme', target: target.date ? target : { fromAge: ctx.A, toAge: ctx.bEnd } }); }, 'btn-block'),
            btn('それでも' + (target.fromAge === target.toAge || target.date ? 'この年' : 'この季節') + 'に置く', function () { reasonMode = true; api.refresh(); }, 'btn-block')
          ]));
          foot = [btn('選び直す', function () { step = 'target'; api.refresh(); })];
        }
      } else if (hasWarn) {
        foot = [btn('選び直す', function () { step = 'target'; api.refresh(); }), btn('それでも置く', function () { place(); }, 'btn-accent')];
      } else {
        foot = [btn('選び直す', function () { step = 'target'; api.refresh(); }), btn('このまま置く', function () { place(); }, 'btn-accent')];
      }
      return { body: body, foot: foot };
    }
    return sheet;
  }
  /*</place-sheet>*/
  function ruleTitles(r) {
    return String(r).replace('ルール', '').split('・').map(function (n) { return D.RULES[+n] || ''; }).filter(Boolean).join('／');
  }

  /* ---------- 5-3. 今年に置く ---------- */
  function openYearSheet() {
    openSheet({ title: function () { return ctx.A + '歳の1年に置く'; }, build: function () {
      var cap = D.capacity(doc, ctx);
      var body = [h('div', { class: 'card flat' }, [
        meterView('休み', cap.leave.used, cap.leave.cap, '日', null, function () { editSetting('leaveDaysPerYear', '年間の休み', '日'); }),
        meterView('週の時間', cap.hours.used, cap.hours.cap, '時間', null, function () { editSetting('freeHoursPerWeek', '1週間の自由な時間', '時間'); }),
        h('div', { class: 'xs muted', text: '個数の上限はありません。重さ（休み・時間・お金）で考えます。上限を超えても置けます。' })
      ])];
      var focus = D.yearFocus(doc, ctx);
      body.push(sec('置いている'));
      if (!focus.length) body.push(h('p', { class: 'small muted', text: 'まだありません。' }));
      focus.forEach(function (f) {
        var it = f.item, act;
        if (f.why === 'year') act = btn('外す', function () { unplaceYear(it.id); }, 'btn-sm');
        else if (f.why === 'date') act = btn('時期', function () { openPlaceSheet(it.id); }, 'btn-sm');
        else act = btn('範囲', function () { openItemSheet(it.id); }, 'btn-sm');
        body.push(itemRow(it, focusMeta(f), h('span', { class: 'iact', on: { click: function (e) { e.stopPropagation(); } } }, act)));
      });
      var some = D.seasonSomewhere(doc, ctx);
      if (some.length) {
        body.push(sec('この季節のどこかで'));
        some.forEach(function (it) { body.push(itemRow(it, D.whenLabel(it, ctx), h('span', { class: 'iact', on: { click: function (e) { e.stopPropagation(); } } }, btn('今年に', function () { openPlaceSheet(it.id, { target: { fromAge: ctx.A, toAge: ctx.A }, fromFocus: true }); }, 'btn-sm')))); });
      }
      var ideas = liveItems().filter(function (i) { return i.status === 'idea'; });
      if (ideas.length) {
        body.push(sec('候補箱から'));
        ideas.forEach(function (it) { body.push(itemRow(it, it.kind === 'theme' ? '土台' : null, h('span', { class: 'iact', on: { click: function (e) { e.stopPropagation(); } } }, btn('今年に', function () { openPlaceSheet(it.id, { target: { fromAge: ctx.A, toAge: ctx.A }, fromFocus: true }); }, 'btn-sm')))); });
      }
      return body;
    } });
  }
  function unplaceYear(id) {
    commit('今年から外しました', function (d) {
      var x = D.byId(d.items, id);
      var pw = x.prevWhen;
      var season = { fromAge: ctx.A, toAge: ctx.bEnd, date: null, endDate: null, precision: 'day' };
      var pwEnd = pw && pw.fromAge != null ? (pw.toAge == null ? pw.fromAge : pw.toAge) : null;
      if (pw && pw.fromAge != null && pwEnd >= ctx.A && !(pw.fromAge === ctx.A && pwEnd === ctx.A)) x.when = pw;
      else if (pw && pw.fromAge == null && !pw.date && x.status !== 'done') { x.when = D.ITEM_DEFAULTS().when; x.status = 'idea'; }
      else x.when = season;
      x.prevWhen = null;
      upd(x);
    });
  }

  /* ---------- 5-4. 項目 ---------- */
  function openItemSheet(id) {
    openSheet({ title: function () { var it = getItem(id); return it ? (it.kind === 'theme' ? '土台' : '経験') : ''; }, build: function (api) {
      var it = getItem(id);
      if (!it) return null;
      var body = [], foot = [];
      function save(fn, label) { commit(label || null, function (d) { var x = D.byId(d.items, id); fn(x, d); upd(x); }); }
      function saveText(fn) { commit(null, function (d) { var x = D.byId(d.items, id); fn(x, d); upd(x); }, { noRefresh: true }); }

      body.push(h('input', { class: 'input', type: 'text', value: it.title, maxlength: '200', 'aria-label': '題名', style: { 'font-weight': '700', 'font-size': '1.1rem' },
        on: { change: function (e) { var v = e.target.value.trim(); if (v && v !== it.title) saveText(function (x) { x.title = v; if (x.origin === 'draft') x.origin = 'user'; }); } } }));
      var status = it.status === 'idea' ? '候補（時期は未定）' : it.status === 'letgo' ? '手放した' + (it.letgo && it.letgo.reason ? '：' + it.letgo.reason : '') : D.whenLabel(it, ctx) + (it.status === 'done' ? '・思い出あり' : '');
      body.push(h('p', { class: 'small muted', text: status }));
      if (it.origin === 'draft' && hintText(it)) body.push(h('p', { class: 'xs muted', text: 'Claudeの下書き：' + hintText(it) }));
      var af = D.adviceForItem(doc, it.id);
      if (af) body.push(h('div', { class: 'finding info' }, [h('div', { class: 'xs muted', text: 'Claude のひとこと（' + adviceDate(af.advice) + '）' }), h('div', { text: af.entry.comment }),
        af.entry.suggestion ? h('div', { class: 'small', text: '提案：' + af.entry.suggestion }) : null,
        af.entry.rule ? h('div', { class: 'rule', text: ruleLabel(af.entry.rule) }) : null]));
      // 下書きの「休み・時間・費用」の案は、置いた後にだけ出す（書き出す時はお金を考えない、という本の手順）
      if (it.status === 'placed' && it.hint) {
        var hx = D.hintExtras(it), hparts = [];
        if (hx.leaveDays != null) hparts.push('休み' + hx.leaveDays + '日');
        if (hx.hoursPerWeek != null) hparts.push('週' + hx.hoursPerWeek + '時間');
        if (hx.goalDate) hparts.push('目安 ' + D.jpDate(hx.goalDate, 'month'));
        if (hx.costOnce != null) hparts.push(man(hx.costOnce));
        if (hx.costPerYear != null) hparts.push('毎年' + man(hx.costPerYear));
        if (hparts.length) body.push(btn('下書きの案を入れる（' + hparts.join('・') + '）', function () { save(function (x) { D.applyHintExtras(x); }, '案を入れました'); }, 'btn-sm'));
      }
      if (it.kind === 'exp') {
        var w = D.windowInfo(it, ctx);
        if (w) body.push(h('p', { class: 'small', text: '窓：' + D.windowText(w) }));
        if (it.repeat) { var left = D.repeatRemaining(doc, it, ctx); body.push(h('p', { class: 'small', text: '回数：あと約' + left + '回（' + D.whenLabel(it, ctx) + '）' })); }
        if (it.status !== 'idea' && it.status !== 'letgo') body.push(h('p', { class: 'xs muted', text: '思い出の配当：約' + D.dividendYears(ctx, D.placedAge(it, ctx)) + '年' }));
      }

      // 本の意図チェックの答え
      if (it.kind === 'exp') {
        var z = it.dwz;
        body.push(h('details', { class: 'more', open: !z, 'data-key': 'dwz' }, [h('summary', {}, ['本の3つの問い', h('span', { class: 'sv', text: z && z.until ? D.UNTIL_LABEL[z.until] : '未回答' })]),
          z && z.until ? h('div', { class: 'small' }, [
            h('div', { text: '① 楽しめるのは：' + D.UNTIL_LABEL[z.until] }),
            h('div', { text: '② 今やる理由：' + (z.why || []).map(function (k) { return D.WHY_LABEL[k]; }).join('・') }),
            h('div', { text: '③ 思い出：' + (D.MEMORY_LABEL[z.memory] || '') }),
            z.reason ? h('div', { text: '今年に置いた理由：' + z.reason }) : null]) : h('p', { class: 'small muted', text: 'まだ答えていません。' }),
          btn(z && z.until ? '答え直す' : '答える', function () { openPlaceSheet(id, { reanswer: true, target: it.status === 'placed' && !it.repeat ? currentTarget(it) : null }); }, 'btn-sm')]));
      }

      // 容量（休み・時間）
      var capKids = [];
      if (it.kind === 'exp') capKids.push(quickRow('休みを取る日数', it.leaveDays, '日', [1, 2, 3, 5, 7, 10], function (v) { save(function (x) { x.leaveDays = v; }); }));
      capKids.push(quickRow(it.kind === 'theme' ? '週の時間' : '続ける時の週の時間', it.hoursPerWeek, '時間', [1, 2, 3, 5, 8], function (v) { save(function (x) { x.hoursPerWeek = v; }); }));
      if (it.kind === 'exp') capKids.push(quickRow('1日で終わる時の時間', it.hoursEach, '時間', [2, 4, 8], function (v) { save(function (x) { x.hoursEach = v; }); }));
      if (it.kind === 'theme') {
        capKids.push(field('目標（できるようになりたいこと）', h('input', { class: 'input', type: 'text', value: it.goal, placeholder: '例：10kmを走れる体',
          on: { change: function (e) { var v = e.target.value.trim(); saveText(function (x) { x.goal = v; }); } } })));
        capKids.push(field('一区切りの目安', h('input', { class: 'input', type: 'date', value: it.goalDate || '', on: { change: function (e) { save(function (x) { x.goalDate = D.isYmd(e.target.value) ? e.target.value : null; }); } } })));
        capKids.push(field('次の一歩（1行）', h('input', { class: 'input', type: 'text', value: it.nextStep, on: { change: function (e) { var v = e.target.value.trim(); saveText(function (x) { x.nextStep = v; }); } } })));
        var sup = liveItems().filter(function (e) { return e.kind === 'exp' && (e.needsIds || []).indexOf(it.id) >= 0; });
        capKids.push(h('p', { class: 'small', text: sup.length ? '支える経験：' + sup.map(function (e) { return e.title; }).join('・') : 'どの経験のための土台？ 経験の画面の「支える土台」から結べます。' }));
      }
      body.push(h('details', { class: 'more', 'data-key': 'cap' }, [h('summary', {}, ['時間と休み', h('span', { class: 'sv', text: [it.leaveDays != null ? '休み' + it.leaveDays + '日' : '', it.hoursPerWeek != null ? '週' + it.hoursPerWeek + '時間' : ''].filter(Boolean).join('・') })]), capKids]));

      // 費用（置いた後にだけ）
      if (it.status === 'placed' || it.status === 'done') {
        // R6（思い出に残りにくいのに高い）は、費用を入れたこの場所で知らせる
        var r6 = it.kind === 'exp' ? D.dwzCheck(it, { fromAge: ctx.A }, ctx).filter(function (f) { return f.id === 'R6'; })[0] : null;
        body.push(h('details', { class: 'more', 'data-key': 'cost' }, [h('summary', {}, ['費用（今の円）', h('span', { class: 'sv', text: it.cost.once != null ? man(it.cost.once) : '' })]),
          r6 ? h('div', { class: 'finding info' }, [h('div', { text: r6.text }), h('div', { class: 'rule', text: ruleLabel(r6.rule) + '（' + ruleTitles(r6.rule) + '）' })]) : null,
          quickRow('1回あたり', it.cost.once, '円', [10000, 30000, 50000, 100000, 300000, 500000, 1000000], function (v) { save(function (x) { x.cost = Object.assign({}, x.cost, { once: v == null ? null : Math.round(v) }); }); }, true),
          quickRow('毎年かかる分', it.cost.perYear, '円', [10000, 50000, 100000], function (v) { save(function (x) { x.cost = Object.assign({}, x.cost, { perYear: v == null ? null : Math.round(v) }); }); }, true)]));
      }

      // 回数型
      if (it.kind === 'exp') {
        var r = it.repeat;
        var repKids = [h('p', { class: 'xs muted', text: '海外旅行のように「人生で何回できるか」を数えたい経験に。' })];
        if (!r) repKids.push(btn('回数で数える', function () {
          // 候補から回数型にする時は、本の3つの問いと判定を通す（時期を決める瞬間には必ずチェックする）
          if (it.status === 'idea') openPlaceSheet(id, { target: { fromAge: ctx.A, toAge: Math.max(ctx.A, D.effEnd(it, ctx)), repeat: { perYear: 1, fromAge: ctx.A, toAge: null } } });
          else save(function (x) { x.repeat = { perYear: 1, fromAge: ctx.A, toAge: null }; });
        }, 'btn-sm'));
        else {
          repKids.push(h('div', { class: 'chips' }, [0.5, 1, 2, 4].map(function (n) { return chip(n < 1 ? '2年に1回' : '年' + n + '回', r.perYear === n, function () { save(function (x) { x.repeat = Object.assign({}, x.repeat, { perYear: n }); }); }); })));
          repKids.push(h('p', { class: 'small', text: r.fromAge + '歳から' + (r.toAge == null ? '窓の終わり（' + D.effEnd(it, ctx) + '歳）' : r.toAge + '歳') + 'まで' }));
          repKids.push(h('div', { class: 'row-actions' }, [
            btn('終わりの年齢', function () { askNumber('何歳まで数える？', r.toAge, '歳', function (n) { save(function (x) { x.repeat = Object.assign({}, x.repeat, { toAge: n == null ? null : Math.round(n) }); }); }, { allowClear: true, hint: '未入力なら窓の終わりまで' }); }, 'btn-sm'),
            btn('回数で数えるのをやめる', function () { save(function (x) { x.repeat = null; if (x.status === 'placed' && !x.when.date && x.when.fromAge == null) x.status = 'idea'; }); }, 'btn-sm')]));
        }
        var parents = liveItems().filter(function (p) { return p.repeat && p.id !== it.id; });
        if (!r && parents.length) {
          repKids.push(field('どの回数型の1回？（例：台湾旅行 → 海外旅行）', h('select', { class: 'input', on: { change: function (e) { var v = e.target.value || null; save(function (x) { x.parentId = v; }); } } },
            [h('option', { value: '', text: 'なし' })].concat(parents.map(function (p) { var o = h('option', { value: p.id, text: p.title }); if (it.parentId === p.id) o.selected = true; return o; })))));
        }
        body.push(h('details', { class: 'more', 'data-key': 'repeat' }, [h('summary', {}, ['回数', h('span', { class: 'sv', text: r ? D.whenLabel(it, ctx) : (it.parentId && getItem(it.parentId) ? getItem(it.parentId).title + 'の1回' : '') })]), repKids]));
      }

      // 誰と・支える土台・カテゴリ・印
      var ppl = livePeople();
      var relKids = [];
      relKids.push(field('誰と', ppl.length ? h('div', { class: 'chips' }, ppl.map(function (p) {
        var on = (it.withIds || []).indexOf(p.id) >= 0;
        return chip(p.name, on, function () { save(function (x) { x.withIds = on ? x.withIds.filter(function (i) { return i !== p.id; }) : x.withIds.concat([p.id]); }); });
      })) : h('p', { class: 'small muted', text: '設定の「大切な人」に登録すると選べます。' })));
      if (it.kind === 'exp') {
        var themes = liveItems().filter(function (t) { return t.kind === 'theme' && t.status !== 'letgo'; });
        relKids.push(field('支える土台', themes.length ? h('div', { class: 'chips' }, themes.map(function (t) {
          var on = (it.needsIds || []).indexOf(t.id) >= 0;
          return chip(t.title, on, function () { save(function (x) { x.needsIds = on ? x.needsIds.filter(function (i) { return i !== t.id; }) : x.needsIds.concat([t.id]); }); });
        })) : h('p', { class: 'small muted', text: '土台（習慣・準備）がまだありません。' })));
      }
      relKids.push(field('カテゴリ', h('div', { class: 'chips' }, doc.settings.categories.map(function (c) {
        return chip(c, it.category === c, function () { save(function (x) { x.category = x.category === c ? '' : c; }); });
      }))));
      relKids.push(checkLine('最後の機会かもしれない', it.lastChance, function (v) { save(function (x) { x.lastChance = v; }); }));
      body.push(h('details', { class: 'more', 'data-key': 'rel' }, [h('summary', {}, ['誰と・土台・カテゴリ', h('span', { class: 'sv', text: [it.category, (it.withIds || []).length ? '誰と' + it.withIds.length : ''].filter(Boolean).join('・') })]), relKids]));

      body.push(h('details', { class: 'more', 'data-key': 'memo' }, [h('summary', {}, ['メモ', h('span', { class: 'sv', text: it.note ? it.note.slice(0, 16) : '' })]),
        h('textarea', { class: 'input', maxlength: '4000', 'aria-label': 'メモ', on: { change: function (e) { var v = e.target.value; saveText(function (x) { x.note = v; }); } } }, it.note)]));

      // 思い出
      var logs = D.live(doc.logs).filter(function (l) { return l.itemId === it.id; });
      if (logs.length) {
        body.push(sec('思い出'));
        logs.forEach(function (l) {
          var feel = l.feel === 3 ? '人生の宝' : l.feel === 2 ? 'とてもよかった' : l.feel === 1 ? 'よかった' : '';
          body.push(h('div', { class: 'card flat' }, [
            h('div', { class: 'small muted', text: [l.date ? D.jpDate(l.date) : '', feel].filter(Boolean).join('・') }),
            l.note ? h('p', { text: l.note }) : null,
            l.link ? h('a', { href: l.link, target: '_blank', rel: 'noopener noreferrer', text: '写真を開く' }) : null,
            (l.later || []).map(function (x) { return h('p', { class: 'small', text: '今思うこと（' + (x.date || '') + '）：' + x.text }); }),
            btn('今思うことを書き足す', function () {
              askText('今思うこと', '', '時間がたって思うこと', function (v) {
                if (!v) return;
                commit('書き足しました', function (d) { var lg = D.byId(d.logs, l.id); lg.later = (lg.later || []).concat([{ date: today(), text: v }]); upd(lg); });
              }, { multi: true });
            }, 'btn-sm btn-ghost')
          ]));
        });
      }

      // 操作
      if (it.status === 'letgo') {
        foot.push(btn('戻す', function () { save(function (x, d) {
          var hasLog = D.live(d.logs).some(function (l) { return l.itemId === x.id; });
          if (hasLog && !x.repeat) x.status = 'done';        // 思い出のある経験は「思い出あり」に戻す
          else x.status = (x.when && (x.when.fromAge != null || x.when.date)) || x.repeat ? 'placed' : 'idea';
          x.letgo = null;
        }, '戻しました'); }, 'btn-accent'));
      } else {
        foot.push(btn(it.status === 'idea' ? '置く' : '時期を変える', function () { openPlaceSheet(id); }, it.status === 'idea' ? 'btn-accent' : ''));
        if (it.kind === 'exp') foot.push(btn(it.repeat ? '1回やった' : '思い出を残す', function () { openMemorySheet(id); }, it.status === 'idea' ? '' : 'btn-accent'));
        foot.push(btn('手放す', function () { openLetgoSheet(id); }));
      }
      foot.push(btn('削除', function () {
        if (logs.length) { toast('思い出がある経験は消せません。［手放す］を使ってください'); return; }
        confirmSheet('削除しますか？', ['ゴミ箱に移ります（設定→データを守る→ゴミ箱 から戻せます）。'], '削除する', function () {
          api.close();
          commit('削除しました', function (d) { D.removeRec(D.byId(d.items, id), device.deviceId); });
        }, true);
      }, 'btn-danger'));
      return { body: body, foot: foot };
    } });
  }
  function currentTarget(it) {
    var w = it.when || {};
    if (w.date) return { date: w.date, endDate: w.endDate, precision: w.precision };
    if (w.fromAge != null) return { fromAge: w.fromAge, toAge: w.toAge == null ? w.fromAge : w.toAge };
    return null;
  }
  function quickRow(label, value, unit, quick, onSet, isYen) {
    var show = value == null ? '未入力' : (isYen ? man(value) : value + unit);
    return h('div', { class: 'field' }, [
      h('div', { class: 'lbl', text: label + '：' + show }),
      h('div', { class: 'chips' }, quick.map(function (q) {
        return chip(isYen ? man(q) : q + unit, value === q, function () { onSet(value === q ? null : q); });
      }).concat([chip('入力', false, function () { askNumber(label, value, unit, function (n) { onSet(n); }, { allowClear: true }); })]))
    ]);
  }

  /* ---------- 5-5. 思い出を残す ---------- */
  function openMemorySheet(id) {
    var key = 'memory:' + id, dr = sheetDrafts[key] || {};
    var date = dr.date || today(), note = dr.note || '', feel = dr.feel == null ? null : dr.feel, link = dr.link || '';
    var it0 = getItem(id);
    if (!dr.date && it0 && it0.when && it0.when.date && D.lastDay(it0) < today()) date = D.lastDay(it0);
    function keep() { sheetDrafts[key] = { date: date, note: note, feel: feel, link: link }; }
    openSheet({ title: '思い出を残す', keepOnBackdrop: true, build: function (api) {
      var it = getItem(id);
      if (!it) return null;
      return {
        body: [h('p', { class: 'ititle', text: it.title }),
          field('いつ', h('input', { class: 'input', type: 'date', value: date, max: today(), on: { change: function (e) { date = e.target.value; keep(); } } })),
          field('一言', h('textarea', { class: 'input', placeholder: '一番覚えていることは？', maxlength: '2000', on: { input: function (e) { note = e.target.value; keep(); } } }, note)),
          field('手応え（任意）', h('div', { class: 'chips' }, [[1, 'よかった'], [2, 'とてもよかった'], [3, '人生の宝']].map(function (x) {
            return chip(x[1], feel === x[0], function () { feel = feel === x[0] ? null : x[0]; keep(); api.refresh(); });
          }))),
          field('写真のリンク（任意・https）', h('input', { class: 'input', type: 'url', value: link, placeholder: 'Googleフォトの共有リンクなど', on: { input: function (e) { link = e.target.value; keep(); } } }),
            '写真そのものはアプリに入れず、リンクだけを残します。')],
        foot: [btn('やめる', api.close), btn('残す', function () {
          if (!D.isYmd(date)) { toast('日付を入れてください'); return; }
          if (link && !D.safeLink(link)) { toast('リンクは https:// で始まるものだけ残せます'); return; }
          delete sheetDrafts[key];
          api.close();
          var years = Math.max(0, ctx.planEnd - D.ageOn(ctx.birth, date));
          commit('思い出の配当が始まりました（これから約' + years + '年）', function (d) {
            var x = D.byId(d.items, id);
            d.logs.push(D.newLog({ itemId: x.id, itemTitle: x.title, date: date, note: note.trim(), feel: feel, link: D.safeLink(link), withIds: (x.withIds || []).slice() }));
            if (!x.repeat) x.status = 'done';
            upd(x);
          });
        }, 'btn-accent')]
      };
    } });
  }

  /* ---------- 5-6. 手放す（正式な状態。件数は数えない）---------- */
  function openLetgoSheet(id) {
    var reason = '';
    openSheet({ title: '手放す', keepOnBackdrop: true, build: function (api) {
      var it = getItem(id);
      if (!it) return null;
      return {
        body: [h('p', { text: '「' + it.title + '」を手放します。やらなかったのではなく、今の自分が選び直した、という記録です。' }),
          field('理由（任意・1行）', h('input', { class: 'input', type: 'text', maxlength: '120', placeholder: '例：興味が変わった', on: { input: function (e) { reason = e.target.value; } } }))],
        foot: [btn('やめる', api.close), btn('手放す', function () {
          api.close();
          commit('手放しました', function (d) { var x = D.byId(d.items, id); x.status = 'letgo'; x.letgo = { date: today(), reason: reason.trim() }; upd(x); });
        }, 'btn-accent')]
      };
    } });
  }

  /* ---------- 5-7. 大切な人 ---------- */
  var RELATIONS = [['parent', '親'], ['sibling', 'きょうだい'], ['partner', 'パートナー'], ['child', '子'], ['friend', '友人'], ['pet', 'ペット'], ['other', 'その他']];
  function openPersonSheet(id) {
    var isNew = !id;
    var draft = isNew ? { name: '', relation: 'parent', birthYear: null } : null;
    openSheet({ title: isNew ? '大切な人を追加' : '大切な人', build: function (api) {
      var p = isNew ? draft : D.byId(doc.people, id);
      if (!p) return null;
      function set(fn, quiet) {
        if (isNew) { fn(draft); if (!quiet) api.refresh(); }
        else commit(null, function (d) { var x = D.byId(d.people, id); fn(x); upd(x); }, { noRefresh: !!quiet });
      }
      var body = [
        field('呼び名', h('input', { class: 'input', type: 'text', value: p.name, maxlength: '60', placeholder: '例：母',
          on: { input: function (e) { if (isNew) draft.name = e.target.value; }, change: function (e) { var v = e.target.value.trim(); set(function (x) { x.name = v; }, true); } } })),
        field('関係', h('div', { class: 'chips' }, RELATIONS.map(function (r) { return chip(r[1], p.relation === r[0], function () { set(function (x) { x.relation = r[0]; }); }); }))),
        field('生まれた年（西暦）', h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: p.birthYear == null ? '' : String(p.birthYear), placeholder: '例：1968',
          on: { change: function (e) { var n = parseInt(e.target.value, 10); set(function (x) { x.birthYear = isFinite(n) && n > 1900 && n < 2200 ? n : null; }, true); } } }),
          '各季節で、その人が何歳かが見えるようになります。')
      ];
      var foot = isNew ? [btn('やめる', api.close), btn('追加', function () {
        if (!draft.name.trim()) { toast('呼び名を入れてください'); return; }
        api.close();
        commit('追加しました', function (d) { d.people.push(D.newPerson(draft)); });
      }, 'btn-accent')] : [btn('削除', function () {
        confirmSheet('削除しますか？', ['ゴミ箱に移ります。'], '削除する', function () { api.close(); commit('削除しました', function (d) { D.removeRec(D.byId(d.people, id), device.deviceId); }); }, true);
      }, 'btn-danger'), btn('閉じる', api.close, 'btn-accent')];
      return { body: body, foot: foot };
    } });
  }

  /* =====================================================================
   * 6. 全体チェックリスト・ゴミ箱
   * ===================================================================== */
  function openChecklist() {
    openSheet({ title: '本の意図チェック', build: function () {
      var body = [h('p', { class: 'small muted', text: '点数ではありません。本の考え方から見て、気になる所を知らせるだけです。' })];
      D.dwzChecklist(doc, ctx).forEach(function (c) {
        var cls = c.ok === true ? 'ok' : c.ok === false ? 'ng' : 'na';
        var mark = c.ok === true ? '✓' : c.ok === false ? '△' : '―';
        var links = (c.itemIds || []).map(function (iid) { var it = getItem(iid); return it ? btn(it.title, function () { openItemSheet(iid); }, 'btn-sm btn-ghost') : null; });
        body.push(h('div', { class: 'check ' + cls }, [h('span', { class: 'mark', text: mark }), h('div', {}, [
          h('div', { class: 'ititle', text: c.title }), h('div', { class: 'small muted', text: c.detail }),
          h('div', { class: 'rule', text: ruleLabel(c.rule) + '（' + ruleTitles(c.rule) + '）' }),
          c.ok === false && links.length ? h('div', { class: 'row-actions' }, links.slice(0, 6)) : null])]));
      });
      return body;
    } });
  }
  function openTrash() {
    openSheet({ title: 'ゴミ箱', build: function () {
      var body = [];
      var items = (doc.items || []).filter(function (i) { return i.deletedAt && !i.undone; });   // 「元に戻す」で取り消した物は出さない
      var people = (doc.people || []).filter(function (p) { return p.deletedAt && !p.undone; });
      if (!items.length && !people.length) body.push(h('p', { class: 'small muted', text: 'ゴミ箱は空です。' }));
      items.forEach(function (i) { body.push(h('div', { class: 'row-actions', style: { 'align-items': 'center' } }, [h('span', { style: { flex: '1' }, text: i.title || '（題名なし）' }),
        btn('戻す', function () { commit('戻しました', function (d) { D.restoreRec(D.byId(d.items, i.id), device.deviceId); }); }, 'btn-sm')])); });
      people.forEach(function (p) { body.push(h('div', { class: 'row-actions', style: { 'align-items': 'center' } }, [h('span', { style: { flex: '1' }, text: p.name }),
        btn('戻す', function () { commit('戻しました', function (d) { D.restoreRec(D.byId(d.people, p.id), device.deviceId); }); }, 'btn-sm')])); });
      return body;
    } });
  }

  /* =====================================================================
   * 7. 設定・書き出し・取り込み・復元・修復
   * ===================================================================== */
  function isInAppBrowser() { return /Line|FBAN|FBAV|Instagram|Twitter|; ?wv\)/i.test(navigator.userAgent || ''); }
  function markExported() { if (isInAppBrowser()) return; device.lastExportAt = D.nowIso(); saveDevice(); renderAll(); }
  function downloadText(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 0);
  }
  // 書き出し：.txt（中身は JSON）。共有メニューから Google ドライブへ保存できる
  function exportNow(mode) {
    store.flush();
    var text = readOnly ? (store.readRaw() || D.exportText(doc)) : D.exportText(doc), name = D.exportFileName(today());
    if (mode === 'share' && navigator.canShare && window.File) {
      try {
        var file = new File([text], name, { type: 'text/plain' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).then(function () { markExported(); toast('書き出しました（' + name + '）'); })
            .catch(function (err) { if (err && err.name === 'AbortError') return; downloadText(name, text); markExported(); toast('ファイルとして保存しました'); });
          return;
        }
      } catch (e) {}
    }
    downloadText(name, text);
    markExported();
    toast('ファイルとして保存しました（' + name + '）');
  }
  function docSummary(d) {
    var n = function (a) { return D.live(a).length; };
    return ['経験と土台：' + n(d.items) + '件', '思い出：' + n(d.logs) + '件', '大切な人：' + n(d.people) + '人',
      '最後に保存：' + (d.savedAt ? d.savedAt.slice(0, 16).replace('T', ' ') + '（UTC）' : '不明')];
  }
  // 取り込み（置き換え）。直前を控えて、元に戻すこともできる
  function importReplace(text, fromWelcome, hooks) {
    var r = D.ingest(text);
    if (!r.ok) { toast(r.reason === 'app' ? 'タイムバケットのデータではないようです' : '読み込めませんでした（中身が壊れています）'); return; }
    if (r.readOnly) { toast('新しい版のアプリで作られたデータです。アプリを更新してから取り込んでください'); return; }
    var lines = docSummary(r.doc);
    var hasData = D.live(doc.items).length > 0 || !!doc.profile.birthDate;
    if (hasData && r.doc.docId !== doc.docId) lines.unshift('⚠ 今のデータとは別の人生データです。今のデータは控えに残し、元に戻すこともできます。');
    else if (hasData) lines.unshift('今のデータを、このファイルの内容で置き換えます（控えを残します）。');
    confirmSheet('この内容で始めますか？', lines, 'この内容で始める', function () {
      store.writePrev(doc);
      lastUndo = { before: JSON.stringify(doc) };
      var c2 = D.ctxOf(r.doc, today());
      if (c2 && D.rolloverCandidates(r.doc, c2).length) { D.applyRollover(r.doc, c2, device.deviceId); rolledNotice = true; }
      doc = r.doc;
      readOnly = false; store.setReadOnly(false);
      store.setReady(true);
      afterChange();
      store.flush();
      if (hooks && hooks.onApplied) hooks.onApplied();
      if (fromWelcome) openSheets.slice().forEach(function (s) { s.close(); });
      toast('取り込みました', { undo: true });
    });
  }
  function importFromPaste(onText, title) {
    var v = '';
    openSheet({ title: title || '貼り付けて取り込む', build: function (api) {
      return { body: [h('textarea', { class: 'input', style: { 'min-height': '12em' }, placeholder: 'ここに中身を貼り付け', on: { input: function (e) { v = e.target.value; } } }, v)],
        foot: [btn('やめる', api.close), btn('取り込む', function () { api.close(); onText(v); }, 'btn-accent')] };
    } });
  }
  function importDraftsText(text) {
    var r;
    var ok = commit(null, function (d) { r = D.importDrafts(d, text); return r.ok ? undefined : false; }, { undo: false });
    if (!ok && r && !r.ok) { toast('下書きファイルではないようです'); return; }
    if (r && r.ok) toast('下書きを' + r.added + '件入れました' + (r.skipped ? '（' + r.skipped + '件は入れ済み）' : ''), { undo: true });
  }

  function openSettings() {
    var settingsSheet = openSheet({ title: '設定', full: true, build: function (api) {
      var p = doc.profile, s = doc.settings;
      var body = [];
      function stepper(label, value, min, max, onSet, hint) {
        return field(label, h('div', { class: 'stepper' }, [
          btn('−', function () { if (value > min) onSet(value - 1); }, 'btn-sm', { 'aria-label': label + 'を1減らす' }),
          h('span', { class: 'val', text: value + '歳' }),
          btn('＋', function () { if (value < max) onSet(value + 1); }, 'btn-sm', { 'aria-label': label + 'を1増やす' })]), hint);
      }
      function setP(k, v) { commit(null, function (d) { d.profile[k] = v; upd(d.profile); }); }
      function setS(k, v) { commit(null, function (d) { d.settings[k] = v; upd(d.settings); }); }

      body.push(h('h3', { text: '人生の前提' }));
      body.push(field('生年月日', h('input', { class: 'input', type: 'date', value: p.birthDate || '', max: today(),
        on: { change: function (e) { if (D.isYmd(e.target.value)) setP('birthDate', e.target.value); } } })));
      body.push(stepper('計画の終点', p.planEndAge, 70, 110, function (v) { setP('planEndAge', v); },
        '終点を長くすると、使える額は少なめに計算されます。長生きへの備えは、一生続く公的年金（本でいう長寿年金の役割）が担います。参考：平均寿命 男' + D.LIFE_TABLE.male + '歳・女' + D.LIFE_TABLE.female + '歳（' + D.LIFE_TABLE.source + '）'));
      body.push(stepper('体が自由に動く目安', p.bodyFreeUntilAge, 40, 100, function (v) { setP('bodyFreeUntilAge', v); }, '体力「ふつう」の経験の窓の既定値になります。'));
      body.push(stepper('体力がいる経験の目安', p.hardBodyUntilAge, 25, 90, function (v) { setP('hardBodyUntilAge', v); }, '体力「きつい」の経験の窓の既定値になります。'));

      body.push(h('h3', { text: '表示', style: { 'margin-top': '1.5rem' } }));
      body.push(field('バケツの幅', seg([{ label: '5年', value: 5 }, { label: '10年', value: 10 }], s.bucketYears, function (v) { setS('bucketYears', v); })));
      body.push(field('文字の大きさ', h('div', { class: 'chips' }, [[1, '100%'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']].map(function (x) {
        return chip(x[1], s.fontScale === x[0], function () { setS('fontScale', x[0]); applyFontScale(x[0]); });
      }))));
      body.push(field('テーマ', seg([{ label: '自動', value: 'auto' }, { label: 'ライト', value: 'light' }, { label: 'ダーク', value: 'dark' }], device.theme || 'auto', function (v) { device.theme = v; saveDevice(); applyTheme(); api.refresh(); })));
      body.push(checkLine('人生タブに「あと約N回の夏」を出す', s.showSummers, function (v) { setS('showSummers', v); }));

      body.push(h('h3', { text: '時間', style: { 'margin-top': '1.5rem' } }));
      body.push(h('div', { class: 'row-actions' }, [
        btn('年間の休み：' + (s.leaveDaysPerYear == null ? '未入力' : s.leaveDaysPerYear + '日'), function () { editSetting('leaveDaysPerYear', '年間の休み（有給・夏休みなど）', '日'); }, 'btn-sm'),
        btn('週の自由時間：' + (s.freeHoursPerWeek == null ? '未入力' : s.freeHoursPerWeek + '時間'), function () { editSetting('freeHoursPerWeek', '1週間の自由な時間', '時間'); }, 'btn-sm')]));

      body.push(h('h3', { text: '大切な人', style: { 'margin-top': '1.5rem' } }));
      livePeople().forEach(function (pp) {
        body.push(h('button', { type: 'button', class: 'irow', on: { click: function () { openPersonSheet(pp.id); } } }, [h('span', { class: 'sym', text: '♡' }),
          h('span', { class: 'itext' }, [h('span', { class: 'ititle', text: pp.name }), h('span', { class: 'imeta', text: (RELATIONS.filter(function (r) { return r[0] === pp.relation; })[0] || ['', ''])[1] + (pp.birthYear ? '・' + pp.birthYear + '年生まれ' : '・生まれた年は未入力') })])]));
      });
      body.push(btn('＋ 大切な人を追加', function () { openPersonSheet(null); }, 'btn-sm', { style: { 'margin-top': '.4rem' } }));

      body.push(syncSettingsSection(api));
      body.push(h('h3', { text: 'データを守る', style: { 'margin-top': '1.5rem' } }));
      var persistEl = h('p', { class: 'small', text: '保存の状態：確認中…' });
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then(function (v) { persistEl.textContent = '保存の状態：' + (v ? 'ブラウザに「消さないで」と登録済み' : 'まだ未登録（ホーム画面に追加すると登録されやすくなります）'); }).catch(function () { persistEl.textContent = '保存の状態：確認できませんでした'; });
      } else persistEl.textContent = '保存の状態：このブラウザでは確認できません';
      body.push(persistEl);
      body.push(h('p', { class: 'small muted', text: '使用量：約' + Math.max(1, Math.round(store.usage() / 1024)) + 'KB・データの版 ' + doc.schemaVersion + '・アプリ v' + D.APP_VERSION + '・前回の書き出し ' + exportAgoText() }));
      body.push(h('p', { class: 'xs muted', text: syncOn() ? 'データはこのスマホの中にあり、変更のたびに自分の Google にも控えを取っています。念のため、年に1回は書き出した .txt も別の場所に残してください。' : 'データはこのスマホの中にあります。機種変更やブラウザのデータ削除では消えるので、上の「同期」を設定するか、書き出した .txt をGoogleドライブなどに保存してください。' }));
      body.push(h('div', { class: 'list' }, [
        btn('書き出す（共有 → Googleドライブなど）', function () { exportNow('share'); }, 'btn-accent btn-block'),
        btn('ファイルとして保存', function () { exportNow('download'); }, 'btn-block'),
        btn('ファイルから取り込む（置き換え）', function () { pickFile(function (t) { importReplace(t); }); }, 'btn-block'),
        btn('貼り付けて取り込む（置き換え）', function () { importFromPaste(function (t) { importReplace(t); }); }, 'btn-block'),
        btn('Claudeの下書きを取り込む', function () { openDraftImport(); }, 'btn-block'),
        btn('ゴミ箱', openTrash, 'btn-block'),
        btn('控えから戻す（直前・昨日）', openBackupsSheet, 'btn-block')
      ]));

      body.push(h('h3', { text: 'このアプリについて', style: { 'margin-top': '1.5rem' } }));
      body.push(h('p', { class: 'small', text: 'タイムバケット v' + D.APP_VERSION + '。ビル・パーキンス『DIE WITH ZERO』の考え方（人生を季節に分け、経験には賞味期限がある）で、死ぬまでの「いつ、何に注力するか」を置いていくための自分用アプリです。' }));
      body.push(h('details', { class: 'more' }, [h('summary', {}, '本の9つのルール（日本語版の章題）'),
        h('ol', { class: 'small' }, Object.keys(D.RULES).map(function (k) { return h('li', { text: D.RULES[k] }); }))]));
      return body;
    } });
    settingsSheet.syncView = true;     // 同期の状態が変わった時に描き直す
  }
  function openDraftImport() {
    openSheet({ title: 'Claudeの下書きを取り込む', build: function (api) {
      return { body: [h('p', { class: 'small', text: 'Claudeが用意した下書き（候補）を候補箱に入れます。すべて「候補」として入り、採用するか・いつに置くかはあなたが決めます。同じ下書きは二度入りません。' })],
        foot: [btn('貼り付ける', function () { api.close(); importFromPaste(importDraftsText, '下書きを貼り付け'); }), btn('ファイルを選ぶ', function () { api.close(); pickFile(importDraftsText); }, 'btn-accent')] };
    } });
  }
  function openBackupsSheet() {
    openSheet({ title: '控えから戻す', build: function (api) {
      var body = [h('p', { class: 'small muted', text: 'このスマホの中にある控えです。戻す前に、今のデータも控えに残ります。' })];
      var prev = store.readPrev();
      var daily = store.readDaily();
      if (prev && prev.ok) body.push(h('div', { class: 'card flat' }, [h('div', { class: 'ititle', text: '直前の控え（取り込み・復元・移行の前）' }), docSummary(prev.doc).map(function (l) { return h('div', { class: 'xs muted', text: l }); }),
        btn('これに戻す', function () { api.close(); importReplace(JSON.stringify(prev.doc)); }, 'btn-sm')]));
      if (daily && daily.result && daily.result.ok) body.push(h('div', { class: 'card flat' }, [h('div', { class: 'ititle', text: '1日1回の控え（' + (daily.day || '') + '）' }), docSummary(daily.result.doc).map(function (l) { return h('div', { class: 'xs muted', text: l }); }),
        btn('これに戻す', function () { api.close(); importReplace(JSON.stringify(daily.result.doc)); }, 'btn-sm')]));
      if (body.length === 1) body.push(h('p', { class: 'small', text: '控えはまだありません。' }));
      return body;
    } });
  }
  // 起動時に保存データが壊れていた時だけ出す修復画面
  function openRepair() {
    if (openSheets.some(function (s) { return s.isRepair; })) return;
    var sheet = openSheet({ title: 'データを読めませんでした', full: true, noClose: true,
      onClose: function () { if (!store.isReady() && !readOnly) setTimeout(openRepair, 0); },   // 戻る操作で閉じても、選ぶまで開き直す
      build: function (api) {
      var body = [h('p', { text: '保存データが壊れていて読めませんでした。壊れたデータは消さずに退避してあります。次のどれかで戻せます。選ぶまで、何も保存しません。' })];
      var prev = store.readPrev(), daily = store.readDaily();
      if (daily && daily.result && daily.result.ok) body.push(btn('1日1回の控え（' + daily.day + '）から戻す', function () { importReplace(JSON.stringify(daily.result.doc), true); }, 'btn-accent btn-block'));
      if (prev && prev.ok) body.push(btn('直前の控えから戻す', function () { importReplace(JSON.stringify(prev.doc), true); }, 'btn-block'));
      body.push(btn('書き出したファイルから戻す', function () { pickFile(function (t) { importReplace(t, true); }); }, 'btn-block'));
      store.corruptCopies().forEach(function (c) {
        body.push(btn('退避したデータを書き出す（' + c.key.slice(-24) + '）', function () { downloadText('timebucket-corrupt.txt', c.raw || ''); }, 'btn-block btn-sm'));
      });
      body.push(btn('新しく始める', function () { store.setReady(true); api.close(); renderAll(); openWizard(); }, 'btn-block btn-ghost'));
      return body;
    } });
    sheet.isRepair = true;
  }

  /* =====================================================================
   * 8. はじめての設定（ウィザード）
   * ===================================================================== */
  function openWizard() {
    var step = 0;
    var w = { birth: doc.profile.birthDate || '', end: doc.profile.planEndAge, body: doc.profile.bodyFreeUntilAge, leave: doc.settings.leaveDaysPerYear, hours: doc.settings.freeHoursPerWeek };
    var sheet = openSheet({ title: 'タイムバケット', full: true, noClose: true, build: function (api) {
      var body = [], foot = [];
      function next() { step++; api.refresh(); }
      if (step === 0) {
        body.push(h('h2', { class: 'hero-age', text: 'ようこそ' }));
        body.push(h('ul', {}, [
          h('li', { text: '人生を5年ごとの「季節（バケツ）」に分けて、死ぬまでに「いつ、何に注力するか」を置いていきます。' }),
          h('li', { text: '経験には賞味期限（窓）があります。体力・一緒にやる人・状況で、できる時期は限られます。' }),
          h('li', { text: '「ゼロで死ぬ」は浪費ではありません。生活と長生きへの備えを確保したうえで、計画的に使い切る考え方です。' }),
          h('li', { text: 'データはこのスマホの中に保存されます。ときどき書き出して、スマホの外にも控えを残します。' })
        ]));
        foot = [btn('以前のデータを復元する', function () {
          openSheet({ title: '以前のデータを復元する', build: function (a2) {
            return [h('p', { class: 'small', text: 'どこから戻しますか？' }), h('div', { class: 'list' }, [
              btn('クラウドから（設定コードを貼る）', function () { a2.close(); askSetupCode('restore'); }, 'btn-accent btn-block'),
              btn('書き出したファイルから', function () { a2.close(); pickFile(function (t) { importReplace(t, true); }); }, 'btn-block')])];
          } });
        }), btn('はじめて使う', next, 'btn-accent')];
      } else if (step === 1) {
        body.push(field('生年月日', h('input', { class: 'input', type: 'date', value: w.birth, max: today(),
          on: { input: function (e) { w.birth = e.target.value; }, change: function (e) { w.birth = e.target.value; api.refresh(); } } })));
        if (D.isYmd(w.birth)) {
          var A = D.ageOn(w.birth, today());
          var yr = D.ageYear(w.birth, A);
          body.push(h('p', { class: 'banner ok', text: '今は' + A + '歳の1年（' + D.jpDate(yr.from) + '〜' + D.jpDate(yr.to) + '）です。1年の区切りは誕生日です。' }));
        }
        foot = [btn('次へ', function () {
          if (!D.isYmd(w.birth)) { toast('生年月日を入れてください'); return; }
          commit(null, function (d) { d.profile.birthDate = w.birth; upd(d.profile); });
          next();
        }, 'btn-accent')];
      } else if (step === 2) {
        body.push(h('p', { text: '計画の終点と、体が自由に動く目安を決めます（あとで設定から変えられます）。' }));
        body.push(field('計画の終点', h('div', { class: 'stepper' }, [btn('−', function () { if (w.end > 70) { w.end--; api.refresh(); } }, 'btn-sm'), h('span', { class: 'val', text: w.end + '歳' }), btn('＋', function () { if (w.end < 110) { w.end++; api.refresh(); } }, 'btn-sm')]),
          '参考：平均寿命 男' + D.LIFE_TABLE.male + '歳・女' + D.LIFE_TABLE.female + '歳。終点を長くすると使える額は少なめに計算されます。長生きへの備えは一生続く公的年金が担います。'));
        body.push(field('体が自由に動く目安', h('div', { class: 'stepper' }, [btn('−', function () { if (w.body > 40) { w.body--; api.refresh(); } }, 'btn-sm'), h('span', { class: 'val', text: w.body + '歳' }), btn('＋', function () { if (w.body < 100) { w.body++; api.refresh(); } }, 'btn-sm')])));
        foot = [btn('次へ', function () { commit(null, function (d) { d.profile.planEndAge = w.end; d.profile.bodyFreeUntilAge = w.body; upd(d.profile); }); next(); }, 'btn-accent')];
      } else if (step === 3) {
        body.push(h('p', { text: '経験に使える時間の予算です。分からなければ「あとで」で大丈夫です。' }));
        body.push(field('年間の休み（有給・夏休みなど）', h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: w.leave == null ? '' : String(w.leave), placeholder: '例：20',
          on: { change: function (e) { var n = parseFloat(e.target.value); w.leave = isFinite(n) && n >= 0 ? n : null; } } })));
        body.push(field('1週間の自由な時間', h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: w.hours == null ? '' : String(w.hours), placeholder: '例：30',
          on: { change: function (e) { var n = parseFloat(e.target.value); w.hours = isFinite(n) && n >= 0 ? n : null; } } }), '平日の朝晩と休日の自由時間の合計'));
        foot = [btn('あとで', next), btn('次へ', function () { commit(null, function (d) { d.settings.leaveDaysPerYear = w.leave; d.settings.freeHoursPerWeek = w.hours; upd(d.settings); }); next(); }, 'btn-accent')];
      } else if (step === 4) {
        body.push(h('p', { text: '一緒に過ごしたい大切な人を登録すると、各季節でその人が何歳かが見えます（任意）。' }));
        livePeople().forEach(function (pp) { body.push(h('div', { class: 'small', text: '♡ ' + pp.name + (pp.birthYear ? '（' + pp.birthYear + '年生まれ）' : '') })); });
        body.push(btn('＋ 大切な人を追加', function () { openPersonSheet(null); }, 'btn-sm'));
        foot = [btn('あとで', next), btn('次へ', next, 'btn-accent')];
      } else if (step === 5) {
        body.push(h('p', { text: 'Claudeが用意した下書き（候補）があれば、ここで取り込めます。すべて「候補」として入り、採用するかはあなたが決めます。' }));
        body.push(h('div', { class: 'list' }, [btn('ファイルを選ぶ', function () { pickFile(importDraftsText); }, 'btn-block'), btn('貼り付ける', function () { importFromPaste(importDraftsText, '下書きを貼り付け'); }, 'btn-block')]));
        foot = [btn('あとで', next), btn('次へ', next, 'btn-accent')];
      } else {
        api.close();
        setTab('inbox');
        toast('まずはお金を考えずに書き出してみましょう。［置く］で、いつが一番いいかを選べます');
        return null;
      }
      body.unshift(h('p', { class: 'xs muted', text: (step + 1) + ' / 6' }));
      return { body: body, foot: foot };
    } });
    return sheet;
  }

  /* =====================================================================
   * 10. 自分の Google への控え（同期）と Claude のレビュー（v1.1）
   *   片方向：スマホ → クラウド。クラウドから戻すのは、本人が選んだ「復元」の時だけ。
   *   秘密キー（設定コード）はこの端末の情報（dwz-device）にだけ置き、書き出しには入れない。
   * ===================================================================== */
  var syncTimer = null, syncBusy = false, lastPingAt = 0;
  var BLOCKING = ['auth', 'other_device', 'doc_mismatch', 'shrink', 'client_old', 'clock_future', 'store_trashed', 'too_large'];
  var ERROR_TEXT = {
    offline: '電波がありません（つながったら自動で送ります）', auth: '設定コードが違うようです（設定 → 同期 で貼り直してください）',
    other_device: 'クラウドには、別の端末が保存した内容があります', doc_mismatch: 'クラウドには、別の人生データがあります',
    shrink: 'クラウドより記録が少ない内容で上書きしそうだったので、止めました', client_old: 'アプリの更新が必要です',
    clock_future: 'この端末の時計が大きく進んでいるようです', store_trashed: 'Google ドライブの控えのフォルダがゴミ箱に入っています',
    too_large: 'データが大きすぎて送れませんでした', busy: 'クラウドが混み合っています（少し後で自動で送ります）',
    server: 'クラウドで問題が起きました（少し後で自動で送ります）', quota: 'Google の保存容量がいっぱいのようです',
    bad_response: 'クラウドから思わぬ返事が来ました（GAS の設定を確かめてください）', bad_request: '送った内容を受け付けてもらえませんでした',
    not_found: '見つかりませんでした', no_api_key: 'Claude の API キーがまだ設定されていません（セットアップ手順.html の v1.1 の節）',
    bad_api_key: 'Claude の API キーが正しくないようです', rate_limited: 'Claude が混み合っています。少し後でもう一度',
    api_error: 'Claude の呼び出しでエラーが起きました', network: 'Claude につながりませんでした', refusal: 'Claude がこの内容のレビューを控えました',
    max_tokens: 'レビューが長すぎて途中で切れました', bad_json: 'Claude の返事を読み取れませんでした', bad_shape: 'Claude の返事の形が違いました',
    no_packet: 'まだ材料が届いていません（少し後でもう一度）', unchanged: '前回のレビューから中身が変わっていません'
  };
  function errText(code) { return ERROR_TEXT[code] || ('うまくいきませんでした（' + code + '）'); }
  function syncOn() { var s = device.sync; return !!(s && s.enabled && s.url && s.key); }
  function deviceLabel() {
    if (device.deviceName) return device.deviceName;
    var ua = navigator.userAgent || '';
    return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'この端末';
  }
  // GAS を呼ぶ。text/plain で送る（ブラウザの事前確認が要らない「単純な」送り方）
  function callGas(op, extra, opts) {
    opts = opts || {};
    var s = device.sync;
    var body = Object.assign({ v: 1, op: op, key: s.key, deviceId: device.deviceId, deviceName: deviceLabel(), appVersion: D.APP_VERSION, writer: D.WRITER_LEVEL }, extra || {});
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 60000) : null;
    return fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow',
      keepalive: !!opts.keepalive, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { var j = JSON.parse(t); return j && typeof j === 'object' ? j : { ok: false, error: 'bad_response' }; } catch (e) { return { ok: false, error: 'bad_response' }; } })
      .catch(function () { return { ok: false, error: 'offline' }; })
      .then(function (j) { if (timer) clearTimeout(timer); return j; });
  }
  function syncMeta() { return doc ? { reviewFrequency: doc.settings.reviewFrequency, reviewIncludeMoney: !!doc.settings.reviewIncludeMoney } : null; }
  function markDirty() {
    if (!syncOn()) return;
    device.sync.dirty = true;
    saveDevice();
    schedulePush(3000);
    renderDot();
  }
  function schedulePush(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(function () { pushNow(); }, ms); }
  function pushNow(opts) {
    opts = opts || {};
    var s = device.sync;
    if (!syncOn() || syncBusy || readOnly || !store.isReady()) return Promise.resolve(null);
    var force = opts.force || s.forceNext || null;
    if (s.blocked && !opts.force) return Promise.resolve(null);
    if (!s.dirty && !opts.manual && !force) return Promise.resolve(null);
    store.flush();
    var payload = {
      baseRev: s.baseRev == null ? 0 : s.baseRev, doc: D.syncDoc(doc),
      tables: ctx ? D.sheetTables(doc, ctx) : null, packet: ctx ? D.reviewPacket(doc, ctx, doc.settings.reviewIncludeMoney) : null,
      meta: syncMeta(),
      reason: opts.manual ? 'manual' : 'auto', force: force
    };
    var sentSeq = doc.saveSeq;
    // 画面を閉じる瞬間の送信（keepalive）は 64KB まで。日本語は1文字3バイトなので、バイト数で測る
    var json = JSON.stringify(payload);
    var small = (window.TextEncoder ? new TextEncoder().encode(json).length : json.length * 3) < 60000;
    syncBusy = true; renderDot();
    return callGas('push', payload, { keepalive: !!opts.keepalive && small }).then(function (res) {
      syncBusy = false;
      if (res.ok) {
        s.baseRev = res.serverRev; s.lastOkAt = D.nowIso(); s.failCount = 0; s.lastError = null; s.blocked = null; s.forceNext = null;
        if (doc.saveSeq === sentSeq) s.dirty = false; else schedulePush(3000);
      } else if (BLOCKING.indexOf(res.error) >= 0) {
        s.forceNext = null;
        s.blocked = { error: res.error, at: D.nowIso(), info: { lastPushDeviceName: res.lastPushDeviceName || null, savedAt: res.savedAt || null, collections: res.collections || null } };
        s.lastError = res.error;
      } else {
        s.failCount = (s.failCount || 0) + 1; s.lastError = res.error; s.lastErrorAt = D.nowIso();
        if (res.error !== 'offline') s.forceNext = null;   // クラウドに届いた失敗なら、次は普通の関所を通す
        if (s.failCount <= 3) schedulePush([60000, 300000, 1800000][s.failCount - 1]);
      }
      saveDevice(); renderAll(); refreshSyncViews();
      return res;
    });
  }
  // 同期の状態を表示しているシート（設定）だけを描き直す。入力欄に文字を打っている間は描き直さない
  function refreshSyncViews() {
    var a = document.activeElement;
    openSheets.forEach(function (sh) {
      if (!sh.syncView) return;
      if (a && sh.dlg.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      sh.refresh();
    });
  }
  function pingNow(force) {
    if (!syncOn()) return Promise.resolve(null);
    if (!force && Date.now() - lastPingAt < 60000) return Promise.resolve(null);
    var s = device.sync;
    if (!force && s.blocked && s.blocked.error === 'auth') return Promise.resolve(null);   // キーが違う間は、自動では呼ばない
    lastPingAt = Date.now();
    return callGas('ping', { meta: syncMeta() }).then(function (res) {
      if (!res.ok) {
        if (res.error === 'auth') { s.blocked = { error: 'auth', at: D.nowIso(), info: {} }; saveDevice(); renderAll(); }
        return res;
      }
      s.server = { rev: res.serverRev, docId: res.docId, savedAt: res.savedAt, lastPushDeviceName: res.lastPushDeviceName, sheetUrl: res.sheetUrl,
        folderUrl: res.folderUrl, review: res.review, trashed: res.trashed, at: D.nowIso() };
      if (res.trashed) s.blocked = { error: 'store_trashed', at: D.nowIso(), info: {} };
      else if (s.blocked && (s.blocked.error === 'store_trashed' || s.blocked.error === 'auth' ||
        (s.blocked.error === 'client_old' && D.WRITER_LEVEL >= (res.minWriter || 1)))) s.blocked = null;   // 直っていたら止めを解く
      if (s.forceNext && res.serverRev !== s.baseRev) s.forceNext = null;   // 戻した後に別の端末が送っていたら、上書きの許可は捨てる
      saveDevice(); renderDot();
      // 新着のレビューは、クラウドとの関係（baseRev）が決まってから取り込む（つなぐ途中の空の文書に書かないように）
      if (s.baseRev != null && !readOnly && store.isReady() && res.advice && res.advice.name && res.advice.name !== s.lastAdvice) fetchAdvice(res.advice.name);
      if (s.dirty) pushNow();
      return res;
    });
  }
  function fetchAdvice(name) {
    return callGas('get', { name: name }).then(function (res) {
      if (!res.ok || !res.doc) return;
      takeAdvice(res.doc, name, true);
    });
  }
  function takeAdvice(adv, name, announce) {
    var added = false;
    commit(null, function (d) { added = D.addAdvice(d, adv); return added ? undefined : false; }, { undo: false, noRefresh: true });
    if (name && adv && adv.id && D.byId(doc.advice, adv.id)) { device.sync.lastAdvice = name; saveDevice(); }
    if (added && announce) toast('Claude のレビューが届きました', { action: { label: '読む', fn: function () { openAdviceSheet(); } } });
    return added;
  }

  // ---- 状態の点（ヘッダー）----
  function syncState() {
    if (!syncOn()) return 'off';
    var s = device.sync;
    if (s.blocked) return 'bad';
    var stale = s.lastOkAt ? (Date.now() - Date.parse(s.lastOkAt)) / 86400000 : 99;
    if (s.dirty || syncBusy) return (s.failCount >= 3 && stale >= 7) ? 'bad' : 'pending';
    return 'ok';
  }
  function agoText(iso) {
    if (!iso) return 'まだ';
    var m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return m + '分前';
    if (m < 1440) return Math.floor(m / 60) + '時間前';
    return Math.floor(m / 1440) + '日前';
  }
  function syncStatusText() {
    var st = syncState(), s = device.sync;
    if (st === 'off') return 'クラウドへの控えは未設定です';
    if (st === 'bad') return 'うまく控えられていません：' + errText(s.blocked ? s.blocked.error : s.lastError);
    if (st === 'pending') return syncBusy ? '送っています…' : '送信待ち（最後の控え：' + agoText(s.lastOkAt) + '）' + (s.lastError ? '・' + errText(s.lastError) : '');
    return 'クラウドに控え済み（' + agoText(s.lastOkAt) + '）';
  }
  function renderDot() {
    var el = document.getElementById('syncDot');
    if (!el) return;
    var st = syncState();
    el.hidden = st === 'off';
    el.setAttribute('data-state', st);
    el.setAttribute('aria-label', '同期の状態：' + syncStatusText());
    el.title = syncStatusText();
  }

  // ---- 止まっている時の帯 ----
  function syncBanner() {
    if (!syncOn() || !device.sync.blocked) return null;
    var b = device.sync.blocked, e = b.error, info = b.info || {};
    var kids = [h('p', { text: errText(e) + (e === 'other_device' && info.lastPushDeviceName ? '（端末：' + info.lastPushDeviceName + '）' : '') + '。自動の控えを止めています。' })];
    var acts = [];
    if (e === 'other_device' || e === 'doc_mismatch' || e === 'shrink') acts.push(btn('クラウドから復元', function () { openCloudRestore(); }, 'btn-sm btn-accent'));
    if (e === 'other_device') acts.push(btn('この端末の内容で上書き', function () {
      confirmSheet('この端末の内容で上書きしますか？', ['クラウドの今の内容は、Drive の preforce フォルダに残ります。'], '上書きする', function () { pushNow({ force: 'other_device', manual: true }); }, true);
    }, 'btn-sm'));
    if (e === 'shrink') acts.push(btn('内容を確かめて上書き', function () {
      confirmSheet('記録が減っていますが、上書きしますか？', ['減っている種類：' + (info.collections || []).join('・'), '消したつもりが無ければ、先に［クラウドから復元］を選んでください。クラウドの今の内容は Drive の preforce フォルダに残ります。'], '上書きする', function () { pushNow({ force: 'restore', manual: true }); }, true);
    }, 'btn-sm'));
    if (e === 'doc_mismatch' || e === 'auth') acts.push(btn('設定を開く', function () { openSettings(); }, 'btn-sm'));
    if (e === 'client_old') acts.push(btn('更新を確かめる', function () { location.reload(); }, 'btn-sm'));
    if (e === 'clock_future' || e === 'store_trashed' || e === 'too_large') acts.push(btn('直したので、もう一度', function () { device.sync.blocked = null; saveDevice(); pushNow({ manual: true }); pingNow(true); }, 'btn-sm'));
    kids.push(h('div', { class: 'row-actions' }, acts));
    return h('div', { class: 'banner warn' }, kids);
  }

  // ---- つなぐ（設定コード）----
  function askSetupCode(mode) {
    askText(mode === 'restore' ? 'クラウドから復元（設定コード）' : '設定コードを貼る', '', 'dwz1. で始まる1行', function (v) { if (v) setupSync(v, mode); },
      { hint: 'GAS から届いたメール「タイムバケット｜設定コード」の1行を、そのまま貼ってください。' });
  }
  function setupSync(code, mode) {
    var p = D.parseSetupCode(code);
    if (!p) { toast('設定コードを読み取れませんでした（dwz1. で始まる1行です）'); return; }
    device.sync = { url: p.url, key: p.key, enabled: true, baseRev: null, dirty: false, failCount: 0, lastOkAt: null, lastError: null, blocked: null, lastAdvice: null };
    saveDevice(); renderAll(); refreshSheets();
    toast('つないでいます…');
    lastPingAt = 0;
    pingNow(true).then(function (res) {
      if (!res || !res.ok) { toast(errText(res ? res.error : 'offline')); return; }
      var decision = mode === 'restore' ? (res.serverRev ? 'restore' : 'empty') : D.firstConnect({ serverRev: res.serverRev, docId: res.docId, savedAt: res.docSavedAt || res.savedAt }, doc);
      if (decision === 'push') {
        device.sync.baseRev = (!res.serverRev || res.lastPushDevice === device.deviceId) ? res.serverRev : null;
        device.sync.dirty = true; saveDevice();
        pushNow({ manual: true }).then(function (r) { if (r && r.ok) toast('クラウドへの控えを始めました'); else if (r) toast(errText(r.error)); });
      } else if (decision === 'restore') restoreFromCloud('current');
      else if (decision === 'empty') toast('クラウドにはまだ控えがありません');
      else if (decision === 'ask-cloud-newer') {
        openSheet({ title: 'クラウドの方が新しい内容です', build: function (api) {
          return { body: [h('p', { text: 'クラウドには、この端末より新しい内容があります（最後の控え：' + (res.lastPushDeviceName || '別の端末') + '・' + agoText(res.savedAt) + '）。' })],
            foot: [btn('この端末で上書き', function () { api.close(); device.sync.baseRev = res.serverRev; pushNow({ force: 'other_device', manual: true }); }),
              btn('クラウドから復元', function () { api.close(); restoreFromCloud('current'); }, 'btn-accent')] };
        } });
      } else {
        openSheet({ title: '別の人生データがあります', build: function (api) {
          return { body: [h('p', { text: 'クラウドには、この端末とは別の人生データが入っています。どちらを残しますか？' }),
            h('p', { class: 'small muted', text: '「この端末で上書き」は、設定の奥で「上書き」と入力した時だけできます（間違えて消さないため）。' })],
            foot: [btn('あとで決める', api.close), btn('クラウドから復元', function () { api.close(); restoreFromCloud('current'); }, 'btn-accent')] };
        } });
        device.sync.blocked = { error: 'doc_mismatch', at: D.nowIso(), info: {} }; saveDevice(); renderAll();
      }
    });
  }
  // クラウドから復元（最新 current か、世代を選ぶ）
  function openCloudRestore() {
    openSheet({ title: 'クラウドから復元', build: function (api) {
      var body = [h('p', { class: 'small muted', text: '戻す前に、この端末の今のデータも控えに残ります。' }),
        btn('いちばん新しい控え（最新）から戻す', function () { restoreFromCloud('current'); }, 'btn-accent btn-block')];
      var listBox = h('div', { class: 'list', style: { 'margin-top': '.6rem' } }, h('p', { class: 'small muted', text: '世代の一覧を読み込んでいます…' }));
      body.push(h('div', { class: 'sec' }, h('h2', { text: '日付を選んで戻す' })), listBox);
      callGas('list', { kind: 'gen' }).then(function (res) {
        listBox.replaceChildren();
        if (!res.ok) { listBox.appendChild(h('p', { class: 'small', text: errText(res.error) })); return; }
        if (!res.files.length) { listBox.appendChild(h('p', { class: 'small muted', text: '世代はまだありません。' })); return; }
        res.files.slice(0, 60).forEach(function (f) {
          listBox.appendChild(btn(f.savedAt.slice(0, 16).replace('T', ' ') + '（UTC）', function () { restoreFromCloud(f.name); }, 'btn-block'));
        });
      });
      return body;
    } });
  }
  // 戻した後は、開いているシートをすべて閉じて「今年」に戻る（importReplace の第2引数）
  function restoreFromCloud(name) {
    toast('読み込んでいます…');
    callGas('get', { name: name }).then(function (res) {
      if (!res.ok || !res.doc) { toast(errText(res.error)); return; }
      importReplace(JSON.stringify(res.doc), true, { onApplied: function () {
        var s = device.sync;
        s.baseRev = res.serverRev; s.blocked = null; s.failCount = 0; s.lastError = null;
        if (name === 'current') s.lastOkAt = D.nowIso();   // クラウドの最新と同じになった
        // 世代から戻した時は「新しい編集」として、次の控えで上書きを許す（記録が減っていても止めない）
        s.forceNext = name === 'current' ? null : 'restore';
        s.dirty = true;
        saveDevice();
        if (s.dirty) schedulePush(1500);
        renderAll();
      } });
    });
  }
  function stopSync() {
    confirmSheet('この端末での同期を止めますか？', ['クラウドの控えは消えません。設定コードを貼り直せば、また始められます。'], '止める', function () {
      device.sync = null; saveDevice(); renderAll(); refreshSheets(); toast('この端末での同期を止めました');
    }, true);
  }
  function forceOverwrite() {
    askText('クラウドをこの端末の内容で上書き', '', '「上書き」と入力', function (v) {
      if (v !== '上書き') { toast('やめました（「上書き」と入力した時だけ上書きします）'); return; }
      pushNow({ force: 'all', manual: true }).then(function (r) { if (r) toast(r.ok ? '上書きしました（前の内容は Drive の preforce に残っています）' : errText(r.error)); });
    }, { hint: 'クラウドの今の内容は Drive の preforce フォルダに残り、メールでも知らせます。' });
  }

  // ---- Claude のレビュー ----
  function requestReview() {
    if (!syncOn()) { toast('先に、同期（設定コード）を設定してください'); return; }
    if (syncBusy) { toast('送信中です。少し後でもう一度押してください'); return; }
    if (device.sync.blocked) { toast(errText(device.sync.blocked.error) + '。先に同期を直してください'); return; }
    toast('Claude が読んでいます（1〜2分かかります）');
    device.sync.dirty = true;
    pushNow({ manual: true }).then(function (pr) {
      if (!pr || !pr.ok) { toast('最新の内容を送れなかったので、レビューをやめました' + (pr ? '（' + errText(pr.error) + '）' : '')); return null; }
      return callGas('review', { meta: syncMeta() }, { timeoutMs: 330000 });
    }).then(function (res) {
      if (!res) return;
      if (res.ok && res.advice) { takeAdvice(res.advice, res.name, false); openAdviceSheet(res.advice.id); return; }
      if (res.error === 'unchanged') { toast(errText('unchanged') + '。前回のレビューを開きます'); openAdviceSheet(); return; }
      toast(errText(res.error));
      pingNow(true);
    });
  }
  function adviceDate(a) { return String(a.at || '').slice(0, 10); }
  function openAdviceSheet(id) {
    openSheet({ title: 'Claude のレビュー', build: function () {
      var a = (id && D.byId(doc.advice, id)) || D.latestAdvice(doc);
      if (!a) return [h('p', { class: 'small muted', text: 'まだレビューはありません。設定の［Claude にレビューしてもらう］か、週1の自動レビューを待ってください。' })];
      var body = [h('p', { class: 'xs muted', text: adviceDate(a) + '・' + (a.source === 'claude-code' ? 'PC の Claude Code' : 'Claude（自動）') + (a.costUsd != null ? '・料金の目安 約$' + a.costUsd : '') })];
      body.push(h('div', { class: 'card flat' }, h('p', { style: { 'white-space': 'pre-wrap', margin: 0 }, text: a.overall })));
      if ((a.praise || []).length) { body.push(sec('良いところ')); body.push(h('ul', {}, a.praise.map(function (p) { return h('li', { text: p }); }))); }
      if ((a.items || []).length) {
        body.push(sec('項目へのひとこと'));
        a.items.forEach(function (x) {
          var it = getItem(x.itemId);
          body.push(h('div', { class: 'finding info' }, [
            h('div', { class: 'ititle', text: it ? it.title : '（今は無い項目）' }),
            h('div', { text: x.comment }),
            x.suggestion ? h('div', { class: 'small', text: '提案：' + x.suggestion }) : null,
            x.rule ? h('div', { class: 'rule', text: ruleLabel(x.rule) + (ruleTitles(x.rule) ? '（' + ruleTitles(x.rule) + '）' : '') }) : null,
            it ? h('div', { class: 'row-actions' }, [btn('項目を開く', function () { openItemSheet(it.id); }, 'btn-sm'),
              it.status !== 'letgo' ? btn('時期を変える', function () { openPlaceSheet(it.id); }, 'btn-sm') : null]) : null
          ]));
        });
      }
      if ((a.questions || []).length) { body.push(sec('問いかけ')); body.push(h('ul', {}, a.questions.map(function (q) { return h('li', { text: q }); }))); }
      body.push(h('p', { class: 'xs muted', text: '提案は自動では反映されません。決めるのはあなたです。' }));
      var older = D.live(doc.advice).filter(function (x) { return x.id !== a.id; }).sort(function (p, q) { return p.at < q.at ? 1 : -1; });
      if (older.length) {
        body.push(h('details', { class: 'more', 'data-key': 'history' }, [h('summary', {}, '前のレビュー'),
          h('div', { class: 'list' }, older.slice(0, 30).map(function (o) { return btn(adviceDate(o) + '　' + o.overall.slice(0, 24) + '…', function () { openAdviceSheet(o.id); }, 'btn-block'); }))]));
      }
      return body;
    } });
  }
  function adviceCard() {
    var a = D.latestAdvice(doc);
    if (!a || device.hiddenAdviceId === a.id) return null;
    return h('div', { class: 'card flat advice-card' }, [
      h('div', { class: 'xs muted', text: 'Claude のひとこと（' + adviceDate(a) + '）' }),
      h('p', { style: { margin: '.3rem 0' }, text: a.overall.length > 110 ? a.overall.slice(0, 110) + '…' : a.overall }),
      h('div', { class: 'row-actions' }, [btn('読む', function () { openAdviceSheet(a.id); }, 'btn-sm btn-accent'),
        btn('閉じる', function () { device.hiddenAdviceId = a.id; saveDevice(); renderAll(); }, 'btn-sm')])
    ]);
  }

  // ---- 設定の「同期」と「Claude のレビュー」の節 ----
  function syncSettingsSection(api) {
    var out = [h('h3', { text: '同期（自分の Google への控え）', style: { 'margin-top': '1.5rem' } })];
    var s = device.sync;
    out.push(h('p', { class: 'small', text: syncStatusText() }));
    if (!syncOn()) {
      out.push(h('p', { class: 'xs muted', text: '自分の Google（GAS）に、変更のたびに自動で控えを取ります。Drive に日付付きの世代が残り、PC で見られるスプレッドシートもできます。' }));
      out.push(btn('設定コードを貼る', function () { askSetupCode('connect'); }, 'btn-accent btn-block'));
    } else {
      var sv = s.server || {};
      out.push(h('div', { class: 'list' }, [
        btn('今すぐ控える', function () { device.sync.dirty = true; pushNow({ manual: true }).then(function (r) { if (r) toast(r.ok ? 'クラウドに控えました' : errText(r.error)); }); }, 'btn-block'),
        btn('クラウドから復元', function () { openCloudRestore(); }, 'btn-block'),
        sv.sheetUrl ? h('a', { class: 'btn btn-block', href: sv.sheetUrl, target: '_blank', rel: 'noopener noreferrer', text: '読む用のスプレッドシートを開く' }) : null,
        sv.folderUrl ? h('a', { class: 'btn btn-block', href: sv.folderUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Drive の控えのフォルダを開く' }) : null
      ]));
      out.push(h('details', { class: 'more', 'data-key': 'sync-more' }, [h('summary', {}, 'くわしい操作'), h('div', { class: 'list' }, [
        h('p', { class: 'xs muted', text: '端末の名前：' + deviceLabel() + '・キー：••••' + String(s.key).slice(-4) + '・版 ' + (s.baseRev == null ? '―' : s.baseRev) }),
        btn('端末の名前を変える', function () { askText('端末の名前', device.deviceName || deviceLabel(), '例：Pixel', function (v) { if (v) { device.deviceName = v.slice(0, 20); saveDevice(); api.refresh(); } }); }, 'btn-block btn-sm'),
        btn('設定コードを貼り直す', function () { askSetupCode('connect'); }, 'btn-block btn-sm'),
        btn('クラウドをこの端末の内容で上書き', forceOverwrite, 'btn-block btn-sm btn-danger'),
        btn('この端末での同期を止める', stopSync, 'btn-block btn-sm btn-danger')
      ])]));
    }
    out.push(h('h3', { text: 'Claude のレビュー', style: { 'margin-top': '1.5rem' } }));
    out.push(h('p', { class: 'xs muted', text: '一覧を Claude が読んで、本の考え方から見た感想とアドバイスを返します。材料に名前・生年月日・メモは入れません。変化が無い週は呼びません（料金がかかりません）。' }));
    out.push(field('自動のレビュー', seg([{ label: '週1', value: 'weekly' }, { label: '月1', value: 'monthly' }, { label: '止める', value: 'off' }], doc.settings.reviewFrequency, function (v) {
      commit(null, function (d) { d.settings.reviewFrequency = v; upd(d.settings); });
    }, '自動のレビュー')));
    out.push(checkLine('金額も Claude に見せる', doc.settings.reviewIncludeMoney, function (v) { commit(null, function (d) { d.settings.reviewIncludeMoney = v; upd(d.settings); }); }));
    var rv = syncOn() && s.server && s.server.review;
    if (rv) out.push(h('p', { class: 'xs muted', text: (rv.hasKey ? 'API キー：設定済み' : 'API キー：未設定（セットアップ手順.html の v1.1 の節）') + '・前回：' + (rv.lastAt ? rv.lastAt.slice(0, 10) : 'まだ') + (rv.lastError ? '・' + errText(String(rv.lastError).split('：')[0]) : '') }));
    out.push(h('div', { class: 'list' }, [
      btn('Claude にレビューしてもらう（今すぐ）', requestReview, 'btn-block'),
      D.live(doc.advice).length ? btn('レビューを読む', function () { openAdviceSheet(); }, 'btn-block') : null
    ]));
    return out;
  }

  /* =====================================================================
   * 9. 見た目の設定・PWA・起動
   * ===================================================================== */
  function applyTheme() {
    var t = device.theme || 'auto';
    if (t === 'auto') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { m.removeAttribute('media'); m.setAttribute('content', t === 'dark' ? '#1a1714' : '#faf9f7'); });
  }
  function applyFontScale(v) { document.documentElement.style.setProperty('--fs', String(v || (doc && doc.settings.fontScale) || 1)); }

  var updateRequested = false;
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    // テスト環境では ?sw=1 を付けた時だけ使う（開発中に古いファイルが返り続けないように）
    if (IS_TEST && params.get('sw') !== '1') return;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) { updateReady = true; renderAll(); }
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) { updateReady = true; renderAll(); } });
      });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!updateRequested) return;          // 自分で［更新］を押した時だけ読み直す（初回のインストールでは読み直さない）
      updateRequested = false;
      location.reload();
    });
  }
  function applyUpdate() {
    store.flush();
    if (swReg && swReg.waiting) { updateRequested = true; swReg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
    else location.reload();
  }

  function checkDayChange() {
    if (!ctx || ctx.today === today()) return;
    if (openSheets.length) return;     // 操作中は次の機会に（シートを閉じた時にもう一度呼ばれる）
    recompute();
    store.daily(doc, today());         // 自動の書き換え（誕生日の戻し）の前の状態を控える
    maybeRollover();
    renderAll();
  }
  function maybeRollover() {
    if (!ctx || readOnly) return;
    if (!D.rolloverCandidates(doc, ctx).length) return;
    rolledNotice = true;       // 先に印を付けてから描く（お知らせの1行を出すため）
    commit(null, function (d) { D.applyRollover(d, ctx, device.deviceId); }, { undo: false });
  }
  function handleLaunch() {
    var act = params.get('do');
    if (!act) return;
    // 一度処理したら URL から消す（再読み込みのたびに開かないように）
    params.delete('do');
    var q = params.toString();
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch (e) {}
    if (act === 'add' && ctx) openIdeaSheet();
  }
  // タブバーの実際の高さ（文字150%で2行になっても）を --tabbar-h に反映する
  function watchTabbarHeight() {
    var inner = document.querySelector('.tabbar');
    if (!inner || !window.ResizeObserver) return;
    new ResizeObserver(function () {
      var hgt = inner.getBoundingClientRect().height;
      if (hgt > 0) document.documentElement.style.setProperty('--tabbar-h', Math.round(hgt) + 'px');
    }).observe(inner);
  }
  function tabFromHash() { var t = (location.hash || '').replace('#', ''); return TAB_TITLES[t] ? t : null; }

  function boot() {
    applyTheme();
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    var r = store.load();
    if (r.status === 'ok' || r.status === 'newer') { doc = r.doc; readOnly = r.status === 'newer'; }
    else doc = D.newDoc();
    applyFontScale();
    ui.tab = tabFromHash() || 'now';
    recompute();
    // ここから先の「操作」でだけ保存する（ただ開いただけでは上書きしない）。
    // 壊れたデータで起動した時は、本人が戻し方を選ぶまで保存しない
    store.setReady(!readOnly && r.status !== 'corrupt');
    renderAll();
    if (ctx && r.status === 'ok') store.daily(doc, today());   // 自動の書き換えの前の状態を控える
    maybeRollover();
    watchTabbarHeight();
    if (r.status === 'corrupt') openRepair();
    else if (!doc.profile.birthDate && !readOnly) openWizard();
    else handleLaunch();

    document.querySelector('.tabbar').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('syncDot').addEventListener('click', openSettings);
    window.addEventListener('online', function () { pingNow(true); });
    renderDot();
    if (syncOn()) setTimeout(function () { pingNow(true); }, 1500);
    document.getElementById('fab').addEventListener('click', function () { openIdeaSheet(); });
    window.addEventListener('hashchange', function () { var t = tabFromHash(); if (t && t !== ui.tab) setTab(t); });
    // 閉じる・裏に回る瞬間に、保留中の保存を取りこぼさない
    window.addEventListener('pagehide', function () { store.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { store.flush(); if (syncOn() && device.sync.dirty) pushNow({ keepalive: true }); }
      else { checkDayChange(); pingNow(); }
    });
    setInterval(checkDayChange, 60000);
    // 同じスマホの別の画面（アプリ／Chromeのタブ）が保存したら、読み直して合わせる
    window.addEventListener('storage', function (e) {
      // 別の画面で同期を設定・解除したら、こちらも合わせる（古い画面が同期の設定を消してしまわないように）
      if (e.key === D.KEYS.device && e.newValue) {
        try { device.sync = JSON.parse(e.newValue).sync || null; renderDot(); } catch (err) {}
        return;
      }
      if (e.key !== D.KEYS.data || !e.newValue) return;
      if (store.pending()) return;      // こちらに未保存の変更がある時は、次の保存で合体する
      var r2 = D.ingest(e.newValue);
      if (!r2.ok) return;
      if (r2.readOnly) { readOnly = true; store.setReadOnly(true); renderAll(); return; }
      doc = r2.doc;
      store.resetSeq(doc.saveSeq);
      recompute(); renderAll(); refreshSheets();
    });
    window.__DWZ_BOOTED = true;
    registerSW();
  }

  try { boot(); }
  catch (e) { console.error(e); if (window.__DWZ_RESCUE) window.__DWZ_RESCUE(); }
})();
