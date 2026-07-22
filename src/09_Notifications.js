/**
 * Slack notification helpers.
 */

var SLACK_WEBHOOK_KEY = 'SLACK_WEBHOOK_URL';
var SLACK_APP_WEBHOOK_KEY = 'SLACK_APP_WEBHOOK_URL';
var SLACK_WORKFLOW_STATUS_WEBHOOK_KEY = 'SLACK_WORKFLOW_STATUS_WEBHOOK_URL';
var SLACK_WORKFLOW_MENTION_WEBHOOK_KEY = 'SLACK_WORKFLOW_MENTION_WEBHOOK_URL';
var SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_KEY = 'SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_URL';
var SLACK_SETTINGS_KEY = 'SLACK_NOTIFICATION_SETTINGS';
var SLACK_DELIVERY_KEY = 'SLACK_DELIVERY_STATUS';
var SLACK_TEMPLATE_MAX_LENGTH = 2000;
var SLACK_RENDERED_MESSAGE_MAX_LENGTH = 3000;
var SLACK_COMMENT_EXCERPT_MAX_LENGTH = 1200;
var SLACK_WORKFLOW_MENTION_MAX_DELIVERIES = 20;
var SLACK_STATUS_TEMPLATE_KEYS = ['taskName', 'parentPath', 'beforeStatus', 'afterStatus', 'actorName', 'webAppUrl'];
var SLACK_MENTION_TEMPLATE_KEYS = ['taskName', 'parentPath', 'mentionedUsers', 'mentionedNames', 'actorName', 'commentText', 'webAppUrl'];
var SLACK_ASSIGNMENT_TEMPLATE_KEYS = ['taskName', 'parentPath', 'assignedUsers', 'assignedNames', 'actorName', 'endDate', 'webAppUrl'];
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
var SLACK_DEFAULT_ASSIGNMENT_TEMPLATE = [
  '*タスクの担当に追加されました*',
  '*タスク*: {taskName}',
  '*親パス*: {parentPath}',
  '*追加担当者*: {assignedUsers}',
  '*期限*: {endDate}',
  '*実行者*: {actorName}',
  '*Webアプリ*: {webAppUrl}'
].join('\n');

function buildStatusChangeNotification_(node, beforeColumn, afterColumn, actor, rows) {
  const beforeName = beforeColumn ? cleanString_(beforeColumn.Name) : '未設定';
  const afterName = afterColumn ? cleanString_(afterColumn.Name) : '未設定';
  const actorName = actor ? cleanString_(actor.Name) : '不明';
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrlForNode_(node.NodeId);
  const settings = slackNotificationSettings_();
  const variables = {
    taskName: cleanString_(node.Name),
    parentPath: path || '-',
    beforeStatus: beforeName,
    afterStatus: afterName,
    actorName: actorName,
    webAppUrl: webAppUrl || '-'
  };
  const payload = buildSlackTemplatePayload_(settings.statusTemplate, variables, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS);
  payload.workflow = {
    type: 'status',
    fields: {
      notification_title: 'タスクのステータスが変更されました',
      task_name: variables.taskName,
      parent_path: variables.parentPath,
      before_status: variables.beforeStatus,
      after_status: variables.afterStatus,
      actor_name: variables.actorName,
      web_app_url: variables.webAppUrl
    }
  };
  return payload;
}

