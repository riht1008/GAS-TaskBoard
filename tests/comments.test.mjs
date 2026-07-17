import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();

const require = createRequire(import.meta.url);
const { addComment, commentPage_ } = require('../src/02_CollaborationApi.js');

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
