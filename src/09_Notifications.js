/**
 * Slack notification helpers.
 */

var SLACK_WEBHOOK_KEY = 'SLACK_WEBHOOK_URL';
var SLACK_SETTINGS_KEY = 'SLACK_NOTIFICATION_SETTINGS';
var SLACK_DELIVERY_KEY = 'SLACK_DELIVERY_STATUS';
var SLACK_TEMPLATE_MAX_LENGTH = 2000;
var SLACK_RENDERED_MESSAGE_MAX_LENGTH = 3000;
var SLACK_COMMENT_EXCERPT_MAX_LENGTH = 1200;
var SLACK_STATUS_TEMPLATE_KEYS = ['taskName', 'parentPath', 'beforeStatus', 'afterStatus', 'actorName', 'webAppUrl'];
var SLACK_MENTION_TEMPLATE_KEYS = ['taskName', 'parentPath', 'mentionedUsers', 'mentionedNames', 'actorName', 'commentText', 'webAppUrl'];
var SLACK_DEFAULT_STATUS_TEMPLATE = [
  '*タスクのステータスが変更されました*',
  '*タスク*: {taskName}',
  '*親パス*: {parentPath}',
  '*変更*: {beforeStatus} → {afterStatus}',
  '*実行者*: {actorName}',
  '*Webアプリ*: {webAppUrl}'
].join('\n');
var SLACK_DEFAULT_MENTION_TEMPLATE = [
  '*コメントでメンションされました*',
  '*タスク*: {taskName}',
  '*親パス*: {parentPath}',
  '*メンション対象*: {mentionedUsers}',
  '*投稿者*: {actorName}',
  '*コメント*',
  '{commentText}',
  '*Webアプリ*: {webAppUrl}'
].join('\n');

function buildStatusChangeNotification_(node, beforeColumn, afterColumn, actor, rows) {
  const beforeName = beforeColumn ? cleanString_(beforeColumn.Name) : '未設定';
  const afterName = afterColumn ? cleanString_(afterColumn.Name) : '未設定';
  const actorName = actor ? cleanString_(actor.Name) : '不明';
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrl_();
  const settings = slackNotificationSettings_();
  return buildSlackTemplatePayload_(settings.statusTemplate, {
    taskName: cleanString_(node.Name),
    parentPath: path || '-',
    beforeStatus: beforeName,
    afterStatus: afterName,
    actorName: actorName,
    webAppUrl: webAppUrl || '-'
  }, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS);
}

function buildMentionNotification_(node, comment, actor, mentionedMembers, rows) {
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrl_();
  const settings = slackNotificationSettings_();
  return buildSlackTemplatePayload_(settings.mentionTemplate, {
    taskName: cleanString_(node.Name),
    parentPath: path || '-',
    mentionedUsers: slackMentionedUsers_(mentionedMembers),
    mentionedNames: (mentionedMembers || []).map(function (member) { return cleanString_(member.Name); }).filter(Boolean).join(', ') || '-',
    actorName: actor ? cleanString_(actor.Name) : '不明',
    commentText: cleanString_(comment.Text).slice(0, SLACK_COMMENT_EXCERPT_MAX_LENGTH),
    webAppUrl: webAppUrl || '-'
  }, SLACK_DEFAULT_MENTION_TEMPLATE, SLACK_MENTION_TEMPLATE_KEYS);
}

function buildSlackTemplatePayload_(template, variables, fallback, allowedKeys) {
  const text = renderSlackTemplate_(template, variables, fallback, allowedKeys);
  return {
    text: text,
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: text }
    }]
  };
}

function renderSlackTemplate_(template, variables, fallback, allowedKeys) {
  const normalized = normalizeSlackTemplate_(template, fallback, allowedKeys, false);
  const values = variables || {};
  return normalized.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, function (match, key) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    // mentionedUsers is assembled only from validated Slack member IDs and escaped names.
    // Escaping it again would turn <@U...> into plain text and suppress the notification.
    return key === 'mentionedUsers' ? cleanString_(values[key]) : slackEscape_(values[key]);
  }).slice(0, SLACK_RENDERED_MESSAGE_MAX_LENGTH);
}

function slackMentionedUsers_(members) {
  const labels = (members || []).map(function (member) {
    const slackUserId = cleanString_(member.SlackUserId).toUpperCase();
    if (/^[UW][A-Z0-9]{2,31}$/.test(slackUserId)) {
      return '<@' + slackUserId + '>';
    }
    return slackEscape_(member.Name);
  }).filter(Boolean);
  return labels.join(', ') || '-';
}

function normalizeSlackTemplate_(value, fallback, allowedKeys, strict) {
  const text = cleanString_(value);
  if (!text) return fallback;
  if (text.length > SLACK_TEMPLATE_MAX_LENGTH) {
    if (strict) throw new Error('Slack通知テンプレートは' + SLACK_TEMPLATE_MAX_LENGTH + '文字以内で入力してください。');
    return fallback;
  }
  const allowed = {};
  (allowedKeys || []).forEach(function (key) { allowed[key] = true; });
  const unknown = (text.match(/\{[^{}\r\n]+\}/g) || [])
    .map(function (token) { return token.slice(1, -1); })
    .filter(function (key) { return !allowed[key]; });
  if (unknown.length) {
    if (strict) throw new Error('未対応のSlack通知プレースホルダーです: {' + unique_(unknown).join('}, {') + '}');
    return fallback;
  }
  return text;
}

