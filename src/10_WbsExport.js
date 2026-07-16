/**
 * Project settings and one-way WBS sheet export.
 */

var WBS_SHEET_NAME = 'WBS';
var WBS_EXPORT_GUARD_KEY = 'WBS_EXPORT_GUARD';
var WBS_EXPORT_GUARD_MS = 15 * 60 * 1000;

function upsertMilestone(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readProjectSettingsSnapshot_();
    requireCurrentMember_(rows.members);
    const milestoneId = cleanString_(payload.milestoneId);
    const name = requireName_(payload.name);
    const date = cleanString_(payload.date);
    if (!isValidDate_(date)) {
      throw new Error('マイルストーン日付は YYYY-MM-DD 形式で入力してください。');
    }
    const note = cleanString_(payload.note);
    const sortOrder = payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== ''
      ? Number(payload.sortOrder)
      : nextSortOrder_(rows.milestones);

    if (milestoneId) {
      const milestone = rows.milestones.find(function (item) { return cleanString_(item.MilestoneId) === milestoneId; });
      if (!milestone) {
        throw new Error('マイルストーンが見つかりません。');
      }
      milestone.Name = name;
      milestone.Date = date;
      milestone.Note = note;
      milestone.SortOrder = sortOrder;
      writeObject_(SHEET.MILESTONES, milestone);
    } else {
      const newMilestoneId = cleanString_(payload.clientMilestoneId);
      const duplicateId = rows.milestones.some(function (item) { return cleanString_(item.MilestoneId) === newMilestoneId; });
      if (newMilestoneId && duplicateId) {
        throw new Error('同じIDのマイルストーンが既に存在します。');
      }
      appendObject_(SHEET.MILESTONES, {
        MilestoneId: newMilestoneId || newId_(),
        Name: name,
        Date: date,
        Note: note,
        SortOrder: sortOrder
      });
    }
    return { ok: true, milestones: readProjectSettingsSnapshot_().milestones.map(clientMilestone_).sort(compareSortOrder_) };
  });
}

function deleteMilestone(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readProjectSettingsSnapshot_();
    requireCurrentMember_(rows.members);
    const milestoneId = cleanString_(payload.milestoneId);
    const milestone = rows.milestones.find(function (item) { return cleanString_(item.MilestoneId) === milestoneId; });
    if (!milestone) {
      throw new Error('マイルストーンが見つかりません。');
    }
    deleteRow_(SHEET.MILESTONES, milestone.__row);
    return { ok: true, milestones: readProjectSettingsSnapshot_().milestones.map(clientMilestone_).sort(compareSortOrder_) };
  });
}

function upsertMeeting(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readProjectSettingsSnapshot_();
    requireCurrentMember_(rows.members);
    const meetingId = cleanString_(payload.meetingId);
    const name = requireName_(payload.name);
    const scheduleRule = normalizeMeetingScheduleRulePayload_(payload);
    const schedule = cleanString_(payload.schedule) || meetingScheduleLabel_(scheduleRule);
    const note = cleanString_(payload.note);
    const sortOrder = payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== ''
      ? Number(payload.sortOrder)
      : nextSortOrder_(rows.meetings);

    if (meetingId) {
      const meeting = rows.meetings.find(function (item) { return cleanString_(item.MeetingId) === meetingId; });
      if (!meeting) {
        throw new Error('会議体が見つかりません。');
      }
      meeting.Name = name;
      meeting.Schedule = schedule;
      meeting.Note = note;
      meeting.SortOrder = sortOrder;
      meeting.ScheduleRuleJson = meetingScheduleRuleJson_(scheduleRule);
      meeting.StartDate = scheduleRule.startDate || '';
      meeting.EndDate = scheduleRule.endDate || '';
      writeObject_(SHEET.MEETINGS, meeting);
    } else {
      const newMeetingId = cleanString_(payload.clientMeetingId);
      const duplicateId = rows.meetings.some(function (item) { return cleanString_(item.MeetingId) === newMeetingId; });
      if (newMeetingId && duplicateId) {
        throw new Error('同じIDの会議体が既に存在します。');
      }
      appendObject_(SHEET.MEETINGS, {
        MeetingId: newMeetingId || newId_(),
        Name: name,
        Schedule: schedule,
        Note: note,
        SortOrder: sortOrder,
        ScheduleRuleJson: meetingScheduleRuleJson_(scheduleRule),
        StartDate: scheduleRule.startDate || '',
        EndDate: scheduleRule.endDate || ''
      });
    }
    return { ok: true, meetings: readProjectSettingsSnapshot_().meetings.map(clientMeeting_).sort(compareSortOrder_) };
  });
}

function deleteMeeting(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readProjectSettingsSnapshot_();
    requireCurrentMember_(rows.members);
    const meetingId = cleanString_(payload.meetingId);
    const meeting = rows.meetings.find(function (item) { return cleanString_(item.MeetingId) === meetingId; });
    if (!meeting) {
      throw new Error('会議体が見つかりません。');
    }
    deleteRow_(SHEET.MEETINGS, meeting.__row);
    return { ok: true, meetings: readProjectSettingsSnapshot_().meetings.map(clientMeeting_).sort(compareSortOrder_) };
  });
}

function normalizeMeetingScheduleRulePayload_(payload) {
  payload = payload || {};
  const raw = payload.scheduleRule && typeof payload.scheduleRule === 'object' && !Array.isArray(payload.scheduleRule)
    ? payload.scheduleRule
    : {};
  let type = cleanString_(payload.ruleType || raw.type);
  let interval = meetingPositiveInt_(payload.interval !== undefined ? payload.interval : raw.interval, 1);
  if (type === 'biweekly') {
    type = 'weekly';
    interval = 2;
  }
  if (['daily', 'weekly', 'monthlyDate', 'monthlyNth'].indexOf(type) === -1) {
    return { type: 'none', interval: 0, startDate: '', endDate: '' };
  }

  const startDate = cleanString_(payload.startDate || raw.startDate);
  if (!isValidDate_(startDate)) {
    throw new Error('開催ルールには初回開催日を YYYY-MM-DD 形式で入力してください。');
  }
  const endDate = cleanString_(payload.endDate || raw.endDate);
  if (endDate && !isValidDate_(endDate)) {
    throw new Error('開催ルールの終了日は YYYY-MM-DD 形式で入力してください。');
  }
  if (endDate && endDate < startDate) {
    throw new Error('開催ルールの終了日は初回開催日以降にしてください。');
  }

  const rule = {
    type: type,
    interval: type === 'weekly' ? Math.max(1, Math.min(interval, 8)) : 1,
    startDate: startDate,
    endDate: endDate
  };
  if (type === 'weekly') {
    rule.weekday = meetingWeekdayValue_(payload.weekday !== undefined ? payload.weekday : raw.weekday, startDate);
  } else if (type === 'monthlyDate') {
    const startDayOfMonth = Number(startDate.slice(8, 10));
    rule.dayOfMonth = Math.max(1, Math.min(meetingPositiveInt_(payload.dayOfMonth !== undefined ? payload.dayOfMonth : raw.dayOfMonth, startDayOfMonth), 31));
  } else if (type === 'monthlyNth') {
    const nth = Number(payload.nth !== undefined ? payload.nth : raw.nth);
    rule.nth = nth === -1 ? -1 : Math.max(1, Math.min(meetingPositiveInt_(nth, 1), 5));
    rule.weekday = meetingWeekdayValue_(payload.weekday !== undefined ? payload.weekday : raw.weekday, startDate);
  }
  return rule;
}

function meetingScheduleRuleJson_(rule) {
  return rule && rule.type && rule.type !== 'none' ? JSON.stringify(rule) : '';
}

function meetingScheduleLabel_(rule) {
  if (!rule || rule.type === 'none') {
    return '';
  }
  const range = rule.startDate
    ? '（' + meetingShortDate_(rule.startDate) + '〜' + (rule.endDate ? meetingShortDate_(rule.endDate) : '') + '）'
    : '';
  if (rule.type === 'daily') {
    return '毎日' + range;
  }
  if (rule.type === 'weekly') {
    const prefix = Number(rule.interval) === 2 ? '隔週' : Number(rule.interval) > 2 ? String(Number(rule.interval)) + '週ごと' : '毎週';
    return prefix + meetingWeekdayLabel_(rule.weekday) + range;
  }
  if (rule.type === 'monthlyDate') {
    return '毎月' + String(Number(rule.dayOfMonth) || 1) + '日' + range;
  }
  if (rule.type === 'monthlyNth') {
    return '毎月' + meetingNthLabel_(rule.nth) + meetingWeekdayLabel_(rule.weekday) + range;
  }
  return '';
}

