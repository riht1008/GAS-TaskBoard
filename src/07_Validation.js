/**
 * Locking, identity, normalization, and domain validation.
 */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw appError_('LOCK_BUSY', '他の操作が進行中です。しばらくして再試行してください。', true);
  }
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function requireCurrentMember_(members) {
  const email = getCurrentEmail_();
  if (!email) {
    throw new Error('ログインユーザーのメールアドレスを取得できません。');
  }
  const source = Array.isArray(members) ? members : readObjects_(SHEET.MEMBERS);
  const member = source.find(function (m) {
    return normalizeEmail_(m.Email) === email;
  });
  if (!member) {
    throw new Error('あなたのアカウントはメンバー登録されていません。メンバー管理で登録してください。');
  }
  return member;
}

function getCurrentEmail_() {
  return normalizeEmail_(Session.getActiveUser().getEmail());
}

function requireName_(value) {
  const name = cleanString_(value);
  if (!name) {
    throw new Error('名称を入力してください。');
  }
  if (name.length > 200) {
    throw new Error('名称は200文字以内で入力してください。');
  }
  return name;
}

function optionalName_(value) {
  const name = cleanString_(value);
  if (name.length > 200) {
    throw new Error('名称は200文字以内で入力してください。');
  }
  return name;
}

function validateStatusId_(statusId, statusColumns) {
  const id = cleanString_(statusId);
  if (!statusColumns.some(function (s) { return cleanString_(s.ColumnId) === id; })) {
    throw new Error('ステータス列が見つかりません。');
  }
  return id;
}

function doneStatusColumnId_(statusColumns) {
  return assertExactlyOneDone_(statusColumns);
}

function normalizeManualProgress_(value, allowBlank) {
  const text = cleanString_(value);
  if (allowBlank && text === '') {
    return '';
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || PROGRESS_VALUES.indexOf(numeric) === -1) {
    throw new Error('進捗率は 0/15/30/45/60/75/90/100 のいずれかで指定してください。');
  }
  return numeric;
}

function validManualProgress_(value) {
  const text = cleanString_(value);
  if (text === '') {
    return null;
  }
  const numeric = Number(text);
  return PROGRESS_VALUES.indexOf(numeric) !== -1 ? numeric : null;
}

function effectiveLeafProgress_(node, doneColumnId) {
  if (!node) {
    return 0;
  }
  if (cleanString_(node.StatusColumnId) === doneColumnId) {
    return 100;
  }
  const manual = validManualProgress_(node.Progress);
  return manual === null ? 0 : manual;
}

function normalizePriority_(value) {
  const priority = cleanString_(value) || 'Mid';
  if (PRIORITIES.indexOf(priority) === -1) {
    throw new Error('優先度が不正です。');
  }
  return priority;
}

function normalizeAssigneeIds_(value, members) {
  const ids = Array.isArray(value) ? value.map(cleanString_) : splitCsv_(value);
  const memberSet = {};
  members.forEach(function (m) { memberSet[cleanString_(m.MemberId)] = true; });
  const uniqueIds = unique_(ids.filter(Boolean));
  uniqueIds.forEach(function (id) {
    if (!memberSet[id]) {
      throw new Error('存在しないメンバーが担当者に含まれています。');
    }
  });
  return uniqueIds;
}

function normalizeSchedule_(startDate, endDate) {
  const start = cleanString_(startDate);
  const end = cleanString_(endDate);
  if (!start && !end) {
    return { startDate: '', endDate: '' };
  }
  if (!start || !end) {
    throw new Error('開始日と終了日は両方入力するか、両方空にしてください。');
  }
  if (!isValidDate_(start) || !isValidDate_(end)) {
    throw new Error('日付は YYYY-MM-DD 形式で入力してください。');
  }
  if (dateToDay_(start) > dateToDay_(end)) {
    throw new Error('開始日は終了日以前にしてください。');
  }
  return { startDate: start, endDate: end };
}

function scheduleWouldBeClearedWithDependencies_(node, dependencies, nodesById) {
  if (hasSchedule_(node)) {
    return false;
  }
  return visibleDependencies_(dependencies, nodesById).some(function (dep) {
    return cleanString_(dep.PredecessorNodeId) === node.NodeId || cleanString_(dep.SuccessorNodeId) === node.NodeId;
  });
}