function buildMentionNotification_(node, comment, actor, mentionedMembers, rows) {
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrlForNode_(node.NodeId, comment.CommentId);
  const settings = slackNotificationSettings_();
  const variables = {
    taskName: cleanString_(node.Name),
    parentPath: path || '-',
    mentionedUsers: slackMentionedUsers_(mentionedMembers),
    mentionedNames: (mentionedMembers || []).map(function (member) { return cleanString_(member.Name); }).filter(Boolean).join(', ') || '-',
    actorName: actor ? cleanString_(actor.Name) : '不明',
    commentText: cleanString_(comment.Text).slice(0, SLACK_COMMENT_EXCERPT_MAX_LENGTH),
    webAppUrl: webAppUrl || '-'
  };
  const payload = buildSlackTemplatePayload_(settings.mentionTemplate, variables, SLACK_DEFAULT_MENTION_TEMPLATE, SLACK_MENTION_TEMPLATE_KEYS);
  payload.workflow = {
    type: 'mention',
    fields: {
      notification_title: 'コメントでメンションされました',
      task_name: variables.taskName,
      parent_path: variables.parentPath,
      actor_name: variables.actorName,
      comment_text: variables.commentText,
      web_app_url: variables.webAppUrl
    },
    recipients: (mentionedMembers || []).map(function (member) {
      return {
        slackUserId: cleanString_(member.SlackUserId).toUpperCase(),
        name: cleanString_(member.Name)
      };
    }).filter(function (recipient) {
      return /^[UW][A-Z0-9]{2,31}$/.test(recipient.slackUserId);
    })
  };
  return payload;
}

function buildAssignmentNotification_(node, actor, assignedMembers, rows) {
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrlForNode_(node.NodeId);
  const settings = slackNotificationSettings_();
  const variables = {
    taskName: cleanString_(node.Name),
    parentPath: path || '-',
    assignedUsers: slackMentionedUsers_(assignedMembers),
    assignedNames: (assignedMembers || []).map(function (member) { return cleanString_(member.Name); }).filter(Boolean).join(', ') || '-',
    actorName: actor ? cleanString_(actor.Name) : '不明',
    endDate: cleanString_(node.EndDate) || '未設定',
    webAppUrl: webAppUrl || '-'
  };
  const payload = buildSlackTemplatePayload_(settings.assignmentTemplate, variables, SLACK_DEFAULT_ASSIGNMENT_TEMPLATE, SLACK_ASSIGNMENT_TEMPLATE_KEYS);
  payload.workflow = {
    type: 'assignment',
    fields: {
      notification_title: 'タスクの担当に追加されました',
      task_name: variables.taskName,
      parent_path: variables.parentPath,
      actor_name: variables.actorName,
      end_date: variables.endDate,
      web_app_url: variables.webAppUrl
    },
    recipients: (assignedMembers || []).map(function (member) {
      return {
        slackUserId: cleanString_(member.SlackUserId).toUpperCase(),
        name: cleanString_(member.Name)
      };
    }).filter(function (recipient) {
      return /^[UW][A-Z0-9]{2,31}$/.test(recipient.slackUserId);
    })
  };
  return payload;
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
    // These values are assembled only from validated Slack member IDs and escaped names.
    // Escaping them again would turn <@U...> into plain text and suppress the notification.
    return key === 'mentionedUsers' || key === 'assignedUsers'
      ? cleanString_(values[key])
      : slackEscape_(values[key]);
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
    const notificationEnabled = slackNotificationEnabled_(settings, options);
    if (!notificationEnabled || !payload) {
      return { ok: true, skipped: true };
    }
    const endpoint = slackEndpointFor_(properties, settings, options);
    if (!endpoint.url) {
      return { ok: true, skipped: true };
    }
    const requests = endpoint.kind === 'app'
      ? [{ text: cleanString_(payload.text), blocks: payload.blocks || [] }]
      : slackWorkflowRequestPayloads_(payload, options.type, endpoint.legacy);
    if (!requests.length) {
      return {
        ok: false,
        skipped: true,
        code: 'SLACK_MEMBER_MAPPING_MISSING',
        message: 'SlackメンバーIDが設定された通知対象者がいないため、Workflow通知を送信しませんでした。'
      };
    }
    return sendSlackRequests_(endpoint, requests);
  } catch (error) {
    const message = 'Slackへの接続に失敗しました。タスクの保存は完了しています。';
    recordSlackDelivery_({ ok: false, responseCode: 0, responseText: cleanString_(error && error.message), message: message });
    console.error('Slack notification exception: ' + cleanString_(error && error.stack || error));
    return { ok: false, responseCode: 0, message: message };
  }
}

