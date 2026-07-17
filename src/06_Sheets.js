/**
 * Spreadsheet schema, readers, and writers.
 */

function readAll_(options) {
  options = options || {};
  const selected = options.sheets ? options.sheets.reduce(function (map, sheetName) {
    map[sheetName] = true;
    return map;
  }, {}) : null;
  function shouldRead(sheetName) {
    if (sheetName === SHEET.ACTIVITY_LOG && !options.includeActivityLog && !selected) {
      return false;
    }
    return !selected || !!selected[sheetName];
  }
  const rows = {
    nodes: shouldRead(SHEET.NODES) ? readObjects_(SHEET.NODES) : [],
    members: shouldRead(SHEET.MEMBERS) ? readObjects_(SHEET.MEMBERS) : [],
    statusColumns: shouldRead(SHEET.STATUS_COLUMNS) ? readObjects_(SHEET.STATUS_COLUMNS) : [],
    dependencies: shouldRead(SHEET.DEPENDENCIES) ? readObjects_(SHEET.DEPENDENCIES) : [],
    comments: shouldRead(SHEET.COMMENTS) ? readObjects_(SHEET.COMMENTS) : [],
    activityLog: shouldRead(SHEET.ACTIVITY_LOG) ? readObjects_(SHEET.ACTIVITY_LOG) : [],
    milestones: shouldRead(SHEET.MILESTONES) ? readObjects_(SHEET.MILESTONES) : [],
    meetings: shouldRead(SHEET.MEETINGS) ? readObjects_(SHEET.MEETINGS) : []
  };
  rows.__loadedSheets = {};
  Object.keys(HEADERS).forEach(function (sheetName) {
    rows.__loadedSheets[sheetName] = shouldRead(sheetName);
  });
  return rows;
}

function readNodeSnapshot_() {
  return readAll_({
    sheets: [SHEET.NODES, SHEET.MEMBERS, SHEET.STATUS_COLUMNS, SHEET.DEPENDENCIES]
  });
}

function readCommentSnapshot_() {
  return readAll_({
    sheets: [SHEET.NODES, SHEET.MEMBERS, SHEET.COMMENTS]
  });
}

function readStatusSnapshot_() {
  return readAll_({
    sheets: [SHEET.NODES, SHEET.MEMBERS, SHEET.STATUS_COLUMNS]
  });
}

function readMemberSnapshot_() {
  return readAll_({
    sheets: [SHEET.NODES, SHEET.MEMBERS, SHEET.STATUS_COLUMNS]
  });
}

function readProjectSettingsSnapshot_() {
  return readAll_({
    sheets: [SHEET.MEMBERS, SHEET.MILESTONES, SHEET.MEETINGS]
  });
}

