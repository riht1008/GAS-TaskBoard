import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();

const require = createRequire(import.meta.url);
const { addComment, commentPage_, getComments, getCommentThread, upsertMember } = require('../src/02_CollaborationApi.js');

test('member updates reject a Slack member ID already linked to someone else', () => {
  const members = [
    { MemberId: 'm1', Name: '鈴木', Email: 'suzuki@example.com', Color: '#1E6F5C', Company: '', SlackUserId: 'U012AB3CD' },
    { MemberId: 'm2', Name: '田中', Email: 'tanaka@example.com', Color: '#2F6FDB', Company: '', SlackUserId: '' }
  ];
  global.withLock_ = callback => callback();
  global.requireSchemaExists_ = () => {};
  global.readMemberSnapshot_ = () => ({ members });
  global.requireCurrentMember_ = () => members[0];
  global.normalizeEmail_ = value => String(value || '').trim().toLowerCase();
  global.requireName_ = value => String(value || '').trim();
  global.normalizeColor_ = value => String(value || '').trim();
  global.normalizeSlackUserId_ = value => {
    const id = String(value || '').trim().toUpperCase();
    if (id && !/^[UW][A-Z0-9]{2,31}$/.test(id)) throw new Error('invalid Slack member ID');
    return id;
  };

  assert.throws(() => upsertMember({
    memberId: 'm2',
    name: '田中',
    email: 'tanaka@example.com',
    color: '#2F6FDB',
    slackUserId: 'u012ab3cd'
  }), /同じSlackメンバーID/);
});

test('commentPage keeps replies with their parent and paginates parent threads', () => {
  const comments = [];
  for (let index = 1; index <= 12; index += 1) {
    comments.push({ id: `p${index}`, timestamp: `2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`, parentCommentId: '' });
  }
  comments.push({ id: 'r12', timestamp: '2026-07-12T01:00:00.000Z', parentCommentId: 'p12' });

  const page = commentPage_(comments, { limit: 10 });

  assert.equal(page.hasMore, true);
  assert.ok(page.comments.some(comment => comment.id === 'p12'));
  assert.ok(page.comments.some(comment => comment.id === 'r12'));
  assert.equal(page.nextCursor.beforeId, 'p3');
});

test('commentPage returns a bounded page from ten thousand threads', () => {
  const comments = Array.from({ length: 10000 }, (_, index) => ({
    id: `p${String(index).padStart(5, '0')}`,
    timestamp: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString(),
    parentCommentId: ''
  }));

  const page = commentPage_(comments, { limit: 50 });

  assert.equal(page.comments.length, 50);
  assert.equal(page.hasMore, true);
  assert.ok(page.nextCursor);
});

test('getComments hydrates only the selected page bodies after reading the lightweight index', () => {
  const index = Array.from({ length: 12 }, (_, offset) => ({
    __row: offset + 2,
    CommentId: `p${offset + 1}`,
    NodeId: 'n1',
    Timestamp: `2026-07-${String(offset + 1).padStart(2, '0')}T00:00:00.000Z`,
    ParentCommentId: ''
  }));
  let hydratedRows = [];
  global.SHEET = { COMMENTS: 'Comments' };
  global.requireSchemaExists_ = () => {};
  global.readCommentSnapshot_ = () => ({ nodes: [{ NodeId: 'n1' }], comments: index });
  global.activeNodes_ = nodes => nodes;
  global.byId_ = (items, key) => Object.fromEntries(items.map(item => [item[key], item]));
  global.readObjectsAtRows_ = (_sheet, rows) => {
    hydratedRows = rows.slice();
    return index.filter(item => rows.includes(item.__row)).map(item => ({
      ...item,
      AuthorId: 'm1',
      AuthorName: '投稿者',
      Text: `本文${item.CommentId}`,
      Mentions: ''
    }));
  };
  global.clientComment_ = comment => ({
    id: comment.CommentId,
    nodeId: comment.NodeId,
    timestamp: comment.Timestamp,
    text: comment.Text,
    parentCommentId: comment.ParentCommentId
  });

  const page = getComments('n1', { limit: 10 });

  assert.equal(page.comments.length, 10);
  assert.equal(hydratedRows.length, 10);
  assert.equal(page.hasMore, true);
  assert.ok(page.comments.every(comment => comment.text.startsWith('本文')));
});

