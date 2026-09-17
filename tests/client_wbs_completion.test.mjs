import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const actions = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
const panels = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/10_WbsExport.js', import.meta.url), 'utf8');

test('successful WBS export opens a completion modal with the generated sheet link', () => {
  assert.match(server, /wbsSheetUrl:\s*wbsSheetUrl \|\| ''/);
  assert.match(actions, /type:\s*'exportWbsComplete'[\s\S]*wbsSheetUrl:/);
  assert.match(panels, /WBS更新完了/);
  assert.match(panels, /href="\$\{h\(dialog\.wbsSheetUrl\)\}" target="_blank" rel="noopener noreferrer"/);
  assert.match(panels, /スプレッドシートでWBSを開く/);
});