function meetingPositiveInt_(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function meetingWeekdayValue_(value, startDate) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 6) {
    return Math.floor(numeric);
  }
  return new Date(Date.UTC(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, Number(startDate.slice(8, 10)))).getUTCDay();
}

function meetingWeekdayLabel_(weekday) {
  return ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][Number(weekday)] || '曜日';
}

function meetingNthLabel_(nth) {
  return Number(nth) === -1 ? '最終' : '第' + String(Number(nth) || 1);
}

function meetingShortDate_(dateText) {
  return dateText ? dateText.replace(/-/g, '/') : '';
}

function exportWbs() {
  requireSchemaExists_();
  const actor = requireCurrentMember_();
  const guardToken = acquireWbsExportGuard_();
  const startedAt = Date.now();

  try {
    const rows = readAll_({ includeActivityLog: true });
    const documentProps = PropertiesService.getDocumentProperties();
    const nowIso = nowIso_();
    const createdAt = documentProps.getProperty('WBS_CREATED_AT') || nowIso;
    const version = (Number(documentProps.getProperty('WBS_VERSION')) || 0) + 1;
    const model = buildWbsModel_(rows, {
      actorName: actor.Name,
      now: nowIso,
      createdAt: createdAt,
      version: version
    });
    writeWbsSheetStaged_(model);
    documentProps.setProperty('WBS_CREATED_AT', createdAt);
    documentProps.setProperty('WBS_VERSION', String(version));
    return {
      ok: true,
      version: version,
      rowCount: model.taskRows.length,
      warning: model.warning || ''
    };
  } catch (error) {
    console.error('WBS export failed after ' + String(Date.now() - startedAt) + 'ms: ' + cleanString_(error && error.stack || error));
    throw error;
  } finally {
    console.info('WBS export finished in ' + String(Date.now() - startedAt) + 'ms');
    releaseWbsExportGuard_(guardToken);
  }
}

function acquireWbsExportGuard_() {
  return withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    let current = null;
    try {
      current = JSON.parse(props.getProperty(WBS_EXPORT_GUARD_KEY) || 'null');
    } catch (error) {
      current = null;
    }
    if (current && Number(current.startedAt) && now - Number(current.startedAt) < WBS_EXPORT_GUARD_MS) {
      throw appError_('WBS_BUSY', 'WBS出力が実行中です。しばらくして再試行してください。', true);
    }
    const token = newId_();
    props.setProperty(WBS_EXPORT_GUARD_KEY, JSON.stringify({ token: token, startedAt: now }));
    return token;
  });
}

function releaseWbsExportGuard_(token) {
  try {
    withLock_(function () {
      const props = PropertiesService.getScriptProperties();
      let current = null;
      try {
        current = JSON.parse(props.getProperty(WBS_EXPORT_GUARD_KEY) || 'null');
      } catch (error) {
        current = null;
      }
      if (!current || cleanString_(current.token) === cleanString_(token)) {
        props.deleteProperty(WBS_EXPORT_GUARD_KEY);
      }
    });
  } catch (error) {
    console.error('WBS guard cleanup failed: ' + cleanString_(error && error.message));
  }
}

function buildWbsModel_(rows, options) {
  rows = rows || {};
  options = options || {};
  const nodes = (rows.nodes || []).filter(function (node) {
    return !wbsClean_(wbsGet_(node, 'DeletedAt', 'deletedAt')) &&
      !wbsClean_(wbsGet_(node, 'DraftOwner', 'draftOwner'));
  });
  const members = rows.members || [];
  const statusColumns = rows.statusColumns || [];
  const milestones = (rows.milestones || []).slice().sort(wbsCompareSort_);
  const meetings = (rows.meetings || []).slice().sort(wbsCompareSort_);
  const logs = rows.activityLog || rows.activityLogs || [];
  const derivedState = computeWbsDerived_(nodes, statusColumns);
  const root = derivedState.root || nodes[0] || {};
  const visibleRows = filterWbsTree_(derivedState);
  const maxDepth = Math.max(3, visibleRows.reduce(function (max, row) { return Math.max(max, row.depth); }, 0));
  const layout = buildWbsLayout_(maxDepth, meetings.length, visibleRows.length);
  const dateRange = buildWbsDateRange_(visibleRows, derivedState.derived, options, milestones, meetings);
  layout.totalCols = layout.ganttStartCol + dateRange.dateColumns.length - 1;
  const actuals = deriveActuals_(logs, {
    progressByNodeId: derivedState.progressByNodeId
  });
  const values = wbsEmptyMatrix_(layout.totalRows, layout.totalCols, '');
  const backgrounds = wbsEmptyMatrix_(layout.totalRows, layout.totalCols, WBS_COLORS.white);

  fillWbsStaticSections_(values, backgrounds, layout, {
    root: root,
    visibleRows: visibleRows,
    derived: derivedState.derived,
    milestones: milestones,
    meetings: meetings,
    dateRange: dateRange,
    options: options
  });
  fillWbsTasks_(values, backgrounds, layout, {
    visibleRows: visibleRows,
    members: members,
    derived: derivedState.derived,
    actuals: actuals,
    dateRange: dateRange,
    progressByNodeId: derivedState.progressByNodeId
  });

  return {
    values: values,
    backgrounds: backgrounds,
    layout: layout,
    taskRows: visibleRows,
    dateColumns: dateRange.dateColumns,
    warning: dateRange.warning,
    sectionRows: visibleRows.filter(function (row) { return row.depth === 1; }).map(function (row) { return row.sheetRow; }),
    normalRows: visibleRows.filter(function (row) { return row.depth !== 1; }).map(function (row) { return row.sheetRow; })
  };
}

var WBS_COLORS = {
  white: '#FFFFFF',
  metaLabel: '#D9D9D9',
  paleYellow: '#FFFFDD',
  header: '#CCCCCC',
  saturday: '#A4C2F4',
  sunday: '#F4CCCC',
  plan: '#B7E1CD',
  section: '#666666',
  completed: '#B7B7B7',
  border: '#000000'
};

var WBS_PROGRESS_OPTIONS = ['0.0', '0.15', '0.3', '0.45', '0.6', '0.75', '0.9', '1'];
var WBS_PROGRESS_COLORS = [
  { value: 0, color: '#e67c73' },
  { value: 0.15, color: '#e98f82' },
  { value: 0.3, color: '#eda392' },
  { value: 0.45, color: '#f1b6a3' },
  { value: 0.6, color: '#f5cab3' },
  { value: 0.75, color: '#f8dec3' },
  { value: 0.9, color: '#fcf1d1' }
];

function buildWbsLayout_(maxDepth, meetingCount, taskCount) {
  const noCol = 1;
  const taskNameStartCol = 2;
  const indentDepth = 4;
  const taskNameEndCol = taskNameStartCol + indentDepth - 1;
  const taskDisplayCol = 6;
  const deliverableCol = 7;
  const noteCol = 8;
  const companyCol = 9;
  const assigneeCol = 10;
  const planStartCol = 11;
  const planEndCol = 12;
  const planDaysCol = 13;
  const actualStartCol = 14;
  const actualEndCol = 15;
  const actualDaysCol = 16;
  const progressCol = 17;
  const doneCol = 18;
  const ganttStartCol = 19;

  const metaStartRow = 1;
  const metaEndRow = 2;
  const headerRow1 = 4;
  const headerRow2 = 5;
  const milestoneStartRow = 6;
  const milestoneBodyStartRow = 7;
  const milestoneBodyRows = 4;
  const milestoneEndRow = milestoneBodyStartRow + milestoneBodyRows - 1;
  const meetingStartRow = milestoneEndRow + 1;
  const meetingBodyStartRow = meetingStartRow + 1;
  const meetingBodyRows = Math.max(3, meetingCount);
  const meetingEndRow = meetingBodyStartRow + meetingBodyRows - 1;
  const taskStartRow = meetingEndRow + 1;
  const taskEndRow = taskCount ? taskStartRow + taskCount - 1 : taskStartRow;

  return {
    noCol: noCol,
    maxDepth: maxDepth,
    indentDepth: indentDepth,
    taskNameStartCol: taskNameStartCol,
    taskNameEndCol: taskNameEndCol,
    taskDisplayCol: taskDisplayCol,
    deliverableCol: deliverableCol,
    noteCol: noteCol,
    companyCol: companyCol,
    assigneeCol: assigneeCol,
    planStartCol: planStartCol,
    planEndCol: planEndCol,
    planDaysCol: planDaysCol,
    actualStartCol: actualStartCol,
    actualEndCol: actualEndCol,
    actualDaysCol: actualDaysCol,
    progressCol: progressCol,
    doneCol: doneCol,
    ganttStartCol: ganttStartCol,
    metaStartRow: metaStartRow,
    metaEndRow: metaEndRow,
    milestoneStartRow: milestoneStartRow,
    milestoneBodyStartRow: milestoneBodyStartRow,
    milestoneBodyRows: milestoneBodyRows,
    milestoneEndRow: milestoneEndRow,
    meetingStartRow: meetingStartRow,
    meetingBodyStartRow: meetingBodyStartRow,
    meetingBodyRows: meetingBodyRows,
    meetingEndRow: meetingEndRow,
    headerRow1: headerRow1,
    headerRow2: headerRow2,
    taskStartRow: taskStartRow,
    taskEndRow: taskEndRow,
    leftEndCol: doneCol,
    totalRows: Math.max(taskEndRow, meetingEndRow),
    totalCols: ganttStartCol + 1
  };
}

