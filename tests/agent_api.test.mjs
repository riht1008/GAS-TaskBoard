import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.splitCsv_ = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

const basePayload = {
  ok: true,
  setupRequired: false,
  version: 'test',
  spreadsheetId: 'sheet-1',
  currentEmail: 'actor@example.com',
  currentMember: { id: 'm1', name: 'Actor', email: 'actor@example.com' },
  rootId: 'root',
  unregistered: false,
  members: [
    { id: 'm1', name: 'Actor', email: 'actor@example.com' },
    { id: 'm2', name: 'Reviewer', email: 'reviewer@example.com' }
  ],
  statusColumns: [
    { id: 'todo', name: '未着手' },
    { id: 'done', name: '完了' }
  ],
  dependencies: [],
  nodes: [
    { id: 'root', name: 'Project', description: '', statusColumnId: 'todo', assigneeIds: ['m1'], isLeaf: false },
    { id: 'n1', name: 'API仕様を確認', description: 'Agent API', statusColumnId: 'todo', assigneeIds: ['m1'], isLeaf: true },
    { id: 'n2', name: 'レビュー', description: '', statusColumnId: 'done', assigneeIds: ['m2'], isLeaf: true }
  ]
};

global.loadAll = () => structuredClone(basePayload);

const require = createRequire(import.meta.url);
const { agentGetContext, agentContextLimit_ } = require('../src/13_AgentApi.js');

test('agent context returns compact project metadata and all nodes by default', () => {
  const result = agentGetContext({});
  assert.equal(result.ok, true);
  assert.equal(result.rootId, 'root');
  assert.equal(result.nodes.length, 3);
  assert.equal(result.totalMatchedNodes, 3);
  assert.equal(result.truncated, false);
  assert.equal('slackSettings' in result, false);
});

test('agent context filters by query, status, assignee, and leaf type', () => {
  const result = agentGetContext({
    query: 'agent api',
    statusColumnIds: ['todo'],
    assigneeIds: ['m1'],
    leafOnly: true
  });
  assert.deepEqual(result.nodes.map(node => node.id), ['n1']);
  assert.equal(result.totalMatchedNodes, 1);
});

test('agent context resolves exact node IDs beyond ordinary list slices', () => {
  const result = agentGetContext({ nodeIds: ['n2'], limit: 1 });

  assert.deepEqual(result.nodes.map(node => node.id), ['n2']);
  assert.equal(result.totalMatchedNodes, 1);
  assert.equal(result.truncated, false);
});

test('agent context reports truncation and validates limits', () => {
  const result = agentGetContext({ limit: 1 });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.totalMatchedNodes, 3);
  assert.equal(result.truncated, true);
  assert.equal(agentContextLimit_('500'), 500);
  assert.throws(() => agentContextLimit_(0), /1〜500/);
  assert.throws(() => agentContextLimit_(501), /1〜500/);
});

test('agent context preserves setup-required responses', () => {
  global.loadAll = () => ({ ok: true, setupRequired: true, currentEmail: 'actor@example.com' });
  assert.deepEqual(agentGetContext({}), {
    ok: true,
    setupRequired: true,
    currentEmail: 'actor@example.com'
  });
  global.loadAll = () => structuredClone(basePayload);
});
