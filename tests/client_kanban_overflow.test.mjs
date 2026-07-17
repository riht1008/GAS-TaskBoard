import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');
const design = fs.readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n    \\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test('kanban columns scroll natural-height cards instead of shrinking them', () => {
  const columnBody = cssRule('.column-body');
  assert.match(columnBody, /grid-auto-rows:\s*max-content/);
  assert.match(columnBody, /overflow:\s*auto/);
  assert.match(columnBody, /overscroll-behavior:\s*contain/);

  const taskCard = cssRule('.task-card');
  assert.match(taskCard, /min-height:\s*calc\(var\(--space-12\) \+ var\(--space-6\)\)/);

  const title = cssRule('.task-card-title');
  assert.match(title, /min-height:\s*1\.45em/);
  assert.match(design, /カードを縦方向へ圧縮しない/);
});