function buildWbsDateRange_(visibleRows, derived, options, milestones, meetings) {
  const days = [];
  visibleRows.forEach(function (row) {
    const plan = wbsPlanForNode_(row.node, derived[wbsNodeId_(row.node)]);
    if (wbsIsValidDate_(plan.startDate) && wbsIsValidDate_(plan.endDate)) {
      days.push(wbsDateToDay_(plan.startDate), wbsDateToDay_(plan.endDate));
    }
  });
  (milestones || []).forEach(function (milestone) {
    const date = wbsClean_(wbsGet_(milestone, 'Date', 'date'));
    if (wbsIsValidDate_(date)) {
      days.push(wbsDateToDay_(date));
    }
  });
  (meetings || []).forEach(function (meeting) {
    wbsExplicitMeetingMarkerDates_(meeting).forEach(function (date) {
      days.push(wbsDateToDay_(date));
    });
    const rule = wbsMeetingScheduleRule_(meeting);
    if (rule.type !== 'none' && wbsIsValidDate_(rule.startDate)) {
      days.push(wbsDateToDay_(rule.startDate));
    }
  });
  let startDay;
  let endDay;
  if (days.length) {
    startDay = Math.min.apply(null, days) - 7;
    endDay = Math.max.apply(null, days) + 7;
  } else {
    const today = wbsClean_(options.today) || wbsDateTextInTimeZone_(options.now) || wbsTodayText_();
    startDay = wbsDateToDay_(today) - 7;
    endDay = wbsDateToDay_(today) + 30;
  }
  let warning = '';
  if (endDay - startDay + 1 > 400) {
    endDay = startDay + 399;
    warning = '計画範囲が400日を超えたため、日付列を400日分に切り詰めました。';
  }
  const dateColumns = [];
  for (let day = startDay; day <= endDay; day += 1) {
    dateColumns.push({ day: day, date: wbsDayToDate_(day), dow: wbsDow_(day) });
  }
  return { startDay: startDay, endDay: endDay, dateColumns: dateColumns, warning: warning };
}

function fillWbsStaticSections_(values, backgrounds, layout, context) {
  const rootName = wbsClean_(wbsGet_(context.root, 'Name', 'name')) || 'プロジェクト';
  const nowDate = wbsDateTextInTimeZone_(context.options.now) || wbsTodayText_();
  const plannedStarts = [];
  const plannedEnds = [];
  context.visibleRows.forEach(function (row) {
    const plan = wbsPlanForNode_(row.node, context.derived[wbsNodeId_(row.node)]);
    if (plan.startDate && plan.endDate) {
      plannedStarts.push(plan.startDate);
      plannedEnds.push(plan.endDate);
    }
  });
  const minStart = plannedStarts.length ? plannedStarts.sort()[0] : '';
  const maxEnd = plannedEnds.length ? plannedEnds.sort()[plannedEnds.length - 1] : '';

  values[0][2] = 'プロジェクト名';
  values[0][6] = rootName;
  values[0][10] = '開始日';
  values[0][11] = '終了日';
  values[0][13] = '更新日';
  values[1][10] = minStart ? wbsDateValue_(minStart) : '';
  values[1][11] = maxEnd ? wbsDateValue_(maxEnd) : '';
  values[1][13] = wbsDateValue_(nowDate);
  wbsSetBackgrounds_(backgrounds, 1, 1, 2, 6, WBS_COLORS.metaLabel);
  wbsSetBackgrounds_(backgrounds, 1, 7, 2, 3, WBS_COLORS.paleYellow);
  wbsSetBackgrounds_(backgrounds, 1, 11, 1, 2, WBS_COLORS.metaLabel);
  wbsSetBackgrounds_(backgrounds, 1, 14, 1, 1, WBS_COLORS.metaLabel);
  wbsSetBackgrounds_(backgrounds, 2, 11, 1, 2, WBS_COLORS.paleYellow);
  wbsSetBackgrounds_(backgrounds, 2, 14, 1, 1, WBS_COLORS.paleYellow);

  wbsSetBackgrounds_(backgrounds, layout.headerRow1, 1, 2, layout.totalCols, WBS_COLORS.header);
  values[layout.headerRow1 - 1][layout.companyCol - 1] = 'タスクオーナー';
  values[layout.headerRow1 - 1][layout.planEndCol - 1] = '計画';
  values[layout.headerRow1 - 1][layout.actualEndCol - 1] = '実績';
  values[layout.headerRow2 - 1][0] = 'No.';
  for (let depth = 0; depth < layout.indentDepth - 1; depth += 1) {
    values[layout.headerRow2 - 1][layout.taskNameStartCol + depth - 1] = depth + 1;
  }
  values[layout.headerRow2 - 1][layout.taskDisplayCol - 1] = 'タスク';
  values[layout.headerRow2 - 1][layout.deliverableCol - 1] = '成果物';
  values[layout.headerRow2 - 1][layout.noteCol - 1] = '備考';
  values[layout.headerRow2 - 1][layout.companyCol - 1] = '会社名';
  values[layout.headerRow2 - 1][layout.assigneeCol - 1] = '責任者';
  values[layout.headerRow2 - 1][layout.planStartCol - 1] = '開始';
  values[layout.headerRow2 - 1][layout.planEndCol - 1] = '終了';
  values[layout.headerRow2 - 1][layout.planDaysCol - 1] = '日数';
  values[layout.headerRow2 - 1][layout.actualStartCol - 1] = '開始';
  values[layout.headerRow2 - 1][layout.actualEndCol - 1] = '終了';
  values[layout.headerRow2 - 1][layout.actualDaysCol - 1] = '日数';
  values[layout.headerRow2 - 1][layout.progressCol - 1] = '進捗率';
  values[layout.headerRow2 - 1][layout.doneCol - 1] = '完了フラグ';
  context.dateRange.dateColumns.forEach(function (date, index) {
    const col = layout.ganttStartCol + index;
    values[layout.headerRow1 - 1][col - 1] = wbsDateValue_(date.date);
    values[layout.headerRow2 - 1][col - 1] = wbsWeekdayLabel_(date.dow);
  });

  values[layout.milestoneStartRow - 1][1] = 'マイルストーン';
  wbsSetRowBackground_(backgrounds, layout.milestoneStartRow, 1, layout.totalCols, WBS_COLORS.section);
  wbsSetBackgrounds_(backgrounds, layout.milestoneBodyStartRow, 1, layout.milestoneBodyRows, layout.leftEndCol, WBS_COLORS.paleYellow);
  wbsMilestonePlacements_(context.milestones, context.dateRange, layout.milestoneBodyRows - 1).forEach(function (placement) {
    const dateIndex = wbsDateIndex_(context.dateRange, placement.date);
    if (dateIndex >= 0) {
      const col = layout.ganttStartCol + dateIndex;
      wbsAppendCellText_(values, layout.milestoneBodyStartRow + placement.lane, col, placement.name);
      wbsAppendCellText_(values, layout.milestoneBodyStartRow + placement.lane + 1, col, '▼');
    }
  });

  values[layout.meetingStartRow - 1][1] = '会議体';
  wbsSetRowBackground_(backgrounds, layout.meetingStartRow, 1, layout.totalCols, WBS_COLORS.section);
  wbsSetBackgrounds_(backgrounds, layout.meetingBodyStartRow, 1, layout.meetingBodyRows, layout.leftEndCol, WBS_COLORS.paleYellow);
  context.meetings.forEach(function (meeting, index) {
    const sheetRow = layout.meetingBodyStartRow + index;
    const name = wbsClean_(wbsGet_(meeting, 'Name', 'name'));
    const schedule = wbsClean_(wbsGet_(meeting, 'Schedule', 'schedule'));
    const note = wbsClean_(wbsGet_(meeting, 'Note', 'note'));
    values[sheetRow - 1][2] = [name, schedule].filter(Boolean).join(' ');
    wbsMeetingMarkerDates_(meeting, context.dateRange).forEach(function (date) {
      const dateIndex = wbsDateIndex_(context.dateRange, date);
      if (dateIndex >= 0) {
        wbsAppendCellText_(values, sheetRow, layout.ganttStartCol + dateIndex, '▼');
      }
    });
    if (!schedule && note) {
      values[sheetRow - 1][2] = [name, note].filter(Boolean).join(' ');
    }
  });
}

