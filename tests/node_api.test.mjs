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
global.appError_ = (code, message) => Object.assign(new Error(message), { code });
global.validateNodeTree_ = () => true;
global.normalizeManualProgress_ = (value, allowBlank) => {
  if (allowBlank && String(value ?? '').trim() === '') return '';
  const numeric = Number(value);
  if (![0, 15, 30, 45, 60, 75, 90, 100].includes(numeric)) throw new Error('進捗率が不正です。');
  return numeric;
};
global.validateStatusId_ = (id, columns) => {
  if (!columns.some(column => column.ColumnId === id)) throw new Error('ステータス列が見つかりません。');
  return id;
};
global.requireName_ = value => {
  const name = String(value || '').trim();
  if (!name) throw new Error('名称を入力してください。');
  return name;
};
global.normalizeAssigneeIds_ = (ids, members) => ids.filter(id => members.some(member => member.MemberId === id));
global.normalizePriority_ = value => value || 'Mid';
global.normalizeIncludeInWbs_ = value => value !== false;
global.normalizeSchedule_ = (startDate, endDate) => ({ startDate: startDate || '', endDate: endDate || '' });
global.normalizeActualDates_ = (startDate, endDate) => ({ startDate: startDate || '', endDate: endDate || '' });
global.sortByOrder_ = rows => rows.slice().sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
global.nodeHasDependency_ = (nodeId, dependencies) => dependencies.some(dependency =>
  dependency.PredecessorNodeId === nodeId || dependency.SuccessorNodeId === nodeId
);
global.optionalName_ = value => String(value || '').trim();
global.nextSortOrder_ = siblings => siblings.length
  ? Math.max(...siblings.map(node => Number(node.SortOrder) || 0)) + 1000
  : 1000;
global.splitCsv_ = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
global.DRAFT_TTL_MS = 60000;
global.buildAssignmentNotification_ = () => null;
global.postToSlack_ = () => {};
global.attachPublicSlackSettings_ = () => {};
let generatedId = 0;
global.newId_ = () => `generated-${++generatedId}`;

const require = createRequire(import.meta.url);
const { addNodes, rollupParentStatuses_, restoreNode, deleteNode, cleanupExpiredDraftNodes_, applyNodePatch_, nodeBaseVersionMatches_ } = require('../src/01_NodeApi.js');

const statusColumns = [
  { ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false, IsInProgressColumn: false },
  { ColumnId: 'doing', Name: '進行中', SortOrder: 2000, IsDoneColumn: false, IsInProgressColumn: true },
  { ColumnId: 'done', Name: '完了', SortOrder: 3000, IsDoneColumn: true, IsInProgressColumn: false }
];

test('addNodes appends many tasks in one sheet write and one snapshot read', () => {
  mockRows = {
    statusColumns,
    members: [{ MemberId: 'actor-1' }, { MemberId: 'member-2' }],
    dependencies: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo', SortOrder: 1000 }
    ]
  };
  writes = [];
  let snapshotReads = 0;
  let appendCalls = 0;
  global.readNodeSnapshot_ = () => {
    snapshotReads += 1;
    return mockRows;
  };
  global.appendObjects_ = (sheetName, objects) => {
    appendCalls += 1;
    assert.equal(sheetName, 'Nodes');
    objects.forEach((object, index) => {
      object.__row = index + 2;
    });
    return objects;
  };

  const result = addNodes({
    requestId: 'batch-1',
    nodes: [
      { nodeId: 'batch-a', parentId: 'root', name: 'A' },
      { nodeId: 'batch-b', parentId: 'root', name: 'B', assigneeIds: ['member-2'] },
      { nodeId: 'batch-c', parentId: 'root', name: 'C' }
    ]
  });

  assert.equal(snapshotReads, 1);
  assert.equal(appendCalls, 1);
  assert.equal(result.createdCount, 3);
  assert.deepEqual(result.createdNodeIds, ['batch-a', 'batch-b', 'batch-c']);
  assert.deepEqual(
    mockRows.nodes.filter(node => node.ParentId === 'root').map(node => node.SortOrder),
    [1000, 2000, 3000]
  );
});

