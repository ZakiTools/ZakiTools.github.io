/* =====================================================================
 * sw.js — Service Worker（オフラインでも開けるように、アプリのファイルを保存しておく係）
 *
 *   ・キャッシュ名に版を入れる（dwz-shell-<版>）。新しい版は「全部まとめて」入れ替える＝古い版と新しい版が混ざらない
 *   ・消すのは dwz-shell- で始まる自分の古い箱だけ（同じ住所の他のアプリや、控えの箱には触れない）
 *   ・切り替えは画面の［更新する］を押した時だけ（勝手に切り替えて画面が崩れないように）
 *   ・Google Apps Script との通信（別の住所・POST）には一切関わらない
 *   VERSION は core.js の APP_VERSION と必ず一致させる（テストで確かめる）
 * ===================================================================== */
'use strict';
const VERSION = '1.1.0';
const CACHE = 'dwz-shell-' + VERSION;
const ASSETS = [
  './', './index.html', './core.js', './app.js', './rescue.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable.png'
];

self.addEventListener('install', (event) => {
  // cache:'reload' で必ず最新をネットから取り直す（GitHub Pages の10分キャッシュを避ける）
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dwz-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // POST（同期など）は素通し
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 別の住所（Google など）は素通し
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ?do=add や #now 付きで開いても同じ画面ファイルを返す（ignoreSearch）
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