function fillWbsTasks_(values, backgrounds, layout, context) {
  const membersById = {};
  context.members.forEach(function (member) {
    membersById[wbsClean_(wbsGet_(member, 'MemberId', 'id'))] = member;
  });
  context.visibleRows.forEach(function (row, index) {
    const node = row.node;
    const nodeId = wbsNodeId_(node);
    const sheetRow = layout.taskStartRow + index;
    row.sheetRow = sheetRow;
    const matrixRow = values[sheetRow - 1];
    const bgRow = backgrounds[sheetRow - 1];
    const plan = wbsPlanForNode_(node, context.derived[nodeId]);
    const actual = context.actuals[nodeId] || {};
    const assigneeIds = wbsSplitCsv_(wbsGet_(node, 'AssigneeIds', 'assigneeIds'));
    const assigneeNames = [];
    const companies = [];
    assigneeIds.forEach(function (id) {
      const member = membersById[id];
      if (!member) {
        return;
      }
      const name = wbsClean_(wbsGet_(member, 'Name', 'name'));
      const company = wbsClean_(wbsGet_(member, 'Company', 'company'));
      if (name) {
        assigneeNames.push(name);
      }
      if (company && companies.indexOf(company) === -1) {
        companies.push(company);
      }
    });

    matrixRow[0] = row.number;
    matrixRow[wbsTaskNameCol_(layout, row.depth) - 1] = wbsClean_(wbsGet_(node, 'Name', 'name'));
    if (row.depth === 1) {
      wbsSetRowBackground_(backgrounds, sheetRow, 1, layout.totalCols, WBS_COLORS.section);
      return;
    }

    wbsSetBackgrounds_(backgrounds, sheetRow, 1, 1, layout.planDaysCol - 1, WBS_COLORS.paleYellow);
    wbsSetBackgrounds_(backgrounds, sheetRow, layout.actualStartCol, 1, 2, WBS_COLORS.paleYellow);
    backgrounds[sheetRow - 1][layout.planDaysCol - 1] = WBS_COLORS.header;
    backgrounds[sheetRow - 1][layout.actualDaysCol - 1] = WBS_COLORS.header;
    backgrounds[sheetRow - 1][layout.doneCol - 1] = WBS_COLORS.header;
    matrixRow[layout.deliverableCol - 1] = wbsClean_(wbsGet_(node, 'Deliverable', 'deliverable'));
    matrixRow[layout.noteCol - 1] = wbsClean_(wbsGet_(node, 'Note', 'note'));
    matrixRow[layout.companyCol - 1] = companies.join('・');
    matrixRow[layout.assigneeCol - 1] = assigneeNames.join('・');
    matrixRow[layout.planStartCol - 1] = plan.startDate ? wbsDateValue_(plan.startDate) : '';
    matrixRow[layout.planEndCol - 1] = plan.endDate ? wbsDateValue_(plan.endDate) : '';
    matrixRow[layout.planDaysCol - 1] = wbsDaysFormula_(sheetRow, layout.planStartCol, layout.planEndCol);
    matrixRow[layout.actualStartCol - 1] = actual.startDate ? wbsDateValue_(actual.startDate) : '';
    matrixRow[layout.actualEndCol - 1] = actual.endDate ? wbsDateValue_(actual.endDate) : '';
    matrixRow[layout.actualDaysCol - 1] = wbsDaysFormula_(sheetRow, layout.actualStartCol, layout.actualEndCol);
    matrixRow[layout.progressCol - 1] = wbsProgressBucket_(context.progressByNodeId[nodeId]) / 100;
    matrixRow[layout.doneCol - 1] = '=IF(' + wbsA1_(sheetRow, layout.progressCol) + '=1, "完了", "")';

    context.dateRange.dateColumns.forEach(function (_date, dateIndex) {
      const col = layout.ganttStartCol + dateIndex;
      bgRow[col - 1] = WBS_COLORS.white;
      matrixRow[col - 1] = wbsActualMarkerFormula_(sheetRow, col, layout.actualStartCol, layout.actualEndCol);
    });
  });
}

function writeWbsSheetStaged_(model) {
  const ss = SpreadsheetApp.getActive();
  const suffix = String(Date.now()) + '_' + newId_().slice(0, 8);
  const stagingName = '__WBS_STAGING_' + suffix;
  const backupName = '__WBS_BACKUP_' + suffix;
  const existing = ss.getSheetByName(WBS_SHEET_NAME);
  const existingIndex = existing ? existing.getIndex() : null;
  const staging = ss.insertSheet(stagingName);
  let backup = null;
  try {
    writeWbsSheet_(model, staging);
    if (existing) {
      existing.setName(backupName);
      backup = existing;
    }
    staging.setName(WBS_SHEET_NAME);
    if (existingIndex) {
      ss.setActiveSheet(staging);
      ss.moveActiveSheet(existingIndex);
    }
    if (backup) {
      try {
        ss.deleteSheet(backup);
      } catch (cleanupError) {
        console.error('WBS backup cleanup failed: ' + cleanString_(cleanupError && cleanupError.message));
      }
    }
  } catch (error) {
    const currentWbs = ss.getSheetByName(WBS_SHEET_NAME);
    backup = ss.getSheetByName(backupName);
    if (backup) {
      if (currentWbs && currentWbs.getSheetId() === staging.getSheetId()) {
        ss.deleteSheet(currentWbs);
      } else {
        const currentStaging = ss.getSheetByName(stagingName);
        if (currentStaging) ss.deleteSheet(currentStaging);
      }
      if (!ss.getSheetByName(WBS_SHEET_NAME)) backup.setName(WBS_SHEET_NAME);
    } else {
      const currentStaging = ss.getSheetByName(stagingName);
      if (currentStaging) ss.deleteSheet(currentStaging);
    }
    throw error;
  }
}

function writeWbsSheet_(model, targetSheet) {
  const ss = SpreadsheetApp.getActive();
  let sheet = targetSheet || ss.getSheetByName(WBS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(WBS_SHEET_NAME);
  }
  const rowCount = model.values.length;
  const colCount = model.values[0] ? model.values[0].length : 1;
  ensureWbsSheetSize_(sheet, rowCount, colCount);
  sheet.clear();
  sheet.setConditionalFormatRules([]);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();
  applyWbsPreValueFormats_(sheet, model, rowCount);
  sheet.getRange(1, 1, rowCount, colCount).setValues(model.values);
  sheet.getRange(1, 1, rowCount, colCount).setBackgrounds(model.backgrounds);
  applyWbsTemplateFormats_(sheet, model, rowCount, colCount);

  const normalBlocks = wbsRowBlocks_(model.normalRows || []);
  if (normalBlocks.length) {
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(WBS_PROGRESS_OPTIONS, true)
      .setAllowInvalid(false)
      .build();
    normalBlocks.forEach(function (block) {
      [model.layout.planStartCol, model.layout.planEndCol, model.layout.actualStartCol, model.layout.actualEndCol].forEach(function (col) {
        sheet.getRange(block.start, col, block.count, 1).setNumberFormat('yyyy/mm/dd');
      });
      sheet.getRange(block.start, model.layout.progressCol, block.count, 1)
        .setNumberFormat('General')
        .setDataValidation(validation);
    });
  }

  sheet.setConditionalFormatRules(buildWbsConditionalFormatRules_(sheet, model));
  SpreadsheetApp.flush();
}

