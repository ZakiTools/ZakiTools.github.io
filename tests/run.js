/* tests/run.js — すべてのテストを実行する
 *   使い方：node tests/run.js
 *   3つのタイムゾーン（日本・ロサンゼルス・キリバス）で自分自身を起動し直して、
 *   旅行中など端末の時刻帯が変わっても日付がずれないことを確かめる。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TZS = ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati'];

if (!process.env.DWZ_TEST_CHILD) {
  let failed = 0;
  for (const tz of TZS) {
    const r = spawnSync(process.execPath, [__filename], {
      env: Object.assign({}, process.env, { TZ: tz, DWZ_TEST_CHILD: '1' }), stdio: 'inherit'
    });
    if (r.status !== 0) failed++;
  }
  console.log(failed ? `\n✗ ${failed} 個のタイムゾーンで失敗しました` : '\n✓ 3つのタイムゾーンすべてで成功しました');
  process.exit(failed ? 1 : 0);
}

const lib = require('./lib.js');
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
for (const f of files) { lib.setFile(f); require(path.join(__dirname, f)); }

(async () => {
  let pass = 0, fail = 0;
  for (const t of lib.registry) {
    try { await t.fn(); pass++; }
    catch (e) { fail++; console.log(`  ✗ [${t.file}] ${t.name}\n      ${String(e && e.message || e).split('\n').join('\n      ')}`); }
  }
  console.log(`[TZ=${process.env.TZ}] ${pass} 件成功 / ${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})();