function normalizeEmail_(email) {
  return cleanString_(email).toLowerCase();
}

function normalizeColor_(value) {
  const color = cleanString_(value);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '';
}

function normalizeIncludeInWbs_(value) {
  if (value === undefined || value === null || cleanString_(value) === '') {
    return true;
  }
  return isTrue_(value);
}

function normalizeStatusColor_(value, name, isDoneColumn) {
  const color = normalizeColor_(value);
  if (color) {
    return color;
  }
  return defaultStatusColor_(name, isDoneColumn);
}

function defaultStatusColor_(name, isDoneColumn) {
  const text = cleanString_(name).toLowerCase();
  if (isDoneColumn || text.indexOf('完了') !== -1 || text.indexOf('done') !== -1) {
    return '#CFE8DE';
  }
  if (text.indexOf('進行') !== -1 || text.indexOf('progress') !== -1 || text.indexOf('doing') !== -1) {
    return '#CFE0F5';
  }
  if (text.indexOf('未着手') !== -1 || text.indexOf('todo') !== -1 || text.indexOf('to do') !== -1) {
    return '#DCE5DE';
  }
  return '#DDE3DF';
}

function assertExactlyOneDone_(columns) {
  const done = (columns || []).filter(function (column) { return isTrue_(column.IsDoneColumn); });
  if (done.length !== 1) {
    throw appError_(
      'STATUS_DONE_INVARIANT',
      '完了列の設定が不正です。StatusColumns の IsDoneColumn=true を厳密に1件にしてください。',
      false
    );
  }
  return cleanString_(done[0].ColumnId);
}

function appError_(code, message, retryable) {
  const safeCode = cleanString_(code) || 'UNKNOWN';
  const error = new Error('[APP:' + safeCode + ':' + (retryable ? '1' : '0') + '] ' + cleanString_(message));
  error.code = safeCode;
  error.retryable = retryable === true;
  return error;
}

function activeNodes_(nodes) {
  return nodes.filter(function (n) { return !cleanString_(n.DeletedAt); });
}

function validateNodeTree_(nodes) {
  const source = nodes || [];
  const nodesById = {};
  source.forEach(function (node) {
    const nodeId = cleanString_(node.NodeId);
    if (!nodeId) {
      throw appError_('NODE_TREE_INVALID', 'NodeIdが空の有効ノードがあります。Nodesシートを確認してください。', false);
    }
    if (nodesById[nodeId]) {
      throw appError_('NODE_TREE_INVALID', 'NodeIdが重複しています: ' + nodeId, false);
    }
    nodesById[nodeId] = node;
  });
  const roots = source.filter(function (node) { return !cleanString_(node.ParentId); });
  if (roots.length !== 1) {
    throw appError_('NODE_TREE_INVALID', '有効なルートノードは厳密に1件必要です。現在: ' + roots.length + '件', false);
  }
  source.forEach(function (node) {
    const nodeId = cleanString_(node.NodeId);
    const parentId = cleanString_(node.ParentId);
    if (parentId && !nodesById[parentId]) {
      throw appError_('NODE_TREE_INVALID', '親ノードが存在しないノードがあります: ' + nodeId, false);
    }
    const seen = {};
    let current = node;
    while (current && cleanString_(current.ParentId)) {
      const currentId = cleanString_(current.NodeId);
      if (seen[currentId]) {
        throw appError_('NODE_TREE_INVALID', 'ノード階層に循環があります: ' + nodeId, false);
      }
      seen[currentId] = true;
      current = nodesById[cleanString_(current.ParentId)];
    }
  });
  return true;
}

function visibleDependencies_(dependencies, nodesById) {
  return dependencies.filter(function (dep) {
    return nodesById[cleanString_(dep.PredecessorNodeId)] && nodesById[cleanString_(dep.SuccessorNodeId)];
  });
}

function nodeHasDependency_(nodeId, dependencies, nodesById) {
  return visibleDependencies_(dependencies, nodesById).some(function (dep) {
    return cleanString_(dep.PredecessorNodeId) === nodeId || cleanString_(dep.SuccessorNodeId) === nodeId;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateNodeTree_: validateNodeTree_
  };
}

function hasSchedule_(node) {
  return !!node && isValidDate_(node.StartDate) && isValidDate_(node.EndDate) && dateToDay_(node.StartDate) <= dateToDay_(node.EndDate);
}
