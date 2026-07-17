import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.appError_ = (code, message) => Object.assign(new Error(message), { code });
global.isValidDate_ = value => {
  const text = global.cleanString_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
global.dateToDay_ = value => Date.parse(`${value}T00:00:00.000Z`) / 86400000;

const require = createRequire(import.meta.url);
const { validateNodeTree_, normalizeActualDates_ } = require('../src/07_Validation.js');

test('actual dates accept a complete range or automatic blank state', () => {
  assert.deepEqual(normalizeActualDates_('', ''), { startDate: '', endDate: '' });
  assert.deepEqual(normalizeActualDates_('2026-07-10', '2026-07-12'), {
    startDate: '2026-07-10',
    endDate: '2026-07-12'
  });
  assert.throws(() => normalizeActualDates_('2026-07-10', ''), /両方を入力/);
  assert.throws(() => normalizeActualDates_('2026-07-12', '2026-07-10'), /実績着手日以降/);
});

test('node tree validation accepts one connected acyclic root tree', () => {
  assert.equal(validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'group', ParentId: 'root' },
    { NodeId: 'task', ParentId: 'group' }
  ]), true);
});

test('node tree validation rejects orphan nodes', () => {
  assert.throws(() => validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'orphan', ParentId: 'missing' }
  ]), error => error.code === 'NODE_TREE_INVALID' && /親ノード/.test(error.message));
});

test('node tree validation rejects hierarchy cycles and duplicate ids', () => {
  assert.throws(() => validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'a', ParentId: 'b' },
    { NodeId: 'b', ParentId: 'a' }
  ]), error => error.code === 'NODE_TREE_INVALID' && /循環/.test(error.message));
  assert.throws(() => validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'root', ParentId: '' }
  ]), error => error.code === 'NODE_TREE_INVALID' && /重複/.test(error.message));
});