function postToSlack_(payload, options) {
  options = options || {};
  const properties = PropertiesService.getScriptProperties();
  try {
    const settings = slackNotificationSettings_();
    const webhookUrl = properties.getProperty(SLACK_WEBHOOK_KEY);
    const notificationEnabled = slackNotificationEnabled_(settings, options);
    if (!notificationEnabled || !webhookUrl || !payload) {
      return { ok: true, skipped: true };
    }
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(slackRequestPayload_(webhookUrl, payload)),
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

function slackNotificationEnabled_(settings, options) {
  settings = settings || {};
  options = options || {};
  return options.force === true
    || (options.type === 'mention' ? settings.mentionEnabled === true : settings.statusChangeEnabled !== false);
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
    if (webhookUrl && !slackWebhookType_(webhookUrl)) {
      throw new Error('Slack Webhook URL の形式が正しくありません。services または triggers のURLを入力してください。');
    }
    if (webhookUrl) properties.setProperty(SLACK_WEBHOOK_KEY, webhookUrl);
    const current = slackNotificationSettings_();
    properties.setProperty(SLACK_SETTINGS_KEY, JSON.stringify({
      statusChangeEnabled: Object.prototype.hasOwnProperty.call(payload, 'statusChangeEnabled')
        ? payload.statusChangeEnabled !== false
        : current.statusChangeEnabled,
      mentionEnabled: Object.prototype.hasOwnProperty.call(payload, 'mentionEnabled')
        ? payload.mentionEnabled === true
        : current.mentionEnabled,
      mentionTemplateVersion: 2,
      statusTemplate: Object.prototype.hasOwnProperty.call(payload, 'statusTemplate')
        ? normalizeSlackTemplate_(payload.statusTemplate, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS, true)
        : current.statusTemplate,
      mentionTemplate: Object.prototype.hasOwnProperty.call(payload, 'mentionTemplate')
        ? normalizeSlackTemplate_(payload.mentionTemplate, SLACK_DEFAULT_MENTION_TEMPLATE, SLACK_MENTION_TEMPLATE_KEYS, true)
        : current.mentionTemplate
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
    return {
      statusChangeEnabled: parsed.statusChangeEnabled !== false,
      mentionEnabled: parsed.mentionEnabled === true,
      statusTemplate: normalizeSlackTemplate_(parsed.statusTemplate, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS, false),
      mentionTemplate: normalizeSlackTemplate_(
        migrateLegacySlackMentionTemplate_(parsed.mentionTemplate, parsed.mentionTemplateVersion),
        SLACK_DEFAULT_MENTION_TEMPLATE,
        SLACK_MENTION_TEMPLATE_KEYS,
        false
      )
    };
  } catch (error) {
    return {
      statusChangeEnabled: true,
      mentionEnabled: false,
      statusTemplate: SLACK_DEFAULT_STATUS_TEMPLATE,
      mentionTemplate: SLACK_DEFAULT_MENTION_TEMPLATE
    };
  }
}

function migrateLegacySlackMentionTemplate_(value, version) {
  const template = cleanString_(value);
  if (Number(version) >= 2 || template.indexOf('{mentionedUsers}') !== -1) return template;
  return template.replace(/\{mentionedNames\}/g, '{mentionedUsers}');
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
    webhookType: slackWebhookType_(webhookUrl),
    statusChangeEnabled: settings.statusChangeEnabled,
    mentionEnabled: settings.mentionEnabled,
    statusTemplate: settings.statusTemplate,
    mentionTemplate: settings.mentionTemplate,
    lastSuccessAt: cleanString_(delivery.lastSuccessAt),
    lastErrorAt: cleanString_(delivery.lastErrorAt),
    lastError: cleanString_(delivery.lastError),
    lastResponseCode: Number(delivery.lastResponseCode) || 0
  };
}

function slackWebhookType_(value) {
  const webhookUrl = cleanString_(value);
  if (/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\/-]+$/.test(webhookUrl)) return 'incoming';
  if (/^https:\/\/hooks\.slack\.com\/triggers\/[A-Za-z0-9_\/-]+$/.test(webhookUrl)) return 'workflow';
  return '';
}

function slackRequestPayload_(webhookUrl, payload) {
  if (slackWebhookType_(webhookUrl) === 'workflow') {
    return { text: cleanString_(payload && payload.text) };
  }
  return payload || {};
}

function attachPublicSlackSettings_(payload) {
  try {
    if (payload) payload.slackSettings = publicSlackSettings_();
  } catch (error) {
    console.error('Slack public settings attachment failed: ' + cleanString_(error && error.message));
  }
  return payload;
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
    SLACK_DEFAULT_STATUS_TEMPLATE: SLACK_DEFAULT_STATUS_TEMPLATE,
    SLACK_DEFAULT_MENTION_TEMPLATE: SLACK_DEFAULT_MENTION_TEMPLATE,
    SLACK_STATUS_TEMPLATE_KEYS: SLACK_STATUS_TEMPLATE_KEYS,
    SLACK_MENTION_TEMPLATE_KEYS: SLACK_MENTION_TEMPLATE_KEYS,
    buildMentionNotification_: buildMentionNotification_,
    slackMentionedUsers_: slackMentionedUsers_,
    slackWebhookType_: slackWebhookType_,
    slackRequestPayload_: slackRequestPayload_,
    normalizeSlackTemplate_: normalizeSlackTemplate_,
    renderSlackTemplate_: renderSlackTemplate_,
    saveSlackSettings: saveSlackSettings,
    slackNotificationSettings_: slackNotificationSettings_,
    slackNotificationEnabled_: slackNotificationEnabled_,
    slackDeliveryErrorMessage_: slackDeliveryErrorMessage_
  };
}
