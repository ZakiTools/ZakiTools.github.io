/* tools/make-icons.js — アプリのアイコン（PNG）を作る（外部ライブラリ不要）
 *   使い方：node tools/make-icons.js
 *   暖色の背景に、白い「バケツ（時間の入れ物）」と、その上の小さな丸（今この瞬間）を描く。
 *   maskable（丸や角丸に切り抜かれても欠けない版）は、絵を中央の安全な範囲に小さめに置く。 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0xd9, 0x77, 0x57];      // --accent
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// 図形（0〜1 の座標）。scale で全体を縮める（maskable 用）
function shapeAt(u, v, scale) {
  const cx = 0.5, cy = 0.53;
  const x = (u - cx) / scale + cx, y = (v - cy) / scale + cy;
  // バケツ：上 y=0.40 幅0.54、下 y=0.78 幅0.38 の台形（角を少し丸めた感じはサンプリングで）
  const top = 0.40, bot = 0.78;
  if (y >= top && y <= bot) {
    const t = (y - top) / (bot - top);
    const half = (0.54 * (1 - t) + 0.38 * t) / 2;
    if (Math.abs(x - 0.5) <= half) return true;
  }
  // ふちの帯（少し広い）
  if (y >= 0.365 && y <= 0.415 && Math.abs(x - 0.5) <= 0.305) return true;
  // 上の小さな丸（今この瞬間）
  const dx = x - 0.5, dy = y - 0.23;
  if (dx * dx + dy * dy <= 0.075 * 0.075) return true;
  return false;
}
function render(size, scale, rounded) {
  const S = 4; // 1ピクセルを4×4で見て、ふちを滑らかにする
  return png(size, (px, py) => {
    let fg = 0, inside = 0;
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const u = (px + (i + 0.5) / S) / size, v = (py + (j + 0.5) / S) / size;
      let inBg = true;
      if (rounded) {       // 角丸の四角（any 用）
        const r = 0.22, qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
        inBg = qx * qx + qy * qy <= r * r;
      }
      if (!inBg) continue;
      inside++;
      if (shapeAt(u, v, scale)) fg++;
    }
    const total = S * S;
    const a = Math.round(255 * inside / total);
    if (!inside) return [0, 0, 0, 0];
    const f = fg / inside;
    return [0, 1, 2].map((k) => Math.round(BG[k] * (1 - f) + FG[k] * f)).concat([a]);
  });
}

const out = path.join(__dirname, '..', 'docs');
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, 1, true));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, 1, true));
fs.writeFileSync(path.join(out, 'icon-maskable.png'), render(512, 0.72, false));
console.log('icons written to docs/');
