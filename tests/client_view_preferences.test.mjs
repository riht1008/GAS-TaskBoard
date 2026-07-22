import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sync = fs.readFileSync(new URL('../src/ClientDataSync.html', import.meta.url), 'utf8');
const selectors = fs.readFileSync(new URL('../src/ClientSelectors.html', import.meta.url), 'utf8');

function preferenceHelpersSource() {
  const start = sync.indexOf('    function viewPreferencesKey()');
  const end = sync.indexOf('    function clearLocalCache(', start);
  if (start < 0 || end < 0) throw new Error('view preference helpers not found');
  return sync.slice(start, end);
}

function preferenceContext(storage = new Map()) {
  const group = { id: 'group', hasChildren: true };
  const leaf = { id: 'leaf', hasChildren: false };
  const context = vm.createContext({
    LOCAL_VIEW_PREFERENCES_PREFIX: 'gasTaskManager.viewPreferences.v1',
    state: {
      rootId: 'root',
      currentEmail: 'USER@example.com',
      nodesById: new Map([[group.id, group], [leaf.id, leaf]]),
      collapsed: new Set(),
      viewPreferencesLoadedKey: ''
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value)
    },
    cacheScopeKey: () => 'https://example.com/macros/s/deployment/exec'
  });
  vm.runInContext(preferenceHelpersSource(), context);
  return context;
}

test('collapsed groups persist per project and user and restore on the next load', () => {
  const storage = new Map();
  const first = preferenceContext(storage);
  first.state.collapsed = new Set(['group', 'leaf', 'missing']);
  first.persistViewPreferences();

  const key = first.viewPreferencesKey();
  assert.match(key, /https%3A%2F%2Fexample\.com/);
  assert.match(key, /:root:user%40example\.com$/);
  assert.deepEqual(JSON.parse(storage.get(key)).collapsedNodeIds, ['group']);

  const next = preferenceContext(storage);
  next.restoreViewPreferences();
  assert.deepEqual(Array.from(next.state.collapsed), ['group']);
});

test('a later full sync prunes stale groups without replacing in-session choices', () => {
  const storage = new Map();
  const context = preferenceContext(storage);
  const key = context.viewPreferencesKey();
  storage.set(key, JSON.stringify({ version: 1, collapsedNodeIds: ['group'] }));
  context.restoreViewPreferences();

  context.state.collapsed.clear();
  storage.set(key, JSON.stringify({ version: 1, collapsedNodeIds: ['group'] }));
  context.restoreViewPreferences();
  assert.deepEqual(Array.from(context.state.collapsed), []);
});

test('manual tree toggles persist the shared list and gantt collapse state', () => {
  const toggleSource = selectors.slice(
    selectors.indexOf('    function toggleCollapsed(nodeId)'),
    selectors.indexOf('    function visibleAnchor(', selectors.indexOf('    function toggleCollapsed(nodeId)'))
  );
  let persisted = 0;
  const context = vm.createContext({
    state: { collapsed: new Set() },
    persistViewPreferences: () => { persisted += 1; },
    render: () => {}
  });
  vm.runInContext(toggleSource, context);
  context.toggleCollapsed('group');
  assert.equal(context.state.collapsed.has('group'), true);
  context.toggleCollapsed('group');
  assert.equal(context.state.collapsed.has('group'), false);
  assert.equal(persisted, 2);
});
