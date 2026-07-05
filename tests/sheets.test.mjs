import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
const { normalizeCellValue_ } = require('../src/06_Sheets.js');

test('normalizeCellValue formats milestone Date objects as yyyy-mm-dd in script timezone', () => {
  const value = new Date('2026-07-14T15:00:00.000Z');

  assert.equal(normalizeCellValue_('Milestones', 'Date', value), '2026-07-15');
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
