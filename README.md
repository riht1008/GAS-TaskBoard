# GAS タスク管理アプリ

Google スプレッドシートにコンテナバインドして使う、社内向けタスク管理 Web アプリです。
仕様は `docs/01要件定義・設計/要件定義書.md` と `docs/01要件定義・設計/基本設計書.md` を正とし、実装時の判断事項だけをここに残します。
機能別の操作仕様・技術仕様は `docs/02仕様書/README.md` に整理しています。

## 構成

- `src/Code.gs`: Webエントリ、初期ロード、初回セットアップ、テンプレートinclude。
- `src/00_Config.js` から `src/09_Notifications.js`: GAS サーバーサイドを設定、API、依存関係、ペイロード、シートI/O、検証、汎用関数、通知へ分割。
- `src/Index.html`: HTML Service のシェル。CSS/JSはテンプレートincludeで読み込む。
- `src/Styles.html`: UIスタイル。
- `src/Client*.html`: Vanilla JavaScript UI。看板、ガント、リスト、詳細ドロワー、メンバー管理、保存キューを役割別に分割。
- `src/appsscript.json`: V8 ランタイムと Web アプリ前提のマニフェスト。
- `.clasp.json`: `rootDir` を `src` に設定し、`clasp push` の対象ルートをソース配下に限定。
- `.claspignore`: `clasp push` 時に GAS へ送るファイルを `src` 配下の実装ファイルだけに限定。
- `tests/*.test.mjs`: WBSモデル、親ステータスロールアップ、依存関係リスケジュールのローカル検証。

## セットアップ

1. 対象スプレッドシートにこの GAS プロジェクトをコンテナバインドする。
2. `clasp push` で `src/` 配下のGAS/HTML/マニフェストを反映する。
3. Web アプリとしてデプロイする。
   - 実行ユーザー: アクセスしたユーザー
   - アクセスできるユーザー: 同一 Google Workspace ドメイン
4. 初回アクセス時に案件名を入力すると、ルートノード、初期ステータス列、最初のメンバーが一括作成される。

## 実装判断

- 名称は 200 文字以内。
- 説明欄は 12000 文字以内、コメントは 4000 文字以内。
- PC 利用前提の最小表示幅は 1080px。
- 依存関係の追加・削除 UI は詳細モーダル内に配置。
- 削除済みノードの復元 UI は実装せず、スプレッドシートの変更履歴で復旧する運用。
- コメント編集・削除は今回スコープ外。Commentsの追加列は `ParentCommentId` / `Mentions` まで。

## Slack通知

ステータス変更時のSlack通知を使う場合は、SlackのIncoming Webhook URLをScript Propertiesへ設定します。

1. SlackでIncoming Webhookを発行し、投稿先チャンネルを選びます。
2. Apps Scriptエディタの「プロジェクトの設定」から Script Properties に `SLACK_WEBHOOK_URL` を追加し、Webhook URLを保存します。
3. `clasp push` 後、Webアプリを開いて初回の再認可を行います。`UrlFetchApp` 追加により、利用者ごとに1回だけ再認可が必要です。

`SLACK_WEBHOOK_URL` が未設定の場合、通知処理はスキップされ、保存操作の挙動は変わりません。Webhook URLが無効でも保存は成功します。

## パフォーマンス方針

- 2026-07-02以降、操作体験はローカルファーストの楽観的更新を基本とする。
- ノード追加・編集・削除、ステータス列、メンバー、コメント、依存関係は、ブラウザ上の状態を先に更新し、スプレッドシート保存はバックグラウンドで確定する。
- スプレッドシート保存が失敗した場合は、可能な範囲で該当操作だけをロールバックし、トーストで通知する。
- スプレッドシートは引き続き正本であり、強制同期や保存応答によりローカル状態を正本へ収束させる。
- Nodes系の連続保存はNodeId単位の保存キューで直列化し、requestIdで古い応答を破棄する。StatusColumns / Members / Dependencies / Comments はバックグラウンドキューで保存順を保つ。

## 検証

```bash
node --test tests/*.test.mjs
clasp push
```

ローカルでは GAS API 自体は実行できないため、Apps Script 固有部分は `clasp push` 後に Web アプリ上で確認してください。
