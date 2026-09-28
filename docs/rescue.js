/* =====================================================================
 * rescue.js — 非常口（app.js とは独立して動く、小さな脱出口）
 *   新しい版に不具合があって画面が真っ白になっても、
 *   ① 生データを .txt で書き出す ② 最新版を読み直す の2つだけはできるようにする。
 *   app.js が起動に成功すると window.__DWZ_BOOTED = true になり、ここは何もしない。
 * ===================================================================== */
(function () {
  'use strict';
  var errors = [];
  window.addEventListener('error', function (e) { errors.push(String((e && (e.message || e.error)) || 'error')); });
  window.addEventListener('unhandledrejection', function (e) { errors.push(String(e && e.reason)); });

  function show() {
    if (window.__DWZ_BOOTED) return;
    var r = document.getElementById('rescue');
    var app = document.getElementById('app');
    if (!r) return;
    r.hidden = false;
    if (app) app.hidden = true;
    var pre = document.getElementById('rescueErr');
    if (pre) pre.textContent = errors.slice(-3).join('\n');
  }
  window.__DWZ_RESCUE = show;
  setTimeout(show, 4000);   // 4秒たっても起動完了の印が無ければ出す

  function today() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 0);
  }
  function exportRaw() {
    var raw = null;
    try { raw = localStorage.getItem('dwz-data'); } catch (e) {}
    if (!raw) { alert('このスマホには保存データが見つかりませんでした。'); return; }
    var name = 'timebucket-rescue-' + today() + '.txt';
    try {
      var file = new File([raw], name, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).catch(function (err) { if (!err || err.name !== 'AbortError') download(name, raw); });
        return;
      }
    } catch (e) {}
    download(name, raw);
  }
  function reloadLatest() {
    // 電波が無い時は何も消さない（消すとオフライン用の画面ごと無くなり、非常口も開けなくなるため）
    if (navigator.onLine === false) { alert('回線につながってから押してください。データはこのスマホの中に残っています。'); return; }
    // 先に最新のファイルを取り直せるか確かめる。1つでも取れなければ、何も消さない
    var files = ['./index.html', './core.js', './app.js', './rescue.js'];
    Promise.all(files.map(function (f) { return fetch(f, { cache: 'reload' }).then(function (r) { if (!r.ok) throw new Error(f); }); }))
      .then(clearAndReload)
      .catch(function () { alert('最新版を取得できませんでした。回線を確かめてから、もう一度押してください。データはこのスマホの中に残っています。'); });
  }
  function clearAndReload() {
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      }
      if (window.caches && caches.keys) {
        // 消すのはこのアプリの画面ファイルの箱（dwz-shell-）だけ。控え（dwz-backup）には触れない
        jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('dwz-shell-') === 0; }).map(function (k) { return caches.delete(k); })); }));
      }
    } catch (e) {}
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var ex = document.getElementById('rescueExport');
    var rl = document.getElementById('rescueReload');
    if (ex) ex.addEventListener('click', exportRaw);
    if (rl) rl.addEventListener('click', reloadLatest);
  });
})();
