import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.Session = {
  getScriptTimeZone: () => 'Asia/Tokyo'
};
global.Utilities = {
  formatDate: (date, timeZone, format) => {
    assert.equal(format, 'yyyy-MM-dd');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce((memo, part) => {
      memo[part.type] = part.value;
      return memo;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
};

const require = createRequire(import.meta.url);
const { normalizeCellValue_, classifyHeaders_, consecutiveRowBlocks_, writeObjects_ } = require('../src/06_Sheets.js');
const configSource = fs.readFileSync(new URL('../src/00_Config.js', import.meta.url), 'utf8');

test('actual date columns are an append-only Nodes schema extension', () => {
  assert.match(configSource, /'DraftExpiresAt',\s*'ActualStartDate',\s*'ActualEndDate'\s*\]/);
});

test('normalizeCellValue formats milestone Date objects as yyyy-mm-dd in script timezone', () => {
  const value = new Date('2026-07-14T15:00:00.000Z');

  assert.equal(normalizeCellValue_('Milestones', 'Date', value), '2026-07-15');
});

test('normalizeCellValue keeps actual dates as date-only text', () => {
  const value = new Date('2026-07-14T15:00:00.000Z');

  assert.equal(normalizeCellValue_('Nodes', 'ActualStartDate', value), '2026-07-15');
  assert.equal(normalizeCellValue_('Nodes', 'ActualEndDate', '2026-07-20'), '2026-07-20');
});

test('normalizeCellValue recovers legacy spreadsheet date strings for date-only fields', () => {
  const value = 'Wed Jul 15 2026 00:00:00 GMT+0900 (日本標準時)';

  assert.equal(normalizeCellValue_('Milestones', 'Date', value), '2026-07-15');
});

test('normalizeCellValue does not reinterpret arbitrary short text as a date', () => {
  assert.equal(normalizeCellValue_('Milestones', 'Date', '1-1'), '1-1');
});

test('normalizeCellValue keeps timestamp Date objects as ISO strings', () => {
  const value = new Date('2026-07-14T15:00:00.000Z');

  assert.equal(normalizeCellValue_('Comments', 'Timestamp', value), '2026-07-14T15:00:00.000Z');
});

test('classifyHeaders allows only known trailing columns to be appended', () => {
  assert.deepEqual(
    classifyHeaders_(['NodeId', 'Name'], ['NodeId', 'Name', 'DraftOwner']),
    { kind: 'append', existingLength: 2, column: 3 }
  );
});

test('classifyHeaders rejects reordered or unexpected columns', () => {
  assert.equal(
    classifyHeaders_(['Name', 'NodeId'], ['NodeId', 'Name']).kind,
    'mismatch'
  );
  assert.equal(
    classifyHeaders_(['NodeId', 'Name', 'Unexpected'], ['NodeId', 'Name']).kind,
    'mismatch'
  );
});

test('sparse row updates are split into consecutive blocks', () => {
  assert.deepEqual(consecutiveRowBlocks_([2, 3, 8, 11, 12, 13]), [
    [2, 3],
    [8],
    [11, 12, 13]
  ]);
});

test('writeObjects writes only targeted consecutive ranges', () => {
  const writes = [];
  global.HEADERS = { Nodes: ['NodeId', 'Name'] };
  global.TEXT_COLUMNS = { Nodes: [] };
  global.sheetValue_ = value => value === undefined ? '' : value;
  global.SpreadsheetApp = {
    getActive: () => ({
      getSheetByName: () => ({
        getRange: (row, column, rowCount, columnCount) => ({
          setValues: values => writes.push({ row, column, rowCount, columnCount, values })
        })
      })
    })
  };

  writeObjects_('Nodes', [
    { __row: 2, NodeId: 'a', Name: 'A' },
    { __row: 3, NodeId: 'b', Name: 'B' },
    { __row: 8, NodeId: 'c', Name: 'C' }
  ]);

  assert.deepEqual(writes, [
    { row: 2, column: 1, rowCount: 2, columnCount: 2, values: [['a', 'A'], ['b', 'B']] },
    { row: 8, column: 1, rowCount: 1, columnCount: 2, values: [['c', 'C']] }
  ]);
});
