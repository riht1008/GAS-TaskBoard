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
    if (sheetName === SHEET.COMMENTS && !selected && options.includeComments !== true) {
      return false;
    }
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
    meetings: shouldRead(SHEET.MEETINGS) ? readObjects_(SHEET.MEETINGS) : [],
    calendarOverrides: shouldRead(SHEET.CALENDAR_OVERRIDES) ? readObjects_(SHEET.CALENDAR_OVERRIDES) : []
  };
  rows.commentCounts = options.includeCommentCounts === true ? readCommentCounts_() : null;
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
  const rows = readAll_({ sheets: [SHEET.NODES, SHEET.MEMBERS] });
  rows.comments = readCommentIndex_();
  rows.__loadedSheets[SHEET.COMMENTS] = true;
  return rows;
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

function readCalendarSnapshot_() {
  return readAll_({
    sheets: [SHEET.MEMBERS, SHEET.CALENDAR_OVERRIDES]
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
  const readable = readableSheet_(sheetName);
  const sheet = readable.sheet;
  const headers = readable.headers;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  return objectsFromValues_(sheetName, headers, sheet.getRange(2, 1, lastRow - 1, headers.length).getValues(), 2);
}

function readableSheet_(sheetName) {
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
  return { sheet: sheet, headers: headers };
}

function objectsFromValues_(sheetName, headers, values, startRow) {
  const rows = [];
  values.forEach(function (row, i) {
    const hasValue = row.some(function (cell) { return cleanString_(cell) !== ''; });
    if (!hasValue) {
      return;
    }
    const obj = { __row: i + startRow };
    headers.forEach(function (h, index) {
      obj[h] = normalizeCellValue_(sheetName, h, row[index]);
    });
    obj.__originalValues = {};
    headers.forEach(function (header) { obj.__originalValues[header] = obj[header]; });
    rows.push(obj);
  });
  return rows;
}

function readSelectedColumns_(sheetName, selectedHeaders) {
  const readable = readableSheet_(sheetName);
  const sheet = readable.sheet;
  const headers = readable.headers;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const rowCount = lastRow - 1;
  const columns = {};
  (selectedHeaders || []).forEach(function (header) {
    const index = headers.indexOf(header);
    if (index < 0) throw new Error(sheetName + ' シートに ' + header + ' 列がありません。');
    columns[header] = sheet.getRange(2, index + 1, rowCount, 1).getValues();
  });
  const rows = [];
  for (let offset = 0; offset < rowCount; offset += 1) {
    const obj = { __row: offset + 2 };
    let hasValue = false;
    selectedHeaders.forEach(function (header) {
      obj[header] = normalizeCellValue_(sheetName, header, columns[header][offset][0]);
      if (cleanString_(obj[header])) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

function readCommentIndex_() {
  return readSelectedColumns_(SHEET.COMMENTS, ['CommentId', 'NodeId', 'Timestamp', 'ParentCommentId']);
}

function readCommentCounts_() {
  const counts = {};
  readSelectedColumns_(SHEET.COMMENTS, ['NodeId']).forEach(function (row) {
    const nodeId = cleanString_(row.NodeId);
    if (nodeId) counts[nodeId] = (counts[nodeId] || 0) + 1;
  });
  return counts;
}

function readObjectsAtRows_(sheetName, rowNumbers) {
  const readable = readableSheet_(sheetName);
  const sheet = readable.sheet;
  const headers = readable.headers;
  const selected = {};
  (rowNumbers || []).forEach(function (rowNumber) {
    const number = Number(rowNumber);
    if (Number.isInteger(number) && number >= 2) selected[number] = true;
  });
  const ordered = Object.keys(selected).map(Number).sort(function (a, b) { return a - b; });
  if (!ordered.length) return [];
  let ranges = coalescedRowRanges_(ordered, 25);
  if (ranges.length > 12) ranges = [{ start: ordered[0], end: ordered[ordered.length - 1] }];
  const rows = [];
  ranges.forEach(function (range) {
    const values = sheet.getRange(range.start, 1, range.end - range.start + 1, headers.length).getValues();
    objectsFromValues_(sheetName, headers, values, range.start).forEach(function (row) {
      if (selected[row.__row]) rows.push(row);
    });
  });
  return rows;
}

function readObjectsMatchingColumn_(sheetName, header, expectedValue) {
  return readObjectsMatchingColumnValues_(sheetName, header, [expectedValue]);
}

function readObjectsMatchingColumnValues_(sheetName, header, expectedValues) {
  const expected = {};
  (expectedValues || []).forEach(function (value) {
    const key = cleanString_(value);
    if (key) expected[key] = true;
  });
  const matches = readSelectedColumns_(sheetName, [header]).filter(function (row) {
    return !!expected[cleanString_(row[header])];
  });
  return readObjectsAtRows_(sheetName, matches.map(function (row) { return row.__row; })).filter(function (row) {
    return !!expected[cleanString_(row[header])];
  });
}

function coalescedRowRanges_(rowNumbers, maxGap) {
  const ranges = [];
  (rowNumbers || []).forEach(function (rowNumber) {
    const last = ranges[ranges.length - 1];
    if (!last || rowNumber - last.end > maxGap + 1) {
      ranges.push({ start: rowNumber, end: rowNumber });
    } else {
      last.end = rowNumber;
    }
  });
  return ranges;
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
  const text = cleanString_(value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
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
  writeObjects_(sheetName, [obj]);
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
    const currentValues = readAndAssertRowIdentities_(sheetName, sheet, block, byRow);
    const values = block.map(function (rowNumber) {
      const row = byRow[rowNumber];
      return headers.map(function (header, columnIndex) {
        const original = row.__originalValues;
        if (original && sameSheetValue_(row[header], original[header])) {
          return currentValues[rowNumber][columnIndex];
        }
        return sheetValue_(row[header]);
      });
    });
    applyRowTextFormats_(sheetName, sheet, start, rowCount);
    sheet.getRange(start, 1, rowCount, headers.length).setValues(values);
  });
}

function readAndAssertRowIdentities_(sheetName, sheet, rowNumbers, byRow) {
  const headers = HEADERS[sheetName];
  const keyHeader = PRIMARY_KEY_HEADER[sheetName];
  const keyColumn = headers.indexOf(keyHeader) + 1;
  if (!keyHeader || keyColumn <= 0) {
    throw new Error(sheetName + ' シートの主キー定義がありません。');
  }
  const start = rowNumbers[0];
  const actualValues = sheet.getRange(start, 1, rowNumbers.length, headers.length).getValues();
  const byPhysicalRow = {};
  rowNumbers.forEach(function (rowNumber, index) {
    const expected = cleanString_(byRow[rowNumber] && byRow[rowNumber][keyHeader]);
    const actual = cleanString_(actualValues[index] && actualValues[index][keyColumn - 1]);
    if (!expected || actual !== expected) {
      throw appError_(
        'ROW_IDENTITY_MISMATCH',
        sheetName + ' シートの行位置が読み込み後に変わりました。誤更新を防ぐため保存を中止しました。同期後にやり直してください。',
        true
      );
    }
    byPhysicalRow[rowNumber] = actualValues[index];
  });
  return byPhysicalRow;
}

function sameSheetValue_(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    return cleanString_(left) === cleanString_(right);
  }
  return String(left) === String(right);
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

function deleteRow_(sheetName, rowNumber, expectedKey) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const keyHeader = PRIMARY_KEY_HEADER[sheetName];
  const keyColumn = (HEADERS[sheetName] || []).indexOf(keyHeader) + 1;
  const actualKey = keyColumn > 0 ? cleanString_(sheet.getRange(rowNumber, keyColumn, 1, 1).getValues()[0][0]) : '';
  if (!cleanString_(expectedKey) || actualKey !== cleanString_(expectedKey)) {
    throw appError_(
      'ROW_IDENTITY_MISMATCH',
      sheetName + ' シートの削除対象行が読み込み後に変わりました。誤削除を防ぐため中止しました。同期後にやり直してください。',
      true
    );
  }
  sheet.deleteRow(rowNumber);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeCellValue_: normalizeCellValue_,
    normalizeDateOnlyCell_: normalizeDateOnlyCell_,
    classifyHeaders_: classifyHeaders_,
    consecutiveRowBlocks_: consecutiveRowBlocks_,
    writeObjects_: writeObjects_,
    readAndAssertRowIdentities_: readAndAssertRowIdentities_,
    readObjectsAtRows_: readObjectsAtRows_,
    coalescedRowRanges_: coalescedRowRanges_
  };
}
