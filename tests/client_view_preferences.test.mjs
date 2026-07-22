import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sync = fs.readFileSync(new URL('../src/ClientDataSync.html', import.meta.url), 'utf8');
const selectors = fs.readFileSync(new URL('../src/ClientSelectors.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');

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
    GANTT_TREE_WIDTH_MIN: 360,
    GANTT_TREE_WIDTH_MAX: 900,
    GANTT_SCALE_LEVELS: [0.75, 1, 1.25, 1.5, 2],
    state: {
      rootId: 'root',
      currentEmail: 'USER@example.com',
      nodesById: new Map([[group.id, group], [leaf.id, leaf]]),
      collapsed: new Set(),
      viewPreferencesLoadedKey: '',
      view: 'kanban',
      ganttTreeWidth: 520,
      ganttZoom: 'day',
      ganttScaleFactor: 1,
      ganttTimelineCollapsed: false
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
  first.state.view = 'gantt';
  first.state.ganttTreeWidth = 684;
  first.state.ganttZoom = 'week';
  first.state.ganttScaleFactor = 1.5;
  first.state.ganttTimelineCollapsed = true;
  first.persistViewPreferences();

  const key = first.viewPreferencesKey();
  assert.match(key, /https%3A%2F%2Fexample\.com/);
  assert.match(key, /:root:user%40example\.com$/);
  assert.deepEqual(JSON.parse(storage.get(key)), {
    version: 2,
    collapsedNodeIds: ['group'],
    view: 'gantt',
    ganttTreeWidth: 684,
    ganttZoom: 'week',
    ganttScaleFactor: 1.5,
    ganttTimelineCollapsed: true
  });

  const next = preferenceContext(storage);
  next.restoreViewPreferences();
  assert.deepEqual(Array.from(next.state.collapsed), ['group']);
  assert.equal(next.state.view, 'gantt');
  assert.equal(next.state.ganttTreeWidth, 684);
  assert.equal(next.state.ganttZoom, 'week');
  assert.equal(next.state.ganttScaleFactor, 1.5);
  assert.equal(next.state.ganttTimelineCollapsed, true);
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

test('view tabs and gantt display controls persist after user operations', () => {
  assert.match(bindings, /state\.view = button\.dataset\.view;\s*persistViewPreferences\(\);/);
  assert.match(bindings, /state\.ganttZoom = button\.dataset\.zoom;\s*persistViewPreferences\(\);/);
  assert.match(bindings, /state\.ganttScaleFactor = nearestGanttScaleFactor\(button\.dataset\.ganttScaleLevel\);\s*persistViewPreferences\(\);/);
  assert.match(bindings, /state\.ganttTimelineCollapsed = !state\.ganttTimelineCollapsed;\s*persistViewPreferences\(\);/);
  assert.match(actions, /const onUp = upEvent => \{[\s\S]*?cleanup\(\);\s*persistViewPreferences\(\);/);
});
