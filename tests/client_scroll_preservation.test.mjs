import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');

function scrollHelperSource() {
  const start = views.indexOf('    function capturePreservedScrollPositions(root)');
  const end = views.indexOf('    function ganttTodayScrollLeft(right)', start);
  if (start < 0 || end < 0) throw new Error('scroll preservation helpers not found');
  return views.slice(start, end);
}

test('named scroll regions restore both axes after their DOM is replaced', () => {
  const element = {
    dataset: { preserveScroll: 'dialog:project-settings:slack' },
    scrollLeft: 37,
    scrollTop: 480
  };
  const root = { querySelectorAll: () => [element] };
  const context = vm.createContext({});
  vm.runInContext(scrollHelperSource(), context);

  const snapshot = context.capturePreservedScrollPositions(root);
  element.scrollLeft = 0;
  element.scrollTop = 0;
  context.restorePreservedScrollPositions(root, snapshot);

  assert.equal(element.scrollLeft, 37);
  assert.equal(element.scrollTop, 480);
});

test('render captures before rebuilding and restores after floating panels are mounted', () => {
  const captureAt = views.indexOf('const preservedScroll = capturePreservedScrollPositions(document)');
  const rebuildAt = views.indexOf('app.innerHTML = `');
  const mountAt = views.indexOf('mountInlineDropdownPortal();');
  const restoreAt = views.indexOf('restorePreservedScrollPositions(document, preservedScroll)');
  assert.ok(captureAt >= 0 && captureAt < rebuildAt);
  assert.ok(restoreAt > mountAt);
  assert.match(views, /markLocalScrollRegions\(current\);[\s\S]*current\.innerHTML = fresh\.innerHTML;[\s\S]*restorePreservedScrollPositions\(current, preservedScroll\);/);
});

test('major app, dialog, and overlay scroll containers have stable context keys', () => {
  assert.match(views, /data-preserve-scroll="view:kanban:columns"/);
  assert.match(views, /data-preserve-scroll="view:kanban:column:\$\{h\(column\.id\)\}"/);
  assert.match(views, /data-preserve-scroll="view:list:table"/);
  assert.match(panels, /data-preserve-scroll="dialog:project-settings:\$\{h\(tab\)\}"/);
  assert.match(panels, /data-preserve-scroll="dropdown:\$\{h\(id\)\}"/);
  assert.match(panels, /data-preserve-scroll="overlay:mention-menu"/);
});
