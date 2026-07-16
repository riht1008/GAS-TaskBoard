import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.byId_ = (rows, idField) => rows.reduce((map, row) => {
  map[global.cleanString_(row[idField])] = row;
  return map;
}, {});
global.childrenMap_ = nodes => nodes.reduce((map, row) => {
  const parentId = global.cleanString_(row.ParentId);
  if (!map[parentId]) map[parentId] = [];
  map[parentId].push(global.cleanString_(row.NodeId));
  return map;
}, {});
global.visibleDependencies_ = (dependencies, nodesById) => dependencies.filter(dep => (
  nodesById[global.cleanString_(dep.PredecessorNodeId)] && nodesById[global.cleanString_(dep.SuccessorNodeId)]
));
global.hasSchedule_ = node => Boolean(node && node.StartDate && node.EndDate && node.StartDate <= node.EndDate);
global.dateToDay_ = dateText => {
  const parts = dateText.split('-').map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
};
global.dayToDate_ = day => {
  const date = new Date(day * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};
global.shiftDate_ = (dateText, deltaDays) => global.dayToDate_(global.dateToDay_(dateText) + deltaDays);
global.cloneRow_ = row => Object.assign({}, row);
global.nowIso_ = () => '2026-07-05T00:00:00.000Z';
global.appError_ = (_code, message) => new Error(message);

const require = createRequire(import.meta.url);
const { rescheduleFromSeeds_, topoSortSubset_, validateDependency_, validateDependencySet_ } = require('../src/04_DependencyApi.js');

function node(id, start, end) {
  return {
    NodeId: id,
    Name: id,
    StartDate: start,
    EndDate: end
  };
}

function dep(from, to) {
  return {
    DependencyId: `${from}-${to}`,
    PredecessorNodeId: from,
    SuccessorNodeId: to
  };
}

function rowsWithParentDependencyTarget() {
  return [
    Object.assign(node('parent', '2026-07-01', '2026-07-05'), { ParentId: '' }),
    Object.assign(node('child', '2026-07-01', '2026-07-02'), { ParentId: 'parent' }),
    Object.assign(node('successor', '2026-07-03', '2026-07-04'), { ParentId: '' })
  ];
}

test('reschedule handles merge dependencies using the latest predecessor end date', () => {
  const nodes = [
    node('p1', '2026-07-01', '2026-07-03'),
    node('p2', '2026-07-01', '2026-07-08'),
    node('s', '2026-07-04', '2026-07-05')
  ];
  const deps = [dep('p1', 's'), dep('p2', 's')];
  const writeMap = {};

  const result = rescheduleFromSeeds_(['p1'], nodes, deps, 'actor-1', writeMap);

  assert.deepEqual(result.shiftedIds, ['s']);
  assert.equal(writeMap.s.StartDate, '2026-07-08');
  assert.equal(writeMap.s.EndDate, '2026-07-09');
});

test('reschedule preserves existing buffer when successor already starts after predecessor', () => {
  const nodes = [
    node('p', '2026-07-01', '2026-07-03'),
    node('s', '2026-07-06', '2026-07-07')
  ];
  const deps = [dep('p', 's')];
  const writeMap = {};

  const result = rescheduleFromSeeds_(['p'], nodes, deps, 'actor-1', writeMap);

  assert.deepEqual(result.shiftedIds, []);
  assert.deepEqual(writeMap, {});
});

test('reschedule propagates through a diamond dependency graph', () => {
  const nodes = [
    node('a', '2026-07-01', '2026-07-10'),
    node('b', '2026-07-02', '2026-07-03'),
    node('c', '2026-07-04', '2026-07-05'),
    node('d', '2026-07-06', '2026-07-07')
  ];
  const deps = [dep('a', 'b'), dep('a', 'c'), dep('b', 'd'), dep('c', 'd')];
  const writeMap = {};

  const result = rescheduleFromSeeds_(['a'], nodes, deps, 'actor-1', writeMap);

  assert.deepEqual(result.shiftedIds, ['b', 'c', 'd']);
  assert.equal(writeMap.b.StartDate, '2026-07-10');
  assert.equal(writeMap.b.EndDate, '2026-07-11');
  assert.equal(writeMap.c.StartDate, '2026-07-10');
  assert.equal(writeMap.c.EndDate, '2026-07-11');
  assert.equal(writeMap.d.StartDate, '2026-07-11');
  assert.equal(writeMap.d.EndDate, '2026-07-12');
});

test('topoSortSubset rejects dependency cycles', () => {
  assert.throws(
    () => topoSortSubset_(['a', 'b'], [dep('a', 'b'), dep('b', 'a')]),
    /循環/
  );
});

test('validateDependency rejects parent nodes as dependency endpoints', () => {
  assert.throws(
    () => validateDependency_('parent', 'successor', rowsWithParentDependencyTarget(), []),
    /末端ノード/
  );
});

test('validateDependency rejects duplicate dependencies', () => {
  const nodes = [node('p', '2026-07-01', '2026-07-02'), node('s', '2026-07-03', '2026-07-04')];
  assert.throws(
    () => validateDependency_('p', 's', nodes, [dep('p', 's')]),
    /既に存在/
  );
});

test('validateDependencySet rejects dependencies that become parent endpoints after restore', () => {
  const nodes = rowsWithParentDependencyTarget();
  assert.throws(
    () => validateDependencySet_(nodes, [dep('parent', 'successor')]),
    /親ノード/
  );
});

test('validateDependencySet rejects a cycle exposed by restored nodes', () => {
  const nodes = [
    node('a', '2026-07-01', '2026-07-02'),
    node('b', '2026-07-02', '2026-07-03')
  ];
  assert.throws(
    () => validateDependencySet_(nodes, [dep('a', 'b'), dep('b', 'a')]),
    /循環/
  );
});
