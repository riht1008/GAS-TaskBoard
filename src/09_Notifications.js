/**
 * Slack notification helpers.
 */

var SLACK_WEBHOOK_KEY = 'SLACK_WEBHOOK_URL';
var SLACK_SETTINGS_KEY = 'SLACK_NOTIFICATION_SETTINGS';
var SLACK_DELIVERY_KEY = 'SLACK_DELIVERY_STATUS';

function buildStatusChangeNotification_(node, beforeColumn, afterColumn, actor, rows) {
  const beforeName = beforeColumn ? cleanString_(beforeColumn.Name) : '未設定';
  const afterName = afterColumn ? cleanString_(afterColumn.Name) : '未設定';
  const actorName = actor ? cleanString_(actor.Name) : '不明';
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrl_();
  const lines = [
    'タスクのステータスが変更されました',
    'タスク: ' + cleanString_(node.Name),
    path ? '親パス: ' + path : '',
    '変更: ' + beforeName + ' -> ' + afterName,
    '実行者: ' + actorName,
    webAppUrl ? 'URL: ' + webAppUrl : ''
  ].filter(Boolean);
  return {
    text: lines.join('\n'),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*タスクのステータスが変更されました*'
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*タスク*\n' + slackEscape_(cleanString_(node.Name)) },
          { type: 'mrkdwn', text: '*変更*\n' + slackEscape_(beforeName) + ' -> ' + slackEscape_(afterName) },
          { type: 'mrkdwn', text: '*実行者*\n' + slackEscape_(actorName) },
          { type: 'mrkdwn', text: '*親パス*\n' + slackEscape_(path || '-') }
        ]
      }
    ].concat(webAppUrl ? [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '<' + webAppUrl + '|Webアプリを開く>'
      }
    }] : [])
  };
}

function postToSlack_(payload, options) {
  options = options || {};
  const properties = PropertiesService.getScriptProperties();
  try {
    const settings = slackNotificationSettings_();
    const webhookUrl = properties.getProperty(SLACK_WEBHOOK_KEY);
    if ((!settings.statusChangeEnabled && options.force !== true) || !webhookUrl || !payload) {
      return { ok: true, skipped: true };
    }
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const responseCode = Number(response.getResponseCode()) || 0;
    const responseText = cleanString_(response.getContentText()).slice(0, 300);
    if (responseCode >= 200 && responseCode < 300) {
      recordSlackDelivery_({ ok: true, responseCode: responseCode, responseText: responseText });
      return { ok: true, responseCode: responseCode };
    }
    const message = slackDeliveryErrorMessage_(responseCode, responseText);
    recordSlackDelivery_({ ok: false, responseCode: responseCode, responseText: responseText, message: message });
    console.error('Slack notification failed (' + responseCode + '): ' + responseText);
    return { ok: false, responseCode: responseCode, message: message };
  } catch (error) {
    const message = 'Slackへの接続に失敗しました。タスクの保存は完了しています。';
    recordSlackDelivery_({ ok: false, responseCode: 0, responseText: cleanString_(error && error.message), message: message });
    console.error('Slack notification exception: ' + cleanString_(error && error.stack || error));
    return { ok: false, responseCode: 0, message: message };
  }
}

function getSlackSettings() {
  requireSchemaExists_();
  requireCurrentMember_();
  return { ok: true, slackSettings: publicSlackSettings_() };
}

function saveSlackSettings(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const properties = PropertiesService.getScriptProperties();
    const webhookUrl = cleanString_(payload.webhookUrl);
    if (webhookUrl && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\/-]+$/.test(webhookUrl)) {
      throw new Error('Slack Incoming Webhook URL の形式が正しくありません。');
    }
    if (webhookUrl) properties.setProperty(SLACK_WEBHOOK_KEY, webhookUrl);
    properties.setProperty(SLACK_SETTINGS_KEY, JSON.stringify({
      statusChangeEnabled: payload.statusChangeEnabled !== false
    }));
    return { ok: true, slackSettings: publicSlackSettings_() };
  });
}