test('addNodes validates the whole batch before writing any rows', () => {
  mockRows = {
    statusColumns,
    members: [{ MemberId: 'actor-1' }],
    dependencies: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo', SortOrder: 1000 }
    ]
  };
  let appendCalls = 0;
  global.readNodeSnapshot_ = () => mockRows;
  global.appendObjects_ = () => {
    appendCalls += 1;
  };

  assert.throws(() => addNodes({
    nodes: [
      { nodeId: 'valid', parentId: 'root', name: 'Valid' },
      { nodeId: 'invalid', parentId: 'missing', name: 'Invalid' }
    ]
  }), /2件目の親ノード/);
  assert.equal(appendCalls, 0);
});

test('addNodes accepts an idempotent replay without appending duplicates', () => {
  mockRows = {
    statusColumns,
    members: [{ MemberId: 'actor-1' }],
    dependencies: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo', SortOrder: 1000 },
      { NodeId: 'existing', ParentId: 'root', Name: 'Existing', StatusColumnId: 'todo', SortOrder: 1000 }
    ]
  };
  let appendCalls = 0;
  global.readNodeSnapshot_ = () => mockRows;
  global.appendObjects_ = (_sheetName, objects) => {
    appendCalls += 1;
    return objects;
  };

  const result = addNodes({
    requestId: 'retry',
    nodes: [{ nodeId: 'existing', parentId: 'root', name: 'Existing' }]
  });

  assert.equal(appendCalls, 0);
  assert.equal(result.createdCount, 0);
  assert.deepEqual(result.createdNodeIds, ['existing']);
});

test('existing node mutations require an explicit matching base version', () => {
  const node = { UpdatedAt: 'v2', DraftOwner: '' };
  const actor = { MemberId: 'actor-1' };
  assert.throws(() => nodeBaseVersionMatches_({}, node, actor, false), error => error.code === 'BASE_VERSION_REQUIRED');
  assert.equal(nodeBaseVersionMatches_({ baseUpdatedAt: 'v1' }, node, actor, false), false);
  assert.equal(nodeBaseVersionMatches_({ baseUpdatedAt: 'v2' }, node, actor, false), true);
});

test('only the owner may save a draft shell without a base version', () => {
  const node = { UpdatedAt: 'v2', DraftOwner: 'actor-1' };
  assert.equal(nodeBaseVersionMatches_({}, node, { MemberId: 'actor-1' }, true), true);
  assert.throws(
    () => nodeBaseVersionMatches_({}, node, { MemberId: 'actor-2' }, true),
    error => error.code === 'BASE_VERSION_REQUIRED'
  );
});

test('applyNodePatch changes only supplied fields and keeps unrelated values', () => {
  const node = {
    NodeId: 'leaf', ParentId: 'root', Name: '元の名前', StatusColumnId: 'todo',
    AssigneeIds: 'm1', Priority: 'Mid', Description: '変更前', Progress: 15
  };
  const rows = {
    nodes: [{ NodeId: 'root', ParentId: '' }, node],
    members: [{ MemberId: 'm1' }],
    statusColumns
  };

  applyNodePatch_(node, { description: '変更後' }, rows);

  assert.equal(node.Description, '変更後');
  assert.equal(node.Name, '元の名前');
  assert.equal(node.AssigneeIds, 'm1');
  assert.equal(node.Progress, 15);
});

test('applyNodePatch enforces leaf progress and done-status invariants', () => {
  const leaf = { NodeId: 'leaf', ParentId: 'root', StatusColumnId: 'todo', Progress: 90 };
  const rows = {
    nodes: [{ NodeId: 'root', ParentId: '' }, leaf],
    members: [],
    statusColumns
  };
  applyNodePatch_(leaf, { progress: 100 }, rows);
  assert.equal(leaf.StatusColumnId, 'done');
  assert.equal(leaf.Progress, 100);

  const parent = { NodeId: 'parent', ParentId: 'root', StatusColumnId: 'todo', Progress: '' };
  rows.nodes = [{ NodeId: 'root', ParentId: '' }, parent, { NodeId: 'child', ParentId: 'parent', StatusColumnId: 'todo' }];
  assert.throws(() => applyNodePatch_(parent, { progress: 15 }, rows), /親タスク/);
});

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
