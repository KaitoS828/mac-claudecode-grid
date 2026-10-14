<p align="center">
  <img src="public/logo.svg" width="72" height="72" alt="CC Grid ロゴ">
</p>

<h1 align="center">mac-claudecode-grid</h1>

<p align="center">
  <b>複数の Claude Code を&nbsp;&nbsp;|&nbsp;&nbsp;1つのブラウザタブで&nbsp;&nbsp;|&nbsp;&nbsp;承認はスマホから</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jsbbshsahs-beep/mac-claudecode-grid?style=flat-square&labelColor=16181d&color=2ea44f" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-2ea44f?style=flat-square&labelColor=16181d" alt="Node.js 18以上">
  <img src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-2ea44f?style=flat-square&labelColor=16181d" alt="macOS と Linux">
  <a href="https://github.com/jsbbshsahs-beep/mac-claudecode-grid/stargazers"><img src="https://img.shields.io/github/stars/jsbbshsahs-beep/mac-claudecode-grid?style=flat-square&logo=github&labelColor=16181d&color=2ea44f" alt="Stars"></a>
</p>

<p align="center">
  <a href="#クイックスタート">クイックスタート</a> · <a href="#機能">機能</a> · <a href="#使い方">使い方</a> · <a href="#リモートモードスマホ">リモートモード</a> · <a href="#faq">FAQ</a> · <a href="docs/reference.md">リファレンス(英語)</a> · <a href="README.md">English</a>
</p>

> **非公式**: CC Grid は個人による非公式プロジェクトで、Anthropic社とは無関係です。「Claude」「Claude Code」はAnthropic社の商標です。無保証・自己責任でご利用ください。

