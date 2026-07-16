import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function backgroundQueueSource() {
  const source = fs.readFileSync(new URL('../src/ClientDataSync.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function queueBackgroundMutation(');
  const end = source.indexOf('    function recomputeClientDerived()', start);
  if (start < 0 || end < 0) throw new Error('background queue source not found');
  return source.slice(start, end);
}

test('a node-affecting background mutation waits for the shared node chain', async () => {
  let releaseNodeMutation;
  const previousNodeMutation = new Promise(resolve => { releaseNodeMutation = resolve; });
  const calls = [];
  const state = {
    currentMember: { id: 'actor' },
    mutationGeneration: 0,
    pendingMutationCount: 0,
    syncStatus: 'idle',
    savingNodeIds: new Set(),
    backgroundChains: new Map(),
    nodeMutationChain: previousNodeMutation,
    lastSyncAt: ''
  };
  const context = vm.createContext({
    state,
    Promise,
    nextRequestId: () => 'r1',
    rebuildIndexes: () => {},
    syncDetailDraftAfterMutation: () => {},
    persistLocalCache: () => {},
    render: () => {},
    showToast: () => {},
    applyMutationResult: () => true,
    serverCallWithRetry: (name, args) => new Promise((resolve, reject) => calls.push({ name, args, resolve, reject }))
  });
  vm.runInContext(backgroundQueueSource(), context);

  const mutation = context.queueBackgroundMutation('statuses', 'upsertStatusColumn', {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);

  releaseNodeMutation();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'upsertStatusColumn');

  calls[0].resolve({ ok: true });
  await mutation;
  assert.equal(state.nodeMutationChain, null);
});