function sendSlackRequests_(endpoint, requests) {
  let lastCode = 0;
  for (let index = 0; index < requests.length; index += 1) {
    if (index > 0 && endpoint.kind === 'workflow' && typeof Utilities !== 'undefined' && Utilities.sleep) {
      Utilities.sleep(1050);
    }
    const response = UrlFetchApp.fetch(endpoint.url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requests[index]),
      muteHttpExceptions: true
    });
    const responseCode = Number(response.getResponseCode()) || 0;
    const responseText = cleanString_(response.getContentText()).slice(0, 300);
    lastCode = responseCode;
    if (responseCode < 200 || responseCode >= 300) {
      const message = slackDeliveryErrorMessage_(responseCode, responseText);
      recordSlackDelivery_({ ok: false, responseCode: responseCode, responseText: responseText, message: message });
      console.error('Slack notification failed (' + responseCode + '): ' + responseText);
      return { ok: false, responseCode: responseCode, message: message };
    }
  }
  recordSlackDelivery_({ ok: true, responseCode: lastCode, responseText: '' });
  return { ok: true, responseCode: lastCode, deliveryCount: requests.length };
}

function slackEndpointFor_(properties, settings, options) {
  const legacyUrl = cleanString_(properties.getProperty(SLACK_WEBHOOK_KEY));
  const legacyType = slackWebhookType_(legacyUrl);
  const appUrl = cleanString_(properties.getProperty(SLACK_APP_WEBHOOK_KEY)) || (legacyType === 'incoming' ? legacyUrl : '');
  const statusUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY)) || (legacyType === 'workflow' ? legacyUrl : '');
  const mentionUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY)) || (legacyType === 'workflow' ? legacyUrl : '');
  const assignmentUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_KEY));
  const target = cleanString_(options.target);
  if (target === 'app') return { kind: 'app', url: appUrl, legacy: false };
  if (target === 'workflowStatus') {
    return { kind: 'workflow', url: statusUrl, legacy: !properties.getProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY) && legacyType === 'workflow' };
  }
  if (target === 'workflowMention') {
    return { kind: 'workflow', url: mentionUrl, legacy: !properties.getProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY) && legacyType === 'workflow' };
  }
  if (target === 'workflowAssignment') {
    return { kind: 'workflow', url: assignmentUrl, legacy: false };
  }
  if (settings.deliveryMode === 'app') return { kind: 'app', url: appUrl, legacy: false };
  if (options.type === 'mention') {
    return { kind: 'workflow', url: mentionUrl, legacy: !properties.getProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY) && legacyType === 'workflow' };
  }
  if (options.type === 'assignment') {
    return { kind: 'workflow', url: assignmentUrl, legacy: false };
  }
  return { kind: 'workflow', url: statusUrl, legacy: !properties.getProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY) && legacyType === 'workflow' };
}

