import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.SHEET = { STATUS_COLUMNS: 'StatusColumns', NODES: 'Nodes' };
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
global.clientStatusColumn_ = column => ({ id: column.ColumnId, isDoneColumn: column.IsDoneColumn, isInProgressColumn: column.IsInProgressColumn });
global.compareSortOrder_ = (a, b) => Number(a.SortOrder || a.sortOrder) - Number(b.SortOrder || b.sortOrder);
global.clientStatusColumns_ = columns => columns.map(global.clientStatusColumn_).sort(global.compareSortOrder_);
global.activeNodes_ = nodes => nodes;
global.validateNodeTree_ = () => {};
global.deleteRow_ = () => {};
global.nowIso_ = () => '2026-07-16T00:00:00.000Z';
global.childrenMap_ = nodes => nodes.reduce((map, node) => {
  const parentId = global.cleanString_(node.ParentId);
  if (!map[parentId]) map[parentId] = [];
  map[parentId].push(global.cleanString_(node.NodeId));
  return map;
}, {});
global.byId_ = (objects, idField) => objects.reduce((map, object) => {
  map[global.cleanString_(object[idField])] = object;
  return map;
}, {});
global.validManualProgress_ = value => value === '' || value === undefined ? null : Number(value);
global.clientNodes_ = (snapshot, ids) => snapshot.nodes.filter(node => ids.includes(node.NodeId));

let rows;
let writes;
global.readStatusSnapshot_ = () => rows;
global.writeObjects_ = (_sheetName, objects) => {
  writes.push(objects.map(object => Object.assign({}, object)));
};
global.appendObject_ = () => { throw new Error('not used'); };

const require = createRequire(import.meta.url);
const { upsertStatusColumn, normalizeNodesForStatusRoles_ } = require('../src/03_StatusApi.js');

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

test('switching status roles normalizes leaf progress and rolls parent statuses up', () => {
  const snapshot = {
    statusColumns: [
      { ColumnId: 'todo', IsDoneColumn: false, IsInProgressColumn: false },
      { ColumnId: 'doing', IsDoneColumn: false, IsInProgressColumn: true },
      { ColumnId: 'done', IsDoneColumn: true, IsInProgressColumn: false }
    ],
    nodes: [
      { __row: 2, NodeId: 'root', ParentId: '', StatusColumnId: 'done', Progress: '' },
      { __row: 3, NodeId: 'old-done', ParentId: 'root', StatusColumnId: 'done', Progress: 100 },
      { __row: 4, NodeId: 'new-done', ParentId: 'root', StatusColumnId: 'todo', Progress: 30 }
    ]
  };
  snapshot.statusColumns.forEach(column => {
    column.IsDoneColumn = column.ColumnId === 'todo';
  });

  const changed = normalizeNodesForStatusRoles_(snapshot, 'done', 'actor');

  assert.equal(snapshot.nodes.find(node => node.NodeId === 'old-done').Progress, 90);
  assert.equal(snapshot.nodes.find(node => node.NodeId === 'new-done').Progress, 100);
  assert.equal(snapshot.nodes.find(node => node.NodeId === 'root').StatusColumnId, 'doing');
  assert.deepEqual(Object.keys(changed).sort(), ['new-done', 'old-done', 'root']);
});

test('done role switch returns every node after writing normalized node rows', () => {
  rows = {
    members: [{ MemberId: 'actor' }],
    statusColumns: [
      { __row: 2, ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false, IsInProgressColumn: false },
      { __row: 3, ColumnId: 'doing', Name: '進行中', SortOrder: 2000, IsDoneColumn: false, IsInProgressColumn: true },
      { __row: 4, ColumnId: 'done', Name: '完了', SortOrder: 3000, IsDoneColumn: true, IsInProgressColumn: false }
    ],
    nodes: [
      { __row: 2, NodeId: 'root', ParentId: '', StatusColumnId: 'done', Progress: '' },
      { __row: 3, NodeId: 'old-done', ParentId: 'root', StatusColumnId: 'done', Progress: 100 },
      { __row: 4, NodeId: 'new-done', ParentId: 'root', StatusColumnId: 'todo', Progress: 30 }
    ]
  };
  writes = [];

  const result = upsertStatusColumn({ columnId: 'todo', name: '未着手', isDoneColumn: true, requestId: 'r1' });

  assert.deepEqual(writes.map(write => write.map(row => row.NodeId || row.ColumnId)), [
    ['todo', 'doing', 'done'],
    ['old-done', 'new-done', 'root']
  ]);
  assert.equal(result.requestId, 'r1');
  assert.equal(result.nodes.length, 3);
});
