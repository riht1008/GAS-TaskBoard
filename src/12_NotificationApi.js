/**
 * In-app mention notifications and per-member read receipts.
 */

var NOTIFICATION_TYPE_MENTION = 'mention';
var NOTIFICATION_PAGE_DEFAULT = 50;
var NOTIFICATION_PAGE_MAX = 100;
var NOTIFICATION_EXCERPT_MAX_LENGTH = 600;

function mentionNotificationKey_(commentId, memberId) {
  return NOTIFICATION_TYPE_MENTION + ':' + cleanString_(commentId) + ':' + cleanString_(memberId);
}

function mentionNotificationIndexForMember_(memberId, activeNodes) {
  const recipientId = cleanString_(memberId);
  if (!recipientId) return [];
  const activeNodeIds = {};
  (activeNodes || []).forEach(function (node) {
    const nodeId = cleanString_(node.NodeId);
    if (nodeId) activeNodeIds[nodeId] = true;
  });
  return readSelectedColumns_(SHEET.COMMENTS, ['CommentId', 'NodeId', 'Timestamp', 'Mentions'])
    .filter(function (comment) {
      return !!activeNodeIds[cleanString_(comment.NodeId)]
        && splitCsv_(comment.Mentions).indexOf(recipientId) !== -1;
    })
    .map(function (comment) {
      return {
        notificationKey: mentionNotificationKey_(comment.CommentId, recipientId),
        commentId: cleanString_(comment.CommentId),
        nodeId: cleanString_(comment.NodeId),
        timestamp: cleanString_(comment.Timestamp),
        __row: comment.__row
      };
    });
}

function notificationReadMapForMember_(memberId) {
  const result = {};
  readObjectsMatchingColumn_(SHEET.NOTIFICATION_READS, 'RecipientMemberId', memberId).forEach(function (receipt) {
    const key = cleanString_(receipt.NotificationKey);
    if (key) result[key] = cleanString_(receipt.ReadAt);
  });
  return result;
}

function unreadMentionCountForMember_(memberId, activeNodes) {
  const readMap = notificationReadMapForMember_(memberId);
  return mentionNotificationIndexForMember_(memberId, activeNodes).filter(function (item) {
    return !readMap[item.notificationKey];
  }).length;
}

function notificationPage_(items, options) {
  options = options || {};
  const limit = Math.min(NOTIFICATION_PAGE_MAX, Math.max(10, Number(options.limit) || NOTIFICATION_PAGE_DEFAULT));
  const beforeTimestamp = cleanString_(options.beforeTimestamp);
  const beforeId = cleanString_(options.beforeId);
  const eligible = (items || []).filter(function (item) {
    const timestamp = cleanString_(item.timestamp);
    const id = cleanString_(item.commentId);
    return !beforeTimestamp || timestamp < beforeTimestamp || (timestamp === beforeTimestamp && id < beforeId);
  }).sort(function (a, b) {
    return cleanString_(b.timestamp).localeCompare(cleanString_(a.timestamp))
      || cleanString_(b.commentId).localeCompare(cleanString_(a.commentId));
  });
  const selected = eligible.slice(0, limit);
  const oldest = selected[selected.length - 1] || null;
  return {
    items: selected,
    hasMore: eligible.length > selected.length,
    nextCursor: oldest ? {
      beforeTimestamp: cleanString_(oldest.timestamp),
      beforeId: cleanString_(oldest.commentId)
    } : null
  };
}

function getNotifications(options) {
  options = options || {};
  requireSchemaExists_();
  const rows = readAll_({ sheets: [SHEET.NODES, SHEET.MEMBERS] });
  const actor = requireCurrentMember_(rows.members);
  const active = activeNodes_(rows.nodes);
  const nodesById = byId_(active, 'NodeId');
  const index = mentionNotificationIndexForMember_(actor.MemberId, active);
  const readMap = notificationReadMapForMember_(actor.MemberId);
  const page = notificationPage_(index, options);
  const commentsById = {};
  readObjectsAtRows_(SHEET.COMMENTS, page.items.map(function (item) { return item.__row; })).forEach(function (comment) {
    commentsById[cleanString_(comment.CommentId)] = comment;
  });
  const notifications = page.items.map(function (item) {
    const comment = commentsById[item.commentId];
    const node = nodesById[item.nodeId];
    if (!comment || !node) return null;
    const readAt = cleanString_(readMap[item.notificationKey]);
    return {
      id: item.notificationKey,
      type: NOTIFICATION_TYPE_MENTION,
      nodeId: item.nodeId,
      nodeName: cleanString_(node.Name),
      parentPath: parentPath_(node, active),
      commentId: item.commentId,
      authorName: cleanString_(comment.AuthorName) || '不明',
      text: cleanString_(comment.Text).slice(0, NOTIFICATION_EXCERPT_MAX_LENGTH),
      timestamp: cleanString_(comment.Timestamp),
      readAt: readAt,
      unread: !readAt
    };
  }).filter(Boolean);
  return {
    ok: true,
    notifications: notifications,
    unreadCount: index.filter(function (item) { return !readMap[item.notificationKey]; }).length,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor
  };
}