function slackWorkflowRequestPayloads_(payload, type, legacy) {
  if (legacy) return [{ text: cleanString_(payload && payload.text) }];
  const workflow = payload && payload.workflow || {};
  const fields = workflow.fields || {};
  if (type === 'mention' || workflow.type === 'mention') {
    return (workflow.recipients || []).slice(0, SLACK_WORKFLOW_MENTION_MAX_DELIVERIES).map(function (recipient) {
      return {
        notification_title: slackEscape_(fields.notification_title),
        task_name: slackEscape_(fields.task_name),
        parent_path: slackEscape_(fields.parent_path),
        mentioned_user_id: cleanString_(recipient.slackUserId),
        mentioned_user_name: slackEscape_(recipient.name),
        actor_name: slackEscape_(fields.actor_name),
        comment_text: slackEscape_(fields.comment_text),
        web_app_url: slackEscape_(fields.web_app_url)
      };
    });
  }
  if (type === 'assignment' || workflow.type === 'assignment') {
    return (workflow.recipients || []).slice(0, SLACK_WORKFLOW_MENTION_MAX_DELIVERIES).map(function (recipient) {
      return {
        notification_title: slackEscape_(fields.notification_title),
        task_name: slackEscape_(fields.task_name),
        parent_path: slackEscape_(fields.parent_path),
        assigned_user_id: cleanString_(recipient.slackUserId),
        assigned_user_name: slackEscape_(recipient.name),
        actor_name: slackEscape_(fields.actor_name),
        end_date: slackEscape_(fields.end_date),
        web_app_url: slackEscape_(fields.web_app_url)
      };
    });
  }
  return [{
    notification_title: slackEscape_(fields.notification_title),
    task_name: slackEscape_(fields.task_name),
    parent_path: slackEscape_(fields.parent_path),
    before_status: slackEscape_(fields.before_status),
    after_status: slackEscape_(fields.after_status),
    actor_name: slackEscape_(fields.actor_name),
    web_app_url: slackEscape_(fields.web_app_url)
  }];
}

