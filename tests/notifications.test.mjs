import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.unique_ = values => Array.from(new Set(values));

const require = createRequire(import.meta.url);
const {
  SLACK_DEFAULT_STATUS_TEMPLATE,
  SLACK_DEFAULT_MENTION_TEMPLATE,
  SLACK_STATUS_TEMPLATE_KEYS,
  SLACK_MENTION_TEMPLATE_KEYS,
  slackMentionedUsers_,
  slackWebhookType_,
  slackRequestPayload_,
  slackWorkflowRequestPayloads_,
  maskedSlackWebhook_,
  normalizeSlackTemplate_,
  renderSlackTemplate_,
  saveSlackSettings,
  slackNotificationSettings_,
  slackNotificationEnabled_,
  slackDeliveryErrorMessage_
} = require('../src/09_Notifications.js');

test('Slack delivery errors are translated into actionable messages', () => {
  assert.match(slackDeliveryErrorMessage_(404, ''), /削除または無効/);
  assert.match(slackDeliveryErrorMessage_(429, ''), /送信制限/);
  assert.match(slackDeliveryErrorMessage_(400, 'channel_is_archived'), /アーカイブ/);
});

test('Slack templates provide defaults and interpolate only supported placeholders', () => {
  const status = renderSlackTemplate_(SLACK_DEFAULT_STATUS_TEMPLATE, {
    taskName: '設計レビュー',
    parentPath: '案件 > UI',
    beforeStatus: '未着手',
    afterStatus: '進行中',
    actorName: '鈴木',
    webAppUrl: 'https://example.test/app'
  }, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS);
  assert.match(status, /設計レビュー/);
  assert.match(status, /未着手 → 進行中/);

  const mention = renderSlackTemplate_(SLACK_DEFAULT_MENTION_TEMPLATE, {
    taskName: '仕様確認',
    parentPath: '案件',
    mentionedUsers: '<@U012AB3CD>, 佐藤',
    mentionedNames: '田中, 佐藤',
    actorName: '鈴木',
    commentText: '<!channel> 確認してください',
    webAppUrl: 'https://example.test/app'
  }, SLACK_DEFAULT_MENTION_TEMPLATE, SLACK_MENTION_TEMPLATE_KEYS);
  assert.match(mention, /<@U012AB3CD>, 佐藤/);
  assert.match(mention, /&lt;!channel&gt;/);
});

test('Slack mention labels notify mapped users and safely fall back to names', () => {
  assert.equal(slackMentionedUsers_([
    { Name: '田中', SlackUserId: 'u012ab3cd' },
    { Name: '<!channel> 佐藤', SlackUserId: '' }
  ]), '<@U012AB3CD>, &lt;!channel&gt; 佐藤');
});

test('Slack webhook variants use the payload shape expected by each endpoint', () => {
  const incomingUrl = 'https://hooks.slack.com/services/T/B/X';
  const workflowUrl = 'https://hooks.slack.com/triggers/T/B/X';
  const payload = { text: '通知', blocks: [{ type: 'section' }] };
  assert.equal(slackWebhookType_(incomingUrl), 'incoming');
  assert.equal(slackWebhookType_(workflowUrl), 'workflow');
  assert.equal(slackWebhookType_('https://example.test/hook'), '');
  assert.deepEqual(slackRequestPayload_(incomingUrl, payload), payload);
  assert.deepEqual(slackRequestPayload_(workflowUrl, payload), { text: '通知' });
  assert.equal(maskedSlackWebhook_(incomingUrl), 'https://hooks.slack.com/services/••••••');
  assert.doesNotMatch(maskedSlackWebhook_(incomingUrl), /\/T\/B\/X$/);
});

test('Workflow Builder receives flat variables and one mention request per Slack member', () => {
  const statusPayloads = slackWorkflowRequestPayloads_({
    text: 'legacy text',
    workflow: {
      type: 'status',
      fields: {
        notification_title: 'ステータス変更',
        task_name: '設計',
        parent_path: '案件 > UI',
        before_status: '未着手',
        after_status: '進行中',
        actor_name: '鈴木',
        web_app_url: 'https://example.test/app'
      }
    }
  }, 'status', false);
  assert.deepEqual(statusPayloads, [{
    notification_title: 'ステータス変更',
    task_name: '設計',
    parent_path: '案件 &gt; UI',
    before_status: '未着手',
    after_status: '進行中',
    actor_name: '鈴木',
    web_app_url: 'https://example.test/app'
  }]);

  const mentionPayloads = slackWorkflowRequestPayloads_({
    text: 'legacy mention',
    workflow: {
      type: 'mention',
      fields: {
        notification_title: 'メンション',
        task_name: '確認',
        parent_path: '案件',
        actor_name: '田中',
        comment_text: '<!channel> お願いします',
        web_app_url: 'https://example.test/app'
      },
      recipients: [
        { slackUserId: 'U012ABC', name: '鈴木' },
        { slackUserId: 'W987XYZ', name: '佐藤' }
      ]
    }
  }, 'mention', false);
  assert.equal(mentionPayloads.length, 2);
  assert.equal(mentionPayloads[0].mentioned_user_id, 'U012ABC');
  assert.equal(mentionPayloads[1].mentioned_user_id, 'W987XYZ');
  assert.equal(mentionPayloads[0].comment_text, '&lt;!channel&gt; お願いします');
  assert.deepEqual(slackWorkflowRequestPayloads_({ text: '旧形式' }, 'status', true), [{ text: '旧形式' }]);
});

