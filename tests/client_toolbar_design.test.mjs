import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/Index.html', import.meta.url), 'utf8');

test('sync is exposed once as a topbar pill and WBS is secondary', () => {
  assert.equal((views.match(/data-action=\"force-sync\"/g) || []).length, 1);
  assert.match(views, /class=\"sync-pill sync-\$\{h\(state\.syncStatus\)\}\"/);
  assert.match(views, /class=\"button secondary\" data-action=\"confirm-export-wbs\"/);
  assert.doesNotMatch(views, />強制同期</);
});

test('filters use progressive controls and a flexible bar', () => {
  assert.match(views, /function renderFilterControl\(/);
  assert.match(views, /data-action=\"edit-filter\"/);
  assert.match(views, /class=\"filter-chip-remove\"/);
  assert.match(styles, /\.filters\s*\{[^}]*display:\s*flex;/s);
  assert.doesNotMatch(styles, /grid-template-columns:\s*minmax\(200px/);
});

test('kanban actions share the filter row and gantt scale uses a stepper', () => {
  assert.match(views, /function renderFilterViewActions\(\)/);
  assert.match(views, /<section class=\"view kanban-view /);
  assert.match(views, /class=\"gantt-scale-stepper\"/);
  assert.doesNotMatch(views, /class=\"gantt-scale-steps\"/);
});

test('gantt left header stays opaque above the translated task rows', () => {
  assert.match(styles, /\.gantt-left-body\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s);
  assert.match(styles, /\.gantt-axis-left\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*7;[^}]*background:\s*var\(--color-surface-raised\);/s);
  assert.match(styles, /\.gantt-axis-left span\s*\{[^}]*background:\s*var\(--color-surface-raised\);/s);
});

test('list inline pickers escape the scroll container through a viewport portal', () => {
  assert.match(index, /id="dropdownPortalRoot" class="dropdown-portal-root"/);
  assert.match(views, /clearInlineDropdownPortal\(\)/);
  assert.match(views, /mountInlineDropdownPortal\(\)/);
  assert.match(bindings, /startsWith\('inline:'\)/);
  assert.match(bindings, /availableAbove > availableBelow/);
  assert.match(bindings, /insideOverlay = Boolean\(dropdown\.closest\('\.modal, \.drawer'\)\)/);
  assert.match(bindings, /document\.addEventListener\('scroll', schedulePosition, \{ capture: true, passive: true \}\)/);
  assert.match(styles, /\.dropdown-menu\.dropdown-menu-portal\s*\{[^}]*position:\s*fixed;/s);
});

test('inline picker placement flips above and clamps away from the right edge', () => {
  const context = {
    document: { documentElement: { clientWidth: 1280, clientHeight: 720 } },
    getComputedStyle: () => ({ getPropertyValue: () => '8px' })
  };
  vm.runInNewContext(bindings, context);
  const trigger = {
    getBoundingClientRect: () => ({ top: 680, right: 1260, bottom: 710, left: 1200, width: 60, height: 30 })
  };
  const menu = { style: {}, dataset: {} };

  context.positionInlineDropdownPortal(trigger, menu, { width: 220, height: 120 });

  assert.equal(menu.dataset.placement, 'top');
  assert.equal(menu.style.top, '552px');
  assert.equal(menu.style.left, '1040px');
  assert.equal(menu.style.maxHeight, '664px');
});