複数の [Claude Code](https://claude.com/claude-code) セッションを、ブラウザ上のグリッドに並べて動かすダッシュボードです。どのセッションが作業中で、どれがあなたの返事を待っていて、トークンをどれだけ使ったかが一目で分かります。許可を求めて止まったセッションには、スマホから答えられます。

```bash
git clone https://github.com/jsbbshsahs-beep/mac-claudecode-grid.git
cd mac-claudecode-grid && npm install && npm start
# http://127.0.0.1:3032 を開く
```

## ターミナルを複数開くのとの違い

ターミナルを複数開いても使えます。ただ、4つ動かして1つが20分前から「yes」を待っていたり、2つが同じファイルを書き換えたりすると困ります。CC Grid はこの2つの問題を中心に作られています。

| | ターミナルを別々に開く | CC Grid |
| :--- | :--- | :--- |
| 自分の返事を待っているのは？ | 全ウィンドウを順に確認 | 入力待ちのパネルが強調表示される |
| 同じフォルダで2セッション | 何も警告されない | 警告バッジが出る。worktree で回避もできる |
| セッションごとのトークン量 | それぞれで `/cost` を実行 | 会話ログから合計してリアルタイム表示 |
| PC を再起動したら | 手作業で全部開き直す | レイアウトから `claude --resume` で一括復元 |
| 席を外している間の許可確認 | 戻るまで待つ | 同じ LAN のスマホから返答 |
| 「あれ、どこでやったっけ？」 | スクロールして探す | 過去の会話とコミットを全文検索 |

## 機能

**セッション**

- 1つのタブで複数の `claude` を実行。各パネルは `node-pty` + xterm.js の本物のターミナルです。
- サーバーを再起動してもセッションが残り、`claude --resume <session-id>` で再開します。閉じたパネルは15秒間なら元に戻せます。
- プロジェクトのルート配下の任意のフォルダ、または絶対パスで開始できます。
- セッションごとに **git worktree** を作成可能（`git worktree add -b grid/...`）。並列セッションが同じファイルを触りません。
- パネルはドラッグで並べ替え。ファイル（50MBまで）をアップロードすると、そのパスがセッションに渡されます。

**モニタリング**

- セッションごとの状態（作業中・待機・入力待ち）を画面の文字から判定。
- `~/.claude/projects` のログからトークン使用量（入力・出力・キャッシュ読み取り）を集計。
- ステータスライン（使用量バー・コンテキスト・モデル）をパネルの横に表示。
- セッションごとの**確認コマンド**: `npm test` などを保存し、パネルから実行して 実行中 / OK / NG を確認。
- 各セッションのフォルダの git diff ビューア。

**履歴とレイアウト**

- 過去の会話と、プロジェクト内の `git log` のメッセージを全文検索。
- 開いているパネルを名前付き**レイアウト**として保存し、あとで復元。すでに動いているセッションはスキップされます。

**スマホ・LAN**

- リモートモードで、承認用の簡易ページ `/m` を提供。トークン保護、プライベートIPのみ、監査ログ付き。

## 動作環境

- Node.js 18 以上
- [Claude Code](https://claude.com/claude-code) がインストールされ、`claude` が `PATH` にあること
- macOS または Linux
- `git`（worktree・diff ビューア・コミット検索を使う場合のみ）

`node-pty` は主要なプラットフォーム向けのビルド済みバイナリを同梱しています。合うものが無い場合は `npm install` 時にコンパイルされ、C++ ツールチェーンが必要です。

## クイックスタート

```bash
git clone https://github.com/jsbbshsahs-beep/mac-claudecode-grid.git
cd mac-claudecode-grid
npm install
npm start
```

http://127.0.0.1:3032 を開きます。ほかの設定は不要です。

<details>
<summary>ポートやプロジェクトのフォルダを変える</summary>

```bash
CC_GRID_PORT=4000 CC_GRID_ROOTS="$HOME/work:$HOME/oss" npm start
```

すべての変数は[設定](#設定環境変数)にあります。

</details>

## 使い方

1. **セッションを追加する。** 一覧（`CC_GRID_ROOTS` 配下の全フォルダとホームディレクトリ）からフォルダを選び、必要なら名前を付けます。独立したブランチで作業したいときは worktree にチェックを入れます。
2. **パネルで作業する。** 普通のターミナルです。`claude --session-id <uuid>`（復元時は `claude --resume <uuid>`）は CC Grid が自動で入力します。
3. **グリッドを見る。** 返事が必要なパネルは強調表示されます。トークン数とステータスラインはリアルタイムで更新されます。
4. **確認コマンドを設定する。** パネルに `npm test` などを設定すると、好きなときに合否を確認できます。
5. **レイアウトを保存する。** 終了前に保存しておくと、あとで各パネルを元のセッションのまま復元できます。
6. **検索する。** 「どこでやったか思い出せない」ときは、過去の会話とコミットを検索します。

パネルを閉じると15秒間ゴミ箱に入り、その後プロセスが終了します。その間なら元に戻せます。

## リモートモード（スマホ）

```bash
npm run start:remote
```

起動時にワンタイムトークン付きの URL が表示されます。同じネットワークのスマホで開くと、トークンが Cookie に保存されます。そのあと `/m` を開くと承認画面になります。

| リモートからできること | リモートからできないこと |
| :--- | :--- |
| セッション一覧・状態・伏せ字処理した画面末尾の確認 | 「今後は確認しない」系の選択肢の選択（サーバーが拒否） |
| 番号付きの確認への返答、Esc | 公開IPアドレスからの接続 |

返答は、そのとき画面に出ていた確認のフィンガープリントと照合されます。古い画面のままタップしても、新しい確認に誤って答えることはなく、拒否されます。すべての操作は `.audit.log` に記録されます。

> **有効にする前に [SECURITY.md](SECURITY.md) を読んでください。** このサーバーは、トークンを持つ人にシェルの操作権限を与えます。LAN の外から使うときは Tailscale などの VPN を使い、ポート転送は絶対にしないでください。

## 設定（環境変数）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `CC_GRID_PORT` | `3032` | ポート |
| `CC_GRID_ROOTS` | `~/dev` | プロジェクト候補のルート（複数は `:` 区切り） |
| `CC_GRID_WORKTREES` | `~/.cc-grid/worktrees` | worktree の作成先 |
| `CC_GRID_REMOTE` | 未設定 | `1` でリモート(LAN)モード |
| `CC_GRID_BIND` | `0.0.0.0` | リモートモードの bind アドレス。ローカルモードは常に `127.0.0.1` |

## FAQ

<details>
<summary><b>コードや会話はどこかに送信されますか？</b></summary>

いいえ。CC Grid はローカルの Node.js サーバーで、手元の `~/.claude/projects` を読むだけで、ほかには通信しません。Claude Code 自体は、いつもどおり Anthropic と通信します。

</details>

<details>
<summary><b>API キーは必要ですか？</b></summary>

不要です。CC Grid はすでにある `claude` コマンドを起動するだけで、Claude Code と同じログインを使います。

</details>

<details>
<summary><b>起動したままで安全ですか？</b></summary>

ローカルモードは `127.0.0.1` のみに bind するので、同じ PC 上のプログラムだけが接続できます。ただし接続できる相手にはシェルの操作権限を与えるため、リバースプロキシの背後に置いたり、ポート転送したりしないでください。[SECURITY.md](SECURITY.md) を参照してください。

</details>

<details>
<summary><b>パネルがすぐ閉じる、<code>posix_spawnp failed</code> と出る</b></summary>

`node-pty` のヘルパーの実行権限が外れています。もう一度 `npm install` を実行するか（`postinstall` が権限を戻します）、`chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` を実行してください。

</details>

<details>
<summary><b>パネルで <code>claude: command not found</code> と出る</b></summary>

各パネルはログインシェル（`$SHELL -l`）で起動します。そのため `claude` は、CC Grid を起動したターミナルではなく、シェルのプロファイルが設定する `PATH` に入っている必要があります。

</details>

<details>
<summary><b>「入力待ち」が表示されない</b></summary>

検出は Claude Code の画面の文言を読んで行っています。Claude Code の更新で文言が変わった可能性があります。[既知の制限](#既知の制限)を参照してください。

</details>

<details>
<summary><b>スマホから接続できない</b></summary>

`npm run start:remote` で起動し、スマホが同じネットワークにあることを確認してください。初回はトークン付きの完全な URL を開く必要があります。公開IPアドレスからは常に拒否されます。

</details>

<details>
<summary><b>Windows で動きますか？</b></summary>

非対応です。パネルは `$SHELL -l` を実行し、動作確認は macOS と Linux のみです。

</details>

## 仕組み

- **サーバー**（`server.js`）: 素の `http` と `ws` を使う Node.js の単一プロセス。各セッションは `node-pty` で起動したログインシェルで、その中で `claude` を実行します。
- **画面モデル**: `@xterm/headless` で各 PTY を写し取り、ブラウザが無くてもサーバーが画面の内容を読めます。
- **状態判定**（`lib/parse.js`）: その画面から、ステータスライン・使用量バー・番号付きの許可プロンプトを読み取ります。
- **トークン使用量**: `~/.claude/projects` の JSONL 会話ログを走査して集計します。
- **UI**（`public/index.html`）: xterm.js とその fit アドオンを使う素の JavaScript。`public/m.html` がスマホ用画面です。

HTTP API とディスクに書き込まれるファイルは[リファレンス](docs/reference.md)（英語）にまとめています。

## 開発

```bash
npm install
npm start          # http://127.0.0.1:3032
npm test           # node --test
```

テストは画面の解析処理とサーバーの基本動作を対象にしています。進め方は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 既知の制限

「入力待ち」や許可プロンプトの検出は、Claude Code が表示する画面の文言（`to interrupt`、`Esc to cancel` 付きの番号付き選択肢、ステータス行）を読み取って行っています。Claude Code の更新で文言が変わると、検出が壊れる可能性があります。解析処理は [`lib/parse.js`](lib/parse.js) にあり、`npm test` で確認できます。

そのほかの制限:

- UI は日本語のみです。
- Windows は非対応です。
- ローカルモードにはログインがありません。ループバックへの bind に頼っています。

## セキュリティ

CC Grid はシェルを公開します。ローカルモードは `127.0.0.1` のみに bind します。リモートモードでは、ワンタイムトークン・プライベートIPの確認・伏せ字処理・監査ログが加わります。詳細と脆弱性の報告方法は [SECURITY.md](SECURITY.md) にあります。

## ライセンス

[MIT](LICENSE)
