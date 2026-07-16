import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function queueSource() {
  const source = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function queueNodeMutation(');
  const end = source.indexOf('    async function callAndApply(', start);
  if (start < 0 || end < 0) throw new Error('queue source not found');
  return source.slice(start, end);
}

function queueContext() {
  const first = { id: 'n1', name: 'initial-1', updatedAt: 'v0' };
  const second = { id: 'n2', name: 'initial-2', updatedAt: 'v0' };
  const state = {
    currentMember: { id: 'actor' },
    nodes: [first, second],
    nodesById: new Map([['n1', first], ['n2', second]]),
    nodeMutationChain: null,
    pendingNodeMutations: new Map(),
    savingNodeIds: new Set(),
    pendingMutationCount: 0,
    mutationGeneration: 0,
    syncStatus: 'idle',
    lastSyncAt: ''
  };
  const calls = [];
  let requestCounter = 0;
  const context = vm.createContext({
    state,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
    nextRequestId: () => `r${++requestCounter}`,
    cloneNode: value => JSON.parse(JSON.stringify(value)),
    rebuildIndexes: () => {
      state.nodesById = new Map(state.nodes.map(item => [item.id, item]));
    },
    render: () => {},
    persistLocalCache: () => {},
    showToast: () => {},
    mergeNodes: incoming => {
      const byId = new Map(state.nodes.map(item => [item.id, item]));
      incoming.forEach(item => byId.set(item.id, item));
      state.nodes = Array.from(byId.values());
      state.nodesById = byId;
    },
    serverCallWithRetry: (_name, [payload]) => new Promise((resolve, reject) => calls.push({ payload, resolve, reject }))
  });
  vm.runInContext(queueSource(), context);
  return { context, state, calls };
}

test('an earlier response is merged and then newer optimistic patches are reapplied', async () => {
  const node = { id: 'n1', name: 'initial', updatedAt: 'v0' };
  const state = {
    currentMember: { id: 'actor' },
    nodes: [node],
    nodesById: new Map([['n1', node]]),
    nodeMutationChain: null,
    pendingNodeMutations: new Map(),
    savingNodeIds: new Set(),
    pendingMutationCount: 0,
    mutationGeneration: 0,
    syncStatus: 'idle',
    lastSyncAt: ''
  };
  const calls = [];
  let requestCounter = 0;
  const context = vm.createContext({
    state,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
    nextRequestId: () => `r${++requestCounter}`,
    cloneNode: value => JSON.parse(JSON.stringify(value)),
    rebuildIndexes: () => {
      state.nodesById = new Map(state.nodes.map(item => [item.id, item]));
    },
    render: () => {},
    persistLocalCache: () => {},
    showToast: () => {},
    mergeNodes: incoming => {
      const byId = new Map(state.nodes.map(item => [item.id, item]));
      incoming.forEach(item => byId.set(item.id, item));
      state.nodes = Array.from(byId.values());
      state.nodesById = byId;
    },
    serverCallWithRetry: (_name, [payload]) => new Promise((resolve, reject) => calls.push({ payload, resolve, reject })),
    applyMutationResult: result => {
      state.nodesById.get('n1').name = result.serverName;
      context.reapplyPendingNodeMutations_(['n1']);
      return true;
    }
  });
  vm.runInContext(queueSource(), context);

  const first = context.queueNodeMutation('n1', 'saveNode', () => ({ patch: { name: 'one' } }), () => {
    state.nodesById.get('n1').name = 'one';
  });
  const second = context.queueNodeMutation('n1', 'saveNode', () => ({ patch: { name: 'two' } }), () => {
    state.nodesById.get('n1').name = 'two';
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  calls[0].resolve({ ok: true, requestId: 'r1', serverName: 'server-one' });
  await first;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(state.nodesById.get('n1').name, 'two');

  calls[1].resolve({ ok: true, requestId: 'r2', serverName: 'server-two' });
  await second;
  assert.equal(state.nodesById.get('n1').name, 'server-two');
});

test('different node mutations are serialized and a ripple response reapplies every touched pending patch', async () => {
  const { context, state, calls } = queueContext();
  context.applyMutationResult = result => {
    context.mergeNodes(result.nodes);
    context.reapplyPendingNodeMutations_(result.nodes.map(node => node.id));
    return true;
  };

  const first = context.queueNodeMutation('n1', 'saveNode', () => ({ patch: { name: 'one' } }), () => {
    state.nodesById.get('n1').name = 'one';
  });
  const second = context.queueNodeMutation('n2', 'saveNode', () => ({ patch: { name: 'two' } }), () => {
    state.nodesById.get('n2').name = 'two';
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  calls[0].resolve({
    ok: true,
    nodes: [
      { id: 'n1', name: 'server-one', updatedAt: 'v1' },
      { id: 'n2', name: 'stale-ripple', updatedAt: 'v0' }
    ]
  });
  await first;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(state.nodesById.get('n2').name, 'two');

  calls[1].resolve({ ok: true, nodes: [{ id: 'n2', name: 'server-two', updatedAt: 'v2' }] });
  await second;
  assert.equal(state.nodesById.get('n2').name, 'server-two');
});

test('a conflict restores an optimistically deleted subtree and reaches onResult', async () => {
  const { context, state, calls } = queueContext();
  state.nodes = [
    { id: 'parent', name: 'local parent', updatedAt: 'v1' },
    { id: 'child', parentId: 'parent', name: 'child', updatedAt: 'v1' }
  ];
  context.rebuildIndexes();
  let resultSeen = false;
  context.applyMutationResult = result => {
    context.mergeNodes(result.nodes || []);
    return result.ok !== false;
  };

  const mutation = context.queueNodeMutation('parent', 'deleteNode', () => ({ nodeId: 'parent' }), () => {
    state.nodes = [];
    context.rebuildIndexes();
  }, {
    snapshot: () => [
      { id: 'parent', name: 'local parent', updatedAt: 'v1' },
      { id: 'child', parentId: 'parent', name: 'child', updatedAt: 'v1' }
    ],
    rollback: snapshot => context.mergeNodes(snapshot),
    onResult: result => { resultSeen = result.code === 'CONFLICT'; }
  });

  await new Promise(resolve => setImmediate(resolve));
  calls[0].resolve({
    ok: false,
    code: 'CONFLICT',
    nodes: [{ id: 'parent', name: 'server parent', updatedAt: 'v2' }]
  });
  await mutation;

  assert.equal(resultSeen, true);
  assert.equal(state.nodesById.get('parent').name, 'server parent');
  assert.equal(state.nodesById.get('child').name, 'child');
});
