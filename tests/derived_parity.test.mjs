import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.childrenMap_ = nodes => nodes.reduce((map, node) => {
  const parentId = global.cleanString_(node.ParentId);
  if (!map[parentId]) map[parentId] = [];
  map[parentId].push(global.cleanString_(node.NodeId));
  return map;
}, {});
global.byId_ = (rows, idField) => rows.reduce((map, row) => {
  map[global.cleanString_(row[idField])] = row;
  return map;
}, {});
global.doneStatusColumnId_ = columns => columns.filter(column => column.IsDoneColumn === true)[0].ColumnId;
global.validManualProgress_ = value => {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return [0, 15, 30, 45, 60, 75, 90, 100].includes(numeric) ? numeric : null;
};
global.effectiveLeafProgress_ = (node, doneId) => node.StatusColumnId === doneId
  ? 100
  : (global.validManualProgress_(node.Progress) ?? 0);
global.hasSchedule_ = node => Boolean(node && /^\d{4}-\d{2}-\d{2}$/.test(node.StartDate || '') && /^\d{4}-\d{2}-\d{2}$/.test(node.EndDate || '') && node.StartDate <= node.EndDate);
global.SHEET = { ACTIVITY_LOG: 'ActivityLog' };
global.sheetWasLoaded_ = rows => Boolean(rows.__loadedSheets && rows.__loadedSheets.ActivityLog);
global.formatDateOnlyCell_ = date => date.toISOString().slice(0, 10);
global.isTrue_ = value => value === true || String(value).toLowerCase() === 'true';

const require = createRequire(import.meta.url);
const { computeDerived_, clientActivityActuals_ } = require('../src/05_Payloads.js');

test('client activity actuals are derived only when the activity sheet was loaded', () => {
  const derived = { task: { progress: 100 } };
  const unloaded = clientActivityActuals_({ activityLog: [] }, derived);
  const loaded = clientActivityActuals_({
    __loadedSheets: { ActivityLog: true },
    activityLog: [
      { NodeId: 'task', Field: 'progress', NewValue: 15, NewValueIsDone: false, ChangedAt: '2026-07-02T00:00:00.000Z' },
      { NodeId: 'task', Field: 'status', NewValue: 'done', NewValueIsDone: true, ChangedAt: '2026-07-05T00:00:00.000Z' }
    ]
  }, derived);

  assert.equal(unloaded, null);
  assert.deepEqual(loaded.task, { startDate: '2026-07-02', endDate: '2026-07-05' });
});

function clientRecomputeSource() {
  const source = fs.readFileSync(new URL('../src/ClientDataSync.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function recomputeClientDerived()');
  if (start < 0) throw new Error('client derived function not found');
  return source.slice(start);
}

function clientRollupSource() {
  const source = fs.readFileSync(new URL('../src/ClientUtils.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function rollupLocalParentStatuses(');
  const end = source.indexOf('    function priorityLabel(', start);
  if (start < 0 || end < 0) throw new Error('client rollup function not found');
  return source.slice(start, end);
}

test('server and client derived progress and rollup bounds stay equivalent', () => {
  const serverNodes = [
    { NodeId: 'root', ParentId: '', StatusColumnId: 'todo', Progress: '', StartDate: '', EndDate: '' },
    { NodeId: 'group', ParentId: 'root', StatusColumnId: 'doing', Progress: '', StartDate: '2026-07-02', EndDate: '2026-07-20' },
    { NodeId: 'a', ParentId: 'group', StatusColumnId: 'done', Progress: 100, StartDate: '2026-07-01', EndDate: '2026-07-03' },
    { NodeId: 'b', ParentId: 'group', StatusColumnId: 'doing', Progress: 45, StartDate: '2026-07-10', EndDate: '2026-07-15' },
    { NodeId: 'c', ParentId: 'root', StatusColumnId: 'todo', Progress: '', StartDate: '', EndDate: '' }
  ];
  const serverStatuses = [
    { ColumnId: 'todo', IsDoneColumn: false },
    { ColumnId: 'doing', IsDoneColumn: false },
    { ColumnId: 'done', IsDoneColumn: true }
  ];
  const expected = computeDerived_(serverNodes, serverStatuses);

  const clientNodes = serverNodes.map(node => ({
    id: node.NodeId,
    parentId: node.ParentId,
    statusColumnId: node.StatusColumnId,
    manualProgress: global.validManualProgress_(node.Progress),
    startDate: node.StartDate,
    endDate: node.EndDate
  }));
  const state = {
    nodes: clientNodes,
    nodesById: new Map(clientNodes.map(node => [node.id, node])),
    statusColumns: serverStatuses.map(column => ({ id: column.ColumnId, isDoneColumn: column.IsDoneColumn })),
    childrenByParent: new Map()
  };
  const context = vm.createContext({
    state,
    Map,
    normalizeProgressValue: global.validManualProgress_
  });
  vm.runInContext(clientRecomputeSource(), context);
  context.recomputeClientDerived();

  clientNodes.forEach(node => {
    assert.deepEqual({
      hasChildren: node.hasChildren,
      progress: node.progress,
      displayStartDate: node.displayStartDate,
      displayEndDate: node.displayEndDate
    }, expected[node.id]);
  });
});

test('client parent status rollup ignores unfinished draft children', () => {
  const state = {
    nodes: [
      { id: 'parent', parentId: '', statusColumnId: 'done' },
      { id: 'real', parentId: 'parent', statusColumnId: 'done' },
      { id: 'draft', parentId: 'parent', statusColumnId: 'todo', isDraft: true }
    ]
  };
  const context = vm.createContext({
    state,
    Map,
    Set,
    doneStatusColumnId: () => 'done',
    inProgressStatusColumnId: () => 'doing'
  });
  vm.runInContext(clientRollupSource(), context);

  context.rollupLocalParentStatuses(['draft']);

  assert.equal(state.nodes.find(node => node.id === 'parent').statusColumnId, 'done');
});
