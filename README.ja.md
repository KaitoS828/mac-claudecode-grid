# mac-claudecode-grid

> **非公式**: CC Grid は個人による非公式プロジェクトで、Anthropic社とは無関係です。「Claude」「Claude Code」はAnthropic社の商標です。無保証・自己責任でご利用ください。

複数の [Claude Code](https://claude.com/claude-code) セッションをブラウザ上のグリッドで並べて動かすダッシュボードです。稼働状況・トークン使用量・履歴検索・スマホ用リモート表示に対応しています。

## 使い方

```bash
npm install
npm start
```

http://127.0.0.1:3032 を開きます。

## 設定（環境変数）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `CC_GRID_PORT` | `3032` | ポート |
| `CC_GRID_ROOTS` | `~/dev` | プロジェクト候補のルート（複数は `:` 区切り） |
| `CC_GRID_WORKTREES` | `~/.cc-grid/worktrees` | worktree の作成先 |
| `CC_GRID_REMOTE` | 未設定 | `1` でリモート(LAN)モード |
| `CC_GRID_BIND` | `0.0.0.0` | リモートモードの bind アドレス |

リモートモードを使う前に [SECURITY.md](SECURITY.md) を必ず読んでください。

## 既知の制限

「入力待ち」や許可プロンプトの検出は、Claude Code が表示する画面の文言（`to interrupt`、`Esc to cancel` 付きの番号付き選択肢、ステータス行）を読み取って行っています。Claude Code の更新で文言が変わると、検出が壊れる可能性があります。解析処理は [`lib/parse.js`](lib/parse.js) にあり、`npm test` で確認できます。

## ライセンス

[MIT](LICENSE)