test('Slack settings reject unknown template placeholders', () => {
  assert.throws(() => normalizeSlackTemplate_(
    'タスク: {unknownField}',
    SLACK_DEFAULT_STATUS_TEMPLATE,
    SLACK_STATUS_TEMPLATE_KEYS,
    true
  ), /未対応/);
});

test('Slack notification choices independently control status and mention delivery', () => {
  const settings = { statusChangeEnabled: true, mentionEnabled: false };
  assert.equal(slackNotificationEnabled_(settings, { type: 'status' }), true);
  assert.equal(slackNotificationEnabled_(settings, { type: 'mention' }), false);
  assert.equal(slackNotificationEnabled_(settings, { type: 'mention', force: true }), true);
});

test('Slack settings persist independent choices and editable templates with legacy-safe defaults', () => {
  const values = new Map();
  const properties = {
    getProperty: key => values.get(key) || '',
    setProperty: (key, value) => values.set(key, value),
    deleteProperty: key => values.delete(key)
  };
  global.PropertiesService = { getScriptProperties: () => properties };
  global.withLock_ = callback => callback();
  global.requireSchemaExists_ = () => {};
  global.requireCurrentMember_ = () => ({ MemberId: 'm1' });

  const initial = slackNotificationSettings_();
  assert.equal(initial.statusChangeEnabled, true);
  assert.equal(initial.mentionEnabled, false);
  assert.equal(initial.statusTemplate, SLACK_DEFAULT_STATUS_TEMPLATE);
  assert.equal(initial.mentionTemplate, SLACK_DEFAULT_MENTION_TEMPLATE);

  values.set('SLACK_NOTIFICATION_SETTINGS', JSON.stringify({
    mentionEnabled: true,
    mentionTemplate: '旧設定の宛先: {mentionedNames}'
  }));
  assert.equal(slackNotificationSettings_().mentionTemplate, '旧設定の宛先: {mentionedUsers}');
  values.delete('SLACK_NOTIFICATION_SETTINGS');

  const result = saveSlackSettings({
    webhookUrl: 'https://hooks.slack.com/services/T/B/X',
    statusChangeEnabled: false,
    mentionEnabled: true,
    statusTemplate: '変更: {taskName}',
    mentionTemplate: '宛先: {mentionedNames}\n{commentText}'
  });

  assert.equal(result.slackSettings.configured, true);
  assert.equal(result.slackSettings.statusChangeEnabled, false);
  assert.equal(result.slackSettings.mentionEnabled, true);
  assert.equal(result.slackSettings.statusTemplate, '変更: {taskName}');
  assert.equal(result.slackSettings.mentionTemplate, '宛先: {mentionedNames}\n{commentText}');
  assert.doesNotMatch(result.slackSettings.maskedWebhookUrl, /\/T\/B\/X$/);

  const workflowResult = saveSlackSettings({
    webhookUrl: 'https://hooks.slack.com/triggers/T/B/X'
  });
  assert.equal(workflowResult.slackSettings.webhookType, 'workflow');
  assert.equal(workflowResult.slackSettings.workflowStatusLegacy, true);
  assert.equal(workflowResult.slackSettings.workflowMentionLegacy, true);

  const splitWorkflowResult = saveSlackSettings({
    deliveryMode: 'workflow',
    workflowStatusWebhookUrl: 'https://hooks.slack.com/triggers/T/B/STATUS',
    workflowMentionWebhookUrl: 'https://hooks.slack.com/triggers/T/B/MENTION',
    statusChangeEnabled: true,
    mentionEnabled: true
  });
  assert.equal(splitWorkflowResult.slackSettings.deliveryMode, 'workflow');
  assert.equal(splitWorkflowResult.slackSettings.workflowStatusConfigured, true);
  assert.equal(splitWorkflowResult.slackSettings.workflowMentionConfigured, true);
  assert.equal(splitWorkflowResult.slackSettings.workflowStatusLegacy, false);
  assert.equal(splitWorkflowResult.slackSettings.workflowMentionLegacy, false);
  assert.doesNotMatch(splitWorkflowResult.slackSettings.maskedWorkflowStatusWebhookUrl, /STATUS/);
  assert.throws(() => saveSlackSettings({ webhookUrl: 'https://example.test/hook' }), /形式/);
});
