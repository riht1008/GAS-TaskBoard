/**
 * Node mutation APIs and node write helpers.
 */

function addNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const parentId = cleanString_(payload.parentId);
    const parent = nodesById[parentId];
    if (!parent) {
      throw new Error('親ノードが見つかりません。');
    }
    if (nodeHasDependency_(parentId, rows.dependencies, nodesById)) {
      throw new Error('依存関係を持つ末端ノードには子タスクを追加できません。');
    }

    const statusColumns = sortByOrder_(rows.statusColumns);
    if (!statusColumns.length) {
      throw new Error('ステータス列がありません。');
    }

    const requestedNodeId = cleanString_(payload.nodeId || payload.clientNodeId);
    if (requestedNodeId && nodesById[requestedNodeId]) {
      throw new Error('同じIDのノードが既に存在します。');
    }
    const nodeId = requestedNodeId || newId_();
    const now = nowIso_();
    const schedule = normalizeSchedule_(payload.startDate, payload.endDate);
    const isShell = payload.isShell === true;
    const node = {
      NodeId: nodeId,
      ParentId: parentId,
      Name: isShell ? optionalName_(payload.name) : requireName_(payload.name),
      StatusColumnId: validateStatusId_(payload.statusColumnId || statusColumns[0].ColumnId, rows.statusColumns),
      AssigneeIds: normalizeAssigneeIds_(payload.assigneeIds || [], rows.members).join(','),
      Priority: normalizePriority_(payload.priority),
      StartDate: schedule.startDate,
      EndDate: schedule.endDate,
      Description: cleanString_(payload.description),
      SortOrder: nextSortOrder_(active.filter(function (n) { return n.ParentId === parentId; })),
      CreatedAt: now,
      UpdatedAt: now,
      UpdatedBy: actor.MemberId,
      DeletedAt: '',
      DeletedBy: '',
      Deliverable: cleanString_(payload.deliverable),
      Note: cleanString_(payload.note),
      Progress: '',
      IncludeInWbs: true
    };

    appendObject_(SHEET.NODES, node);
    let freshRows = readAll_();
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(freshRows, [parentId], actor.MemberId, rollupWriteMap);
    if (rollupIds.length) {
      writeObjects_(SHEET.NODES, Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; }));
      freshRows = readAll_();
    }
    const affectedIds = unique_([nodeId, parentId].concat(rollupIds).concat(ancestorIdsForMany_([nodeId, parentId].concat(rollupIds), activeNodes_(freshRows.nodes))));
    return makeMutationPayload_(freshRows, affectedIds, payload.requestId, { createdNodeId: nodeId });
  });
}

function saveNode(payload) {
  payload = payload || {};
  let statusNotification = null;
  const result = withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    const patch = payload.patch || {};
    const nodeId = cleanString_(payload.nodeId);
    let rows = readAll_();
    let active = activeNodes_(rows.nodes);
    let nodesById = byId_(active, 'NodeId');
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }

    if (payload.baseUpdatedAt !== undefined && cleanString_(payload.baseUpdatedAt) !== cleanString_(node.UpdatedAt)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    const beforeStart = cleanString_(node.StartDate);
    const beforeEnd = cleanString_(node.EndDate);
    const beforeStatus = cleanString_(node.StatusColumnId);
    const doneColumnId = doneStatusColumnId_(rows.statusColumns);
    const beforeProgress = effectiveLeafProgress_(node, doneColumnId);
    const nodeHadChildren = (childrenMap_(active)[node.NodeId] || []).length > 0;
    applyNodePatch_(node, patch, rows);
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actor.MemberId;

    if (scheduleWouldBeClearedWithDependencies_(node, rows.dependencies, nodesById)) {
      throw new Error('依存関係があるノードの日付は未設定にできません。先に依存関係を削除してください。');
    }

    const scheduleChanged = beforeStart !== node.StartDate || beforeEnd !== node.EndDate;
    const statusChanged = beforeStatus !== node.StatusColumnId;
    const afterProgress = effectiveLeafProgress_(node, doneColumnId);
    const progressChanged = !nodeHadChildren && beforeProgress !== afterProgress;
    const writeMap = {};
    writeMap[node.NodeId] = node;

    let rescheduleResult = { shiftedIds: [] };
    if (scheduleChanged) {
      rescheduleResult = rescheduleFromSeeds_([node.NodeId], activeNodes_(rows.nodes), visibleDependencies_(rows.dependencies, nodesById), actor.MemberId, writeMap);
    }
    rollupParentStatuses_(rows, [node.NodeId], actor.MemberId, writeMap);

    writeObjects_(SHEET.NODES, Object.keys(writeMap).map(function (id) { return writeMap[id]; }));
    appendNodeActivityLogs_(node.NodeId, {
      statusChanged: statusChanged,
      beforeStatus: beforeStatus,
      afterStatus: cleanString_(node.StatusColumnId),
      progressChanged: progressChanged,
      beforeProgress: beforeProgress,
      afterProgress: afterProgress,
      doneColumnId: doneColumnId,
      actorId: actor.MemberId
    });
    rows = readAll_();
    const writeIds = Object.keys(writeMap);
    const affectedIds = unique_(writeIds.concat(ancestorIdsForMany_(writeIds, activeNodes_(rows.nodes))));
    if (statusChanged) {
      try {
        const afterNode = byId_(activeNodes_(rows.nodes), 'NodeId')[node.NodeId] || node;
        statusNotification = buildStatusChangeNotification_(
          afterNode,
          rows.statusColumns.find(function (column) { return cleanString_(column.ColumnId) === beforeStatus; }),
          rows.statusColumns.find(function (column) { return cleanString_(column.ColumnId) === cleanString_(afterNode.StatusColumnId); }),
          actor,
          rows
        );
      } catch (error) {
        statusNotification = null;
      }
    }
    return makeMutationPayload_(rows, affectedIds, requestId, {
      rescheduledCount: rescheduleResult.shiftedIds.filter(function (id) { return id !== node.NodeId; }).length,
      statusChanged: statusChanged,
      progressChanged: progressChanged
    });
  });
  if (statusNotification) {
    postToSlack_(statusNotification);
  }
  return result;
}

function moveNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    let rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const newParentId = cleanString_(payload.newParentId);
    const node = nodesById[nodeId];
    const newParent = nodesById[newParentId];
    if (!node || !newParent) {
      throw new Error('移動対象または移動先が見つかりません。');
    }
    if (!node.ParentId) {
      throw new Error('ルートノードは移動できません。');
    }
    if (nodeId === newParentId) {
      throw new Error('自分自身を親にはできません。');
    }
    const descendants = collectDescendantIds_(nodeId, childrenMap_(active));
    if (descendants.indexOf(newParentId) !== -1) {
      throw new Error('子孫ノードを親にはできません。');
    }
    if (nodeHasDependency_(newParentId, rows.dependencies, nodesById)) {
      throw new Error('依存関係を持つ末端ノードの配下には移動できません。');
    }
    if (descendants.length && nodeHasDependency_(nodeId, rows.dependencies, nodesById)) {
      throw new Error('依存関係を持つノードをグループ化できません。');
    }

    const oldParentId = node.ParentId;
    if (payload.baseUpdatedAt !== undefined && cleanString_(payload.baseUpdatedAt) !== cleanString_(node.UpdatedAt)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    node.ParentId = newParentId;
    node.SortOrder = payload.newSortOrder !== undefined && payload.newSortOrder !== null && payload.newSortOrder !== ''
      ? Number(payload.newSortOrder)
      : nextSortOrder_(active.filter(function (n) { return n.ParentId === newParentId; }));
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actor.MemberId;
    const writeMap = {};
    writeMap[node.NodeId] = node;
    const rollupIds = rollupParentStatuses_(rows, [nodeId, oldParentId, newParentId], actor.MemberId, writeMap);
    writeObjects_(SHEET.NODES, Object.keys(writeMap).map(function (id) { return writeMap[id]; }));

    rows = readAll_();
    const affectedIds = unique_([nodeId, oldParentId, newParentId]
      .concat(rollupIds)
      .concat(ancestorIds_(oldParentId, activeNodes_(rows.nodes)))
      .concat(ancestorIds_(newParentId, activeNodes_(rows.nodes))));
    return makeMutationPayload_(rows, affectedIds, requestId, {});
  });
}

function deleteNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (!node.ParentId) {
      throw new Error('ルートノードは削除できません。');
    }
    const targetIds = [nodeId].concat(collectDescendantIds_(nodeId, childrenMap_(active)));
    const now = nowIso_();
    const targets = targetIds.map(function (id) {
      const row = nodesById[id];
      row.DeletedAt = now;
      row.DeletedBy = actor.MemberId;
      row.UpdatedAt = now;
      row.UpdatedBy = actor.MemberId;
      return row;
    });
    writeObjects_(SHEET.NODES, targets);

    let freshRows = readAll_();
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(freshRows, [node.ParentId], actor.MemberId, rollupWriteMap);
    if (rollupIds.length) {
      writeObjects_(SHEET.NODES, Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; }));
      freshRows = readAll_();
    }
    const affectedIds = unique_(ancestorIds_(node.ParentId, activeNodes_(freshRows.nodes)).concat([node.ParentId]).concat(rollupIds));
    return makeMutationPayload_(freshRows, affectedIds, cleanString_(payload.requestId), {
      deletedNodeIds: targetIds
    });
  });
}

function restoreNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    let rows = readAll_();
    const nodesById = byId_(rows.nodes, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (!cleanString_(node.DeletedAt)) {
      return makeMutationPayload_(rows, [nodeId], requestId, { restoredNodeIds: [] });
    }
    const parentId = cleanString_(node.ParentId);
    const parent = parentId ? nodesById[parentId] : null;
    if (parent && cleanString_(parent.DeletedAt)) {
      throw new Error('親タスクが削除済みのため復元できません。');
    }

    const deletedAt = cleanString_(node.DeletedAt);
    const descendantIds = collectDescendantIds_(nodeId, childrenMap_(rows.nodes)).filter(function (id) {
      const row = nodesById[id];
      return row && cleanString_(row.DeletedAt) === deletedAt;
    });
    const targetIds = [nodeId].concat(descendantIds);
    const now = nowIso_();
    const targets = targetIds.map(function (id) {
      const row = nodesById[id];
      row.DeletedAt = '';
      row.DeletedBy = '';
      row.UpdatedAt = now;
      row.UpdatedBy = actor.MemberId;
      return row;
    }).filter(Boolean);
    writeObjects_(SHEET.NODES, targets);

    rows = readAll_();
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(rows, [nodeId, parentId], actor.MemberId, rollupWriteMap);
    if (rollupIds.length) {
      writeObjects_(SHEET.NODES, Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; }));
      rows = readAll_();
    }
    const active = activeNodes_(rows.nodes);
    const affectedIds = unique_(targetIds.concat([parentId]).concat(rollupIds).concat(ancestorIds_(nodeId, active)));
    return makeMutationPayload_(rows, affectedIds, requestId, {
      restoredNodeIds: targetIds
    });
  });
}

function fitNodeToChildren(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    let rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (payload.baseUpdatedAt !== undefined && cleanString_(payload.baseUpdatedAt) !== cleanString_(node.UpdatedAt)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    const childBounds = descendantOwnScheduleBounds_(nodeId, active);
    if (!childBounds.startDate || !childBounds.endDate) {
      throw new Error('子孫に日付が設定されたノードがありません。');
    }
    node.StartDate = childBounds.startDate;
    node.EndDate = childBounds.endDate;
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actor.MemberId;
    writeObject_(SHEET.NODES, node);

    rows = readAll_();
    const affectedIds = unique_([nodeId].concat(ancestorIds_(nodeId, activeNodes_(rows.nodes))));
    return makeMutationPayload_(rows, affectedIds, requestId, {});
  });
}

function applyNodePatch_(node, patch, rows) {
  const hasStatusPatch = Object.prototype.hasOwnProperty.call(patch, 'statusColumnId');
  const hasProgressPatch = Object.prototype.hasOwnProperty.call(patch, 'progress');
  const doneColumnId = doneStatusColumnId_(rows.statusColumns);
  const beforeDone = cleanString_(node.StatusColumnId) === doneColumnId;
  const active = activeNodes_(rows.nodes);
  const childIds = childrenMap_(active)[cleanString_(node.NodeId)] || [];
  const isLeaf = !childIds.length;
  const normalizedProgress = hasProgressPatch ? normalizeManualProgress_(patch.progress, true) : null;
  const normalizedStatus = hasStatusPatch ? validateStatusId_(patch.statusColumnId, rows.statusColumns) : '';

  if (hasProgressPatch && childIds.length) {
    throw new Error('親タスクの進捗率は子タスクから自動計算されます。');
  }
  if (hasProgressPatch && normalizedProgress === 100 && hasStatusPatch && normalizedStatus !== doneColumnId) {
    throw new Error('進捗100%は完了ステータスでのみ設定できます。');
  }

  if (patch.name !== undefined) {
    node.Name = requireName_(patch.name);
  }
  if (hasStatusPatch) {
    node.StatusColumnId = normalizedStatus;
  }
  if (patch.assigneeIds !== undefined) {
    node.AssigneeIds = normalizeAssigneeIds_(patch.assigneeIds, rows.members).join(',');
  }
  if (patch.priority !== undefined) {
    node.Priority = normalizePriority_(patch.priority);
  }
  if (patch.description !== undefined) {
    const description = cleanString_(patch.description);
    if (description.length > 12000) {
      throw new Error('説明は12000文字以内で入力してください。');
    }
    node.Description = description;
  }
  if (patch.deliverable !== undefined) {
    const deliverable = cleanString_(patch.deliverable);
    if (deliverable.length > 1000) {
      throw new Error('成果物は1000文字以内で入力してください。');
    }
    node.Deliverable = deliverable;
  }
  if (patch.note !== undefined) {
    const note = cleanString_(patch.note);
    if (note.length > 1000) {
      throw new Error('備考は1000文字以内で入力してください。');
    }
    node.Note = note;
  }
  if (patch.includeInWbs !== undefined) {
    node.IncludeInWbs = normalizeIncludeInWbs_(patch.includeInWbs);
  }
  if (hasProgressPatch && isLeaf) {
    node.Progress = normalizedProgress === '' ? '' : normalizedProgress;
    if (normalizedProgress === 100) {
      node.StatusColumnId = doneColumnId;
    }
  }
  if (isLeaf && cleanString_(node.StatusColumnId) === doneColumnId) {
    node.Progress = 100;
  } else if (isLeaf && hasStatusPatch && beforeDone && !hasProgressPatch) {
    node.Progress = 90;
  }
  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    const schedule = normalizeSchedule_(
      patch.startDate !== undefined ? patch.startDate : node.StartDate,
      patch.endDate !== undefined ? patch.endDate : node.EndDate
    );
    node.StartDate = schedule.startDate;
    node.EndDate = schedule.endDate;
  }
}

