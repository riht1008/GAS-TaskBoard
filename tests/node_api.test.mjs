import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.isTrue_ = value => value === true || String(value).toLowerCase() === 'true';
global.activeNodes_ = nodes => nodes.filter(node => !global.cleanString_(node.DeletedAt));
global.byId_ = (rows, idField) => rows.reduce((map, row) => {
  map[global.cleanString_(row[idField])] = row;
  return map;
}, {});
global.childrenMap_ = nodes => nodes.reduce((map, node) => {
  const parentId = global.cleanString_(node.ParentId);
  if (!map[parentId]) map[parentId] = [];
  map[parentId].push(global.cleanString_(node.NodeId));
  return map;
}, {});
global.collectDescendantIds_ = (nodeId, children) => {
  const result = [];
  const stack = (children[nodeId] || []).slice();
  while (stack.length) {
    const id = stack.shift();
    result.push(id);
    (children[id] || []).forEach(childId => stack.push(childId));
  }
  return result;
};
global.ancestorIds_ = (nodeId, activeNodes) => {
  const nodesById = global.byId_(activeNodes, 'NodeId');
  const result = [];
  let current = nodesById[nodeId];
  while (current && global.cleanString_(current.ParentId)) {
    const parentId = global.cleanString_(current.ParentId);
    if (result.includes(parentId)) break;
    result.push(parentId);
    current = nodesById[parentId];
  }
  return result;
};
global.unique_ = values => Array.from(new Set((values || []).map(global.cleanString_).filter(Boolean)));
global.doneStatusColumnId_ = statusColumns => global.cleanString_((statusColumns.find(column => column.IsDoneColumn) || statusColumns[0] || {}).ColumnId);
global.nowIso_ = () => '2026-07-05T00:00:00.000Z';
global.cloneRow_ = row => Object.assign({}, row);
global.ancestorIdsForMany_ = (ids, activeNodes) => global.unique_((ids || []).flatMap(id => global.ancestorIds_(id, activeNodes)));
global.validateDependencySet_ = (_active, dependencies) => dependencies || [];
global.rescheduleFromSeeds_ = () => ({ shiftedIds: [] });
global.withLock_ = fn => fn();
global.requireSchemaExists_ = () => {};
global.requireCurrentMember_ = () => ({ MemberId: 'actor-1' });
global.SHEET = { NODES: 'Nodes' };

let mockRows = null;
let writes = [];
global.readNodeSnapshot_ = () => mockRows;
global.writeObjects_ = (sheetName, objects) => {
  writes.push({ sheetName, objects: objects.map(row => Object.assign({}, row)) });
  objects.forEach(object => {
    const index = mockRows.nodes.findIndex(node => node.NodeId === object.NodeId);
    if (index >= 0) mockRows.nodes[index] = Object.assign({}, object);
  });
};
global.makeMutationPayload_ = (rows, affectedIds, requestId, extra) => Object.assign({
  ok: true,
  requestId,
  nodes: global.activeNodes_(rows.nodes).filter(node => affectedIds.includes(node.NodeId))
}, extra || {});
global.clientNodes_ = (rows, affectedIds) => global.activeNodes_(rows.nodes).filter(node => affectedIds.includes(node.NodeId));
global.makeConflictPayload_ = (_rows, nodeId, requestId) => ({ ok: false, code: 'CONFLICT', nodeId, requestId });

const require = createRequire(import.meta.url);
const { rollupParentStatuses_, restoreNode, deleteNode, cleanupExpiredDraftNodes_ } = require('../src/01_NodeApi.js');

const statusColumns = [
  { ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false, IsInProgressColumn: false },
  { ColumnId: 'doing', Name: '進行中', SortOrder: 2000, IsDoneColumn: false, IsInProgressColumn: true },
  { ColumnId: 'done', Name: '完了', SortOrder: 3000, IsDoneColumn: true, IsInProgressColumn: false }
];

function rowsWithChildren(childStatuses, parentStatus = 'todo') {
  return {
    statusColumns,
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      { NodeId: 'parent', ParentId: 'root', Name: 'Parent', StatusColumnId: parentStatus },
      ...childStatuses.map((status, index) => ({
        NodeId: `child${index + 1}`,
        ParentId: 'parent',
        Name: `Child ${index + 1}`,
        StatusColumnId: status
      }))
    ]
  };
}

test('rollup sets parent to in progress when any child is done but not all are done', () => {
  const rows = rowsWithChildren(['done', 'todo']);
  const writeMap = {};
  const changedIds = rollupParentStatuses_(rows, ['child1'], 'actor-1', writeMap);

  assert.equal(rows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'doing');
  assert.equal(writeMap.parent.StatusColumnId, 'doing');
  assert.equal(writeMap.parent.UpdatedBy, 'actor-1');
  assert.ok(changedIds.includes('parent'));
});

test('rollup propagates partial completion to ancestors', () => {
  const rows = rowsWithChildren(['done', 'todo']);
  const writeMap = {};
  const changedIds = rollupParentStatuses_(rows, ['child1'], 'actor-1', writeMap);

  assert.equal(rows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'doing');
  assert.equal(rows.nodes.find(node => node.NodeId === 'root').StatusColumnId, 'doing');
  assert.equal(writeMap.root.StatusColumnId, 'doing');
  assert.deepEqual(changedIds, ['parent', 'root']);
});

test('rollup keeps all-done children in the done status', () => {
  const rows = rowsWithChildren(['done', 'done']);
  const writeMap = {};
  rollupParentStatuses_(rows, ['child1'], 'actor-1', writeMap);

  assert.equal(rows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'done');
  assert.equal(writeMap.parent.StatusColumnId, 'done');
});