function testSlackConnection() {
  requireSchemaExists_();
  const actor = requireCurrentMember_();
  const result = postToSlack_({
    text: 'GAS TaskBoard Slack接続テスト（実行者: ' + cleanString_(actor.Name) + '）'
  }, { force: true });
  if (!result || result.skipped) {
    return {
      ok: false,
      code: 'SLACK_NOT_CONFIGURED',
      message: 'Slack Webhookが未設定です。',
      slackSettings: publicSlackSettings_()
    };
  }
  return {
    ok: result.ok === true,
    code: result.ok ? '' : 'SLACK_DELIVERY_FAILED',
    message: result.ok ? 'Slackへテスト通知を送信しました。' : result.message,
    slackSettings: publicSlackSettings_()
  };
}

function disconnectSlack() {
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const properties = PropertiesService.getScriptProperties();
    properties.deleteProperty(SLACK_WEBHOOK_KEY);
    properties.deleteProperty(SLACK_DELIVERY_KEY);
    return { ok: true, slackSettings: publicSlackSettings_() };
  });
}

function slackNotificationSettings_() {
  const raw = PropertiesService.getScriptProperties().getProperty(SLACK_SETTINGS_KEY);
  try {
    const parsed = JSON.parse(raw || '{}');
    return { statusChangeEnabled: parsed.statusChangeEnabled !== false };
  } catch (error) {
    return { statusChangeEnabled: true };
  }
}

function publicSlackSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const webhookUrl = cleanString_(properties.getProperty(SLACK_WEBHOOK_KEY));
  const settings = slackNotificationSettings_();
  let delivery = {};
  try {
    delivery = JSON.parse(properties.getProperty(SLACK_DELIVERY_KEY) || '{}');
  } catch (error) {
    delivery = {};
  }
  return {
    configured: !!webhookUrl,
    maskedWebhookUrl: webhookUrl ? webhookUrl.slice(0, 34) + '••••••' : '',
    statusChangeEnabled: settings.statusChangeEnabled,
    lastSuccessAt: cleanString_(delivery.lastSuccessAt),
    lastErrorAt: cleanString_(delivery.lastErrorAt),
    lastError: cleanString_(delivery.lastError),
    lastResponseCode: Number(delivery.lastResponseCode) || 0
  };
}

function recordSlackDelivery_(result) {
  try {
    const properties = PropertiesService.getScriptProperties();
    let delivery = {};
    try {
      delivery = JSON.parse(properties.getProperty(SLACK_DELIVERY_KEY) || '{}');
    } catch (error) {
      delivery = {};
    }
    if (result.ok) {
      delivery.lastSuccessAt = nowIso_();
      delivery.lastError = '';
      delivery.lastErrorAt = '';
    } else {
      delivery.lastErrorAt = nowIso_();
      delivery.lastError = cleanString_(result.message || result.responseText).slice(0, 500);
    }
    delivery.lastResponseCode = Number(result.responseCode) || 0;
    properties.setProperty(SLACK_DELIVERY_KEY, JSON.stringify(delivery));
  } catch (error) {
    console.error('Slack delivery status recording failed: ' + cleanString_(error && error.message));
  }
}

function slackDeliveryErrorMessage_(responseCode, responseText) {
  if (responseCode === 404) return 'Slack Webhookが削除または無効化されています。再設定してください。';
  if (responseCode === 403) return 'Slack管理者の制限により投稿できません。';
  if (responseCode === 429) return 'Slackの送信制限に達しました。時間を置いて再試行してください。';
  if (responseText === 'channel_is_archived') return '通知先Slackチャンネルがアーカイブされています。';
  if (responseText === 'invalid_token' || responseText === 'no_active_hooks') return 'Slack連携が無効です。Webhookを再設定してください。';
  return 'Slack通知に失敗しました（HTTP ' + String(responseCode || 0) + '）。';
}

function parentPath_(node, activeNodes) {
  const nodesById = byId_(activeNodes, 'NodeId');
  const names = [];
  let current = node;
  const seen = {};
  while (current && cleanString_(current.ParentId)) {
    const parentId = cleanString_(current.ParentId);
    if (seen[parentId]) {
      break;
    }
    seen[parentId] = true;
    const parent = nodesById[parentId];
    if (!parent) {
      break;
    }
    names.unshift(cleanString_(parent.Name));
    current = parent;
  }
  return names.join(' > ');
}

function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    return '';
  }
}

function slackEscape_(value) {
  return cleanString_(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    slackDeliveryErrorMessage_: slackDeliveryErrorMessage_
  };
}
