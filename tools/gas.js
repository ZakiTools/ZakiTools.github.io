/* tools/gas.js — GAS（自分の Google の控え係）を作る・送る・公開する
 *
 *   使い方（repo フォルダで）：
 *     node tools/gas.js create   … 最初に1回。自分の Google に GAS のプロジェクトを作る
 *     node tools/gas.js push     … repo/gas のコードを送る（ウェブアプリの版は変えない）
 *     node tools/gas.js deploy   … 送って、ウェブアプリを新しい版にする（住所は変わらない）
 *     node tools/gas.js status   … 控えの番号がそろっているか確かめる
 *
 *   scriptId・deploymentId は公開しない（../private/gas-deploy.json に置く）。
 *   組み立ては ../private/gas-build/ で行い、そこに Config.gs（ウェブアプリの番号）を足してから clasp で送る。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SRC = path.join(REPO, 'gas');
const PRIVATE = path.join(REPO, '..', 'private');
const BUILD = path.join(PRIVATE, 'gas-build');
const CONF = path.join(PRIVATE, 'gas-deploy.json');

function readConf() { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch (e) { return {}; } }
function writeConf(c) { fs.writeFileSync(CONF, JSON.stringify(c, null, 2)); }
function mask(s) { return s ? s.slice(0, 6) + '…' + s.slice(-4) : '(なし)'; }
function clasp(args) {
  const cmd = process.platform === 'win32' ? 'clasp.cmd' : 'clasp';
  // Windows では clasp.cmd をシェル経由で呼ぶので、空白を含む引数（題名・説明）は "…" で囲む
  const win = process.platform === 'win32';
  const argv = win ? args.map((a) => (/[\s&|<>^"]/.test(a) ? '"' + a.replace(/"/g, '') + '"' : a)) : args;
  return execFileSync(cmd, argv, { cwd: BUILD, encoding: 'utf8', shell: win, stdio: ['ignore', 'pipe', 'pipe'] });
}
function version() {
  const m = /var APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(REPO, 'docs', 'core.js'), 'utf8'));
  return m ? m[1] : '?';
}

function build() {
  const c = readConf();
  if (!c.scriptId) throw new Error('まだ GAS のプロジェクトがありません。先に node tools/gas.js create');
  fs.mkdirSync(BUILD, { recursive: true });
  fs.readdirSync(BUILD).forEach((f) => { if (/\.(gs|json)$/.test(f) && f !== '.clasp.json') fs.unlinkSync(path.join(BUILD, f)); });
  fs.readdirSync(SRC).forEach((f) => { if (/\.(gs|json)$/.test(f)) fs.copyFileSync(path.join(SRC, f), path.join(BUILD, f)); });
  fs.writeFileSync(path.join(BUILD, 'Config.gs'),
    '/* Config.gs — 手元の道具（tools/gas.js）が作る。公開しない */\nvar DWZ_DEPLOYMENT_ID = ' + JSON.stringify(c.deploymentId || '') + ';\n');
  fs.writeFileSync(path.join(BUILD, '.clasp.json'), JSON.stringify({ scriptId: c.scriptId, rootDir: '.' }, null, 2));
  return c;
}

const cmd = process.argv[2];
try {
  if (cmd === 'create') {
    const c = readConf();
    if (c.scriptId) { console.log('もうあります：scriptId ' + mask(c.scriptId)); process.exit(0); }
    fs.mkdirSync(BUILD, { recursive: true });
    const out = clasp(['create-script', '--type', 'standalone', '--title', 'タイムバケット 控え', '--rootDir', '.']);
    const cj = JSON.parse(fs.readFileSync(path.join(BUILD, '.clasp.json'), 'utf8'));
    writeConf({ scriptId: cj.scriptId, deploymentId: '', createdAt: new Date().toISOString() });
    console.log(out.trim().split('\n').filter((l) => !/https?:\/\//.test(l)).join('\n'));
    console.log('作りました：scriptId ' + mask(cj.scriptId));
  } else if (cmd === 'push') {
    build();
    clasp(['push', '-f']);
    console.log('送りました（ウェブアプリの版はそのまま）');
  } else if (cmd === 'deploy') {
    let c = build();
    clasp(['push', '-f']);
    const desc = 'v' + version() + ' ' + new Date().toISOString().slice(0, 10);
    if (!c.deploymentId) {
      const out = clasp(['create-deployment', '-d', desc]);
      const m = /(AKfyc[\w-]+)/.exec(out);
      if (!m) throw new Error('deploymentId を読み取れませんでした：' + out.slice(0, 200));
      c.deploymentId = m[1];
      writeConf(c);
      build();                       // 番号を Config.gs に入れて、もう一度送る
      clasp(['push', '-f']);
    }
    clasp(['update-deployment', c.deploymentId, '-d', desc]);
    console.log('公開しました（' + desc + '・deploymentId ' + mask(c.deploymentId) + '）');
  } else if (cmd === 'status') {
    const c = readConf();
    console.log('scriptId ' + mask(c.scriptId) + ' / deploymentId ' + mask(c.deploymentId));
  } else {
    console.log('使い方：node tools/gas.js create | push | deploy | status');
  }
} catch (e) {
  console.error('失敗しました：' + String(e.stderr || e.message || e).slice(0, 600));
  process.exit(1);
}
