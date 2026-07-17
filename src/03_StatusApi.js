/**
 * Kanban status column APIs.
 */

function upsertStatusColumn(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readStatusSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    if (payload.isDoneColumn === true && payload.isInProgressColumn === true) {
      throw new Error('完了列と進行中列は同じ列に設定できません。');
    }
    const columnId = cleanString_(payload.columnId);
    const name = requireName_(payload.name);
    let columns = rows.statusColumns;
    assertExactlyOneDone_(columns);
    const previousDoneColumnId = doneStatusColumnId_(columns);
    const currentInProgressColumnId = inProgressStatusColumnId_(columns);
    columns.forEach(function (column) {
      column.IsInProgressColumn = cleanString_(column.ColumnId) === currentInProgressColumnId;
    });
    let requestedDoneColumnId = '';
    let requestedInProgressColumnId = '';
    if (columnId) {
      const column = columns.find(function (c) { return cleanString_(c.ColumnId) === columnId; });
      if (!column) {
        throw new Error('ステータス列が見つかりません。');
      }
      column.Name = name;
      if (payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== '') {
        column.SortOrder = Number(payload.sortOrder);
      }
      column.Color = normalizeStatusColor_(payload.color, name, payload.isDoneColumn === true || isTrue_(column.IsDoneColumn));
      if (payload.isDoneColumn === true) {
        requestedDoneColumnId = columnId;
      }
      if (payload.isInProgressColumn === true) {
        requestedInProgressColumnId = columnId;
      }
    } else {
      const newColumnId = cleanString_(payload.clientColumnId);
      const duplicateId = columns.some(function (c) { return cleanString_(c.ColumnId) === newColumnId; });
      if (newColumnId && duplicateId) {
        throw new Error('同じIDのステータス列が既に存在します。');
      }
      const createdColumnId = newColumnId || newId_();
      requestedDoneColumnId = payload.isDoneColumn === true ? createdColumnId : '';
      requestedInProgressColumnId = payload.isInProgressColumn === true ? createdColumnId : '';
      const newColumn = {
        ColumnId: createdColumnId,
        Name: name,
        SortOrder: payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== ''
          ? Number(payload.sortOrder)
          : nextSortOrder_(columns),
        IsDoneColumn: false,
        Color: normalizeStatusColor_(payload.color, name, payload.isDoneColumn === true),
        IsInProgressColumn: false
      };
      columns.push(newColumn);
      appendObject_(SHEET.STATUS_COLUMNS, newColumn);
    }
    if (requestedDoneColumnId && requestedDoneColumnId === currentInProgressColumnId) {
      throw new Error('進行中列を完了列にはできません。先に別の列を進行中列にしてください。');
    }
    if (requestedInProgressColumnId && requestedInProgressColumnId === previousDoneColumnId) {
      throw new Error('完了列と進行中列は同じ列に設定できません。');
    }
    if (requestedDoneColumnId) {
      columns.forEach(function (c) { c.IsDoneColumn = cleanString_(c.ColumnId) === requestedDoneColumnId; });
    }
    if (requestedInProgressColumnId) {
      columns.forEach(function (c) { c.IsInProgressColumn = cleanString_(c.ColumnId) === requestedInProgressColumnId; });
    }
    assertExactlyOneDone_(columns);
    const nextDoneColumnId = doneStatusColumnId_(columns);
    const nextInProgressColumnId = inProgressStatusColumnId_(columns);
    const rolesChanged = previousDoneColumnId !== nextDoneColumnId || currentInProgressColumnId !== nextInProgressColumnId;
    if (rolesChanged) validateNodeTree_(activeNodes_(rows.nodes));
    const nodeWriteMap = rolesChanged
      ? normalizeNodesForStatusRoles_(rows, previousDoneColumnId, actor.MemberId)
      : {};
    writeObjects_(SHEET.STATUS_COLUMNS, columns);
    const nodeWrites = Object.keys(nodeWriteMap).map(function (id) { return nodeWriteMap[id]; });
    if (nodeWrites.length) writeObjects_(SHEET.NODES, nodeWrites);
    const response = {
      ok: true,
      requestId: cleanString_(payload.requestId),
      statusColumns: clientStatusColumns_(columns)
    };
    if (rolesChanged) {
      response.nodes = clientNodes_(rows, activeNodes_(rows.nodes).map(function (node) { return cleanString_(node.NodeId); }));
    }
    return response;
  });
}

