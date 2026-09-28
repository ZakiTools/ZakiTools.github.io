/* tests/lib.js — 外部ライブラリ無しの小さなテスト道具
 *   test('名前', fn) で登録し、run.js がまとめて実行する。
 *   fn は async でもよい（保存の待ち時間などを試す時）。 */
'use strict';
const assert = require('node:assert/strict');
const path = require('path');

const registry = [];
function test(name, fn) { registry.push({ name, fn, file: currentFile }); }
let currentFile = '';
function setFile(f) { currentFile = f; }

// 架空の人物だけを使う（本物の生年月日はテストに書かない）
const BIRTH = '2000-11-15';          // 2026-09-28 時点で 25歳（バケツ 25〜29）
const TODAY = '2026-09-28';

function core() { return require(path.join(__dirname, '..', 'docs', 'core.js')); }

// テスト用の文書を作る（生年月日と今日を固定）
function makeDoc(opts) {
  const D = core();
  const doc = D.newDoc();
  doc.profile.birthDate = (opts && opts.birth) || BIRTH;
  if (opts && opts.leave != null) doc.settings.leaveDaysPerYear = opts.leave;
  if (opts && opts.hours != null) doc.settings.freeHoursPerWeek = opts.hours;
  return doc;
}
function ctx(doc, today) { return core().ctxOf(doc, today || TODAY); }

// 偽の localStorage（容量の上限も試せる）
function fakeStorage(limitChars) {
  const m = new Map();
  const api = {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] || null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      v = String(v);
      if (limitChars != null) {
        let total = 0;
        m.forEach((val, key) => { if (key !== k) total += key.length + val.length; });
        if (total + k.length + v.length > limitChars) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      }
      m.set(k, v);
    },
    removeItem(k) { m.delete(k); },
    _map: m
  };
  return api;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { test, registry, setFile, assert, BIRTH, TODAY, core, makeDoc, ctx, fakeStorage, sleep };