function slackNotificationEnabled_(settings, options) {
  settings = settings || {};
  options = options || {};
  if (options.force === true) return true;
  if (options.type === 'mention') return settings.mentionEnabled === true;
  if (options.type === 'assignment') return settings.assignmentEnabled === true;
  return settings.statusChangeEnabled !== false;
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
    const current = slackNotificationSettings_();
    let deliveryMode = cleanString_(payload.deliveryMode) || current.deliveryMode;
    let appWebhookUrl = cleanString_(payload.appWebhookUrl);
    let workflowStatusWebhookUrl = cleanString_(payload.workflowStatusWebhookUrl);
    let workflowMentionWebhookUrl = cleanString_(payload.workflowMentionWebhookUrl);
    let workflowAssignmentWebhookUrl = cleanString_(payload.workflowAssignmentWebhookUrl);

    // Compatibility with the single-URL settings UI used before delivery modes were introduced.
    const legacyPayloadUrl = cleanString_(payload.webhookUrl);
    const legacyPayloadType = slackWebhookType_(legacyPayloadUrl);
    if (legacyPayloadType === 'incoming') {
      if (!cleanString_(payload.deliveryMode)) deliveryMode = 'app';
    } else if (legacyPayloadType === 'workflow') {
      // Keep the former single-URL contract in the legacy slot. A stale browser
      // still submits one {text} variable, so promoting this URL to the new flat
      // field contract would silently break its existing workflow.
      if (!cleanString_(payload.deliveryMode)) deliveryMode = 'workflow';
    } else if (legacyPayloadUrl) {
      throw new Error('Slack Webhook URL の形式が正しくありません。');
    }

    if (deliveryMode !== 'app' && deliveryMode !== 'workflow') {
      throw new Error('Slack通知方式を選択してください。');
    }
    if (appWebhookUrl && slackWebhookType_(appWebhookUrl) !== 'incoming') {
      throw new Error('Slackアプリ方式には /services/ のIncoming Webhook URLを入力してください。');
    }
    if (workflowStatusWebhookUrl && slackWebhookType_(workflowStatusWebhookUrl) !== 'workflow') {
      throw new Error('ステータス通知には /triggers/ のWorkflow URLを入力してください。');
    }
    if (workflowMentionWebhookUrl && slackWebhookType_(workflowMentionWebhookUrl) !== 'workflow') {
      throw new Error('メンション通知には /triggers/ のWorkflow URLを入力してください。');
    }
    if (workflowAssignmentWebhookUrl && slackWebhookType_(workflowAssignmentWebhookUrl) !== 'workflow') {
      throw new Error('アサイン通知には /triggers/ のWorkflow URLを入力してください。');
    }
    const nextStatusEnabled = Object.prototype.hasOwnProperty.call(payload, 'statusChangeEnabled')
      ? payload.statusChangeEnabled !== false
      : current.statusChangeEnabled;
    const nextMentionEnabled = Object.prototype.hasOwnProperty.call(payload, 'mentionEnabled')
      ? payload.mentionEnabled === true
      : current.mentionEnabled;
    const nextAssignmentEnabled = Object.prototype.hasOwnProperty.call(payload, 'assignmentEnabled')
      ? payload.assignmentEnabled === true
      : current.assignmentEnabled;
    const legacyStoredUrl = cleanString_(properties.getProperty(SLACK_WEBHOOK_KEY));
    const existingAppUrl = cleanString_(properties.getProperty(SLACK_APP_WEBHOOK_KEY))
      || (legacyPayloadType === 'incoming' ? legacyPayloadUrl : '')
      || (slackWebhookType_(legacyStoredUrl) === 'incoming' ? legacyStoredUrl : '');
    const existingWorkflowStatusUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY))
      || (legacyPayloadType === 'workflow' ? legacyPayloadUrl : '')
      || (slackWebhookType_(legacyStoredUrl) === 'workflow' ? legacyStoredUrl : '');
    const existingWorkflowMentionUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY))
      || (legacyPayloadType === 'workflow' ? legacyPayloadUrl : '')
      || (slackWebhookType_(legacyStoredUrl) === 'workflow' ? legacyStoredUrl : '');
    const existingWorkflowAssignmentUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_KEY));
    if (deliveryMode === 'app' && (nextStatusEnabled || nextMentionEnabled || nextAssignmentEnabled) && !appWebhookUrl && !existingAppUrl) {
      throw new Error('Slackアプリ方式のIncoming Webhook URLを入力してください。');
    }
    if (deliveryMode === 'workflow' && nextStatusEnabled && !workflowStatusWebhookUrl && !existingWorkflowStatusUrl) {
      throw new Error('ステータス通知のWorkflow URLを入力してください。');
    }
    if (deliveryMode === 'workflow' && nextMentionEnabled && !workflowMentionWebhookUrl && !existingWorkflowMentionUrl) {
      throw new Error('メンション通知のWorkflow URLを入力してください。');
    }
    if (deliveryMode === 'workflow' && nextAssignmentEnabled && !workflowAssignmentWebhookUrl && !existingWorkflowAssignmentUrl) {
      throw new Error('アサイン通知のWorkflow URLを入力してください。');
    }
    const nextStatusTemplate = Object.prototype.hasOwnProperty.call(payload, 'statusTemplate')
      ? normalizeSlackTemplate_(payload.statusTemplate, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS, true)
      : current.statusTemplate;
    const nextMentionTemplate = Object.prototype.hasOwnProperty.call(payload, 'mentionTemplate')
      ? normalizeSlackTemplate_(payload.mentionTemplate, SLACK_DEFAULT_MENTION_TEMPLATE, SLACK_MENTION_TEMPLATE_KEYS, true)
      : current.mentionTemplate;
    const nextAssignmentTemplate = Object.prototype.hasOwnProperty.call(payload, 'assignmentTemplate')
      ? normalizeSlackTemplate_(payload.assignmentTemplate, SLACK_DEFAULT_ASSIGNMENT_TEMPLATE, SLACK_ASSIGNMENT_TEMPLATE_KEYS, true)
      : current.assignmentTemplate;
    if (legacyPayloadUrl) properties.setProperty(SLACK_WEBHOOK_KEY, legacyPayloadUrl);
    if (appWebhookUrl) properties.setProperty(SLACK_APP_WEBHOOK_KEY, appWebhookUrl);
    if (workflowStatusWebhookUrl) properties.setProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY, workflowStatusWebhookUrl);
    if (workflowMentionWebhookUrl) properties.setProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY, workflowMentionWebhookUrl);
    if (workflowAssignmentWebhookUrl) properties.setProperty(SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_KEY, workflowAssignmentWebhookUrl);
    properties.setProperty(SLACK_SETTINGS_KEY, JSON.stringify({
      deliveryMode: deliveryMode,
      statusChangeEnabled: nextStatusEnabled,
      mentionEnabled: nextMentionEnabled,
      assignmentEnabled: nextAssignmentEnabled,
      mentionTemplateVersion: 2,
      statusTemplate: nextStatusTemplate,
      mentionTemplate: nextMentionTemplate,
      assignmentTemplate: nextAssignmentTemplate
    }));
    return { ok: true, slackSettings: publicSlackSettings_() };
  });
}