function normalizeNodesForStatusRoles_(rows, previousDoneColumnId, actorId) {
  const active = activeNodes_(rows.nodes).filter(function (node) { return !cleanString_(node.DraftOwner); });
  const nodesById = byId_(active, 'NodeId');
  const children = childrenMap_(active);
  const doneColumnId = doneStatusColumnId_(rows.statusColumns);
  const inProgressColumnId = inProgressStatusColumnId_(rows.statusColumns);
  const writeMap = {};
  const now = nowIso_();

  function markChanged(node) {
    node.UpdatedAt = now;
    node.UpdatedBy = actorId;
    writeMap[cleanString_(node.NodeId)] = node;
  }

  active.forEach(function (node) {
    if ((children[cleanString_(node.NodeId)] || []).length) return;
    const currentProgress = validManualProgress_(node.Progress);
    let nextProgress = currentProgress;
    if (cleanString_(node.StatusColumnId) === doneColumnId) {
      nextProgress = 100;
    } else if (currentProgress === 100) {
      nextProgress = 90;
    }
    if (nextProgress !== currentProgress) {
      node.Progress = nextProgress;
      markChanged(node);
    }
  });

  const depthMemo = {};
  function depthOf(nodeId) {
    if (depthMemo[nodeId] !== undefined) return depthMemo[nodeId];
    const node = nodesById[nodeId];
    if (!node || !cleanString_(node.ParentId)) {
      depthMemo[nodeId] = 0;
      return 0;
    }
    depthMemo[nodeId] = depthOf(cleanString_(node.ParentId)) + 1;
    return depthMemo[nodeId];
  }

  active.filter(function (node) {
    return (children[cleanString_(node.NodeId)] || []).length > 0;
  }).sort(function (a, b) {
    return depthOf(cleanString_(b.NodeId)) - depthOf(cleanString_(a.NodeId));
  }).forEach(function (node) {
    const childStatuses = (children[cleanString_(node.NodeId)] || []).map(function (childId) {
      return cleanString_(nodesById[childId] && nodesById[childId].StatusColumnId);
    }).filter(Boolean);
    if (!childStatuses.length) return;
    const currentStatus = cleanString_(node.StatusColumnId);
    let nextStatus = '';
    if (childStatuses.every(function (statusId) { return statusId === doneColumnId; })) {
      nextStatus = doneColumnId;
    } else if (inProgressColumnId && (
      childStatuses.some(function (statusId) { return statusId === inProgressColumnId; }) ||
      childStatuses.some(function (statusId) { return statusId === doneColumnId; }) ||
      currentStatus === doneColumnId ||
      currentStatus === previousDoneColumnId
    )) {
      nextStatus = inProgressColumnId;
    }
    if (nextStatus && nextStatus !== currentStatus) {
      node.StatusColumnId = nextStatus;
      markChanged(node);
    }
  });

  return writeMap;
}

function deleteStatusColumn(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readStatusSnapshot_();
    requireCurrentMember_(rows.members);
    assertExactlyOneDone_(rows.statusColumns);
    const columnId = cleanString_(payload.columnId);
    const column = rows.statusColumns.find(function (c) { return cleanString_(c.ColumnId) === columnId; });
    if (!column) {
      throw new Error('ステータス列が見つかりません。');
    }
    if (isTrue_(column.IsDoneColumn)) {
      throw new Error('完了列は削除できません。先に別の列を完了列にしてください。');
    }
    if (cleanString_(column.ColumnId) === inProgressStatusColumnId_(rows.statusColumns)) {
      throw new Error('進行中列は削除できません。先に別の列を進行中列にしてください。');
    }
    if (rows.statusColumns.length <= 1) {
      throw new Error('最後のステータス列は削除できません。');
    }
    const used = activeNodes_(rows.nodes).some(function (n) { return cleanString_(n.StatusColumnId) === columnId; });
    if (used) {
      throw new Error('この列に所属するノードがあります。先に別の列へ移動してください。');
    }
    deleteRow_(SHEET.STATUS_COLUMNS, column.__row, column.ColumnId);
    const columns = rows.statusColumns.filter(function (item) { return cleanString_(item.ColumnId) !== columnId; });
    assertExactlyOneDone_(columns);
    return { ok: true, statusColumns: clientStatusColumns_(columns) };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    upsertStatusColumn: upsertStatusColumn,
    deleteStatusColumn: deleteStatusColumn,
    normalizeNodesForStatusRoles_: normalizeNodesForStatusRoles_
  };
}
