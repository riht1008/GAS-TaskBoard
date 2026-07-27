import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const stateSource = fs.readFileSync(new URL('../src/ClientState.html', import.meta.url), 'utf8');

test('gantt task names open details without a duplicate edit button', () => {
  const start = views.indexOf('    function renderGanttTreeRow(');
  const end = views.indexOf('    function renderGanttInteractionRows(', start);
  assert.ok(start >= 0 && end > start);
  const source = views.slice(start, end);

  assert.match(source, /class="tree-name[^"]*" data-open-node=/);
  assert.doesNotMatch(source, /icon\('edit'\)/);
  assert.doesNotMatch(source, /title="編集"/);
});

test('list assignee picker exposes a deferred apply flow', () => {
  assert.match(views, /field: 'assigneeIds'[\s\S]{0,180}deferCommit: true/);
  assert.match(views, /inlineDraftValue\(node\.id, 'assigneeIds'/);
  assert.match(panels, /data-action="cancel-deferred-dropdown"/);
  assert.match(panels, /data-action="apply-deferred-dropdown"/);
  assert.match(panels, /dropdown-selection-count/);
  assert.match(stateSource, /discardDeferredDropdownDraft\(state\.openDropdown\)/);
  assert.match(views, /discardInactiveDeferredDropdownDrafts\(state\.openDropdown\)/);
  assert.match(bindings, /key\.endsWith\(':assigneeIds'\) && key !== activeKey/);
});

test('assignee option clicks stay local and apply invokes one save with the final selection', () => {
  const start = bindings.indexOf('    function setDropdownValue(');
  const end = bindings.indexOf('    function draftForScope(', start);
  assert.ok(start >= 0 && end > start);
  const source = bindings.slice(start, end);

  const node = { id: 'n1', assigneeIds: ['m1'] };
  const inlineDrafts = new Map();
  const saves = [];
  const state = {
    nodesById: new Map([['n1', node]]),
    filters: {},
    openDropdown: 'inline:n1:assigneeIds',
    calendarView: null
  };
  const context = vm.createContext({
    state,
    inlineNodeIdFromScope: scope => String(scope).startsWith('inline:') ? String(scope).slice('inline:'.length) : '',
    splitControlId: id => {
      const text = String(id || '');
      const index = text.lastIndexOf(':');
      return index < 0 ? { scope: text, field: '' } : { scope: text.slice(0, index), field: text.slice(index + 1) };
    },
    inlineDraftValue: (nodeId, field, fallback) => {
      const key = `${nodeId}:${field}`;
      return inlineDrafts.has(key) ? inlineDrafts.get(key) : fallback;
    },
    inlineDraftKey: (nodeId, field) => `${nodeId}:${field}`,
    setInlineDraft: (nodeId, field, value) => inlineDrafts.set(`${nodeId}:${field}`, value),
    clearInlineDraft: (nodeId, field) => inlineDrafts.delete(`${nodeId}:${field}`),
    saveInlineNodeField: (nodeId, field, value) => {
      saves.push({ nodeId, field, value: value.slice() });
      inlineDrafts.delete(`${nodeId}:${field}`);
    },
    draftForScope: () => null,
    normalizeProgressValue: value => Number(value),
    doneStatusColumnId: () => 'done',
    render: () => {},
    requestAnimationFrame: callback => callback(),
    document: { querySelectorAll: () => [] },
    Array
  });
  vm.runInContext(source, context);

  context.setDropdownValue('inline:n1', 'assigneeIds', 'm1', true, true);
  context.setDropdownValue('inline:n1', 'assigneeIds', 'm2', true, true);

  assert.equal(saves.length, 0);
  assert.deepEqual(node.assigneeIds, ['m1']);
  assert.deepEqual(Array.from(inlineDrafts.get('n1:assigneeIds')), ['m2']);

  context.applyDeferredDropdown('inline:n1:assigneeIds');

  assert.equal(saves.length, 1);
  assert.equal(saves[0].nodeId, 'n1');
  assert.equal(saves[0].field, 'assigneeIds');
  assert.deepEqual(Array.from(saves[0].value), ['m2']);
  assert.equal(state.openDropdown, '');
});
