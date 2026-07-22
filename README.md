# GAS タスク管理アプリ

Google スプレッドシートにコンテナバインドして使う、社内向けタスク管理 Web アプリです。
仕様は `docs/01要件定義・設計/要件定義書.md` と `docs/01要件定義・設計/基本設計書.md` を正とし、実装時の判断事項だけをここに残します。
機能別の操作仕様・技術仕様は `docs/02仕様書/README.md` に整理しています。

## 構成

- `src/Code.js`: Webエントリ、初期ロード、初回セットアップ、テンプレートinclude。
- `src/00_Config.js` から `src/13_AgentApi.js`: GAS サーバーサイドを設定、API、依存関係、ペイロード、シートI/O、検証、汎用関数、Slack通知、WBS出力、アプリ内通知、AIエージェント向け読み取りAPIへ分割。
- `src/Index.html`: HTML Service のシェル。CSS/JSはテンプレートincludeで読み込む。
- `src/Styles.html`: UIスタイル。
- `src/Client*.html`: Vanilla JavaScript UI。看板、ガント、リスト、詳細ドロワー、メンバー管理、保存キューを役割別に分割。
- `src/appsscript.json`: V8 ランタイムと Web アプリ前提のマニフェスト。
- `.clasp.json`: `rootDir` を `src` に設定し、`clasp push` の対象ルートをソース配下に限定。
- `.claspignore`: `clasp push` 時に GAS へ送るファイルを `src` 配下の実装ファイルだけに限定。
- `tests/*.test.mjs`: WBSモデル・切替、初期化再開、シートスキーマ、ノード木整合性、派生値等価性、親ステータスロールアップ、依存関係、削除復元、保存キュー、コメントページング、Slack通知テンプレート・メンション通知・エラー変換のローカル検証。

## セットアップ

1. `.example.clasp.json` を `.clasp.json` としてコピーし、`scriptId` を対象の GAS プロジェクトIDに書き換える。`.clasp.json` は `.gitignore` 対象でリモートには push されない。
2. 対象スプレッドシートにこの GAS プロジェクトをコンテナバインドする。
3. `clasp push` で `src/` 配下のGAS/HTML/マニフェストを反映する。
4. Web アプリとしてデプロイする。
   - 実行ユーザー: アクセスしたユーザー
   - アクセスできるユーザー: 同一 Google Workspace ドメイン
5. 初回アクセス時に案件名を入力すると、ルートノード、初期ステータス列、最初のメンバーが一括作成される。

## 実装判断

- 名称は 200 文字以内。
- 説明欄は 12000 文字以内、コメントは 4000 文字以内。
- PC 利用前提の最小表示幅は 1080px。
- 依存関係の追加・削除 UI は詳細モーダル内に配置。
- 削除直後はトーストの「元に戻す」から、同じ削除操作で消えたサブツリーを復元する。
- コメント編集・削除は今回スコープ外。Commentsの追加列は `ParentCommentId` / `Mentions` まで。

## Slack通知

ステータス変更、コメントメンション、新しい担当者へのアサインのSlack通知は、Slackアプリ方式（Incoming Webhook）とWorkflow Builder方式から選べます。アサイン通知は初期状態でOFFです。

1. Webアプリの「プロジェクト設定」→「Slack通知」で通知方式を選びます。
2. Slackアプリ方式はIncoming Webhookを1本、Workflow Builder方式はONにする通知に応じてステータス用、メンション用、アサイン用のWebhookを最大3本作り、対応するURLを入力します。
3. Workflow Builder方式では画面に表示されたフラット変数をSlackへ追加し、`mentioned_user_id` と `assigned_user_id` をユーザーID型にします。単一の `{text}` 変数は使いません。
4. `clasp push` 後、Webアプリを開いて初回の再認可を行います。`UrlFetchApp` 追加により、利用者ごとに1回だけ再認可が必要です。

同画面で3種類の通知の個別ON/OFF、用途別の接続テスト、最終配信状態の確認、方式別の連携解除ができます。Slackアプリ方式では各送信文面の編集とデフォルト復元もできます。Webhook URL本体は保存後にブラウザへ返しませんが、設定済み状態と固定マスクを常時表示します。未設定または無効でもタスク保存・コメント保存は成功します。

Slack通知内のTaskBoard URLは対象タスクへのディープリンクです。コメントメンションは該当コメントまで開きます。アプリ内通知一覧は30秒間のメモリキャッシュを使い、期限後も一覧を消さずバックグラウンドで更新します。

## アプリ内通知

トップバーのベルに自分宛のコメントメンションを表示します。バッジは未読数で、通知カードの選択で対象タスクと該当コメントを開いた後に既読になります。カードのメニューと上部ボタンから、単件または一括で既読にできます。

## AIエージェント連携

[taskboard-agent-toolkit](https://github.com/riht1008/taskboard-agent-toolkit)を使うと、Claude Code、Cursor、GitHub Copilot、CodexなどのローカルAIエージェントからMCPまたはCLIでタスクを参照・追加・更新・コメント投稿できます。

標準のbrowser transportは既存Webアプリを専用Chromeプロファイルで開き、`google.script.run`から本リポジトリの`agentGetContext`、`addNode`、`saveNode`、`addComment`を呼びます。新しいGoogle Cloudプロジェクトや独自OAuthクライアントは不要で、既存Webアプリと同じログインユーザー識別・ロック・競合検知を維持します。

```bash
taskboard connect --web-app-url "https://script.google.com/macros/s/.../exec"
taskboard doctor
```

## パフォーマンス方針

- 2026-07-02以降、操作体験はローカルファーストの楽観的更新を基本とする。
- ノード追加・編集・削除、ステータス列、メンバー、コメント、依存関係は、ブラウザ上の状態を先に更新し、スプレッドシート保存はバックグラウンドで確定する。
- スプレッドシート保存が失敗した場合は、可能な範囲で該当操作だけをロールバックし、トーストで通知する。
- スプレッドシートは引き続き正本であり、トップバーの同期ピルによる最新確認や保存応答によりローカル状態を正本へ収束させる。
- Nodesへ波及し得る保存はクライアント全体で1本の保存キューへ直列化し、応答に含まれた全ノードへ後続のoptimistic patchを重ね直す。CommentsなどNodesへ波及しない操作はスコープ別バックグラウンドキューで保存順を保つ。

## 検証

```bash
node --test tests/*.test.mjs
clasp push
```

ローカルでは GAS API 自体は実行できないため、Apps Script 固有部分は `clasp push` 後に Web アプリ上で確認してください。

## コード統計

`main` への push 時に GitHub Actions (`.github/workflows/analyze-code.yml`) が自動更新します。

<!-- LANGUAGES BREAKDOWN START -->
```
[ LANGUAGES BREAKDOWN ]

HTML         --> 11,901 lines
JavaScript   --> 8,545 lines

[ TOTAL LINES OF CODE: 20,446 ]
```
<!-- LANGUAGES BREAKDOWN END -->
