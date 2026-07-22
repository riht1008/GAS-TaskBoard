import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panelsSource = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const userSpecSource = fs.readFileSync(new URL('../docs/02仕様書/13通知/ユーザー仕様.md', import.meta.url), 'utf8');

test('Slack mode descriptions stay product-focused and organization-neutral', () => {
  assert.match(panelsSource, /通知の文面と投稿先を、TaskBoardとSlackのどちらで管理するか/);
  assert.match(panelsSource, /通知の見た目をTaskBoard側で管理したい場合/);
  assert.match(panelsSource, /通知の見た目をSlack側で管理したい場合/);
  assert.doesNotMatch(panelsSource, /申請不要|社内申請|カスタムSlackアプリを作れない/);
  assert.doesNotMatch(userSpecSource, /申請不要|社内申請|カスタムSlackアプリを申請しにくい/);
});

test('Workflow guidance explains exact variable order, type, insertion, and URL flow', () => {
  assert.match(panelsSource, /title: 'ステータス変更Workflow'/);
  assert.match(panelsSource, /title: 'コメントメンションWorkflow'/);
  assert.match(panelsSource, /title: 'アサイン通知Workflow'/);
  assert.match(panelsSource, /\$\{h\(config\.title\)\}の作り方/);
  assert.match(panelsSource, /次の表の変数を上から順に追加/);
  assert.match(panelsSource, /送信処理上は順番に依存しません/);
  assert.match(panelsSource, /Slackの「変数を挿入」から同名の変数を選んでください/);
  assert.match(panelsSource, /「Slack通知設定を保存」→「接続テスト」/);
  assert.match(panelsSource, /name: 'mentioned_user_id', type: 'ユーザーID'/);
  assert.match(panelsSource, /name: 'assigned_user_id', type: 'ユーザーID'/);
  assert.match(panelsSource, /slack-message-example/);
  assert.match(panelsSource, /Slack公式のWebhook Workflow手順を開く/);
});

test('legacy Workflow notice explains current behavior and the complete migration action', () => {
  assert.match(panelsSource, /TaskBoard更新前に登録されたWorkflowで通知しています/);
  assert.match(panelsSource, /通知はそのまま続きます/);
  assert.match(panelsSource, /Slack側で下記の変数を登録したWorkflowを作成または更新/);
  assert.match(panelsSource, /Slackが発行したURLをこの欄に入力して保存/);
  assert.doesNotMatch(panelsSource, /以前の1変数方式|旧形式・再設定が必要/);
});
