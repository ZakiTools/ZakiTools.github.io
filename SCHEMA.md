# データの形（SCHEMA）— 60年もたせるための決め事

> アプリが無くなっても、書き出した `.txt`（中身は JSON）を読めば意味が分かるように、ここに形を書いておく。

## 文書（人生データ1冊）

```
{ app:"dwz-timebucket", schemaVersion:1, minWriter:1, docId, saveSeq, createdAt, savedAt,
  profile, settings, money|null,
  items[], logs[], people[], assets[], yearPlans[], reviews[], advice[] }
```

| 項目 | 意味 |
|---|---|
| `app` | 名札。別のアプリのデータを取り込まないため |
| `schemaVersion` | データの形の版。**意味が変わる時だけ** +1 |
| `minWriter` | このデータに書き込んでよいアプリの最低段階。**項目や配列を足した版で** +1 |
| `docId` | 「この人生データ1冊」の背番号。テスト用データが混ざるのを防ぐ |
| `saveSeq` | 保存のたびに変わる印。同じスマホの別画面の上書きを見つけるため |

## すべての記録に共通

- `id`（UUID）、`createdAt`・`updatedAt`（UTC の ISO 形式 `2026-09-28T03:12:45.000Z`）、`deletedAt`（墓標＝消した印。中身は残す）
- `updatedAt` は必ず前の値より新しくする。既定値のまま作った記録は `1970-01-01T00:00:00.000Z`
- 日付は `"YYYY-MM-DD"`（Date に変換しない）。年齢やバケツは保存せず毎回計算する
- 金額は「今の円」の整数。既定値と同じ項目は保存時に省き、読み込み時に埋め戻す

## items（経験と土台）

| 項目 | 意味 |
|---|---|
| `kind` | `exp`（経験）／`theme`（土台＝習慣・準備） |
| `status` | `idea`（候補）／`placed`（置いた）／`done`（思い出あり）／`letgo`（手放した） |
| `origin` | `user`／`draft`（Claudeの下書き）／`example`（例） |
| `when` | `{fromAge, toAge, date, endDate, precision:'day'|'month'}` どこに置いたか |
| `window` | `{startAge, endAge}` 窓（賞味期限）。未入力なら体力から（きつい50・ふつう75・軽い＝終点） |
| `body` | `light`／`normal`／`hard` 必要な体力 |
| `dwz` | 本の3つの問いの答え `{until:'30s'|'40s'|'60s'|'any', why:[body,people,stage,era,none], memory:'high'|'mid'|'low', reason, at}` |
| `repeat` | 回数型 `{perYear, fromAge, toAge}`（例：海外旅行 年1回 26〜75歳） |
| `parentId` | 回数型の親（例：台湾旅行 → 海外旅行） |
| `leaveDays`・`hoursPerWeek`・`hoursEach`・`cost{once,perYear}` | 容量（休み・時間・お金） |
| `withIds`・`needsIds` | 誰と（people の id）・支える土台（theme の id） |
| `give`・`risk` | 与える `{toIds,toText}`・挑戦 `{worst,prep}` |
| `goal`・`goalDate`・`nextStep`・`pillar` | 土台用 |
| `letgo`・`prevWhen`・`hint`・`draftKey` | 手放した理由・「今年から外す」時の戻り先・下書きの案・下書きの印 |

## logs（思い出。1回ごとに1件）

`{itemId, itemTitle（控え）, date, endDate, feel:1|2|3|null, note, link（httpsのみ）, withIds, later:[{date,text}]}`

## people（大切な人）

`{name, relation, birthYear, birthDate, goOutUntilAge, meetPerYear, onCalendar, note}`

## advice（Claude のレビュー。追記だけ）

`{id, at, source:'api'|'claude-code', model, packetHash, overall, praise[], items:[{itemId, comment, suggestion, rule}], questions[], usage, costUsd}`

- `id` が同じものは二度入れない（`addAdvice`）。提案がデータに自動で反映されることはない
- レビューの材料（`reviewPacket`）には、名前・生年月日・メモ・写真のリンク・思い出の一言を入れない。金額は `settings.reviewIncludeMoney` が true の時だけ
- `settings.reviewFrequency`：`weekly`（既定）／`monthly`／`off`

## 自分の Google ドライブの控え（v1.1。GAS が書く）

フォルダ「タイムバケット（消さないで）」

| 場所 | 中身 |
|---|---|
| `current.json` | 最新。書き出しと同じ形＋ `_server:{rev, savedAt, device}`（取り込む時に `_server` は捨てる） |
| `generations/<年>/<時刻>_r<版>_<端末>.json` | 世代。最新20個／14日以内すべて／90日までは1日1個／それより古いものは月1個を永久に |
| `advice/*.json` | Claude のレビュー（上の advice の1件） |
| `preforce/`・`premigrate/`・`preupdate/` | 上書き・形の変更・アプリの版の変更の直前のコピー（消さない） |
| `tables.json`・`packet.json` | 読む用の表の材料・レビューの材料（アプリが作る） |
| スプレッドシート「タイムバケット 読む用」 | PC で見る用（一方通行。直してもアプリには戻らない） |

送る時の関所（上から順）：`client_old`（古いアプリ）→ `store_trashed`（フォルダがゴミ箱）→ `doc_mismatch`（別の人生データ）→ `other_device`（別の端末が後から保存）→ `shrink`（どれかの種類で記録の数が減った。墓標も数える）→ `clock_future`（端末の時計が1日以上進んでいる）。
関所を越える上書き（force）は `other_device`／`restore`／`all` の3段階で、越える前に `preforce/` へコピーを残す。`all` は設定の奥で「上書き」と入力した時だけ。

## 形を変える時の規則

1. 知らない項目・知らない最上位の配列は、読み込みでも保存でも**捨てない**（古い版のアプリが新しい項目を消さないため）
2. 項目や配列を足した版では `minWriter`（と `core.js` の `WRITER_LEVEL`・`MIN_WRITER`）を上げる。古い版はそのデータを読み取り専用で開く
3. 意味が変わる時だけ `schemaVersion` を上げ、次の3つを必ずセットで行う
   - `core.js` の `MIGRATIONS[n]`（版 n → n+1 に直す処理。`updatedAt` に触れない。同じ入力なら必ず同じ出力）
   - `tests/fixtures/vN-*.json`（その版の凍結サンプル。一度作ったら書き換えない）
   - この `SCHEMA.md` の更新

## 端末の中の保存場所（localStorage。すべて `dwz-` で始まる）

| キー | 中身 | 書き出しに含めるか |
|---|---|---|
| `dwz-data` | 正本 | 含める |
| `dwz-prev` | 取り込み・復元・移行の直前の控え | 含めない |
| `dwz-daily`・`dwz-daily-day` | 1日1回の控え | 含めない |
| `dwz-data-corrupt-<日時>` | 読めなかったデータの退避（最大2件） | 含めない |
| `dwz-device` | この端末だけの情報（テーマ・前回の書き出し・同期の設定 `sync:{url, key, baseRev, dirty, lastOkAt, blocked, …}`） | **含めない**（秘密キーはここだけ） |