function applyWbsPreValueFormats_(sheet, model, rowCount) {
  const layout = model.layout;
  const textRanges = [
    sheet.getRange(1, layout.noCol, rowCount, 1),
    sheet.getRange(1, layout.taskNameStartCol, rowCount, layout.taskDisplayCol - layout.taskNameStartCol + 1),
    sheet.getRange(1, layout.deliverableCol, rowCount, 2),
    sheet.getRange(1, layout.companyCol, rowCount, 2)
  ];
  textRanges.forEach(function (range) {
    range.setNumberFormat('@');
  });
  if (model.dateColumns.length) {
    sheet.getRange(layout.milestoneBodyStartRow, layout.ganttStartCol, layout.milestoneBodyRows, model.dateColumns.length).setNumberFormat('@');
    sheet.getRange(layout.meetingBodyStartRow, layout.ganttStartCol, layout.meetingBodyRows, model.dateColumns.length).setNumberFormat('@');
  }
}

function applyWbsTemplateFormats_(sheet, model, rowCount, colCount) {
  const layout = model.layout;
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(layout.taskDisplayCol);
  sheet.getRange(1, 1, rowCount, colCount)
    .setFontFamily('Arial')
    .setFontColor('#000000')
    .setVerticalAlignment('middle')
    .setWrap(false);

  sheet.getRange(layout.headerRow1, 1, 2, colCount)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRangeList(['C1', 'K1:L1', 'N1']).setFontWeight('bold');
  sheet.getRange(layout.headerRow1, layout.companyCol, 1, 1).setHorizontalAlignment('left');
  sheet.getRange(layout.headerRow1, layout.ganttStartCol, 1, model.dateColumns.length || 1).setNumberFormat('m/d');
  sheet.getRange(2, layout.planStartCol, 1, 2).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, layout.actualStartCol, 1, 1).setNumberFormat('yyyy/mm/dd');

  const sectionRows = [layout.milestoneStartRow, layout.meetingStartRow].concat(model.sectionRows || []);
  if (sectionRows.length) {
    sheet.getRangeList(sectionRows.map(function (row) {
      return 'A' + row + ':' + wbsColumnLetter_(colCount) + row;
    })).setFontColor('#FFFFFF').setFontWeight('bold');
  }

  applyWbsTemplateBorders_(sheet, model);

  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidths(layout.taskNameStartCol, layout.indentDepth, 18);
  sheet.setColumnWidth(layout.taskDisplayCol, 149);
  sheet.setColumnWidth(layout.deliverableCol, 150);
  sheet.setColumnWidth(layout.noteCol, 87);
  sheet.setColumnWidth(layout.companyCol, 46);
  sheet.setColumnWidth(layout.assigneeCol, 63);
  sheet.setColumnWidths(layout.planStartCol, 2, 75);
  sheet.setColumnWidth(layout.planDaysCol, 31);
  sheet.setColumnWidths(layout.actualStartCol, 2, 75);
  sheet.setColumnWidth(layout.actualDaysCol, 31);
  sheet.setColumnWidth(layout.progressCol, 75);
  sheet.setColumnWidth(layout.doneCol, 70);
  if (model.dateColumns.length) {
    sheet.setColumnWidths(layout.ganttStartCol, model.dateColumns.length, 36);
  }
}

function applyWbsTemplateBorders_(sheet, model) {
  const layout = model.layout;
  const style = SpreadsheetApp.BorderStyle.SOLID;
  const color = WBS_COLORS.border;
  function border(row, col, rows, cols, top, left, bottom, right, vertical, horizontal) {
    sheet.getRange(row, col, rows, cols).setBorder(top, left, bottom, right, vertical, horizontal, color, style);
  }

  border(1, 1, 2, 6, true, true, true, true, null, null);
  border(1, 7, 2, 3, true, null, true, true, null, null);
  border(1, layout.planStartCol, 2, 2, true, true, true, true, true, true);
  border(1, layout.actualStartCol, 2, 1, true, true, true, true, null, true);

  border(layout.headerRow1, 1, 2, 1, true, true, true, true, null, null);
  border(layout.headerRow1, layout.taskNameStartCol, 2, layout.taskDisplayCol - layout.taskNameStartCol + 1, true, true, true, true, null, null);
  border(layout.headerRow1, layout.deliverableCol, 2, 1, true, true, true, true, null, null);
  border(layout.headerRow1, layout.noteCol, 2, 1, true, true, true, true, null, null);
  border(layout.headerRow1, layout.noteCol, 2, 1, null, null, null, true, null, null);
  border(layout.headerRow1, layout.companyCol, 2, 2, true, true, true, true, true, true);
  border(layout.headerRow1, layout.planStartCol, 1, 3, true, null, true, true, null, null);
  border(layout.headerRow2, layout.planStartCol, 1, 3, true, true, true, true, true, null);
  border(layout.headerRow1, layout.actualStartCol, 1, 3, true, true, true, null, null, null);
  border(layout.headerRow2, layout.actualStartCol, 1, 3, true, true, true, null, true, null);
  border(layout.headerRow1, layout.progressCol, 2, 2, true, true, true, true, true, null);
  if (model.dateColumns.length) {
    border(layout.headerRow1, layout.ganttStartCol, 2, model.dateColumns.length, true, true, true, true, true, true);
  }

  border(layout.milestoneStartRow, layout.doneCol, layout.meetingEndRow - layout.milestoneStartRow + 1, 1, null, null, null, true, null, null);

  wbsRowBlocks_(model.normalRows || []).forEach(function (block) {
    border(block.start, 1, block.count, 1, true, true, true, null, null, true);
    border(block.start, layout.taskNameStartCol, block.count, layout.taskDisplayCol - layout.taskNameStartCol + 1, true, true, true, true, null, true);
    border(block.start, layout.deliverableCol, block.count, 1, true, null, true, true, null, true);
    border(block.start, layout.noteCol, block.count, layout.assigneeCol - layout.noteCol + 1, true, true, true, true, true, true);
    border(block.start, layout.planStartCol, block.count, 3, true, true, true, true, true, true);
    border(block.start, layout.actualStartCol, block.count, 3, true, true, true, true, true, true);
    border(block.start, layout.progressCol, block.count, 2, true, true, true, true, true, true);
  });
}

function buildWbsConditionalFormatRules_(sheet, model) {
  const layout = model.layout;
  const rules = [];
  if (model.dateColumns.length) {
    const bodyRange = sheet.getRange(layout.milestoneBodyStartRow, layout.ganttStartCol, layout.totalRows - layout.milestoneBodyStartRow + 1, model.dateColumns.length);
    [layout.milestoneStartRow, layout.meetingStartRow].concat(model.sectionRows || []).forEach(function (row) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=' + wbsColumnLetter_(layout.ganttStartCol) + '$4<>""')
        .setBackground(WBS_COLORS.section)
        .setFontColor('#FFFFFF')
        .setRanges([sheet.getRange(row, layout.ganttStartCol, 1, model.dateColumns.length)])
        .build());
    });
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=1')
      .setBackground(WBS_COLORS.sunday)
      .setFontColor(WBS_COLORS.sunday)
      .setRanges([bodyRange])
      .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=7')
      .setBackground(WBS_COLORS.saturday)
      .setFontColor(WBS_COLORS.saturday)
      .setRanges([bodyRange])
      .build());
  }
  if (model.taskRows.length) {
    const taskRows = model.taskRows.length;
    const taskGanttRange = sheet.getRange(layout.taskStartRow, layout.ganttStartCol, taskRows, model.dateColumns.length || 1);
    const leftTaskRange = sheet.getRange(layout.taskStartRow, 1, taskRows, layout.leftEndCol);
    const progressRanges = wbsRowBlocks_(model.normalRows || []).map(function (block) {
      return sheet.getRange(block.start, layout.progressCol, block.count, 1);
    });
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(WEEKDAY(S$4)<>1,WEEKDAY(S$4)<>7,S$4>=$K' + layout.taskStartRow + '-0.0001,S$4<=$L' + layout.taskStartRow + '+0.0001)')
      .setBackground(WBS_COLORS.plan)
      .setRanges([taskGanttRange])
      .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$R' + layout.taskStartRow + '="完了"')
      .setBackground(WBS_COLORS.completed)
      .setRanges([leftTaskRange])
      .build());
    if (progressRanges.length) {
      WBS_PROGRESS_COLORS.forEach(function (progress) {
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenNumberEqualTo(progress.value)
          .setBackground(progress.color)
          .setRanges(progressRanges)
          .build());
      });
    }
  }
  if (model.dateColumns.length) {
    const headerRange = sheet.getRange(layout.headerRow1, layout.ganttStartCol, 2, model.dateColumns.length);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=1')
      .setBackground(WBS_COLORS.sunday)
      .setRanges([headerRange])
      .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=7')
      .setBackground(WBS_COLORS.saturday)
      .setRanges([headerRange])
      .build());
  }
  return rules;
}

