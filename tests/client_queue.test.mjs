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

test('an earlier response is merged and then newer optimistic patches are reapplied', async () => {
  const node = { id: 'n1', name: 'initial', updatedAt: 'v0' };
  const state = {
    currentMember: { id: 'actor' },
    nodes: [node],
    nodesById: new Map([['n1', node]]),
    saveChains: new Map(),
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
