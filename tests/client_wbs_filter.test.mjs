import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const selectors = fs.readFileSync(new URL('../src/ClientSelectors.html', import.meta.url), 'utf8');
const utils = fs.readFileSync(new URL('../src/ClientUtils.html', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source slice not found: ${startMarker}`);
  return source.slice(start, end);
}

function filterContext(wbsInclusion) {
  const root = { id: 'root', parentId: '', includeInWbs: true };
  const excludedParent = { id: 'parent', parentId: 'root', includeInWbs: false };
  const inheritedExcludedChild = { id: 'child', parentId: 'parent', includeInWbs: true };
  const included = { id: 'included', parentId: 'root', includeInWbs: true };
  const nodes = [root, excludedParent, inheritedExcludedChild, included];
  const state = {
    filters: {
      query: '',
      parentId: '',
      statusIds: [],
      assigneeId: '',
      priority: '',
      wbsInclusion,
      dateStart: '',
      dateEnd: ''
    },
    nodesById: new Map(nodes.map(node => [node.id, node])),
    memberById: new Map()
  };
  const context = vm.createContext({
    state,
    statusName: () => '',
    isDescendantOf: () => false,
    ancestorChain: nodeId => {
      const chain = [];
      let node = state.nodesById.get(nodeId);
      while (node && node.parentId) {
        chain.push(node.parentId);
        node = state.nodesById.get(node.parentId);
      }
      return chain;
    }
  });
  vm.runInContext(sourceSlice(utils, '    function hasWbsExcludedAncestor(', '    function renderWbsExcludedChip('), context);
  vm.runInContext(sourceSlice(selectors, '    function matchesFilters(', '    function visibleTreeNodes('), context);
  return { context, excludedParent, inheritedExcludedChild, included };
}

test('WBS filter uses effective inclusion, including exclusions inherited from a parent', () => {
  const excluded = filterContext('excluded');
  assert.equal(excluded.context.matchesFilters(excluded.excludedParent), true);
  assert.equal(excluded.context.matchesFilters(excluded.inheritedExcludedChild), true);
  assert.equal(excluded.context.matchesFilters(excluded.included), false);

  const included = filterContext('included');
  assert.equal(included.context.matchesFilters(included.excludedParent), false);
  assert.equal(included.context.matchesFilters(included.inheritedExcludedChild), false);
  assert.equal(included.context.matchesFilters(included.included), true);
});

test('WBS inclusion is available as a progressive filter and is reset with other filters', () => {
  assert.match(views, /\{ field: 'wbsInclusion', label: 'WBS反映' \}/);
  assert.match(views, /\{ value: 'included', label: 'WBS対象' \}/);
  assert.match(views, /\{ value: 'excluded', label: 'WBS対象外' \}/);
  assert.match(bindings, /wbsInclusion: ''/);
});
