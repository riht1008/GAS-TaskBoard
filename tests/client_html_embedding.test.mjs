import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const clientFiles = [
  'ClientState.html',
  'ClientDataSync.html',
  'ClientRenderViews.html',
  'ClientRenderPanels.html',
  'ClientBindings.html',
  'ClientActions.html',
  'ClientSelectors.html',
  'ClientUtils.html'
];

test('injected client fragments avoid literal URL protocol separators', () => {
  clientFiles.forEach(file => {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, `${file} contains a protocol literal that GAS HtmlService can truncate`);
  });
});
