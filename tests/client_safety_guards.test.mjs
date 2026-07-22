import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function functionSlice(file, startMarker, endMarker) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source slice not found: ${startMarker}`);
  return source.slice(start, end);
}

test('detail save patch contains only fields changed by the user', () => {
  const source = functionSlice('../src/ClientActions.html', '    function detailPatchBetweenSnapshots(', '    function sameDetailSnapshot(');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const baseline = {
    name: 'Task', statusColumnId: 'todo', priority: 'Mid', assigneeIds: ['m1'],
    startDate: '2026-01-01', endDate: '2026-01-02', actualStartDate: '', actualEndDate: '',
    description: 'before', deliverable: '', note: '', progress: 15, includeInWbs: true
  };
  const current = { ...baseline, assigneeIds: ['m1'], description: 'after' };

  assert.deepEqual({ ...context.detailPatchBetweenSnapshots(baseline, current, true) }, { description: 'after' });
  current.progress = 30;
  assert.deepEqual({ ...context.detailPatchBetweenSnapshots(baseline, current, false) }, { description: 'after' });
  assert.deepEqual({ ...context.detailPatchBetweenSnapshots(baseline, current, true) }, { description: 'after', progress: 30 });
});

test('initial server load cannot overwrite a mutation started from cached UI', async () => {
  const source = functionSlice('../src/ClientDataSync.html', '    async function init()', '    function serverCall(');
  let resolveLoad;
  let pending = false;
  const applied = [];
  const state = { mutationGeneration: 0, syncStatus: 'idle', fullSyncDeferred: false };
  const context = vm.createContext({
    state,
    readLocalCache: () => ({ source: 'cache' }),
    applyFullData: data => applied.push(data.source),
    render: () => {},
    openInitialDeepLink: () => {},
    serverCall: () => new Promise(resolve => { resolveLoad = resolve; }),
    hasPendingMutations: () => pending,
    shouldDeferFullSyncApply: () => false,
    persistLocalCache: () => {},
    renderSetup: () => {},
    clearLocalCache: () => {},
    showToast: () => {},
    app: {}
  });
  vm.runInContext(source, context);

  const initialization = context.init();
  await new Promise(resolve => setImmediate(resolve));
  pending = true;
  state.mutationGeneration += 1;
  resolveLoad({ source: 'server', setupRequired: false });
  await initialization;

  assert.deepEqual(applied, ['cache']);
  assert.equal(state.fullSyncDeferred, true);
});

test('gantt scale is capped even if legacy sheet data contains extreme dates', () => {
  const source = functionSlice('../src/ClientSelectors.html', '    function ganttScale(', '    function ganttTimelineRows(');
  const toDay = value => Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86400000);
  const context = vm.createContext({
    state: { ganttZoom: 'day', ganttScaleFactor: 1 },
    PROJECT_DATE_MIN: '2000-01-01',
    PROJECT_DATE_MAX: '2100-12-31',
    MAX_GANTT_DISPLAY_DAYS: 3660,
    localTodayDay: () => toDay('2026-07-18'),
    dateToDay: toDay,
    ganttTimelineAnchorDates: () => [toDay('2100-12-31')],
    dateFilterRange: () => null,
    nearestGanttScaleFactor: value => value
  });
  vm.runInContext(source, context);

  const scale = context.ganttScale([
    { displayStartDate: '1900-01-01', displayEndDate: '9999-12-31' }
  ]);

  assert.ok(scale.endDay - scale.startDay + 1 <= 3660);
  assert.ok(scale.width <= 3660 * scale.dayWidth);
});

test('timeout message explicitly says the mutation result may be unknown', () => {
  const dataSync = fs.readFileSync(new URL('../src/ClientDataSync.html', import.meta.url), 'utf8');
  const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
  assert.match(dataSync, /処理自体は完了している可能性があります。再実行せず、同期して結果を確認/);
  assert.match(actions, /error\.code === 'SERVER_TIMEOUT'\) loadComments\(nodeId\)/);
});

test('inline text input is persisted to client draft state before blur', () => {
  const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
  const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
  assert.match(bindings, /bindOnce\(element, 'input'.*setInlineDraft/s);
  assert.match(views, /inlineDraftValue\(node\.id, 'name'/);
});
