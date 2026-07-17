/**
 * Project-wide calendar overrides used by the Gantt display.
 *
 * Only explicit exceptions are stored. `standard` removes the row so the
 * client falls back to the derived Saturday/Sunday/Japanese-holiday calendar.
 * These settings intentionally do not participate in task scheduling,
 * dependency rescheduling, duration calculation, or WBS export.
 */

var CALENDAR_OVERRIDE_MAX_DAYS = 366;

function saveCalendarOverrides(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readCalendarSnapshot_();
    requireCurrentMember_(rows.members);
    const normalized = normalizeCalendarOverridePayload_(payload);
    const plan = calendarOverrideMutationPlan_(
      rows.calendarOverrides,
      normalized.startDate,
      normalized.endDate,
      normalized.dayType,
      normalized.name
    );

    writeObjects_(SHEET.CALENDAR_OVERRIDES, plan.updates);
    appendObjects_(SHEET.CALENDAR_OVERRIDES, plan.inserts);
    plan.deletes.slice().sort(function (a, b) {
      return Number(b.__row) - Number(a.__row);
    }).forEach(function (row) {
      deleteRow_(SHEET.CALENDAR_OVERRIDES, row.__row, row.Date);
    });

    return {
      ok: true,
      calendarOverrides: clientCalendarOverrides_(readCalendarSnapshot_().calendarOverrides)
    };
  });
}

function normalizeCalendarOverridePayload_(payload) {
  const startDate = cleanString_(payload.startDate || payload.date);
  const endDate = cleanString_(payload.endDate || startDate);
  if (!isValidDate_(startDate) || !isValidDate_(endDate)) {
    throw new Error('対象期間は YYYY-MM-DD 形式で入力してください。');
  }
  if (endDate < startDate) {
    throw new Error('終了日は開始日以降にしてください。');
  }
  assertProjectDateRange_(startDate, endDate, 'カレンダー対象期間');
  const dateCount = dateToDay_(endDate) - dateToDay_(startDate) + 1;
  if (dateCount > CALENDAR_OVERRIDE_MAX_DAYS) {
    throw new Error('一度に設定できる期間は366日以内です。');
  }

  let dayType = cleanString_(payload.dayType).toLowerCase();
  if (dayType === 'standard') dayType = '';
  if (dayType !== '' && dayType !== 'working' && dayType !== 'holiday') {
    throw new Error('日の扱いは「標準」「稼働日」「休日」から選択してください。');
  }
  const name = dayType ? cleanString_(payload.name) : '';
  if (name.length > 100) {
    throw new Error('名称は100文字以内で入力してください。');
  }
  return {
    startDate: startDate,
    endDate: endDate,
    dayType: dayType,
    name: name
  };
}

function calendarOverrideMutationPlan_(rows, startDate, endDate, dayType, name) {
  const existingByDate = {};
  (rows || []).forEach(function (row) {
    const date = cleanString_(row.Date);
    if (!isValidDate_(date)) {
      throw new Error('CalendarOverrides シートに不正な日付があります。');
    }
    const existingType = cleanString_(row.DayType).toLowerCase();
    if (existingType !== 'working' && existingType !== 'holiday') {
      throw new Error('CalendarOverrides シートの DayType は working または holiday にしてください。');
    }
    if (existingByDate[date]) {
      throw new Error('CalendarOverrides シートに同じ日付が複数あります。');
    }
    existingByDate[date] = row;
  });

  const plan = { updates: [], inserts: [], deletes: [] };
  calendarOverrideDates_(startDate, endDate).forEach(function (date) {
    const existing = existingByDate[date];
    if (!dayType) {
      if (existing) plan.deletes.push(existing);
      return;
    }
    if (existing) {
      const updated = cloneRow_(existing);
      updated.DayType = dayType;
      updated.Name = name;
      plan.updates.push(updated);
      return;
    }
    plan.inserts.push({ Date: date, DayType: dayType, Name: name });
  });
  return plan;
}

function calendarOverrideDates_(startDate, endDate) {
  const startDay = dateToDay_(startDate);
  const endDay = dateToDay_(endDate);
  const result = [];
  for (let day = startDay; day <= endDay; day += 1) {
    result.push(dayToDate_(day));
  }
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeCalendarOverridePayload_: normalizeCalendarOverridePayload_,
    calendarOverrideMutationPlan_: calendarOverrideMutationPlan_,
    calendarOverrideDates_: calendarOverrideDates_
  };
}