function ensureWbsSheetSize_(sheet, rowCount, colCount) {
  if (sheet.getMaxRows() < rowCount) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rowCount - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < colCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), colCount - sheet.getMaxColumns());
  }
}

function computeWbsDerived_(nodes, statusColumns) {
  const children = {};
  const nodesById = {};
  nodes.forEach(function (node) {
    const id = wbsNodeId_(node);
    nodesById[id] = node;
    const parentId = wbsClean_(wbsGet_(node, 'ParentId', 'parentId'));
    if (!children[parentId]) {
      children[parentId] = [];
    }
    children[parentId].push(id);
  });
  Object.keys(children).forEach(function (parentId) {
    children[parentId].sort(function (a, b) { return wbsCompareSort_(nodesById[a], nodesById[b]); });
  });
  const doneColumn = (statusColumns || []).find(function (column) {
    return wbsIsTrue_(wbsGet_(column, 'IsDoneColumn', 'isDoneColumn'));
  }) || (statusColumns || [])[0] || {};
  const doneColumnId = wbsClean_(wbsGet_(doneColumn, 'ColumnId', 'id'));
  const progressMemo = {};
  const boundsMemo = {};

  function progressOf(id) {
    if (progressMemo[id] !== undefined) {
      return progressMemo[id];
    }
    const node = nodesById[id];
    const childIds = children[id] || [];
    if (!node) {
      return 0;
    }
    if (!childIds.length) {
      const manual = wbsValidProgress_(wbsGet_(node, 'Progress', 'manualProgress'));
      progressMemo[id] = wbsClean_(wbsGet_(node, 'StatusColumnId', 'statusColumnId')) === doneColumnId ? 100 : manual === null ? 0 : manual;
      return progressMemo[id];
    }
    const sum = childIds.reduce(function (total, childId) { return total + progressOf(childId); }, 0);
    progressMemo[id] = Math.round((sum / childIds.length) * 10) / 10;
    return progressMemo[id];
  }

  function boundsOf(id) {
    if (boundsMemo[id]) {
      return boundsMemo[id];
    }
    const node = nodesById[id];
    const starts = [];
    const ends = [];
    if (node && wbsHasSchedule_(node)) {
      starts.push(wbsClean_(wbsGet_(node, 'StartDate', 'startDate')));
      ends.push(wbsClean_(wbsGet_(node, 'EndDate', 'endDate')));
    }
    (children[id] || []).forEach(function (childId) {
      const bounds = boundsOf(childId);
      if (bounds.startDate && bounds.endDate) {
        starts.push(bounds.startDate);
        ends.push(bounds.endDate);
      }
    });
    boundsMemo[id] = starts.length ? { startDate: starts.sort()[0], endDate: ends.sort()[ends.length - 1] } : { startDate: '', endDate: '' };
    return boundsMemo[id];
  }

  const derived = {};
  const progressByNodeId = {};
  nodes.forEach(function (node) {
    const id = wbsNodeId_(node);
    const bounds = boundsOf(id);
    progressByNodeId[id] = progressOf(id);
    derived[id] = {
      hasChildren: (children[id] || []).length > 0,
      progress: progressByNodeId[id],
      displayStartDate: bounds.startDate,
      displayEndDate: bounds.endDate
    };
  });
  const root = nodes.find(function (node) { return !wbsClean_(wbsGet_(node, 'ParentId', 'parentId')); }) || nodes[0] || null;
  return { nodes: nodes, nodesById: nodesById, children: children, derived: derived, progressByNodeId: progressByNodeId, root: root };
}

function filterWbsTree_(state) {
  const rootId = state.root ? wbsNodeId_(state.root) : '';
  const rows = [];
  function visitChildren(parentId, depth, prefix) {
    let index = 0;
    (state.children[parentId] || []).forEach(function (childId) {
      const node = state.nodesById[childId];
      if (!node || !wbsIncludeInWbs_(node)) {
        return;
      }
      index += 1;
      const number = prefix ? prefix + '-' + index : String(index);
      rows.push({ node: node, depth: depth, number: number, sheetRow: 0 });
      visitChildren(childId, depth + 1, number);
    });
  }
  visitChildren(rootId, 1, '');
  return rows;
}

function deriveActuals_(logs, options) {
  logs = logs || [];
  options = options || {};
  const grouped = {};
  logs.forEach(function (log) {
    const nodeId = wbsClean_(wbsGet_(log, 'NodeId', 'nodeId'));
    if (!nodeId) {
      return;
    }
    if (!grouped[nodeId]) {
      grouped[nodeId] = [];
    }
    grouped[nodeId].push(log);
  });
  const actuals = {};
  Object.keys(grouped).forEach(function (nodeId) {
    const nodeLogs = grouped[nodeId].slice().sort(function (a, b) {
      return wbsClean_(wbsGet_(a, 'ChangedAt', 'changedAt')).localeCompare(wbsClean_(wbsGet_(b, 'ChangedAt', 'changedAt')));
    });
    const startCandidates = [];
    nodeLogs.forEach(function (log) {
      const field = wbsClean_(wbsGet_(log, 'Field', 'field'));
      const changedAt = wbsClean_(wbsGet_(log, 'ChangedAt', 'changedAt'));
      if (!changedAt) {
        return;
      }
      const changedDate = wbsDateTextInTimeZone_(changedAt);
      if (field === 'status') {
        if (changedDate) startCandidates.push(changedDate);
      }
      if (field === 'progress' && Number(wbsGet_(log, 'NewValue', 'newValue')) > 0) {
        if (changedDate) startCandidates.push(changedDate);
      }
    });
    const currentProgress = Number(options.progressByNodeId && options.progressByNodeId[nodeId]) || 0;
    let endDate = '';
    if (currentProgress === 100) {
      nodeLogs.forEach(function (log) {
        if (wbsIsTrue_(wbsGet_(log, 'NewValueIsDone', 'newValueIsDone'))) {
          endDate = wbsDateTextInTimeZone_(wbsGet_(log, 'ChangedAt', 'changedAt'));
        }
      });
    }
    actuals[nodeId] = {
      startDate: startCandidates.length ? startCandidates.sort()[0] : '',
      endDate: endDate
    };
  });
  return actuals;
}

function wbsPlanForNode_(node, derived) {
  const ownStart = wbsClean_(wbsGet_(node, 'StartDate', 'startDate'));
  const ownEnd = wbsClean_(wbsGet_(node, 'EndDate', 'endDate'));
  if (wbsIsValidDate_(ownStart) && wbsIsValidDate_(ownEnd)) {
    return { startDate: ownStart, endDate: ownEnd };
  }
  return {
    startDate: derived && derived.displayStartDate ? derived.displayStartDate : '',
    endDate: derived && derived.displayEndDate ? derived.displayEndDate : ''
  };
}

function wbsSetRowBackground_(backgrounds, row, startCol, colCount, color) {
  for (let col = startCol; col < startCol + colCount; col += 1) {
    backgrounds[row - 1][col - 1] = color;
  }
}

function wbsSetBackgrounds_(backgrounds, startRow, startCol, rowCount, colCount, color) {
  for (let row = startRow; row < startRow + rowCount; row += 1) {
    wbsSetRowBackground_(backgrounds, row, startCol, colCount, color);
  }
}

function wbsRowBlocks_(rows) {
  const sorted = rows
    .map(function (row) { return Number(row) || 0; })
    .filter(function (row) { return row > 0; })
    .sort(function (a, b) { return a - b; });
  const blocks = [];
  sorted.forEach(function (row) {
    const last = blocks[blocks.length - 1];
    if (last && last.start + last.count === row) {
      last.count += 1;
      return;
    }
    blocks.push({ start: row, count: 1 });
  });
  return blocks;
}

function wbsEmptyMatrix_(rows, cols, value) {
  const matrix = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      line.push(value);
    }
    matrix.push(line);
  }
  return matrix;
}

function wbsDaysFormula_(row, startCol, endCol) {
  const start = wbsA1_(row, startCol);
  const end = wbsA1_(row, endCol);
  return '=IF(AND(' + start + '<>"", ' + end + '<>""), ' + end + '-' + start + '+1, "")';
}

