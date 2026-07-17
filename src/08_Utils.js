/**
 * Tree, collection, date, and primitive helpers.
 */

function childrenMap_(nodes) {
  const map = {};
  nodes.forEach(function (n) {
    const parentId = cleanString_(n.ParentId);
    if (!map[parentId]) {
      map[parentId] = [];
    }
    map[parentId].push(cleanString_(n.NodeId));
  });
  return map;
}

function collectDescendantIds_(nodeId, children) {
  const result = [];
  const stack = (children[nodeId] || []).slice();
  const visited = {};
  visited[cleanString_(nodeId)] = true;
  while (stack.length) {
    const id = cleanString_(stack.shift());
    if (!id) {
      continue;
    }
    if (visited[id]) {
      throw appError_('NODE_TREE_INVALID', 'ノード階層に循環または重複参照があります。シートの ParentId を確認してください。', false);
    }
    visited[id] = true;
    result.push(id);
    (children[id] || []).forEach(function (childId) { stack.push(childId); });
  }
  return result;
}

function ancestorIds_(nodeId, activeNodes) {
  const nodesById = byId_(activeNodes, 'NodeId');
  const result = [];
  let current = nodesById[nodeId];
  while (current && cleanString_(current.ParentId)) {
    const parentId = cleanString_(current.ParentId);
    if (result.indexOf(parentId) !== -1) {
      break;
    }
    result.push(parentId);
    current = nodesById[parentId];
  }
  return result;
}

function ancestorIdsForMany_(ids, activeNodes) {
  let result = [];
  (ids || []).forEach(function (id) {
    result = result.concat(ancestorIds_(id, activeNodes));
  });
  return unique_(result);
}

function byId_(rows, idField) {
  const map = {};
  rows.forEach(function (row) {
    map[cleanString_(row[idField])] = row;
  });
  return map;
}

function nextSortOrder_(siblings) {
  if (!siblings || !siblings.length) {
    return 1000;
  }
  return Math.max.apply(null, siblings.map(function (s) { return Number(s.SortOrder) || 0; })) + 1000;
}

function sortByOrder_(rows) {
  return rows.slice().sort(compareSortOrder_);
}

function compareSortOrder_(a, b) {
  const diff = (Number(a.sortOrder !== undefined ? a.sortOrder : a.SortOrder) || 0) - (Number(b.sortOrder !== undefined ? b.sortOrder : b.SortOrder) || 0);
  if (diff !== 0) {
    return diff;
  }
  const an = cleanString_(a.name !== undefined ? a.name : a.Name);
  const bn = cleanString_(b.name !== undefined ? b.name : b.Name);
  return an.localeCompare(bn, 'ja');
}

function splitCsv_(value) {
  return cleanString_(value).split(',').map(function (part) { return cleanString_(part); }).filter(Boolean);
}

function unique_(values) {
  const seen = {};
  const result = [];
  (values || []).forEach(function (value) {
    const key = cleanString_(value);
    if (key && !seen[key]) {
      seen[key] = true;
      result.push(key);
    }
  });
  return result;
}

function cleanString_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function sheetValue_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) {
    // Sheets interprets these prefixes as formulas in some write/import paths.
    // The leading apostrophe is a display-neutral literal marker in Sheets.
    return "'" + value;
  }
  return value;
}

function isTrue_(value) {
  return value === true || cleanString_(value).toLowerCase() === 'true' || cleanString_(value) === '1';
}

function isValidDate_(value) {
  const text = cleanString_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const parts = text.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function dateToDay_(dateText) {
  if (!isValidDate_(dateText)) {
    throw new Error('日付形式が不正です。');
  }
  const parts = dateText.split('-').map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY_MS);
}

function dayToDate_(day) {
  return Utilities.formatDate(new Date(day * DAY_MS), 'UTC', 'yyyy-MM-dd');
}

function shiftDate_(dateText, deltaDays) {
  return dayToDate_(dateToDay_(dateText) + deltaDays);
}

function nowIso_() {
  return new Date().toISOString();
}

function newId_() {
  return Utilities.getUuid();
}

function cloneRow_(row) {
  const clone = {};
  Object.keys(row).forEach(function (key) { clone[key] = row[key]; });
  return clone;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectDescendantIds_: collectDescendantIds_,
    sheetValue_: sheetValue_,
    isValidDate_: isValidDate_,
    dateToDay_: dateToDay_
  };
}
