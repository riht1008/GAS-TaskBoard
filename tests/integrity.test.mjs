import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.appError_ = (code, message) => Object.assign(new Error(message), { code });

const require = createRequire(import.meta.url);
const { validateNodeTree_ } = require('../src/07_Validation.js');

test('node tree validation accepts one connected acyclic root tree', () => {
  assert.equal(validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'group', ParentId: 'root' },
    { NodeId: 'task', ParentId: 'group' }
  ]), true);
});

test('node tree validation rejects orphan nodes', () => {
  assert.throws(() => validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'orphan', ParentId: 'missing' }
  ]), error => error.code === 'NODE_TREE_INVALID' && /親ノード/.test(error.message));
});

test('node tree validation rejects hierarchy cycles and duplicate ids', () => {
  assert.throws(() => validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'a', ParentId: 'b' },
    { NodeId: 'b', ParentId: 'a' }
  ]), error => error.code === 'NODE_TREE_INVALID' && /循環/.test(error.message));
  assert.throws(() => validateNodeTree_([
    { NodeId: 'root', ParentId: '' },
    { NodeId: 'root', ParentId: '' }
  ]), error => error.code === 'NODE_TREE_INVALID' && /重複/.test(error.message));
});
