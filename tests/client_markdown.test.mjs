import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const utils = fs.readFileSync(new URL('../src/ClientUtils.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');

function markdownRenderer() {
  const start = utils.indexOf('    function h(value) {');
  const end = utils.indexOf('    function cssEscape(value) {', start);
  if (start < 0 || end < 0) throw new Error('markdown renderer source not found');
  const context = vm.createContext({ URL });
  vm.runInContext(utils.slice(start, end), context);
  return context.renderMarkdown;
}

test('description and comments render pipe tables with escaped cells and alignment', () => {
  const renderMarkdown = markdownRenderer();
  const html = renderMarkdown('| 項目 | 状態 | 備考 |\n| :--- | :---: | ---: |\n| API | **進行中** | `確認` |\n| UI \\| 表 | 完了 | https://example.com/path |');

  assert.match(html, /<table class="markdown-table">/);
  assert.match(html, /<th class="markdown-table-cell markdown-table-cell--left" scope="col">項目<\/th>/);
  assert.match(html, /<th class="markdown-table-cell markdown-table-cell--center" scope="col">状態<\/th>/);
  assert.match(html, /<th class="markdown-table-cell markdown-table-cell--right" scope="col">備考<\/th>/);
  assert.match(html, /<strong>進行中<\/strong>/);
  assert.match(html, /<code>確認<\/code>/);
  assert.match(html, /UI \| 表/);
  assert.match(html, /<a href="https:\/\/example\.com\/path"/);
});

test('description and comments render multi-line blockquotes, including nested markdown', () => {
  const renderMarkdown = markdownRenderer();
  const html = renderMarkdown('> 引用の1行目\n> **重要**な引用\n>\n> - 引用内のリスト');

  assert.match(html, /^<blockquote>/);
  assert.match(html, /引用の1行目<br>/);
  assert.match(html, /<strong>重要<\/strong>な引用/);
  assert.match(html, /<ul>[\s\S]*<li>引用内のリスト<\/li>[\s\S]*<\/ul>/);
  assert.match(html, /<\/blockquote>$/);
});

test('table and blockquote content stays HTML escaped', () => {
  const renderMarkdown = markdownRenderer();
  const html = renderMarkdown('| <script> | x |\n| --- | --- |\n| [危険](javascript:alert(1)) | > 引用 |');

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href=["']javascript:/i);
  assert.match(html, /&gt; 引用/);
});

test('markdown styles include readable quote and horizontally scrollable table surfaces', () => {
  assert.match(styles, /\.markdown-body blockquote \{/);
  assert.match(styles, /\.markdown-table-wrap \{[\s\S]*overflow-x: auto/);
  assert.match(styles, /\.markdown-table-cell--center/);
  assert.match(styles, /\.markdown-table th \{[\s\S]*font-weight: var\(--weight-semibold\)/);
});
