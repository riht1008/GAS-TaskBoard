/**
 * Kanban status column APIs.
 */

function upsertStatusColumn(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readStatusSnapshot_();
    requireCurrentMember_(rows.members);
    if (payload.isDoneColumn === true && payload.isInProgressColumn === true) {
      throw new Error('完了列と進行中列は同じ列に設定できません。');
    }
    const columnId = cleanString_(payload.columnId);
    const name = requireName_(payload.name);
    let columns = rows.statusColumns;
    assertExactlyOneDone_(columns);
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
    const currentDoneColumnId = doneStatusColumnId_(columns);
    if (requestedInProgressColumnId && requestedInProgressColumnId === currentDoneColumnId) {
      throw new Error('完了列と進行中列は同じ列に設定できません。');
    }
    if (requestedDoneColumnId) {
      columns.forEach(function (c) { c.IsDoneColumn = cleanString_(c.ColumnId) === requestedDoneColumnId; });
    }
    if (requestedInProgressColumnId) {
      columns.forEach(function (c) { c.IsInProgressColumn = cleanString_(c.ColumnId) === requestedInProgressColumnId; });
    }
    assertExactlyOneDone_(columns);
    writeObjects_(SHEET.STATUS_COLUMNS, columns);
    return { ok: true, statusColumns: clientStatusColumns_(columns) };
  });
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
    deleteRow_(SHEET.STATUS_COLUMNS, column.__row);
    const columns = rows.statusColumns.filter(function (item) { return cleanString_(item.ColumnId) !== columnId; });
    assertExactlyOneDone_(columns);
    return { ok: true, statusColumns: clientStatusColumns_(columns) };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    upsertStatusColumn: upsertStatusColumn,
    deleteStatusColumn: deleteStatusColumn
  };
}
