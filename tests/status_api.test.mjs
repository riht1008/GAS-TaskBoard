import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.SHEET = { STATUS_COLUMNS: 'StatusColumns' };
global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.isTrue_ = value => value === true || String(value).toLowerCase() === 'true';
global.withLock_ = fn => fn();
global.requireSchemaExists_ = () => {};
global.requireCurrentMember_ = () => ({ MemberId: 'actor' });
global.requireName_ = value => {
  const name = global.cleanString_(value);
  if (!name) throw new Error('name');
  return name;
};
global.normalizeStatusColor_ = value => value || '#ddd';
global.assertExactlyOneDone_ = columns => {
  const done = columns.filter(column => global.isTrue_(column.IsDoneColumn));
  if (done.length !== 1) throw new Error('done invariant');
  return done[0].ColumnId;
};
global.doneStatusColumnId_ = columns => columns.find(column => global.isTrue_(column.IsDoneColumn)).ColumnId;
global.inProgressStatusColumnId_ = columns => (columns.find(column => global.isTrue_(column.IsInProgressColumn)) || columns.find(column => column.Name === '進行中') || {}).ColumnId || '';
global.ensureExactlyOneDone_ = columns => {
  const done = columns.filter(column => global.isTrue_(column.IsDoneColumn));
  if (done.length !== 1) throw new Error('done invariant');
};
global.clientStatusColumn_ = column => ({ id: column.ColumnId, isDoneColumn: column.IsDoneColumn, isInProgressColumn: column.IsInProgressColumn });
global.compareSortOrder_ = (a, b) => Number(a.SortOrder || a.sortOrder) - Number(b.SortOrder || b.sortOrder);
global.clientStatusColumns_ = columns => columns.map(global.clientStatusColumn_).sort(global.compareSortOrder_);
global.activeNodes_ = nodes => nodes;
global.deleteRow_ = () => {};

let rows;
let writes;
global.readStatusSnapshot_ = () => rows;
global.writeObjects_ = (_sheetName, objects) => {
  writes.push(objects.map(object => Object.assign({}, object)));
};
global.appendObject_ = () => { throw new Error('not used'); };

const require = createRequire(import.meta.url);
const { upsertStatusColumn } = require('../src/03_StatusApi.js');

test('switching the done column writes all status rows as one batch', () => {
  rows = {
    nodes: [],
    members: [{ MemberId: 'actor' }],
    statusColumns: [
      { __row: 2, ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false, IsInProgressColumn: false },
      { __row: 3, ColumnId: 'doing', Name: '進行中', SortOrder: 2000, IsDoneColumn: false, IsInProgressColumn: true },
      { __row: 4, ColumnId: 'done', Name: '完了', SortOrder: 3000, IsDoneColumn: true, IsInProgressColumn: false }
    ]
  };
  writes = [];

  const result = upsertStatusColumn({ columnId: 'todo', name: '未着手', isDoneColumn: true });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 3);
  assert.equal(writes[0].filter(column => column.IsDoneColumn === true).length, 1);
  assert.equal(result.statusColumns.find(column => column.id === 'todo').isDoneColumn, true);
});

test('renaming the in-progress column preserves its explicit rollup role', () => {
  rows = {
    nodes: [],
    members: [{ MemberId: 'actor' }],
    statusColumns: [
      { __row: 2, ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false, IsInProgressColumn: false },
      { __row: 3, ColumnId: 'doing', Name: '進行中', SortOrder: 2000, IsDoneColumn: false, IsInProgressColumn: true },
      { __row: 4, ColumnId: 'done', Name: '完了', SortOrder: 3000, IsDoneColumn: true, IsInProgressColumn: false }
    ]
  };
  writes = [];

  const result = upsertStatusColumn({ columnId: 'doing', name: 'レビュー中' });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter(column => column.IsInProgressColumn === true).length, 1);
  assert.equal(result.statusColumns.find(column => column.id === 'doing').isInProgressColumn, true);
});
