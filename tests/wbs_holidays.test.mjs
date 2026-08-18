import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildWbsModel_,
  wbsHolidayFormula_,
  wbsJapaneseHolidaysForYear_
} = require('../src/10_WbsExport.js');
const wbsSource = fs.readFileSync(new URL('../src/10_WbsExport.js', import.meta.url), 'utf8');

function options() {
  return {
    actorName: '佐藤',
    now: '2026-07-15T00:00:00.000Z',
    createdAt: '2026-07-15T00:00:00.000Z',
    version: 1
  };
}

test('WBS uses the same Japanese holiday rules as the in-app calendar', () => {
  const holidays2026 = wbsJapaneseHolidaysForYear_(2026);
  assert.equal(holidays2026['2026-05-06'], '振替休日');
  assert.equal(holidays2026['2026-09-22'], '国民の休日');
  assert.equal(holidays2026['2026-07-20'], '海の日');

  const holidays2021 = wbsJapaneseHolidaysForYear_(2021);
  assert.equal(holidays2021['2021-07-22'], '海の日');
  assert.equal(holidays2021['2021-07-23'], 'スポーツの日');
  assert.equal(holidays2021['2021-08-08'], '山の日');
  assert.equal(holidays2021['2021-08-09'], '振替休日');
});

test('WBS model exposes holidays in the exported date range for conditional formatting', () => {
  const model = buildWbsModel_({
    statusColumns: [
      { ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false },
      { ColumnId: 'done', Name: '完了', SortOrder: 2000, IsDoneColumn: true }
    ],
    members: [],
    milestones: [],
    meetings: [],
    activityLog: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: '案件', StatusColumnId: 'todo', SortOrder: 1000 },
      { NodeId: 'task', ParentId: 'root', Name: 'タスク', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-15', EndDate: '2026-07-16' }
    ]
  }, options());

  assert.deepEqual(model.holidayDates, ['2026-07-20']);
  assert.equal(model.holidayHelperCol, model.layout.totalCols + 1);
  assert.equal(
    wbsHolidayFormula_(model, 'S$4'),
    '=COUNTIF($AI$1:$AI$1,S$4)>0'
  );
});

test('WBS conditional formatting marks holidays and excludes them from plan bars', () => {
  assert.match(wbsSource, /holidayHelperCol/);
  assert.match(wbsSource, /COUNTIF\(\$' \+ helperColumn \+ '\$1:\$' \+ helperColumn/);
  assert.match(wbsSource, /whenFormulaSatisfied\(holidayFormula\)/);
  assert.match(wbsSource, /holidayCountFormula \+ '=0,'/);
});