function getNotificationCommentThread(payload) {
  payload = payload || {};
  requireSchemaExists_();
  const rows = readAll_({ sheets: [SHEET.NODES, SHEET.MEMBERS] });
  const actor = requireCurrentMember_(rows.members);
  const nodeId = cleanString_(payload.nodeId);
  const commentId = cleanString_(payload.commentId);
  const active = activeNodes_(rows.nodes);
  if (!byId_(active, 'NodeId')[nodeId]) {
    throw new Error('通知先のタスクが見つかりません。');
  }
  const index = readSelectedColumns_(SHEET.COMMENTS, ['CommentId', 'NodeId', 'ParentCommentId', 'Mentions']);
  const target = index.find(function (comment) {
    return cleanString_(comment.CommentId) === commentId && cleanString_(comment.NodeId) === nodeId;
  });
  if (!target || splitCsv_(target.Mentions).indexOf(cleanString_(actor.MemberId)) === -1) {
    throw new Error('自分宛のメンションコメントが見つかりません。');
  }
  return commentThreadFromIndex_(nodeId, commentId, active, index);
}

function markNotificationRead(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readAll_({ sheets: [SHEET.NODES, SHEET.MEMBERS] });
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    const notificationKey = cleanString_(payload.notificationKey);
    const commentId = cleanString_(payload.commentId);
    const expectedKey = mentionNotificationKey_(commentId, actor.MemberId);
    const comment = readObjectsMatchingColumn_(SHEET.COMMENTS, 'CommentId', commentId)[0];
    if (!notificationKey || notificationKey !== expectedKey || !comment
      || !byId_(active, 'NodeId')[cleanString_(comment.NodeId)]
      || splitCsv_(comment.Mentions).indexOf(cleanString_(actor.MemberId)) === -1) {
      throw new Error('自分宛の通知が見つかりません。');
    }
    const existing = readObjectsMatchingColumn_(SHEET.NOTIFICATION_READS, 'NotificationKey', notificationKey)[0];
    let readAt = existing ? cleanString_(existing.ReadAt) : '';
    if (!existing) {
      readAt = nowIso_();
      appendObject_(SHEET.NOTIFICATION_READS, {
        NotificationKey: notificationKey,
        RecipientMemberId: actor.MemberId,
        NotificationType: NOTIFICATION_TYPE_MENTION,
        SourceId: commentId,
        ReadAt: readAt
      });
    }
    return {
      ok: true,
      notificationKey: notificationKey,
      readAt: readAt,
      unreadCount: unreadMentionCountForMember_(actor.MemberId, active)
    };
  });
}

function markAllNotificationsRead() {
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readAll_({ sheets: [SHEET.NODES, SHEET.MEMBERS] });
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    const index = mentionNotificationIndexForMember_(actor.MemberId, active);
    const readMap = notificationReadMapForMember_(actor.MemberId);
    const readAt = nowIso_();
    const missing = index.filter(function (item) { return !readMap[item.notificationKey]; });
    appendObjects_(SHEET.NOTIFICATION_READS, missing.map(function (item) {
      return {
        NotificationKey: item.notificationKey,
        RecipientMemberId: actor.MemberId,
        NotificationType: NOTIFICATION_TYPE_MENTION,
        SourceId: item.commentId,
        ReadAt: readAt
      };
    }));
    return { ok: true, markedCount: missing.length, unreadCount: 0, readAt: readAt };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mentionNotificationKey_: mentionNotificationKey_,
    notificationPage_: notificationPage_,
    getNotifications: getNotifications,
    getNotificationCommentThread: getNotificationCommentThread,
    markNotificationRead: markNotificationRead,
    markAllNotificationsRead: markAllNotificationsRead
  };
}
