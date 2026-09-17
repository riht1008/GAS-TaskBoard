import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');

test('list headers expose persisted pointer and keyboard column resizing', () => {
  assert.match(views, /data-list-column-resizer="\$\{index\}"/);
  assert.match(views, /normalizedListColumnWidths_\(state\.listColumnWidths\)/);
  assert.match(bindings, /function bindList\(\)[\s\S]*startListColumnResize[\s\S]*ArrowLeft[\s\S]*ArrowRight/);
  assert.match(actions, /function startListColumnResize\(event\)[\s\S]*state\.listColumnWidths = applyListColumnWidths_[\s\S]*persistViewPreferences\(\)/);
  assert.match(styles, /\.list-column-resizer\s*\{[\s\S]*cursor:\s*col-resize;[\s\S]*touch-action:\s*none;/);
});