function wbsActualMarkerFormula_(row, dateCol, actualStartCol, actualEndCol) {
  const dateCell = wbsColumnLetter_(dateCol) + '$4';
  const startCell = '$' + wbsColumnLetter_(actualStartCol) + row;
  const endCell = '$' + wbsColumnLetter_(actualEndCol) + row;
  return '=IF(AND(' + dateCell + '<>"", ' + dateCell + '>=' + startCell + '-0.0001, ' + dateCell + '<=' + endCell + '+0.0001), "★", "")';
}

function wbsTaskNameCol_(layout, depth) {
  const safeDepth = Math.max(1, Math.min(Number(depth) || 1, layout.indentDepth));
  return layout.taskNameStartCol + safeDepth - 1;
}

function wbsAppendCellText_(values, row, col, text) {
  const value = wbsClean_(text);
  if (!value) {
    return;
  }
  const current = wbsClean_(values[row - 1][col - 1]);
  values[row - 1][col - 1] = current ? current + ' / ' + value : value;
}

function wbsMilestonePlacements_(milestones, dateRange, laneCount) {
  const lanes = [];
  const safeLaneCount = Math.max(1, Number(laneCount) || 1);
  return (milestones || [])
    .map(function (milestone, index) {
      const date = wbsClean_(wbsGet_(milestone, 'Date', 'date'));
      return {
        name: wbsClean_(wbsGet_(milestone, 'Name', 'name')),
        date: date,
        day: wbsDateToDay_(date),
        index: index
      };
    })
    .filter(function (marker) {
      return Number.isFinite(marker.day) && wbsDateIndex_(dateRange, marker.date) >= 0;
    })
    .sort(function (a, b) {
      return a.day - b.day || a.index - b.index;
    })
    .map(function (marker) {
      let laneIndex = lanes.findIndex(function (lastDay) {
        return lastDay === undefined || marker.day - lastDay >= 2;
      });
      if (laneIndex < 0 && lanes.length < safeLaneCount) {
        laneIndex = lanes.length;
      }
      if (laneIndex < 0) {
        laneIndex = lanes.reduce(function (best, lastDay, index) {
          return lastDay < lanes[best] ? index : best;
        }, 0);
      }
      lanes[laneIndex] = marker.day;
      return {
        name: marker.name,
        date: marker.date,
        lane: laneIndex
      };
    });
}

function wbsMeetingMarkerDates_(meeting, dateRange) {
  const result = [];
  const seen = {};
  function addDate(dateText) {
    if (wbsIsValidDate_(dateText) && !seen[dateText]) {
      seen[dateText] = true;
      result.push(dateText);
    }
  }

  wbsExplicitMeetingMarkerDates_(meeting).forEach(addDate);
  const rule = wbsMeetingScheduleRule_(meeting);
  if (dateRange && Number.isFinite(dateRange.startDay) && Number.isFinite(dateRange.endDay)) {
    if (rule.type !== 'none') {
      wbsExpandMeetingScheduleRule_(rule, dateRange).forEach(addDate);
    } else if (wbsMeetingIsDaily_(meeting)) {
      for (let day = dateRange.startDay; day <= dateRange.endDay; day += 1) {
        addDate(wbsDayToDate_(day));
      }
    } else {
      const weekday = wbsMeetingRecurrenceWeekday_(meeting);
      if (weekday !== null) {
        for (let day = dateRange.startDay; day <= dateRange.endDay; day += 1) {
          if (wbsWeekdayOfDay_(day) === weekday) {
            addDate(wbsDayToDate_(day));
          }
        }
      }
    }
  }
  return result.sort();
}

function wbsMeetingScheduleRule_(meeting) {
  const text = wbsClean_(wbsGet_(meeting, 'ScheduleRuleJson', 'scheduleRuleJson'));
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text) || {};
    } catch (error) {
      parsed = {};
    }
  } else {
    parsed = wbsGet_(meeting, 'scheduleRule', 'scheduleRule') || {};
  }
  const type = wbsClean_(parsed.type);
  if (['daily', 'weekly', 'monthlyDate', 'monthlyNth'].indexOf(type) === -1) {
    return { type: 'none' };
  }
  const startDate = wbsClean_(wbsGet_(meeting, 'StartDate', 'startDate')) || wbsClean_(parsed.startDate);
  const endDate = wbsClean_(wbsGet_(meeting, 'EndDate', 'endDate')) || wbsClean_(parsed.endDate);
  if (!wbsIsValidDate_(startDate) || (endDate && !wbsIsValidDate_(endDate))) {
    return { type: 'none' };
  }
  const rule = {
    type: type,
    interval: Math.max(1, Math.floor(Number(parsed.interval) || 1)),
    startDate: startDate,
    endDate: endDate
  };
  if (type === 'weekly') {
    rule.weekday = wbsSafeWeekday_(parsed.weekday, wbsWeekdayOfDay_(wbsDateToDay_(startDate)));
  } else if (type === 'monthlyDate') {
    rule.dayOfMonth = Math.max(1, Math.min(Math.floor(Number(parsed.dayOfMonth) || Number(startDate.slice(8, 10))), 31));
  } else if (type === 'monthlyNth') {
    const nth = Number(parsed.nth);
    rule.nth = nth === -1 ? -1 : Math.max(1, Math.min(Math.floor(nth || 1), 5));
    rule.weekday = wbsSafeWeekday_(parsed.weekday, wbsWeekdayOfDay_(wbsDateToDay_(startDate)));
  }
  return rule;
}

function wbsExpandMeetingScheduleRule_(rule, dateRange) {
  const result = [];
  const startDay = Math.max(dateRange.startDay, wbsDateToDay_(rule.startDate));
  const endDay = Math.min(dateRange.endDay, rule.endDate ? wbsDateToDay_(rule.endDate) : dateRange.endDay);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || startDay > endDay) {
    return result;
  }
  const anchorDay = wbsDateToDay_(rule.startDate);
  if (rule.type === 'daily') {
    const interval = Math.max(1, Number(rule.interval) || 1);
    for (let day = startDay; day <= endDay; day += 1) {
      if ((day - anchorDay) % interval === 0) {
        result.push(wbsDayToDate_(day));
      }
    }
    return result;
  }
  if (rule.type === 'weekly') {
    const interval = Math.max(1, Number(rule.interval) || 1);
    const anchorWeek = wbsWeekStartDay_(anchorDay);
    for (let day = startDay; day <= endDay; day += 1) {
      if (wbsWeekdayOfDay_(day) !== rule.weekday) {
        continue;
      }
      const diffWeeks = Math.floor((wbsWeekStartDay_(day) - anchorWeek) / 7);
      if (diffWeeks >= 0 && diffWeeks % interval === 0) {
        result.push(wbsDayToDate_(day));
      }
    }
    return result;
  }
  const anchorMonth = wbsMonthStartDay_(anchorDay);
  const firstMonth = wbsMonthStartDay_(startDay);
  const lastMonth = wbsMonthStartDay_(endDay);
  for (let month = firstMonth; month <= lastMonth; month = wbsAddMonths_(month, 1)) {
    const diffMonths = wbsMonthDiff_(anchorMonth, month);
    if (diffMonths < 0 || diffMonths % Math.max(1, Number(rule.interval) || 1) !== 0) {
      continue;
    }
    const candidate = rule.type === 'monthlyDate'
      ? wbsDateForMonthDay_(month, rule.dayOfMonth)
      : wbsNthWeekdayOfMonthDay_(month, rule.nth, rule.weekday);
    if (Number.isFinite(candidate) && candidate >= startDay && candidate <= endDay) {
      result.push(wbsDayToDate_(candidate));
    }
  }
  return result;
}

function wbsExplicitMeetingMarkerDates_(meeting) {
  const text = [
    wbsGet_(meeting, 'Name', 'name'),
    wbsGet_(meeting, 'Schedule', 'schedule'),
    wbsGet_(meeting, 'Note', 'note')
  ].map(wbsClean_).join(' ');
  const result = [];
  const seen = {};
  const matches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  matches.forEach(function (dateText) {
    if (wbsIsValidDate_(dateText) && !seen[dateText]) {
      seen[dateText] = true;
      result.push(dateText);
    }
  });
  return result;
}

function wbsMeetingIsDaily_(meeting) {
  const text = wbsClean_(wbsGet_(meeting, 'Schedule', 'schedule')).toLowerCase();
  return text.indexOf('毎日') !== -1 || text.indexOf('daily') !== -1 || text.indexOf('every day') !== -1;
}

