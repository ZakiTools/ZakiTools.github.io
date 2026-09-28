# タイムバケット

『DIE WITH ZERO』（ビル・パーキンス）の考え方で、死ぬまでの季節（5年ごとのバケツ）に
「いつ、何に注力するか」を置いていく、自分用のスマホアプリ（PWA）です。

- 本体：`docs/`（素の HTML / CSS / JavaScript。外部ライブラリ・ビルド無し）
- データ：スマホの中（localStorage）に保存。個人のデータはこのリポジトリには一切入りません
- 公開：GitHub Pages（`docs/` を配信）

## ファイル

| 場所 | 中身 |
|---|---|
| `docs/index.html` | 画面の骨組みと見た目（CSS）、CSP |
| `docs/core.js` | 計算とデータ（画面に依存しない。テストで直接動かせる） |
| `docs/app.js` | 画面（タブ・シート・操作） |
| `docs/rescue.js` | 非常口（起動に失敗した時に、データの書き出しと読み直しだけはできる） |
| `docs/sw.js` | Service Worker（オフラインで開けるようにする） |
| `docs/manifest.webmanifest` | ホーム画面に入れた時の名前・アイコン・ショートカット |
| `tests/` | 自動テスト（`node tests/run.js`）と実機の確認リスト（`MANUAL.md`） |
| `tools/make-icons.js` | アイコンを作り直す（`node tools/make-icons.js`） |
| `gas/` | 自分の Google への控え係（Google Apps Script のウェブアプリ）と Claude のレビュー |
| `tools/gas.js` | GAS を作る・送る・公開する（clasp を使う。番号は `../private/gas-deploy.json` に置き、公開しない） |
| `SCHEMA.md` | データの形と、形を変える時の規則 |
| `CHANGELOG.md` | 変更の記録 |

## テスト

```
node tests/run.js
```

日本・ロサンゼルス・キリバスの3つのタイムゾーンで自動的に繰り返します（旅行中も日付がずれないことの確認）。

## リリースの手順

1. `node tests/run.js` がすべて成功する
2. `docs/core.js` の `APP_VERSION` と `docs/sw.js` の `VERSION` を同じ値に上げる（テストが一致を確かめる）
3. `CHANGELOG.md` に書く
4. commit して push（GitHub Pages に反映される）
5. スマホで「新しい版があります［更新する］」を押し、設定の版を確認する
6. `gas/` を変えた時は `node tools/gas.js deploy`（ウェブアプリの住所は変わらない）

## 控え係（GAS）

```
node tools/gas.js create   # 最初に1回（自分の Google に GAS のプロジェクトを作る）
node tools/gas.js deploy   # コードを送ってウェブアプリを新しい版に
```

その後、GAS のエディタで `setup`（最初に1回）→ `sendSetupCode`（設定コードをメールで受け取る）を実行する。
Claude の自動レビューを使う時は、スクリプト プロパティに `ANTHROPIC_API_KEY` を置く（コードやリポジトリには書かない）。

## 開発中に画面を見る

`../.claude/launch.json` の `dwz-pwa`（http://localhost:4610）。
テスト環境（github.io 以外）では `?today=2027-06-02` で日付を変えて試せます。
Service Worker は `?sw=1` を付けた時だけ動きます（開発中に古いファイルが返り続けないように）。