function rollupParentStatuses_(rows, seedIds, actorId, writeMap) {
  writeMap = writeMap || {};
  const active = activeNodes_(rows.nodes);
  const nodesById = byId_(active, 'NodeId');
  const children = childrenMap_(active);
  const doneColumnId = doneStatusColumnId_(rows.statusColumns);
  const inProgressColumnId = inProgressStatusColumnId_(rows.statusColumns);
  const candidates = unique_((seedIds || []).reduce(function (all, id) {
    const cleanId = cleanString_(id);
    if (!cleanId) {
      return all;
    }
    return all.concat([cleanId]).concat(ancestorIds_(cleanId, active));
  }, []));
  const changedIds = [];

  candidates.forEach(function (nodeId) {
    const node = nodesById[nodeId];
    const childIds = children[nodeId] || [];
    if (!node || !childIds.length) {
      return;
    }
    const childStatuses = childIds
      .map(function (childId) { return nodesById[childId]; })
      .filter(Boolean)
      .map(function (child) { return cleanString_(child.StatusColumnId); });
    if (!childStatuses.length) {
      return;
    }
    let nextStatus = '';
    if (childStatuses.every(function (statusId) { return statusId === doneColumnId; })) {
      nextStatus = doneColumnId;
    } else if (inProgressColumnId && (
      childStatuses.some(function (statusId) { return statusId === inProgressColumnId; }) ||
      childStatuses.some(function (statusId) { return statusId === doneColumnId; }) ||
      cleanString_(node.StatusColumnId) === doneColumnId
    )) {
      nextStatus = inProgressColumnId;
    }
    if (!nextStatus || cleanString_(node.StatusColumnId) === nextStatus) {
      return;
    }
    node.StatusColumnId = nextStatus;
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actorId;
    writeMap[node.NodeId] = node;
    changedIds.push(node.NodeId);
  });

  return changedIds;
}

function inProgressStatusColumnId_(statusColumns) {
  const column = (statusColumns || []).find(function (statusColumn) {
    const name = cleanString_(statusColumn.Name).toLowerCase();
    return name === '進行中' || name.indexOf('進行中') !== -1 || name === 'doing' || name === 'in progress';
  });
  return column ? cleanString_(column.ColumnId) : '';
}

function appendNodeActivityLogs_(nodeId, change) {
  const now = nowIso_();
  if (change.statusChanged) {
    appendObject_(SHEET.ACTIVITY_LOG, {
      LogId: newId_(),
      NodeId: nodeId,
      Field: 'status',
      OldValue: change.beforeStatus,
      NewValue: change.afterStatus,
      NewValueIsDone: change.afterStatus === change.doneColumnId,
      ChangedAt: now,
      ChangedBy: change.actorId
    });
  }
  if (change.progressChanged) {
    appendObject_(SHEET.ACTIVITY_LOG, {
      LogId: newId_(),
      NodeId: nodeId,
      Field: 'progress',
      OldValue: change.beforeProgress,
      NewValue: change.afterProgress,
      NewValueIsDone: Number(change.afterProgress) === 100,
      ChangedAt: now,
      ChangedBy: change.actorId
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    rollupParentStatuses_: rollupParentStatuses_,
    inProgressStatusColumnId_: inProgressStatusColumnId_,
    restoreNode: restoreNode
  };
}
