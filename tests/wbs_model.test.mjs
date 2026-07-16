import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildWbsModel_,
  deriveActuals_,
  wbsColumnLetter_
} = require('../src/10_WbsExport.js');

const statusColumns = [
  { ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false },
  { ColumnId: 'done', Name: '完了', SortOrder: 2000, IsDoneColumn: true }
];

function baseRows() {
  return {
    statusColumns,
    members: [
      { MemberId: 'm1', Name: '佐藤', Email: 'sato@example.com', Company: 'ACME', Color: '#1E6F5C' },
      { MemberId: 'm2', Name: '田中', Email: 'tanaka@example.com', Company: 'ACME', Color: '#2F6FDB' }
    ],
    milestones: [],
    meetings: [],
    activityLog: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: '案件', StatusColumnId: 'todo', SortOrder: 1000 },
      { NodeId: 'a', ParentId: 'root', Name: 'A', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-01', EndDate: '2026-07-03' },
      { NodeId: 'b', ParentId: 'root', Name: 'B', StatusColumnId: 'todo', SortOrder: 2000, IncludeInWbs: false, StartDate: '2026-07-02', EndDate: '2026-07-04' },
      { NodeId: 'b1', ParentId: 'b', Name: 'B-1', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-02', EndDate: '2026-07-04' },
      { NodeId: 'c', ParentId: 'root', Name: 'C', StatusColumnId: 'todo', SortOrder: 3000, StartDate: '2026-07-05', EndDate: '2026-07-06' },
      { NodeId: 'c1', ParentId: 'c', Name: 'C-1', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-05', EndDate: '2026-07-05' },
      { NodeId: 'c1a', ParentId: 'c1', Name: 'C-1-a', StatusColumnId: 'done', SortOrder: 1000, Progress: 100, StartDate: '2026-07-05', EndDate: '2026-07-05' },
      { NodeId: 'c1a1', ParentId: 'c1a', Name: 'C-1-a-1', StatusColumnId: 'todo', SortOrder: 1000, Progress: 45, StartDate: '2026-07-05', EndDate: '2026-07-05' }
    ]
  };
}

test('WBS numbering skips IncludeInWbs=false subtrees', () => {
  const model = buildWbsModel_(baseRows(), {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  assert.deepEqual(model.taskRows.map(row => [row.number, row.node.NodeId]), [
    ['1', 'a'],
    ['2', 'c'],
    ['2-1', 'c1'],
    ['2-1-1', 'c1a'],
    ['2-1-1-1', 'c1a1']
  ]);
});

test('WBS excludes unfinished draft nodes and their dates', () => {
  const rows = baseRows();
  rows.nodes.push({
    NodeId: 'draft',
    ParentId: 'root',
    Name: '',
    StatusColumnId: 'todo',
    SortOrder: 4000,
    StartDate: '2027-12-01',
    EndDate: '2027-12-31',
    DraftOwner: 'm1'
  });

  const model = buildWbsModel_(rows, {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });

  assert.equal(model.taskRows.some(row => row.node.NodeId === 'draft'), false);
  assert.equal(model.dateColumns.some(column => column.date.startsWith('2027-12')), false);
});

test('template layout keeps management columns fixed and places deep task names', () => {
  const model = buildWbsModel_(baseRows(), {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  assert.equal(model.layout.maxDepth, 4);
  assert.equal(model.layout.taskNameStartCol, 2);
  assert.equal(model.layout.taskNameEndCol, 5);
  assert.equal(model.layout.taskDisplayCol, 6);
  assert.equal(model.layout.deliverableCol, 7);
  assert.equal(model.layout.doneCol, 18);
  assert.equal(model.layout.ganttStartCol, 19);
  assert.equal(model.layout.taskStartRow, 15);
  assert.deepEqual(model.sectionRows, [15, 16]);
  assert.deepEqual(model.normalRows, [17, 18, 19]);
  assert.equal(wbsColumnLetter_(model.layout.ganttStartCol), 'S');
  const deepest = model.taskRows.find(row => row.node.NodeId === 'c1a1');
  assert.equal(model.values[deepest.sheetRow - 1][4], 'C-1-a-1');
  assert.equal(model.backgrounds[0][0], '#D9D9D9');
  assert.equal(model.backgrounds[1][5], '#D9D9D9');
  assert.equal(model.backgrounds[0][8], '#FFFFDD');
  assert.equal(model.backgrounds[1][8], '#FFFFDD');
  assert.equal(model.backgrounds[0][9], '#FFFFFF');
  assert.equal(model.backgrounds[0][10], '#D9D9D9');
  assert.equal(model.backgrounds[1][10], '#FFFFDD');
  assert.equal(model.backgrounds[2][0], '#FFFFFF');
  assert.equal(model.values[model.layout.headerRow2 - 1][0], 'No.');
  assert.equal(model.values[model.layout.headerRow2 - 1][5], 'タスク');
  assert.equal(model.values[model.layout.headerRow2 - 1][17], '完了フラグ');
});

test('template places milestones and dated meetings on gantt rows', () => {
  const rows = baseRows();
  rows.milestones = [
    { MilestoneId: 'ms1', Name: 'Kick Off', Date: '2026-07-05', SortOrder: 1000 },
    { MilestoneId: 'ms2', Name: 'Review', Date: '2026-07-06', SortOrder: 2000 }
  ];
  rows.meetings = [
    { MeetingId: 'mt1', Name: '定例会', Schedule: '毎週月曜日', SortOrder: 1000 }
  ];
  const model = buildWbsModel_(rows, {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  const milestoneDateIndex = model.dateColumns.findIndex(date => date.date === '2026-07-05');
  const adjacentMilestoneDateIndex = model.dateColumns.findIndex(date => date.date === '2026-07-06');
  const meetingDateIndex = model.dateColumns.findIndex(date => date.date === '2026-07-06');
  assert.notEqual(milestoneDateIndex, -1);
  assert.notEqual(adjacentMilestoneDateIndex, -1);
  assert.notEqual(meetingDateIndex, -1);
  assert.equal(model.values[model.layout.milestoneBodyStartRow - 1][model.layout.ganttStartCol + milestoneDateIndex - 1], 'Kick Off');
  assert.equal(model.values[model.layout.milestoneBodyStartRow][model.layout.ganttStartCol + milestoneDateIndex - 1], '▼');
  assert.equal(model.values[model.layout.milestoneBodyStartRow][model.layout.ganttStartCol + adjacentMilestoneDateIndex - 1], 'Review');
  assert.equal(model.values[model.layout.milestoneBodyStartRow + 1][model.layout.ganttStartCol + adjacentMilestoneDateIndex - 1], '▼');
  assert.equal(model.values[model.layout.meetingBodyStartRow - 1][2], '定例会 毎週月曜日');
  assert.equal(model.values[model.layout.meetingBodyStartRow - 1][model.layout.ganttStartCol + meetingDateIndex - 1], '▼');
});

test('recurring meeting rules expand biweekly and monthly occurrences', () => {
  const rows = baseRows();
  rows.nodes = [
    { NodeId: 'root', ParentId: '', Name: '案件', StatusColumnId: 'todo', SortOrder: 1000 },
    { NodeId: 'phase', ParentId: 'root', Name: 'Phase', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-01', EndDate: '2026-08-20' },
    { NodeId: 'task', ParentId: 'phase', Name: 'Task', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-01', EndDate: '2026-08-20' }
  ];
  rows.meetings = [
    {
      MeetingId: 'mt-biweekly',
      Name: '隔週会',
      Schedule: '隔週金曜日',
      ScheduleRuleJson: JSON.stringify({ type: 'weekly', interval: 2, startDate: '2026-07-03', endDate: '', weekday: 5 }),
      StartDate: '2026-07-03',
      EndDate: '',
      SortOrder: 1000
    },
    {
      MeetingId: 'mt-monthly',
      Name: '月次会',
      Schedule: '毎月第2火曜日',
      ScheduleRuleJson: JSON.stringify({ type: 'monthlyNth', interval: 1, startDate: '2026-07-14', endDate: '', nth: 2, weekday: 2 }),
      StartDate: '2026-07-14',
      EndDate: '',
      SortOrder: 2000
    }
  ];
  const model = buildWbsModel_(rows, {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  const cell = (sheetRow, dateText) => {
    const index = model.dateColumns.findIndex(date => date.date === dateText);
    assert.notEqual(index, -1);
    return model.values[sheetRow - 1][model.layout.ganttStartCol + index - 1];
  };
  assert.equal(cell(model.layout.meetingBodyStartRow, '2026-07-03'), '▼');
  assert.equal(cell(model.layout.meetingBodyStartRow, '2026-07-10'), '');
  assert.equal(cell(model.layout.meetingBodyStartRow, '2026-07-17'), '▼');
  assert.equal(cell(model.layout.meetingBodyStartRow + 1, '2026-07-14'), '▼');
  assert.equal(cell(model.layout.meetingBodyStartRow + 1, '2026-08-11'), '▼');
});

test('deriveActuals uses first activity and last done snapshot only for current 100%', () => {
  const logs = [
    { NodeId: 'n1', Field: 'progress', NewValue: 30, NewValueIsDone: false, ChangedAt: '2026-07-02T01:00:00.000Z' },
    { NodeId: 'n1', Field: 'status', NewValue: 'doing', NewValueIsDone: false, ChangedAt: '2026-07-03T01:00:00.000Z' },
    { NodeId: 'n1', Field: 'progress', NewValue: 100, NewValueIsDone: true, ChangedAt: '2026-07-04T01:00:00.000Z' },
    { NodeId: 'n1', Field: 'status', NewValue: 'done', NewValueIsDone: true, ChangedAt: '2026-07-05T01:00:00.000Z' },
    { NodeId: 'n2', Field: 'progress', NewValue: 15, NewValueIsDone: false, ChangedAt: '2026-07-06T01:00:00.000Z' },
    { NodeId: 'n2', Field: 'progress', NewValue: 100, NewValueIsDone: true, ChangedAt: '2026-07-07T01:00:00.000Z' }
  ];
  const actuals = deriveActuals_(logs, { progressByNodeId: { n1: 100, n2: 90 } });
  assert.deepEqual(actuals.n1, { startDate: '2026-07-02', endDate: '2026-07-05' });
  assert.deepEqual(actuals.n2, { startDate: '2026-07-06', endDate: '' });
});

test('deriveActuals converts UTC timestamps to Asia/Tokyo dates', () => {
  const logs = [
    { NodeId: 'n1', Field: 'progress', NewValue: 15, NewValueIsDone: false, ChangedAt: '2026-07-04T15:30:00.000Z' },
    { NodeId: 'n1', Field: 'progress', NewValue: 100, NewValueIsDone: true, ChangedAt: '2026-07-04T16:00:00.000Z' }
  ];
  const actuals = deriveActuals_(logs, { progressByNodeId: { n1: 100 } });
  assert.deepEqual(actuals.n1, { startDate: '2026-07-05', endDate: '2026-07-05' });
});

test('WBS progress output floors derived parent progress to valid options', () => {
  const rows = baseRows();
  rows.nodes = [
    { NodeId: 'root', ParentId: '', Name: '案件', StatusColumnId: 'todo', SortOrder: 1000 },
    { NodeId: 'phase', ParentId: 'root', Name: 'Phase', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-01', EndDate: '2026-07-03' },
    { NodeId: 'parent', ParentId: 'phase', Name: 'Parent', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-01', EndDate: '2026-07-03' },
    { NodeId: 'leaf1', ParentId: 'parent', Name: 'Leaf 1', StatusColumnId: 'todo', SortOrder: 1000, Progress: 90, StartDate: '2026-07-01', EndDate: '2026-07-01' },
    { NodeId: 'leaf2', ParentId: 'parent', Name: 'Leaf 2', StatusColumnId: 'done', SortOrder: 2000, Progress: 100, StartDate: '2026-07-02', EndDate: '2026-07-02' }
  ];
  const model = buildWbsModel_(rows, {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  const parentRow = model.taskRows.find(row => row.node.NodeId === 'parent');
  assert.equal(model.values[parentRow.sheetRow - 1][model.layout.progressCol - 1], 0.9);
});

test('WBS model builds a 100 task project without truncating the date range', () => {
  const rows = baseRows();
  rows.nodes = [
    { NodeId: 'root', ParentId: '', Name: '案件', StatusColumnId: 'todo', SortOrder: 1000 }
  ];
  for (let phase = 1; phase <= 10; phase += 1) {
    const phaseId = `phase-${phase}`;
    rows.nodes.push({
      NodeId: phaseId,
      ParentId: 'root',
      Name: `Phase ${phase}`,
      StatusColumnId: 'todo',
      SortOrder: phase * 1000,
      StartDate: '2026-07-01',
      EndDate: '2026-10-31'
    });
    for (let task = 1; task <= 10; task += 1) {
      const day = (phase - 1) * 10 + task;
      const start = new Date(Date.UTC(2026, 6, 1 + day));
      const end = new Date(Date.UTC(2026, 6, 2 + day));
      const dateText = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
      rows.nodes.push({
        NodeId: `task-${phase}-${task}`,
        ParentId: phaseId,
        Name: `Task ${phase}-${task}`,
        StatusColumnId: task % 5 === 0 ? 'done' : 'todo',
        SortOrder: task * 1000,
        Progress: task % 5 === 0 ? 100 : 45,
        StartDate: dateText(start),
        EndDate: dateText(end)
      });
    }
  }
  rows.milestones = [
    { MilestoneId: 'ms1', Name: '中間レビュー', Date: '2026-08-15', SortOrder: 1000 },
    { MilestoneId: 'ms2', Name: '完了判定', Date: '2026-10-15', SortOrder: 2000 }
  ];
  rows.meetings = [
    {
      MeetingId: 'weekly',
      Name: '週次定例',
      Schedule: '毎週金曜日',
      ScheduleRuleJson: JSON.stringify({ type: 'weekly', interval: 1, startDate: '2026-07-03', endDate: '', weekday: 5 }),
      StartDate: '2026-07-03',
      EndDate: '',
      SortOrder: 1000
    }
  ];

  const startedAt = Date.now();
  const model = buildWbsModel_(rows, {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(model.taskRows.length, 110);
  assert.equal(model.warning, '');
  assert.ok(model.dateColumns.length <= 400);
  assert.equal(model.values.length, model.layout.totalRows);
  assert.equal(model.values[0].length, model.layout.totalCols);
  assert.ok(elapsedMs < 5000, `WBS model build took ${elapsedMs}ms`);
});
