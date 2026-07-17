import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
const bindings = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/Index.html', import.meta.url), 'utf8');

test('Escape closes only the active dropdown layer', () => {
  assert.match(bindings, /function closeOpenDropdownAndRestoreFocus_\(/);
  assert.match(bindings, /event\.stopPropagation\(\);\s*closeOpenDropdownAndRestoreFocus_\(\);/s);
  assert.match(actions, /event\.key === 'Escape'[\s\S]*?event\.stopPropagation\(\);[\s\S]*?state\.commentMention = null/);
});

test('dirty task details require an explicit close decision and recover after save errors', () => {
  assert.match(actions, /function hasUnsavedDetailDraft\(/);
  assert.match(actions, /type: 'confirmDetailClose'/);
  assert.match(actions, /restoreDetailDraftSnapshot\(node\.id, reopenDraft, \{ shell: wasShell, focusName: true \}\)/);
  assert.match(panels, /data-action="discard-detail-close"/);
  assert.match(panels, /data-action="save-detail-close"/);
});

test('confirmation dialogs preserve their parent context', () => {
  assert.match(actions, /function openContextualConfirm\(/);
  assert.match(actions, /dialog\.returnDialog = state\.dialog \|\| null/);
  assert.match(actions, /state\.dialog = returnDialog/);
  assert.match(panels, /type === 'confirmSlackDisconnect'/);
});

test('project settings retain a separate draft for each tab', () => {
  assert.match(actions, /const drafts = \{\s*milestones:[\s\S]*meetings:[\s\S]*slack:/);
  assert.match(actions, /state\.dialog\.drafts\[currentTab\] = state\.dialog\.draft/);
  assert.match(actions, /state\.dialog\.draft = state\.dialog\.drafts\[state\.projectSettingsTab\]/);
});

test('overlay pickers use the viewport portal and stay above modal surfaces', () => {
  assert.match(bindings, /insideOverlay = Boolean\(dropdown\.closest\('\.modal, \.drawer'\)\)/);
  assert.match(styles, /\.dropdown-portal-root\.overlay-portal-active\s*\{[^}]*z-index:\s*60;/s);
  assert.match(bindings, /portalRoot \? Array\.from\(portalRoot\.querySelectorAll\(selector\)\)/);
});

test('WBS waits for saves and unregistered users get an explicit read-only shell', () => {
  assert.match(views, /wbsBlockedBySave = hasPendingMutations\(\)/);
  assert.match(views, /shell shell-unregistered/);
  assert.match(views, /メンバー登録後に管理できます/);
  assert.match(views, /state\.currentMember \? '' : 'disabled'[\s\S]{0,120}最初のタスクを追加/);
  assert.match(panels, /confirm-dependency-delete[\s\S]{0,180}state\.currentMember \? '' : 'disabled'/);
  assert.match(panels, /reply-comment[\s\S]{0,240}state\.currentMember \? '' : 'disabled'/);
  assert.match(styles, /\.shell\.shell-unregistered\s*\{[^}]*grid-template-rows:\s*var\(--topbar-height\) auto auto 1fr;/s);
});

test('document and calendar expose baseline accessibility semantics', () => {
  assert.match(index, /<html lang="ja">/);
  assert.match(index, /<title>タスク管理<\/title>/);
  assert.match(panels, /aria-current="date"/);
});
