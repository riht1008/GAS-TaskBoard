import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.appError_ = (code, message) => Object.assign(new Error(message), { code });
global.DAY_MS = 86400000;

const require = createRequire(import.meta.url);
const { collectDescendantIds_, sheetValue_ } = require('../src/08_Utils.js');

test('sheetValue stores formula-like user text as a literal', () => {
  assert.equal(sheetValue_('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(sheetValue_('+123'), "'+123");
  assert.equal(sheetValue_('-123'), "'-123");
  assert.equal(sheetValue_('@name'), "'@name");
  assert.equal(sheetValue_('ordinary text'), 'ordinary text');
});

test('descendant traversal fails fast on corrupt cycles', () => {
  assert.throws(
    () => collectDescendantIds_('a', { a: ['b'], b: ['c'], c: ['a'] }),
    error => error.code === 'NODE_TREE_INVALID'
  );
});

test('descendant traversal returns each valid child once', () => {
  assert.deepEqual(collectDescendantIds_('a', { a: ['b', 'c'], b: ['d'] }), ['b', 'c', 'd']);
});