function testSlackConnection(payload) {
  payload = payload || {};
  requireSchemaExists_();
  const actor = requireCurrentMember_();
  const settings = slackNotificationSettings_();
  const target = cleanString_(payload.target) || (settings.deliveryMode === 'app' ? 'app' : 'workflowStatus');
  const actorSlackUserId = cleanString_(actor.SlackUserId).toUpperCase();
  if ((target === 'workflowMention' || target === 'workflowAssignment') && !/^[UW][A-Z0-9]{2,31}$/.test(actorSlackUserId)) {
    return {
      ok: false,
      code: 'SLACK_MEMBER_ID_REQUIRED',
      message: '接続テストの実行者にSlackメンバーIDを設定してください。',
      slackSettings: publicSlackSettings_()
    };
  }
  const testText = 'GAS TaskBoard Slack接続テスト（実行者: ' + cleanString_(actor.Name) + '）';
  const testPayload = {
    text: testText,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: testText } }],
    workflow: target === 'workflowMention' ? {
      type: 'mention',
      fields: {
        notification_title: 'コメントメンション通知の接続テスト',
        task_name: '接続テスト',
        parent_path: '-',
        actor_name: cleanString_(actor.Name),
        comment_text: 'Workflow Builderとの接続を確認しています。',
        web_app_url: webAppUrl_() || '-'
      },
      recipients: [{ slackUserId: actorSlackUserId, name: cleanString_(actor.Name) }]
    } : target === 'workflowAssignment' ? {
      type: 'assignment',
      fields: {
        notification_title: 'アサイン通知の接続テスト',
        task_name: '接続テスト',
        parent_path: '-',
        actor_name: cleanString_(actor.Name),
        end_date: '2026-12-31',
        web_app_url: webAppUrl_() || '-'
      },
      recipients: [{ slackUserId: actorSlackUserId, name: cleanString_(actor.Name) }]
    } : {
      type: 'status',
      fields: {
        notification_title: 'ステータス通知の接続テスト',
        task_name: '接続テスト',
        parent_path: '-',
        before_status: '未着手',
        after_status: '確認済み',
        actor_name: cleanString_(actor.Name),
        web_app_url: webAppUrl_() || '-'
      }
    }
  };
  const result = postToSlack_(testPayload, {
    force: true,
    type: target === 'workflowMention' ? 'mention' : target === 'workflowAssignment' ? 'assignment' : 'status',
    target: target
  });
  if (!result || result.skipped) {
    return {
      ok: false,
      code: result && result.code || 'SLACK_NOT_CONFIGURED',
      message: result && result.message || '選択したSlack通知先が未設定です。',
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

function disconnectSlack(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const properties = PropertiesService.getScriptProperties();
    const target = cleanString_(payload.target) || slackNotificationSettings_().deliveryMode;
    const legacyUrl = cleanString_(properties.getProperty(SLACK_WEBHOOK_KEY));
    if (target === 'app') {
      properties.deleteProperty(SLACK_APP_WEBHOOK_KEY);
      if (slackWebhookType_(legacyUrl) === 'incoming') properties.deleteProperty(SLACK_WEBHOOK_KEY);
    } else {
      properties.deleteProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY);
      properties.deleteProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY);
      properties.deleteProperty(SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_KEY);
      if (slackWebhookType_(legacyUrl) === 'workflow') properties.deleteProperty(SLACK_WEBHOOK_KEY);
    }
    properties.deleteProperty(SLACK_DELIVERY_KEY);
    return { ok: true, slackSettings: publicSlackSettings_() };
  });
}

