import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.SHEET = {
  NODES: 'Nodes',
  MEMBERS: 'Members',
  STATUS_COLUMNS: 'StatusColumns'
};
global.APP_VERSION = 'test';
global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.normalizeEmail_ = value => global.cleanString_(value).toLowerCase();
global.normalizeColor_ = value => global.cleanString_(value);
global.getCurrentEmail_ = () => 'owner@example.com';
global.nowIso_ = () => '2026-07-16T00:00:00.000Z';
global.withLock_ = fn => fn();
global.ensureSchema_ = () => {};
global.activeNodes_ = nodes => nodes.filter(node => !node.DeletedAt);
global.sortByOrder_ = rows => rows.slice().sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
global.assertExactlyOneDone_ = columns => {
  const done = columns.filter(column => column.IsDoneColumn === true);
  if (done.length !== 1) throw new Error('done invariant');
  return done[0].ColumnId;
};
global.validateDependencySet_ = () => [];
global.hasExpiredDraftNodes_ = () => false;
global.cleanupExpiredDraftNodes_ = () => [];

let rows;
let nextId;
let failStatusAppendOnce;
global.newId_ = () => `id-${nextId++}`;
global.readAll_ = () => rows;
global.appendObject_ = (sheetName, object) => {
  const copy = Object.assign({}, object, { __row: 2 });
  if (sheetName === global.SHEET.NODES) rows.nodes.push(copy);
  return copy;
};
global.appendObjects_ = (sheetName, objects) => {
  if (sheetName === global.SHEET.STATUS_COLUMNS && failStatusAppendOnce) {
    failStatusAppendOnce = false;
    throw new Error('simulated write failure');
  }
  return objects.map((object, index) => Object.assign({}, object, { __row: rows.statusColumns.length + index + 2 }));
};
global.writeObjects_ = () => {};
global.makeFullPayload_ = source => ({ ok: true, rows: source });

const require = createRequire(import.meta.url);
const { setupProject } = require('../src/Code.js');

function resetRows() {
  rows = {
    nodes: [],
    members: [],
    statusColumns: [],
    dependencies: [],
    comments: [],
    milestones: [],
    meetings: []
  };
  nextId = 1;
  failStatusAppendOnce = false;
}

test('setupProject resumes after a partial first attempt without duplicating the member', () => {
  resetRows();
  failStatusAppendOnce = true;

  assert.throws(
    () => setupProject({ projectName: '案件A', memberName: 'Owner', color: '#123456' }),
    /simulated write failure/
  );
  assert.equal(rows.members.length, 1);
  assert.equal(rows.nodes.length, 0);

  const result = setupProject({ projectName: '案件A', memberName: 'Owner', color: '#123456' });

  assert.equal(result.ok, true);
  assert.equal(rows.members.length, 1);
  assert.equal(rows.statusColumns.length, 3);
  assert.equal(rows.statusColumns.filter(column => column.IsDoneColumn === true).length, 1);
  assert.equal(rows.nodes.length, 1);
  assert.equal(rows.nodes[0].Name, '案件A');
});
