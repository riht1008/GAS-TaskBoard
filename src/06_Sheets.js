/**
 * Spreadsheet schema, readers, and writers.
 */

function readAll_(options) {
  options = options || {};
  return {
    nodes: readObjects_(SHEET.NODES),
    members: readObjects_(SHEET.MEMBERS),
    statusColumns: readObjects_(SHEET.STATUS_COLUMNS),
    dependencies: readObjects_(SHEET.DEPENDENCIES),
    comments: readObjects_(SHEET.COMMENTS),
    activityLog: options.includeActivityLog ? readObjects_(SHEET.ACTIVITY_LOG) : [],
    milestones: readObjects_(SHEET.MILESTONES),
    meetings: readObjects_(SHEET.MEETINGS)
  };
}

function ensureSchema_() {
  Object.keys(HEADERS).forEach(function (sheetName) {
    ensureSheet_(sheetName);
  });
}

function requireSchemaExists_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(function (sheetName) {
    if (!ss.getSheetByName(sheetName)) {
      throw new Error('必要なシートが見つかりません。先に全体読み込みまたは初回セットアップを実行してください。');
    }
  });
}

function ensureSheet_(sheetName) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    initializeSheet_(sheetName, sheet, headers);
    return;
  }
  const maxColumns = sheet.getMaxColumns();
  if (maxColumns < headers.length) {
    sheet.insertColumnsAfter(maxColumns, headers.length - maxColumns);
    initializeSheet_(sheetName, sheet, headers);
    return;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(cleanString_);
  const headersMatch = headers.every(function (header, index) { return currentHeaders[index] === header; });
  if (!headersMatch) {
    initializeSheet_(sheetName, sheet, headers);
  }
}

function initializeSheet_(sheetName, sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  applyTextFormats_(sheetName, sheet);
}

function applyTextFormats_(sheetName, sheet) {
  applyRowTextFormats_(sheetName, sheet, 1, sheet.getMaxRows());
}

function applyRowTextFormats_(sheetName, sheet, rowNumber, rowCount) {
  const headers = HEADERS[sheetName];
  (TEXT_COLUMNS[sheetName] || []).forEach(function (name) {
    const index = headers.indexOf(name);
    if (index >= 0) {
      sheet.getRange(rowNumber, index + 1, rowCount, 1).setNumberFormat('@');
    }
  });
}

function readObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = [];
  values.forEach(function (row, i) {
    const hasValue = row.some(function (cell) { return cleanString_(cell) !== ''; });
    if (!hasValue) {
      return;
    }
    const obj = { __row: i + 2 };
    headers.forEach(function (h, index) {
      obj[h] = normalizeCellValue_(sheetName, h, row[index]);
    });
    rows.push(obj);
  });
  return rows;
}

function normalizeCellValue_(sheetName, header, value) {
  if (isDateOnlyHeader_(header)) {
    return normalizeDateOnlyCell_(value);
  }
  if (value instanceof Date) {
    if (header === 'CreatedAt' || header === 'UpdatedAt' || header === 'DeletedAt' || header === 'Timestamp') {
      return value.toISOString();
    }
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  return cleanString_(value);
}

function isDateOnlyHeader_(header) {
  return header === 'StartDate' || header === 'EndDate' || header === 'Date';
}

function normalizeDateOnlyCell_(value) {
  if (value instanceof Date) {
    return formatDateOnlyCell_(value);
  }
  const text = cleanString_(value);
  if (!text) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (!looksLikeDateOnlyString_(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateOnlyCell_(parsed);
  }
  return text;
}

function looksLikeDateOnlyString_(text) {
  return /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(text) ||
    /GMT[+-]\d{4}/.test(text) ||
    /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text) ||
    /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text);
}

function formatDateOnlyCell_(date) {
  const zone = spreadsheetTimeZone_();
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

function spreadsheetTimeZone_() {
  if (typeof Session !== 'undefined' && Session.getScriptTimeZone) {
    try {
      return Session.getScriptTimeZone() || 'Asia/Tokyo';
    } catch (error) {
      return 'Asia/Tokyo';
    }
  }
  return 'Asia/Tokyo';
}

function appendObject_(sheetName, obj) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const rowNumber = sheet.getLastRow() + 1;
  if (rowNumber > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rowNumber - sheet.getMaxRows());
  }
  applyRowTextFormats_(sheetName, sheet, rowNumber, 1);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function (h) { return sheetValue_(obj[h]); })]);
}

function writeObject_(sheetName, obj) {
  if (!obj || !obj.__row) {
    throw new Error('書き込み対象の行番号がありません。');
  }
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  applyRowTextFormats_(sheetName, sheet, obj.__row, 1);
  sheet.getRange(obj.__row, 1, 1, headers.length).setValues([headers.map(function (h) { return sheetValue_(obj[h]); })]);
}

function writeObjects_(sheetName, rows) {
  (rows || []).forEach(function (row) {
    if (row && row.__row) {
      writeObject_(sheetName, row);
    }
  });
}

function deleteRow_(sheetName, rowNumber) {
  SpreadsheetApp.getActive().getSheetByName(sheetName).deleteRow(rowNumber);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeCellValue_: normalizeCellValue_,
    normalizeDateOnlyCell_: normalizeDateOnlyCell_
  };
}