function slackNotificationSettings_() {
  const raw = PropertiesService.getScriptProperties().getProperty(SLACK_SETTINGS_KEY);
  try {
    const parsed = JSON.parse(raw || '{}');
    const legacyType = slackWebhookType_(PropertiesService.getScriptProperties().getProperty(SLACK_WEBHOOK_KEY));
    const deliveryMode = parsed.deliveryMode === 'app' || parsed.deliveryMode === 'workflow'
      ? parsed.deliveryMode
      : legacyType === 'incoming' ? 'app' : legacyType === 'workflow' ? 'workflow' : '';
    return {
      deliveryMode: deliveryMode,
      statusChangeEnabled: parsed.statusChangeEnabled !== false,
      mentionEnabled: parsed.mentionEnabled === true,
      assignmentEnabled: parsed.assignmentEnabled === true,
      statusTemplate: normalizeSlackTemplate_(parsed.statusTemplate, SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_STATUS_TEMPLATE_KEYS, false),
      mentionTemplate: normalizeSlackTemplate_(
        migrateLegacySlackMentionTemplate_(parsed.mentionTemplate, parsed.mentionTemplateVersion),
        SLACK_DEFAULT_MENTION_TEMPLATE,
        SLACK_MENTION_TEMPLATE_KEYS,
        false
      ),
      assignmentTemplate: normalizeSlackTemplate_(parsed.assignmentTemplate, SLACK_DEFAULT_ASSIGNMENT_TEMPLATE, SLACK_ASSIGNMENT_TEMPLATE_KEYS, false)
    };
  } catch (error) {
    return {
      deliveryMode: '',
      statusChangeEnabled: true,
      mentionEnabled: false,
      assignmentEnabled: false,
      statusTemplate: SLACK_DEFAULT_STATUS_TEMPLATE,
      mentionTemplate: SLACK_DEFAULT_MENTION_TEMPLATE,
      assignmentTemplate: SLACK_DEFAULT_ASSIGNMENT_TEMPLATE
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
  const legacyUrl = cleanString_(properties.getProperty(SLACK_WEBHOOK_KEY));
  const legacyType = slackWebhookType_(legacyUrl);
  const storedAppUrl = cleanString_(properties.getProperty(SLACK_APP_WEBHOOK_KEY));
  const storedWorkflowStatusUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_STATUS_WEBHOOK_KEY));
  const storedWorkflowMentionUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_MENTION_WEBHOOK_KEY));
  const storedWorkflowAssignmentUrl = cleanString_(properties.getProperty(SLACK_WORKFLOW_ASSIGNMENT_WEBHOOK_KEY));
  const appUrl = storedAppUrl || (legacyType === 'incoming' ? legacyUrl : '');
  const workflowStatusUrl = storedWorkflowStatusUrl || (legacyType === 'workflow' ? legacyUrl : '');
  const workflowMentionUrl = storedWorkflowMentionUrl || (legacyType === 'workflow' ? legacyUrl : '');
  const workflowAssignmentUrl = storedWorkflowAssignmentUrl;
  const settings = slackNotificationSettings_();
  let delivery = {};
  try {
    delivery = JSON.parse(properties.getProperty(SLACK_DELIVERY_KEY) || '{}');
  } catch (error) {
    delivery = {};
  }
  const activeConfigured = settings.deliveryMode === 'app'
    ? !!appUrl
    : settings.deliveryMode === 'workflow'
      ? (settings.statusChangeEnabled || settings.mentionEnabled || settings.assignmentEnabled)
        && (!settings.statusChangeEnabled || !!workflowStatusUrl)
        && (!settings.mentionEnabled || !!workflowMentionUrl)
        && (!settings.assignmentEnabled || !!workflowAssignmentUrl)
      : false;
  return {
    configured: activeConfigured,
    deliveryMode: settings.deliveryMode,
    appConfigured: !!appUrl,
    maskedAppWebhookUrl: maskedSlackWebhook_(appUrl),
    workflowStatusConfigured: !!workflowStatusUrl,
    maskedWorkflowStatusWebhookUrl: maskedSlackWebhook_(workflowStatusUrl),
    workflowStatusLegacy: !storedWorkflowStatusUrl && legacyType === 'workflow',
    workflowMentionConfigured: !!workflowMentionUrl,
    maskedWorkflowMentionWebhookUrl: maskedSlackWebhook_(workflowMentionUrl),
    workflowMentionLegacy: !storedWorkflowMentionUrl && legacyType === 'workflow',
    workflowAssignmentConfigured: !!workflowAssignmentUrl,
    maskedWorkflowAssignmentWebhookUrl: maskedSlackWebhook_(workflowAssignmentUrl),
    // Kept for cached clients from the previous single-URL UI.
    maskedWebhookUrl: maskedSlackWebhook_(settings.deliveryMode === 'app' ? appUrl : workflowStatusUrl),
    webhookType: settings.deliveryMode === 'app' ? 'incoming' : settings.deliveryMode === 'workflow' ? 'workflow' : '',
    statusChangeEnabled: settings.statusChangeEnabled,
    mentionEnabled: settings.mentionEnabled,
    assignmentEnabled: settings.assignmentEnabled,
    statusTemplate: settings.statusTemplate,
    mentionTemplate: settings.mentionTemplate,
    assignmentTemplate: settings.assignmentTemplate,
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

function maskedSlackWebhook_(value) {
  const type = slackWebhookType_(value);
  if (type === 'incoming') return 'https://hooks.slack.com/services/••••••';
  if (type === 'workflow') return 'https://hooks.slack.com/triggers/••••••';
  return '';
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

function webAppUrlForNode_(nodeId, commentId) {
  const baseUrl = webAppUrl_();
  const targetNodeId = cleanString_(nodeId);
  if (!baseUrl || !targetNodeId) return baseUrl;
  let url = baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + 'node=' + encodeURIComponent(targetNodeId);
  const targetCommentId = cleanString_(commentId);
  if (targetCommentId) url += '&comment=' + encodeURIComponent(targetCommentId);
  return url;
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
    SLACK_DEFAULT_ASSIGNMENT_TEMPLATE: SLACK_DEFAULT_ASSIGNMENT_TEMPLATE,
    SLACK_STATUS_TEMPLATE_KEYS: SLACK_STATUS_TEMPLATE_KEYS,
    SLACK_MENTION_TEMPLATE_KEYS: SLACK_MENTION_TEMPLATE_KEYS,
    SLACK_ASSIGNMENT_TEMPLATE_KEYS: SLACK_ASSIGNMENT_TEMPLATE_KEYS,
    buildMentionNotification_: buildMentionNotification_,
    buildAssignmentNotification_: buildAssignmentNotification_,
    webAppUrlForNode_: webAppUrlForNode_,
    slackMentionedUsers_: slackMentionedUsers_,
    slackWebhookType_: slackWebhookType_,
    slackRequestPayload_: slackRequestPayload_,
    slackWorkflowRequestPayloads_: slackWorkflowRequestPayloads_,
    maskedSlackWebhook_: maskedSlackWebhook_,
    normalizeSlackTemplate_: normalizeSlackTemplate_,
    renderSlackTemplate_: renderSlackTemplate_,
    saveSlackSettings: saveSlackSettings,
    slackNotificationSettings_: slackNotificationSettings_,
    slackNotificationEnabled_: slackNotificationEnabled_,
    slackDeliveryErrorMessage_: slackDeliveryErrorMessage_
  };
}
