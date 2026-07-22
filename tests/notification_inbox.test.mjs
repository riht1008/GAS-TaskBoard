import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.splitCsv_ = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

const require = createRequire(import.meta.url);
global.commentThreadFromIndex_ = require('../src/02_CollaborationApi.js').commentThreadFromIndex_;
const {
  mentionNotificationKey_,
  notificationPage_,
  getNotifications,
  getNotificationCommentThread,
  markNotificationRead,
  markAllNotificationsRead
} = require('../src/12_NotificationApi.js');

function functionSlice(file, startMarker, endMarker) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source slice not found: ${startMarker}`);
  return source.slice(start, end);
}

test('mention notification keys are per recipient and pages are newest first', () => {
  assert.equal(mentionNotificationKey_('c1', 'm1'), 'mention:c1:m1');
  assert.notEqual(mentionNotificationKey_('c1', 'm1'), mentionNotificationKey_('c1', 'm2'));

  const page = notificationPage_([
    { commentId: 'c1', timestamp: '2026-07-01T00:00:00.000Z' },
    { commentId: 'c3', timestamp: '2026-07-03T00:00:00.000Z' },
    { commentId: 'c2', timestamp: '2026-07-02T00:00:00.000Z' }
  ], { limit: 10 });

  assert.deepEqual(page.items.map(item => item.commentId), ['c3', 'c2', 'c1']);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor.beforeId, 'c1');
});

test('notification inbox derives historical mentions and overlays per-member read receipts', () => {
  global.SHEET = { NODES: 'Nodes', MEMBERS: 'Members', COMMENTS: 'Comments', NOTIFICATION_READS: 'NotificationReads' };
  global.requireSchemaExists_ = () => {};
  global.readAll_ = () => ({
    nodes: [{ NodeId: 'root', ParentId: '', Name: '案件' }, { NodeId: 'n1', ParentId: 'root', Name: '仕様確認' }],
    members: [{ MemberId: 'm1', Name: '自分' }]
  });
  global.requireCurrentMember_ = members => members[0];
  global.activeNodes_ = nodes => nodes;
  global.byId_ = (items, key) => Object.fromEntries(items.map(item => [item[key], item]));
  global.readSelectedColumns_ = sheet => sheet === 'Comments' ? [
    { __row: 2, CommentId: 'c1', NodeId: 'n1', Timestamp: '2026-07-01T00:00:00.000Z', Mentions: 'm1' },
    { __row: 3, CommentId: 'c2', NodeId: 'n1', Timestamp: '2026-07-02T00:00:00.000Z', Mentions: 'm1,m2' }
  ] : [];
  global.readObjectsMatchingColumn_ = sheet => sheet === 'NotificationReads' ? [{
    NotificationKey: 'mention:c1:m1', RecipientMemberId: 'm1', ReadAt: '2026-07-03T00:00:00.000Z'
  }] : [];
  global.readObjectsAtRows_ = (_sheet, rows) => rows.map(row => row === 2 ? {
    CommentId: 'c1', NodeId: 'n1', AuthorName: '田中', Timestamp: '2026-07-01T00:00:00.000Z', Text: '古いメンション'
  } : {
    CommentId: 'c2', NodeId: 'n1', AuthorName: '佐藤', Timestamp: '2026-07-02T00:00:00.000Z', Text: '新しいメンション'
  });
  global.parentPath_ = () => '案件';

  const result = getNotifications({ limit: 50 });

  assert.equal(result.unreadCount, 1);
  assert.deepEqual(result.notifications.map(item => item.commentId), ['c2', 'c1']);
  assert.equal(result.notifications[0].unread, true);
  assert.equal(result.notifications[1].unread, false);
  assert.equal(result.notifications[0].nodeName, '仕様確認');
});

test('marking a notification read appends one authenticated receipt and updates unread count', () => {
  const receipts = [];
  const comment = { CommentId: 'c1', NodeId: 'n1', Mentions: 'm1' };
  global.SHEET = { NODES: 'Nodes', MEMBERS: 'Members', COMMENTS: 'Comments', NOTIFICATION_READS: 'NotificationReads' };
  global.withLock_ = callback => callback();
  global.requireSchemaExists_ = () => {};
  global.readAll_ = () => ({
    nodes: [{ NodeId: 'n1', ParentId: '', Name: '仕様確認' }],
    members: [{ MemberId: 'm1', Name: '自分' }]
  });
  global.requireCurrentMember_ = members => members[0];
  global.activeNodes_ = nodes => nodes;
  global.byId_ = (items, key) => Object.fromEntries(items.map(item => [item[key], item]));
  global.readObjectsMatchingColumn_ = (sheet, _field, value) => {
    if (sheet === 'Comments') return value === 'c1' ? [comment] : [];
    return receipts.filter(receipt => receipt.NotificationKey === value || receipt.RecipientMemberId === value);
  };
  global.readSelectedColumns_ = sheet => sheet === 'Comments' ? [{
    __row: 2, CommentId: 'c1', NodeId: 'n1', Timestamp: '2026-07-01T00:00:00.000Z', Mentions: 'm1'
  }] : [];
  global.nowIso_ = () => '2026-07-04T00:00:00.000Z';
  global.appendObject_ = (_sheet, receipt) => receipts.push(receipt);

  const result = markNotificationRead({ notificationKey: 'mention:c1:m1', commentId: 'c1' });

  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].RecipientMemberId, 'm1');
  assert.equal(result.unreadCount, 0);
  markNotificationRead({ notificationKey: 'mention:c1:m1', commentId: 'c1' });
  assert.equal(receipts.length, 1);
});

test('notification navigation returns the target reply thread only after self-mention validation', () => {
  const index = [
    { __row: 2, CommentId: 'p1', NodeId: 'n1', ParentCommentId: '', Mentions: '' },
    { __row: 3, CommentId: 'r1', NodeId: 'n1', ParentCommentId: 'p1', Mentions: 'm1' },
    { __row: 4, CommentId: 'r2', NodeId: 'n1', ParentCommentId: 'p1', Mentions: '' },
    { __row: 5, CommentId: 'p2', NodeId: 'n1', ParentCommentId: '', Mentions: 'm1' }
  ];
  global.SHEET = { NODES: 'Nodes', MEMBERS: 'Members', COMMENTS: 'Comments' };
  global.requireSchemaExists_ = () => {};
  global.readAll_ = () => ({
    nodes: [{ NodeId: 'n1', ParentId: '', Name: '仕様確認' }],
    members: [{ MemberId: 'm1', Name: '自分' }]
  });
  global.requireCurrentMember_ = members => members[0];
  global.activeNodes_ = nodes => nodes;
  global.byId_ = (items, key) => Object.fromEntries(items.map(item => [item[key], item]));
  global.readSelectedColumns_ = () => index;
  global.readObjectsAtRows_ = (_sheet, rows) => index.filter(item => rows.includes(item.__row)).map(item => ({
    ...item,
    Timestamp: `2026-07-0${item.__row}T00:00:00.000Z`
  }));
  global.clientComment_ = comment => ({ id: comment.CommentId, timestamp: comment.Timestamp });

  const result = getNotificationCommentThread({ nodeId: 'n1', commentId: 'r1' });

  assert.deepEqual(result.comments.map(comment => comment.id), ['p1', 'r1', 'r2']);
  assert.throws(
    () => getNotificationCommentThread({ nodeId: 'n1', commentId: 'p1' }),
    /自分宛のメンション/
  );
});

test('bulk read appends only missing receipts for every current self mention', () => {
  const appended = [];
  global.SHEET = { NODES: 'Nodes', MEMBERS: 'Members', COMMENTS: 'Comments', NOTIFICATION_READS: 'NotificationReads' };
  global.withLock_ = callback => callback();
  global.requireSchemaExists_ = () => {};
  global.readAll_ = () => ({
    nodes: [{ NodeId: 'n1', ParentId: '', Name: '仕様確認' }],
    members: [{ MemberId: 'm1', Name: '自分' }]
  });
  global.requireCurrentMember_ = members => members[0];
  global.activeNodes_ = nodes => nodes;
  global.readSelectedColumns_ = sheet => sheet === 'Comments' ? [
    { __row: 2, CommentId: 'c1', NodeId: 'n1', Timestamp: '2026-07-01T00:00:00.000Z', Mentions: 'm1' },
    { __row: 3, CommentId: 'c2', NodeId: 'n1', Timestamp: '2026-07-02T00:00:00.000Z', Mentions: 'm1' }
  ] : [];
  global.readObjectsMatchingColumn_ = sheet => sheet === 'NotificationReads' ? [{
    NotificationKey: 'mention:c1:m1', RecipientMemberId: 'm1', ReadAt: '2026-07-03T00:00:00.000Z'
  }] : [];
  global.nowIso_ = () => '2026-07-04T00:00:00.000Z';
  global.appendObjects_ = (_sheet, receipts) => appended.push(...receipts);

  const result = markAllNotificationsRead();

  assert.equal(result.markedCount, 1);
  assert.equal(result.unreadCount, 0);
  assert.deepEqual(appended.map(receipt => receipt.NotificationKey), ['mention:c2:m1']);
});

test('notification memory cache skips fresh reloads and preserves stale cards while refreshing', async () => {
  const source = functionSlice(
    '../src/ClientActions.html',
    '    async function loadNotifications(',
    '    function toggleNotificationMenu('
  );
  let now = 20_000;
  let calls = 0;
  let resolveRefresh;
  const state = {
    currentMember: { id: 'm1' },
    notifications: [{ id: 'cached' }],
    notificationLoadedAt: 10_000,
    notificationLoading: false,
    notificationRefreshing: false,
    notificationLoadingMore: false,
    notificationMenuId: '',
    notificationPage: { hasMore: false, nextCursor: null },
    notificationUnreadCount: 1,
    notificationInboxOpen: true
  };
  const context = vm.createContext({
    state,
    NOTIFICATION_MEMORY_TTL_MS: 30_000,
    Date: { now: () => now },
    Map,
    render: () => {},
    persistLocalCache: () => {},
    showToast: () => {},
    serverCall: () => {
      calls += 1;
      return new Promise(resolve => { resolveRefresh = resolve; });
    }
  });
  vm.runInContext(source, context);

  await context.loadNotifications(true);
  assert.equal(calls, 0);
  assert.deepEqual(state.notifications, [{ id: 'cached' }]);

  now = 50_001;
  const refresh = context.loadNotifications(true);
  assert.equal(calls, 1);
  assert.equal(state.notificationLoading, false);
  assert.equal(state.notificationRefreshing, true);
  assert.deepEqual(state.notifications, [{ id: 'cached' }]);
  resolveRefresh({ notifications: [{ id: 'fresh' }], unreadCount: 0, hasMore: false, nextCursor: null });
  await refresh;
  assert.equal(state.notificationRefreshing, false);
  assert.deepEqual(state.notifications, [{ id: 'fresh' }]);
});

test('client notification box exposes bell badge, scrollable cards, read actions, and comment navigation', () => {
  const state = fs.readFileSync(new URL('../src/ClientState.html', import.meta.url), 'utf8');
  const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
  const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
  const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');
  const dataSync = fs.readFileSync(new URL('../src/ClientDataSync.html', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../src/Index.html', import.meta.url), 'utf8');

  assert.match(state, /bell:/);
  assert.match(state, /'more-horizontal'/);
  assert.match(views, /notification-badge/);
  assert.match(views, /mark-all-notifications-read/);
  assert.match(views, /mark-notification-read/);
  assert.match(views, /open-notification/);
  assert.match(actions, /getNotificationCommentThread/);
  assert.match(actions, /getCommentThread/);
  assert.match(actions, /markNotificationRead/);
  assert.match(actions, /NOTIFICATION_MEMORY_TTL_MS/);
  assert.match(actions, /notificationRefreshing/);
  assert.match(dataSync, /openInitialDeepLink/);
  assert.match(index, /__TASKBOARD_BOOTSTRAP_NODE_ID__/);
  assert.match(actions, /state\.drawerNodeId === notification\.nodeId/);
  assert.match(panels, /data-comment-id=/);
  assert.match(styles, /\.notification-popover[\s\S]*height: 520px/);
  assert.match(styles, /\.notification-list[\s\S]*overflow-y: auto/);
});
