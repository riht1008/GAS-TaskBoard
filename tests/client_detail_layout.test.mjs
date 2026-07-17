import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const nodeApi = fs.readFileSync(new URL('../src/01_NodeApi.js', import.meta.url), 'utf8');

test('detail drawer uses a wide content and property split with responsive fallback', () => {
  assert.match(panels, /drawer detail-drawer/);
  assert.match(panels, /<main class="detail-main">/);
  assert.match(panels, /<aside class="detail-sidebar" aria-label="タスクのプロパティ">/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) calc\(var\(--space-12\) \* 7\)/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.detail-drawer-body \{[\s\S]*display: block/);
});

test('detail drawer exposes editable actual dates and keeps them in the save snapshot', () => {
  assert.match(panels, /field: 'actualStartDate'/);
  assert.match(panels, /field: 'actualEndDate'/);
  assert.match(panels, /未設定時はステータス・進捗の変更履歴から自動算出します/);
  assert.match(actions, /actualStartDate: draft\.actualStartDate/);
  assert.match(actions, /actualEndDate: draft\.actualEndDate/);
  assert.match(actions, /a\.actualStartDate === b\.actualStartDate/);
  assert.match(actions, /a\.actualEndDate === b\.actualEndDate/);
});

test('description and comment composer receive the primary editing space', () => {
  assert.match(panels, /detail-description-textarea/);
  assert.match(panels, /detail-comments-section/);
  assert.match(styles, /\.detail-description-textarea \{[\s\S]*min-height: calc\(var\(--space-12\) \* 4\)/);
  assert.match(styles, /\.detail-comments-section \.comment-composer \.textarea \{[\s\S]*min-height: calc\(var\(--space-12\) \* 3\)/);
});

test('activity-derived actual dates are loaded only when the detail drawer needs them', () => {
  assert.match(nodeApi, /function getNodeActualDates\(payload\)/);
  assert.match(actions, /async function loadNodeActualDates\(nodeId\)/);
  assert.match(views, /if \(!node\.actualDatesLoaded && !state\.actualDatesLoading\.has\(node\.id\)\)/);
});