test('rollup leaves untouched parents as not started when all children are not started', () => {
  const rows = rowsWithChildren(['todo', 'todo']);
  const writeMap = {};
  const changedIds = rollupParentStatuses_(rows, ['child1'], 'actor-1', writeMap);

  assert.equal(rows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'todo');
  assert.deepEqual(writeMap, {});
  assert.deepEqual(changedIds, []);
});

test('restoreNode restores a deleted subtree and rolls parent statuses up', () => {
  mockRows = {
    statusColumns,
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      { NodeId: 'parent', ParentId: 'root', Name: 'Parent', StatusColumnId: 'todo', DeletedAt: '2026-07-04T00:00:00.000Z', DeletedBy: 'actor-1' },
      { NodeId: 'child', ParentId: 'parent', Name: 'Child', StatusColumnId: 'done', DeletedAt: '2026-07-04T00:00:00.000Z', DeletedBy: 'actor-1' }
    ]
  };
  writes = [];

  const result = restoreNode({ nodeId: 'parent', requestId: 'req-1' });

  assert.deepEqual(result.restoredNodeIds, ['parent', 'child']);
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'parent').DeletedAt, '');
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'child').DeletedAt, '');
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'done');
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'root').StatusColumnId, 'done');
  assert.equal(writes[0].sheetName, 'Nodes');
  assert.equal(result.requestId, 'req-1');
});

test('restoreNode does not restore descendants deleted by older operations', () => {
  mockRows = {
    statusColumns,
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      { NodeId: 'parent', ParentId: 'root', Name: 'Parent', StatusColumnId: 'todo', DeletedAt: '2026-07-04T00:00:00.000Z', DeletedBy: 'actor-1' },
      { NodeId: 'current-child', ParentId: 'parent', Name: 'Current Child', StatusColumnId: 'done', DeletedAt: '2026-07-04T00:00:00.000Z', DeletedBy: 'actor-1' },
      { NodeId: 'old-child', ParentId: 'parent', Name: 'Old Child', StatusColumnId: 'todo', DeletedAt: '2026-06-20T00:00:00.000Z', DeletedBy: 'actor-2' }
    ]
  };
  writes = [];

  const result = restoreNode({ nodeId: 'parent', requestId: 'req-old-child' });

  assert.deepEqual(result.restoredNodeIds, ['parent', 'current-child']);
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'parent').DeletedAt, '');
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'current-child').DeletedAt, '');
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'old-child').DeletedAt, '2026-06-20T00:00:00.000Z');
  assert.ok(writes[0].objects.some(node => node.NodeId === 'parent'));
  assert.ok(writes[0].objects.some(node => node.NodeId === 'current-child'));
  assert.ok(!writes[0].objects.some(node => node.NodeId === 'old-child'));
});

test('restoreNode rejects restoring a child whose parent is still deleted', () => {
  mockRows = {
    statusColumns,
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      { NodeId: 'parent', ParentId: 'root', Name: 'Parent', StatusColumnId: 'todo', DeletedAt: '2026-07-04T00:00:00.000Z', DeletedBy: 'actor-1' },
      { NodeId: 'child', ParentId: 'parent', Name: 'Child', StatusColumnId: 'todo', DeletedAt: '2026-07-04T00:00:00.000Z', DeletedBy: 'actor-1' }
    ]
  };
  writes = [];

  assert.throws(
    () => restoreNode({ nodeId: 'child', requestId: 'req-2' }),
    /親タスクが削除済み/
  );
  assert.deepEqual(writes, []);
});

test('deleteNode refuses when the confirmed subtree changed', () => {
  mockRows = {
    statusColumns,
    members: [{ MemberId: 'actor-1' }],
    dependencies: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      { NodeId: 'parent', ParentId: 'root', Name: 'Parent', StatusColumnId: 'todo', UpdatedAt: 'v1' },
      { NodeId: 'new-child', ParentId: 'parent', Name: 'New Child', StatusColumnId: 'todo', UpdatedAt: 'v2' }
    ]
  };
  writes = [];

  const result = deleteNode({
    nodeId: 'parent',
    baseUpdatedAt: 'v1',
    expectedTargetIds: ['parent'],
    requestId: 'delete-1'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'DELETE_SCOPE_CHANGED');
  assert.deepEqual(writes, []);
});

test('expired draft nodes are soft-deleted while normal nodes remain active', () => {
  mockRows = {
    statusColumns,
    members: [{ MemberId: 'actor-1' }],
    dependencies: [],
    nodes: [
      { __row: 2, NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      {
        __row: 3,
        NodeId: 'expired',
        ParentId: 'root',
        Name: '',
        StatusColumnId: 'todo',
        DraftOwner: 'actor-1',
        DraftExpiresAt: '2026-07-15T00:00:00.000Z'
      },
      {
        __row: 4,
        NodeId: 'fresh',
        ParentId: 'root',
        Name: '',
        StatusColumnId: 'todo',
        DraftOwner: 'actor-1',
        DraftExpiresAt: '2026-07-17T00:00:00.000Z'
      },
      { __row: 5, NodeId: 'normal', ParentId: 'root', Name: 'Task', StatusColumnId: 'todo', DraftOwner: '' }
    ]
  };
  writes = [];

  const deletedIds = cleanupExpiredDraftNodes_(mockRows, Date.parse('2026-07-16T00:00:00.000Z'));

  assert.deepEqual(deletedIds, ['expired']);
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'expired').DeletedAt, '2026-07-16T00:00:00.000Z');
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'fresh').DeletedAt, undefined);
  assert.equal(mockRows.nodes.find(node => node.NodeId === 'normal').DeletedAt, undefined);
  assert.equal(writes.length, 1);
});