test('getCommentThread hydrates an exact old comment thread for deep links', () => {
  const index = [
    { __row: 2, CommentId: 'p1', NodeId: 'n1', Timestamp: '2026-07-01T00:00:00.000Z', ParentCommentId: '' },
    { __row: 3, CommentId: 'r1', NodeId: 'n1', Timestamp: '2026-07-02T00:00:00.000Z', ParentCommentId: 'p1' },
    { __row: 4, CommentId: 'r2', NodeId: 'n1', Timestamp: '2026-07-03T00:00:00.000Z', ParentCommentId: 'p1' },
    { __row: 5, CommentId: 'p2', NodeId: 'n1', Timestamp: '2026-07-04T00:00:00.000Z', ParentCommentId: '' }
  ];
  global.SHEET = { COMMENTS: 'Comments' };
  global.requireSchemaExists_ = () => {};
  global.readCommentSnapshot_ = () => ({ nodes: [{ NodeId: 'n1' }], comments: index });
  global.activeNodes_ = nodes => nodes;
  global.byId_ = (items, key) => Object.fromEntries(items.map(item => [item[key], item]));
  global.readObjectsAtRows_ = (_sheet, rows) => index.filter(item => rows.includes(item.__row)).map(item => ({
    ...item,
    AuthorId: 'm1',
    AuthorName: '投稿者',
    Text: item.CommentId,
    Mentions: ''
  }));
  global.clientComment_ = comment => ({ id: comment.CommentId, parentCommentId: comment.ParentCommentId });
  global.appError_ = (_code, message) => new Error(message);

  const result = getCommentThread({ nodeId: 'n1', commentId: 'r1' });

  assert.deepEqual(result.comments.map(comment => comment.id), ['p1', 'r1', 'r2']);
});

test('addComment posts one mention notification after releasing the sheet lock', () => {
  let insideLock = false;
  const events = [];
  const rows = {
    nodes: [{ NodeId: 'root', ParentId: '', Name: '案件' }, { NodeId: 'n1', ParentId: 'root', Name: '仕様確認' }],
    members: [{ MemberId: 'm1', Name: '投稿者' }, { MemberId: 'm2', Name: '確認者' }],
    comments: []
  };
  global.SHEET = { COMMENTS: 'Comments' };
  global.withLock_ = callback => {
    insideLock = true;
    try {
      return callback();
    } finally {
      insideLock = false;
    }
  };
  global.requireSchemaExists_ = () => {};
  global.readCommentSnapshot_ = () => rows;
  global.requireCurrentMember_ = () => rows.members[0];
  global.activeNodes_ = nodes => nodes;
  global.byId_ = (items, key) => Object.fromEntries(items.map(item => [item[key], item]));
  global.unique_ = values => Array.from(new Set(values));
  global.splitCsv_ = value => String(value || '').split(',').filter(Boolean);
  global.newId_ = () => 'generated-comment';
  global.nowIso_ = () => '2026-07-17T00:00:00.000Z';
  global.appendObject_ = () => events.push(insideLock ? 'append:locked' : 'append:unlocked');
  global.clientComment_ = comment => ({ id: comment.CommentId, nodeId: comment.NodeId, mentions: String(comment.Mentions || '').split(',').filter(Boolean) });
  global.buildMentionNotification_ = (node, comment, actor, mentionedMembers) => {
    assert.equal(insideLock, true);
    assert.equal(node.NodeId, 'n1');
    assert.equal(comment.Text, '@確認者 お願いします');
    assert.deepEqual(mentionedMembers.map(member => member.MemberId), ['m2']);
    return { text: 'mention payload' };
  };
  global.postToSlack_ = (payload, options) => {
    assert.equal(insideLock, false);
    events.push('post:' + options.type + ':' + payload.text);
    return { ok: true };
  };
  global.attachPublicSlackSettings_ = payload => {
    payload.slackSettings = { mentionEnabled: true };
    return payload;
  };

  const result = addComment({
    commentId: 'c1',
    nodeId: 'n1',
    text: '@確認者 お願いします',
    mentions: ['m2', 'missing']
  });

  assert.deepEqual(events, ['append:locked', 'post:mention:mention payload']);
  assert.deepEqual(result.comment.mentions, ['m2']);
  assert.equal(result.slackSettings.mentionEnabled, true);

  events.length = 0;
  const withoutValidMention = addComment({
    commentId: 'c2',
    nodeId: 'n1',
    text: '通常コメント',
    mentions: ['missing']
  });
  assert.deepEqual(events, ['append:locked']);
  assert.deepEqual(withoutValidMention.comment.mentions, []);
  assert.equal(withoutValidMention.slackSettings, undefined);
});
