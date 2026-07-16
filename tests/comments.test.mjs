import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();

const require = createRequire(import.meta.url);
const { commentPage_ } = require('../src/02_CollaborationApi.js');

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
