import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const utils = fs.readFileSync(new URL('../src/ClientUtils.html', import.meta.url), 'utf8');
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

test('detail drawer uses one task title and compact property rows', () => {
  assert.match(panels, /drawer-title detail-toolbar-title">タスク詳細/);
  assert.doesNotMatch(panels, /drawer-title">\$\{h\(node\.name/);
  assert.match(panels, /aria-label="タスク名"/);
  assert.match(panels, /function renderDetailPropertyRow/);
  assert.match(panels, /field: 'statusColumnId'[\s\S]{0,180}plain: true/);
  assert.match(styles, /\.detail-property-row \{[\s\S]*grid-template-columns:/);
});

test('description has explicit read and edit modes with Escape returning to read mode', () => {
  assert.match(panels, /state\.detailDescriptionEditing/);
  assert.match(panels, /data-action="edit-detail-description"/);
  assert.match(panels, /data-detail-description-input/);
  assert.match(actions, /function startDetailDescriptionEdit\(\)/);
  assert.match(actions, /function finishDetailDescriptionEdit\(\)/);
  assert.match(bindings, /if \(state\.detailDescriptionEditing\)[\s\S]{0,220}finishDetailDescriptionEdit\(\)/);
});

test('comments use a timeline and the save footer appears only for a dirty draft', () => {
  assert.match(panels, /comment-list comment-timeline/);
  assert.match(styles, /\.comment-timeline::before/);
  assert.match(panels, /detail-save-footer" \$\{showSaveFooter \? '' : 'hidden'\}/);
  assert.match(actions, /function updateDetailSaveFooter\(\)/);
  assert.match(bindings, /if \(scope === 'detail'\) updateDetailSaveFooter\(\)/);
  assert.match(bindings, /!element\.closest\('\[hidden\], \[aria-hidden="true"\]'\)/);
  assert.match(styles, /\.detail-save-footer\[hidden\] \{\s*display: none/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.detail-save-next \{\s*display: none/);
});

test('description read mode renders markdown headings with existing typography tokens', () => {
  assert.match(utils, /headingMatch = rawLine\.match/);
  assert.match(utils, /html \+= '<h' \+ level/);
  assert.match(styles, /\.markdown-body :is\(h1, h2, h3\)/);
  assert.match(styles, /\.markdown-body h1 \{\s*font-size: var\(--text-lg\)/);
});

test('activity-derived actual dates are loaded only when the detail drawer needs them', () => {
  assert.match(nodeApi, /function getNodeActualDates\(payload\)/);
  assert.match(actions, /async function loadNodeActualDates\(nodeId\)/);
  assert.match(views, /if \(!node\.actualDatesLoaded && !state\.actualDatesLoading\.has\(node\.id\)\)/);
});