function sheetWasLoaded_(rows, sheetName) {
  return !rows || !rows.__loadedSheets || rows.__loadedSheets[sheetName] === true;
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
  const readWidth = Math.max(headers.length, sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, readWidth).getValues()[0].map(cleanString_);
  const classification = classifyHeaders_(currentHeaders, headers);
  if (classification.kind === 'empty') {
    if (sheet.getLastRow() > 1) {
      throw appError_('SCHEMA_MISMATCH', sheetName + ' シートのヘッダーが空ですが、データ行が存在します。自動修復を停止しました。', false);
    }
    initializeSheet_(sheetName, sheet, headers);
    return;
  }
  if (classification.kind === 'mismatch') {
    throw appError_(
      'SCHEMA_MISMATCH',
      sheetName + ' シートの列構成が想定と異なります（列 ' + classification.column + '）。データ列の誤解釈を防ぐため自動修復を停止しました。',
      false
    );
  }
  if (classification.kind === 'exact') {
    return;
  }
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  if (classification.kind === 'append') {
    const start = classification.existingLength + 1;
    const missing = headers.slice(classification.existingLength);
    sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  sheet.setFrozenRows(1);
  applyTextFormats_(sheetName, sheet);
}

function classifyHeaders_(currentHeaders, expectedHeaders) {
  const current = (currentHeaders || []).map(cleanString_);
  while (current.length && !current[current.length - 1]) {
    current.pop();
  }
  if (!current.length) {
    return { kind: 'empty', existingLength: 0, column: 1 };
  }
  const compareLength = Math.min(current.length, expectedHeaders.length);
  for (let index = 0; index < compareLength; index += 1) {
    if (current[index] !== expectedHeaders[index]) {
      return { kind: 'mismatch', existingLength: current.length, column: index + 1 };
    }
  }
  if (current.length > expectedHeaders.length) {
    return { kind: 'mismatch', existingLength: current.length, column: expectedHeaders.length + 1 };
  }
  if (current.length < expectedHeaders.length) {
    return { kind: 'append', existingLength: current.length, column: current.length + 1 };
  }
  return { kind: 'exact', existingLength: current.length, column: 0 };
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
  if (!sheet) {
    throw appError_('SCHEMA_MISMATCH', sheetName + ' シートが見つかりません。', false);
  }
  const headerWidth = Math.max(headers.length, sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, headerWidth).getValues()[0].map(cleanString_);
  const classification = classifyHeaders_(currentHeaders, headers);
  if (classification.kind !== 'exact') {
    throw appError_(
      'SCHEMA_MISMATCH',
      sheetName + ' シートの列構成が想定と異なります。全体を再読み込みし、解消しない場合はシートの列順を確認してください。',
      false
    );
  }
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
    if (header === 'CreatedAt' || header === 'UpdatedAt' || header === 'DeletedAt' || header === 'Timestamp' || header === 'DraftExpiresAt') {
      return value.toISOString();
    }
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  return cleanString_(value);
}

function isDateOnlyHeader_(header) {
  return header === 'StartDate' || header === 'EndDate' ||
    header === 'ActualStartDate' || header === 'ActualEndDate' ||
    header === 'Date';
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
  return appendObjects_(sheetName, [obj])[0];
}

function appendObjects_(sheetName, objects) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const source = (objects || []).filter(Boolean);
  if (!source.length) {
    return [];
  }
  const rowNumber = sheet.getLastRow() + 1;
  const lastRowNumber = rowNumber + source.length - 1;
  if (lastRowNumber > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastRowNumber - sheet.getMaxRows());
  }
  applyRowTextFormats_(sheetName, sheet, rowNumber, source.length);
  sheet.getRange(rowNumber, 1, source.length, headers.length).setValues(source.map(function (obj) {
    return headers.map(function (h) { return sheetValue_(obj[h]); });
  }));
  source.forEach(function (obj, index) { obj.__row = rowNumber + index; });
  return source;
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
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const byRow = {};
  (rows || []).forEach(function (row) {
    if (row && row.__row) {
      byRow[Number(row.__row)] = row;
    }
  });
  const ordered = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; });
  if (!ordered.length) {
    return;
  }
  consecutiveRowBlocks_(ordered).forEach(function (block) {
    const start = block[0];
    const rowCount = block.length;
    const values = block.map(function (rowNumber) {
      const row = byRow[rowNumber];
      return headers.map(function (header) { return sheetValue_(row[header]); });
    });
    applyRowTextFormats_(sheetName, sheet, start, rowCount);
    sheet.getRange(start, 1, rowCount, headers.length).setValues(values);
  });
}

function consecutiveRowBlocks_(rowNumbers) {
  const ordered = (rowNumbers || []).map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; });
  const blocks = [];
  ordered.forEach(function (rowNumber) {
    const block = blocks[blocks.length - 1];
    if (!block || rowNumber !== block[block.length - 1] + 1) {
      blocks.push([rowNumber]);
    } else {
      block.push(rowNumber);
    }
  });
  return blocks;
}

function deleteRow_(sheetName, rowNumber) {
  SpreadsheetApp.getActive().getSheetByName(sheetName).deleteRow(rowNumber);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeCellValue_: normalizeCellValue_,
    normalizeDateOnlyCell_: normalizeDateOnlyCell_,
    classifyHeaders_: classifyHeaders_,
    consecutiveRowBlocks_: consecutiveRowBlocks_,
    writeObjects_: writeObjects_
  };
}