function wbsMeetingRecurrenceWeekday_(meeting) {
  const text = wbsClean_(wbsGet_(meeting, 'Schedule', 'schedule')).toLowerCase();
  const japanese = [
    { words: ['日曜日', '日曜'], value: 0 },
    { words: ['月曜日', '月曜'], value: 1 },
    { words: ['火曜日', '火曜'], value: 2 },
    { words: ['水曜日', '水曜'], value: 3 },
    { words: ['木曜日', '木曜'], value: 4 },
    { words: ['金曜日', '金曜'], value: 5 },
    { words: ['土曜日', '土曜'], value: 6 }
  ];
  const english = [
    { pattern: /\b(sunday|sun)\b/, value: 0 },
    { pattern: /\b(monday|mon)\b/, value: 1 },
    { pattern: /\b(tuesday|tue)\b/, value: 2 },
    { pattern: /\b(wednesday|wed)\b/, value: 3 },
    { pattern: /\b(thursday|thu)\b/, value: 4 },
    { pattern: /\b(friday|fri)\b/, value: 5 },
    { pattern: /\b(saturday|sat)\b/, value: 6 }
  ];
  const japaneseMatch = japanese.find(function (item) {
    return item.words.some(function (word) { return text.indexOf(word) !== -1; });
  });
  if (japaneseMatch) {
    return japaneseMatch.value;
  }
  const englishMatch = english.find(function (item) {
    return item.pattern.test(text);
  });
  return englishMatch ? englishMatch.value : null;
}

function wbsWeekdayOfDay_(day) {
  return new Date(day * 86400000).getUTCDay();
}

function wbsSafeWeekday_(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 6 ? Math.floor(numeric) : fallback;
}

function wbsWeekStartDay_(day) {
  return day - wbsWeekdayOfDay_(day);
}

function wbsMonthStartDay_(day) {
  const date = new Date(day * 86400000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86400000);
}

function wbsAddMonths_(monthDay, deltaMonths) {
  const date = new Date(wbsMonthStartDay_(monthDay) * 86400000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + deltaMonths, 1) / 86400000);
}

function wbsMonthDiff_(startMonthDay, currentMonthDay) {
  const start = new Date(wbsMonthStartDay_(startMonthDay) * 86400000);
  const current = new Date(wbsMonthStartDay_(currentMonthDay) * 86400000);
  return (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth();
}

function wbsDateForMonthDay_(monthDay, dayOfMonth) {
  const month = new Date(wbsMonthStartDay_(monthDay) * 86400000);
  const candidate = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Number(dayOfMonth) || 1));
  if (candidate.getUTCMonth() !== month.getUTCMonth()) {
    return NaN;
  }
  return Math.floor(candidate.getTime() / 86400000);
}

function wbsNthWeekdayOfMonthDay_(monthDay, nth, weekday) {
  const first = wbsMonthStartDay_(monthDay);
  if (Number(nth) === -1) {
    const nextMonth = wbsAddMonths_(first, 1);
    const last = nextMonth - 1;
    const delta = (wbsWeekdayOfDay_(last) - weekday + 7) % 7;
    return last - delta;
  }
  const firstDelta = (weekday - wbsWeekdayOfDay_(first) + 7) % 7;
  const candidate = first + firstDelta + (Math.max(1, Math.floor(Number(nth) || 1)) - 1) * 7;
  return wbsMonthStartDay_(candidate) === first ? candidate : NaN;
}

function wbsA1_(row, col) {
  return wbsColumnLetter_(col) + row;
}

function wbsColumnLetter_(col) {
  let value = '';
  let current = col;
  while (current > 0) {
    const mod = (current - 1) % 26;
    value = String.fromCharCode(65 + mod) + value;
    current = Math.floor((current - mod) / 26);
  }
  return value;
}

function wbsDateIndex_(dateRange, dateText) {
  const day = wbsIsValidDate_(dateText) ? wbsDateToDay_(dateText) : NaN;
  if (!Number.isFinite(day) || day < dateRange.startDay || day > dateRange.endDay) {
    return -1;
  }
  return day - dateRange.startDay;
}

function wbsNodeId_(node) {
  return wbsClean_(wbsGet_(node, 'NodeId', 'id'));
}

function wbsGet_(obj, gasKey, clientKey) {
  if (!obj) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(obj, gasKey)) {
    return obj[gasKey];
  }
  return obj[clientKey];
}

function wbsIncludeInWbs_(node) {
  const value = wbsGet_(node, 'IncludeInWbs', 'includeInWbs');
  if (value === undefined || value === null || wbsClean_(value) === '') {
    return true;
  }
  return wbsIsTrue_(value);
}

function wbsCompareSort_(a, b) {
  const diff = (Number(wbsGet_(a, 'SortOrder', 'sortOrder')) || 0) - (Number(wbsGet_(b, 'SortOrder', 'sortOrder')) || 0);
  if (diff !== 0) {
    return diff;
  }
  return wbsClean_(wbsGet_(a, 'Name', 'name')).localeCompare(wbsClean_(wbsGet_(b, 'Name', 'name')), 'ja');
}

function wbsValidProgress_(value) {
  if (value === null || value === undefined || wbsClean_(value) === '') {
    return null;
  }
  const numeric = Number(value);
  return [0, 15, 30, 45, 60, 75, 90, 100].indexOf(numeric) !== -1 ? numeric : null;
}

function wbsProgressBucket_(value) {
  const numeric = Math.max(0, Math.min(100, Number(value) || 0));
  return [0, 15, 30, 45, 60, 75, 90, 100].reduce(function (best, candidate) {
    return candidate <= numeric + 0.000001 ? candidate : best;
  }, 0);
}

function wbsHasSchedule_(node) {
  const start = wbsClean_(wbsGet_(node, 'StartDate', 'startDate'));
  const end = wbsClean_(wbsGet_(node, 'EndDate', 'endDate'));
  return wbsIsValidDate_(start) && wbsIsValidDate_(end) && wbsDateToDay_(start) <= wbsDateToDay_(end);
}

function wbsSplitCsv_(value) {
  if (Array.isArray(value)) {
    return value.map(wbsClean_).filter(Boolean);
  }
  return wbsClean_(value).split(',').map(wbsClean_).filter(Boolean);
}

function wbsClean_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function wbsIsTrue_(value) {
  return value === true || wbsClean_(value).toLowerCase() === 'true' || wbsClean_(value) === '1';
}

function wbsIsValidDate_(value) {
  const text = wbsClean_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const parts = text.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function wbsDateToDay_(value) {
  if (!wbsIsValidDate_(value)) {
    return NaN;
  }
  const parts = value.split('-').map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
}

function wbsDayToDate_(day) {
  const date = new Date(day * 86400000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function wbsDateValue_(dateText) {
  if (!wbsIsValidDate_(dateText)) {
    return '';
  }
  const parts = dateText.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function wbsDow_(day) {
  return new Date(day * 86400000).getUTCDay();
}

function wbsWeekdayLabel_(dow) {
  return ['日', '月', '火', '水', '木', '金', '土'][dow] || '';
}

function wbsFormatMonthDay_(dateText) {
  return String(Number(dateText.slice(5, 7))) + '/' + String(Number(dateText.slice(8, 10)));
}

function wbsTodayText_() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function wbsDefaultTimeZone_() {
  if (typeof Session !== 'undefined' && Session.getScriptTimeZone) {
    try {
      return Session.getScriptTimeZone() || 'Asia/Tokyo';
    } catch (error) {
      return 'Asia/Tokyo';
    }
  }
  return 'Asia/Tokyo';
}

function wbsDateTextInTimeZone_(value, timeZone) {
  const text = wbsClean_(value);
  if (!text) {
    return '';
  }
  if (wbsIsValidDate_(text)) {
    return text;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const zone = timeZone || wbsDefaultTimeZone_();
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(date, zone, 'yyyy-MM-dd');
  }
  if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce(function (memo, part) {
      memo[part.type] = part.value;
      return memo;
    }, {});
    if (parts.year && parts.month && parts.day) {
      return parts.year + '-' + parts.month + '-' + parts.day;
    }
  }
  return date.toISOString().slice(0, 10);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildWbsModel_: buildWbsModel_,
    deriveActuals_: deriveActuals_,
    filterWbsTree_: filterWbsTree_,
    computeWbsDerived_: computeWbsDerived_,
    wbsDateTextInTimeZone_: wbsDateTextInTimeZone_,
    wbsColumnLetter_: wbsColumnLetter_
  };
}
