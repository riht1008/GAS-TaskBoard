import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

global.DAY_MS = 86400000;
global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.isValidDate_ = value => {
  const text = global.cleanString_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parts = text.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
};
global.dateToDay_ = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / global.DAY_MS);
global.dayToDate_ = day => new Date(day * global.DAY_MS).toISOString().slice(0, 10);
global.cloneRow_ = row => ({ ...row });
global.assertProjectDateRange_ = (start, end) => {
  if (start < '2000-01-01' || end > '2100-12-31') throw new Error('日付範囲が不正です。');
};

const api = require('../src/11_CalendarApi.js');
const configSource = fs.readFileSync(new URL('../src/00_Config.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../src/11_CalendarApi.js', import.meta.url), 'utf8');

test('CalendarOverrides schema stores only manual date, type, and name values as text', () => {
  const context = {};
  vm.runInNewContext(configSource, context);
  assert.deepEqual(Array.from(context.HEADERS.CalendarOverrides), ['Date', 'DayType', 'Name']);
  assert.deepEqual(Array.from(context.TEXT_COLUMNS.CalendarOverrides), ['Date', 'DayType', 'Name']);
});

test('calendar override range updates existing rows and inserts missing dates', () => {
  const existing = [{ __row: 2, Date: '2026-08-10', DayType: 'holiday', Name: '旧設定' }];
  const plan = api.calendarOverrideMutationPlan_(existing, '2026-08-10', '2026-08-12', 'working', '休日出勤');
  assert.deepEqual(plan.updates, [{ __row: 2, Date: '2026-08-10', DayType: 'working', Name: '休日出勤' }]);
  assert.deepEqual(plan.inserts, [
    { Date: '2026-08-11', DayType: 'working', Name: '休日出勤' },
    { Date: '2026-08-12', DayType: 'working', Name: '休日出勤' }
  ]);
  assert.deepEqual(plan.deletes, []);
});

test('standard removes only explicit overrides in the selected period', () => {
  const existing = [
    { __row: 2, Date: '2026-08-10', DayType: 'holiday', Name: '夏季休暇' },
    { __row: 3, Date: '2026-08-11', DayType: 'holiday', Name: '夏季休暇' },
    { __row: 4, Date: '2026-08-12', DayType: 'working', Name: '稼働日' }
  ];
  const plan = api.calendarOverrideMutationPlan_(existing, '2026-08-10', '2026-08-11', '', '');
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.inserts, []);
  assert.deepEqual(plan.deletes.map(row => row.Date), ['2026-08-10', '2026-08-11']);
});

test('calendar override payload validates type, order, and maximum range', () => {
  assert.deepEqual(api.normalizeCalendarOverridePayload_({
    startDate: '2026-07-20',
    endDate: '2026-07-20',
    dayType: 'standard',
    name: 'ignored'
  }), {
    startDate: '2026-07-20',
    endDate: '2026-07-20',
    dayType: '',
    name: ''
  });
  assert.throws(() => api.normalizeCalendarOverridePayload_({ startDate: '2026-08-02', endDate: '2026-08-01', dayType: 'holiday' }), /終了日/);
  assert.throws(() => api.normalizeCalendarOverridePayload_({ startDate: '2026-01-01', endDate: '2027-01-02', dayType: 'holiday' }), /366日/);
  assert.throws(() => api.normalizeCalendarOverridePayload_({ startDate: '2026-08-01', dayType: 'closed' }), /標準/);
});

test('calendar override save is locked, member-authenticated, and isolated from Nodes', () => {
  assert.match(apiSource, /return withLock_\(function \(\) \{/);
  assert.match(apiSource, /requireCurrentMember_\(rows\.members\)/);
  assert.match(apiSource, /writeObjects_\(SHEET\.CALENDAR_OVERRIDES/);
  assert.doesNotMatch(apiSource, /SHEET\.NODES/);
  assert.doesNotMatch(apiSource, /reschedule|cascade/i);
});
