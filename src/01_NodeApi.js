/**
 * Node mutation APIs and node write helpers.
 */

function addNode(payload) {
  payload = payload || {};
  let assignmentNotification = null;
  const result = withLock_(function () {
    requireSchemaExists_();
    const rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
    const nodesById = byId_(active, 'NodeId');
    const parentId = cleanString_(payload.parentId);
    const parent = nodesById[parentId];
    if (!parent) {
      throw new Error('親ノードが見つかりません。');
    }
    if (cleanString_(parent.DraftOwner)) {
      throw new Error('作成途中のタスクには子タスクを追加できません。先に名称を保存してください。');
    }
    if (nodeHasDependency_(parentId, rows.dependencies, nodesById)) {
      throw new Error('依存関係を持つ末端ノードには子タスクを追加できません。');
    }

    const statusColumns = sortByOrder_(rows.statusColumns);
    if (!statusColumns.length) {
      throw new Error('ステータス列がありません。');
    }

    const requestedNodeId = cleanString_(payload.nodeId || payload.clientNodeId);
    const existingRequestedNode = requestedNodeId && rows.nodes.find(function (item) {
      return cleanString_(item.NodeId) === requestedNodeId;
    });
    if (existingRequestedNode) {
      if (cleanString_(existingRequestedNode.DeletedAt)) {
        throw new Error('同じIDの削除済みノードが既に存在します。');
      }
      const existingAffectedIds = unique_([requestedNodeId, cleanString_(existingRequestedNode.ParentId)]
        .concat(ancestorIds_(requestedNodeId, active)));
      return makeMutationPayload_(rows, existingAffectedIds, payload.requestId, { createdNodeId: requestedNodeId });
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
      IncludeInWbs: true,
      DraftOwner: isShell ? actor.MemberId : '',
      DraftExpiresAt: isShell ? new Date(Date.now() + DRAFT_TTL_MS).toISOString() : '',
      ActualStartDate: '',
      ActualEndDate: ''
    };

    appendObject_(SHEET.NODES, node);
    let freshRows = readNodeSnapshot_();
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(freshRows, [parentId], actor.MemberId, rollupWriteMap);
    if (rollupIds.length) {
      writeObjects_(SHEET.NODES, Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; }));
      freshRows = readNodeSnapshot_();
    }
    const affectedIds = unique_([nodeId, parentId].concat(rollupIds).concat(ancestorIdsForMany_([nodeId, parentId].concat(rollupIds), activeNodes_(freshRows.nodes))));
    const assignedIds = splitCsv_(node.AssigneeIds).filter(function (id) { return id !== cleanString_(actor.MemberId); });
    if (assignedIds.length) {
      try {
        const assignedSet = {};
        assignedIds.forEach(function (id) { assignedSet[id] = true; });
        const assignedMembers = freshRows.members.filter(function (member) { return !!assignedSet[cleanString_(member.MemberId)]; });
        const freshNode = byId_(activeNodes_(freshRows.nodes), 'NodeId')[nodeId] || node;
        assignmentNotification = buildAssignmentNotification_(freshNode, actor, assignedMembers, freshRows);
      } catch (error) {
        assignmentNotification = null;
      }
    }
    return makeMutationPayload_(freshRows, affectedIds, payload.requestId, { createdNodeId: nodeId });
  });
  if (assignmentNotification) {
    postToSlack_(assignmentNotification, { type: 'assignment' });
    attachPublicSlackSettings_(result);
  }
  return result;
}

function addNodes(payload) {
  payload = payload || {};
  const source = Array.isArray(payload.nodes) ? payload.nodes : [];
  if (!source.length || source.length > 100) {
    throw new Error('一括追加するタスクは1〜100件で指定してください。');
  }

  const assignmentNotifications = [];
  const result = withLock_(function () {
    requireSchemaExists_();
    const rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
    const nodesById = byId_(active, 'NodeId');
    const allNodesById = byId_(rows.nodes, 'NodeId');
    const statusColumns = sortByOrder_(rows.statusColumns);
    if (!statusColumns.length) {
      throw new Error('ステータス列がありません。');
    }

    const now = nowIso_();
    const seenNodeIds = {};
    const createdNodeIds = [];
    const insertedNodes = [];
    const parentIds = [];

    source.forEach(function (rawItem, index) {
      const item = rawItem || {};
      const itemLabel = 'タスク' + (index + 1) + '件目';
      const parentId = cleanString_(item.parentId);
      const parent = nodesById[parentId];
      if (!parent) {
        throw new Error(itemLabel + 'の親ノードが見つかりません。');
      }
      if (cleanString_(parent.DraftOwner)) {
        throw new Error(itemLabel + 'は作成途中のタスクへ追加できません。先に親タスクの名称を保存してください。');
      }
      if (nodeHasDependency_(parentId, rows.dependencies, nodesById)) {
        throw new Error(itemLabel + 'は依存関係を持つ末端ノードへ追加できません。');
      }

      const isShell = item.isShell === true;
      const name = isShell ? optionalName_(item.name) : requireName_(item.name);
      const requestedNodeId = cleanString_(item.nodeId || item.clientNodeId);
      let nodeId = requestedNodeId || newId_();
      while (!requestedNodeId && allNodesById[nodeId]) {
        nodeId = newId_();
      }
      if (seenNodeIds[nodeId]) {
        throw new Error(itemLabel + 'のNodeIdが一括追加内で重複しています。');
      }
      seenNodeIds[nodeId] = true;

      const existingNode = allNodesById[nodeId];
      if (existingNode) {
        if (cleanString_(existingNode.DeletedAt)) {
          throw new Error(itemLabel + 'と同じIDの削除済みノードが既に存在します。');
        }
        if (cleanString_(existingNode.ParentId) !== parentId || cleanString_(existingNode.Name) !== name) {
          throw new Error(itemLabel + 'のNodeIdは別のノードで使用されています。');
        }
        createdNodeIds.push(nodeId);
        parentIds.push(parentId);
        return;
      }

      const schedule = normalizeSchedule_(item.startDate, item.endDate);
      const node = {
        NodeId: nodeId,
        ParentId: parentId,
        Name: name,
        StatusColumnId: validateStatusId_(item.statusColumnId || statusColumns[0].ColumnId, rows.statusColumns),
        AssigneeIds: normalizeAssigneeIds_(item.assigneeIds || [], rows.members).join(','),
        Priority: normalizePriority_(item.priority),
        StartDate: schedule.startDate,
        EndDate: schedule.endDate,
        Description: cleanString_(item.description),
        SortOrder: nextSortOrder_(active.filter(function (candidate) { return candidate.ParentId === parentId; })),
        CreatedAt: now,
        UpdatedAt: now,
        UpdatedBy: actor.MemberId,
        DeletedAt: '',
        DeletedBy: '',
        Deliverable: cleanString_(item.deliverable),
        Note: cleanString_(item.note),
        Progress: '',
        IncludeInWbs: item.includeInWbs !== false,
        DraftOwner: isShell ? actor.MemberId : '',
        DraftExpiresAt: isShell ? new Date(Date.now() + DRAFT_TTL_MS).toISOString() : '',
        ActualStartDate: '',
        ActualEndDate: ''
      };

      rows.nodes.push(node);
      active.push(node);
      nodesById[nodeId] = node;
      allNodesById[nodeId] = node;
      insertedNodes.push(node);
      createdNodeIds.push(nodeId);
      parentIds.push(parentId);
    });

    validateNodeTree_(active);
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(rows, unique_(parentIds), actor.MemberId, rollupWriteMap);
    if (insertedNodes.length) {
      appendObjects_(SHEET.NODES, insertedNodes);
    }
    if (rollupIds.length) {
      writeObjects_(SHEET.NODES, Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; }));
    }

    const affectedIds = unique_(createdNodeIds
      .concat(parentIds)
      .concat(rollupIds)
      .concat(ancestorIdsForMany_(createdNodeIds.concat(parentIds).concat(rollupIds), active)));

    insertedNodes.forEach(function (node) {
      const assignedIds = splitCsv_(node.AssigneeIds).filter(function (id) {
        return id !== cleanString_(actor.MemberId);
      });
      if (!assignedIds.length) {
        return;
      }
      try {
        const assignedSet = {};
        assignedIds.forEach(function (id) { assignedSet[id] = true; });
        const assignedMembers = rows.members.filter(function (member) {
          return !!assignedSet[cleanString_(member.MemberId)];
        });
        const notification = buildAssignmentNotification_(node, actor, assignedMembers, rows);
        if (notification) {
          assignmentNotifications.push(notification);
        }
      } catch (error) {
        // Task creation succeeds even when notification payload construction fails.
      }
    });

    return makeMutationPayload_(rows, affectedIds, payload.requestId, {
      createdNodeIds: createdNodeIds,
      createdCount: insertedNodes.length
    });
  });

  assignmentNotifications.forEach(function (notification) {
    postToSlack_(notification, { type: 'assignment' });
  });
  if (assignmentNotifications.length) {
    attachPublicSlackSettings_(result);
  }
  return result;
}

function saveNode(payload) {
  payload = payload || {};
  let statusNotification = null;
  let assignmentNotification = null;
  const result = withLock_(function () {
    requireSchemaExists_();
    const requestId = cleanString_(payload.requestId);
    const patch = payload.patch || {};
    const nodeId = cleanString_(payload.nodeId);
    let rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    let active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
    let nodesById = byId_(active, 'NodeId');
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }

    if (!nodeBaseVersionMatches_(payload, node, actor, true)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    const beforeStart = cleanString_(node.StartDate);
    const beforeEnd = cleanString_(node.EndDate);
    const beforeActualStart = cleanString_(node.ActualStartDate);
    const beforeActualEnd = cleanString_(node.ActualEndDate);
    const beforeStatus = cleanString_(node.StatusColumnId);
    const beforeAssigneeIds = splitCsv_(node.AssigneeIds);
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
    const actualDatesChanged = beforeActualStart !== cleanString_(node.ActualStartDate) || beforeActualEnd !== cleanString_(node.ActualEndDate);
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
    rows = readNodeSnapshot_();
    const writeIds = Object.keys(writeMap);
    const affectedIds = unique_(writeIds.concat(ancestorIdsForMany_(writeIds, activeNodes_(rows.nodes))));
    if (statusChanged || progressChanged || actualDatesChanged) {
      rows.activityLog = readObjectsMatchingColumnValues_(SHEET.ACTIVITY_LOG, 'NodeId', affectedIds);
      rows.__loadedSheets[SHEET.ACTIVITY_LOG] = true;
    }
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
    const afterAssigneeIds = splitCsv_(node.AssigneeIds);
    const addedAssigneeIds = afterAssigneeIds.filter(function (id) {
      return beforeAssigneeIds.indexOf(id) === -1 && id !== cleanString_(actor.MemberId);
    });
    if (addedAssigneeIds.length) {
      try {
        const addedSet = {};
        addedAssigneeIds.forEach(function (id) { addedSet[id] = true; });
        const assignedMembers = rows.members.filter(function (member) { return !!addedSet[cleanString_(member.MemberId)]; });
        const afterNode = byId_(activeNodes_(rows.nodes), 'NodeId')[node.NodeId] || node;
        assignmentNotification = buildAssignmentNotification_(afterNode, actor, assignedMembers, rows);
      } catch (error) {
        assignmentNotification = null;
      }
    }
    return makeMutationPayload_(rows, affectedIds, requestId, {
      rescheduledCount: rescheduleResult.shiftedIds.filter(function (id) { return id !== node.NodeId; }).length,
      statusChanged: statusChanged,
      progressChanged: progressChanged
    });
  });
  if (statusNotification) {
    postToSlack_(statusNotification, { type: 'status' });
    attachPublicSlackSettings_(result);
  }
  if (assignmentNotification) {
    postToSlack_(assignmentNotification, { type: 'assignment' });
    attachPublicSlackSettings_(result);
  }
  return result;
}

function getNodeActualDates(payload) {
  payload = payload || {};
  requireSchemaExists_();
  const rows = readAll_({ sheets: [SHEET.NODES, SHEET.STATUS_COLUMNS] });
  const nodeId = cleanString_(payload.nodeId);
  const active = activeNodes_(rows.nodes);
  if (!byId_(active, 'NodeId')[nodeId]) {
    throw new Error('ノードが見つかりません。');
  }
  rows.activityLog = readObjectsMatchingColumn_(SHEET.ACTIVITY_LOG, 'NodeId', nodeId);
  rows.__loadedSheets[SHEET.ACTIVITY_LOG] = true;
  const derived = computeDerived_(active, rows.statusColumns);
  const actuals = clientActivityActuals_(rows, derived);
  const actual = actuals && actuals[nodeId] ? actuals[nodeId] : {};
  return {
    ok: true,
    nodeId: nodeId,
    inferredActualStartDate: cleanString_(actual.startDate),
    inferredActualEndDate: cleanString_(actual.endDate)
  };
}

function moveNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const requestId = cleanString_(payload.requestId);
    let rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
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
    if (cleanString_(newParent.DraftOwner)) {
      throw new Error('作成途中のタスクを移動先にはできません。');
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
    if (!nodeBaseVersionMatches_(payload, node, actor, false)) {
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

    rows = readNodeSnapshot_();
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
    const rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (!node.ParentId) {
      throw new Error('ルートノードは削除できません。');
    }
    if (!nodeBaseVersionMatches_(payload, node, actor, false)) {
      return makeConflictPayload_(rows, nodeId, cleanString_(payload.requestId));
    }
    const targetIds = [nodeId].concat(collectDescendantIds_(nodeId, childrenMap_(active)));
    if (!Array.isArray(payload.expectedTargetIds)) {
      throw appError_('DELETE_SCOPE_REQUIRED', '削除対象の確認情報がありません。同期後にもう一度削除してください。', false);
    }
    const expectedTargetIds = payload.expectedTargetIds.map(cleanString_).filter(Boolean).sort();
    if (expectedTargetIds.join(',') !== targetIds.slice().sort().join(',')) {
      const affected = unique_(targetIds.concat(ancestorIds_(nodeId, active)));
      return {
        ok: false,
        code: 'DELETE_SCOPE_CHANGED',
        message: '確認後に対象サブツリーが変更されました。最新の件数を確認してから、もう一度削除してください。',
        requestId: cleanString_(payload.requestId),
        nodeId: nodeId,
        nodes: clientNodes_(rows, affected)
      };
    }
    const now = nowIso_();
    const targets = targetIds.map(function (id) {
      const row = nodesById[id];
      row.DeletedAt = now;
      row.DeletedBy = actor.MemberId;
      row.UpdatedAt = now;
      row.UpdatedBy = actor.MemberId;
      return row;
    });
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(rows, [node.ParentId], actor.MemberId, rollupWriteMap);
    writeObjects_(SHEET.NODES, targets.concat(Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; })));

    const freshRows = readNodeSnapshot_();
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
    const requestId = cleanString_(payload.requestId);
    let rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
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
    const prospectiveRows = Object.assign({}, rows, {
      nodes: rows.nodes.map(cloneRow_)
    });
    const prospectiveById = byId_(prospectiveRows.nodes, 'NodeId');
    const targets = targetIds.map(function (id) {
      const row = prospectiveById[id];
      row.DeletedAt = '';
      row.DeletedBy = '';
      row.UpdatedAt = now;
      row.UpdatedBy = actor.MemberId;
      return row;
    }).filter(Boolean);
    const prospectiveActive = activeNodes_(prospectiveRows.nodes);
    validateNodeTree_(prospectiveActive);
    const visibleDependencies = validateDependencySet_(prospectiveActive, prospectiveRows.dependencies);
    const rescheduleWriteMap = {};
    const rescheduleResult = rescheduleFromSeeds_(
      targetIds,
      prospectiveActive,
      visibleDependencies,
      actor.MemberId,
      rescheduleWriteMap
    );
    Object.keys(rescheduleWriteMap).forEach(function (id) {
      prospectiveById[id] = rescheduleWriteMap[id];
      const index = prospectiveRows.nodes.findIndex(function (item) { return cleanString_(item.NodeId) === id; });
      if (index >= 0) prospectiveRows.nodes[index] = rescheduleWriteMap[id];
    });
    const rollupWriteMap = {};
    const rollupIds = rollupParentStatuses_(prospectiveRows, [nodeId, parentId], actor.MemberId, rollupWriteMap);
    const combinedWriteMap = {};
    targets.forEach(function (row) { combinedWriteMap[cleanString_(row.NodeId)] = row; });
    Object.keys(rescheduleWriteMap).forEach(function (id) { combinedWriteMap[id] = rescheduleWriteMap[id]; });
    Object.keys(rollupWriteMap).forEach(function (id) { combinedWriteMap[id] = rollupWriteMap[id]; });
    writeObjects_(SHEET.NODES, Object.keys(combinedWriteMap).map(function (id) { return combinedWriteMap[id]; }));

    rows = readNodeSnapshot_();
    const active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
    const affectedIds = unique_(targetIds
      .concat(rescheduleResult.shiftedIds)
      .concat([parentId])
      .concat(rollupIds)
      .concat(ancestorIdsForMany_(targetIds.concat(rescheduleResult.shiftedIds), active)));
    return makeMutationPayload_(rows, affectedIds, requestId, {
      restoredNodeIds: targetIds,
      rescheduledCount: rescheduleResult.shiftedIds.length
    });
  });
}

function fitNodeToChildren(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const requestId = cleanString_(payload.requestId);
    let rows = readNodeSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const active = activeNodes_(rows.nodes);
    validateNodeTree_(active);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (!nodeBaseVersionMatches_(payload, node, actor, false)) {
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

    rows = readNodeSnapshot_();
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
    node.DraftOwner = '';
    node.DraftExpiresAt = '';
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
  if (patch.actualStartDate !== undefined || patch.actualEndDate !== undefined) {
    const actual = normalizeActualDates_(
      patch.actualStartDate !== undefined ? patch.actualStartDate : node.ActualStartDate,
      patch.actualEndDate !== undefined ? patch.actualEndDate : node.ActualEndDate
    );
    node.ActualStartDate = actual.startDate;
    node.ActualEndDate = actual.endDate;
  }
}

function nodeBaseVersionMatches_(payload, node, actor, allowOwnedDraft) {
  const hasBase = Object.prototype.hasOwnProperty.call(payload || {}, 'baseUpdatedAt') && payload.baseUpdatedAt !== undefined;
  const isOwnedDraft = allowOwnedDraft && cleanString_(node && node.DraftOwner) &&
    cleanString_(node.DraftOwner) === cleanString_(actor && actor.MemberId);
  if (!hasBase) {
    if (isOwnedDraft) return true;
    throw appError_('BASE_VERSION_REQUIRED', '更新元のバージョン情報がありません。同期後にもう一度保存してください。', false);
  }
  return cleanString_(payload.baseUpdatedAt) === cleanString_(node && node.UpdatedAt);
}

function rollupParentStatuses_(rows, seedIds, actorId, writeMap) {
  writeMap = writeMap || {};
  const active = activeNodes_(rows.nodes).filter(function (node) { return !cleanString_(node.DraftOwner); });
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
  const explicit = (statusColumns || []).filter(function (statusColumn) {
    return isTrue_(statusColumn.IsInProgressColumn);
  });
  if (explicit.length > 1) {
    throw appError_('STATUS_PROGRESS_INVARIANT', '進行中列の設定が複数あります。StatusColumnsを確認してください。', false);
  }
  if (explicit.length === 1) {
    return cleanString_(explicit[0].ColumnId);
  }
  const column = (statusColumns || []).find(function (statusColumn) {
    const name = cleanString_(statusColumn.Name).toLowerCase();
    return name === '進行中' || name.indexOf('進行中') !== -1 || name === 'doing' || name === 'in progress';
  });
  return column ? cleanString_(column.ColumnId) : '';
}

function appendNodeActivityLogs_(nodeId, change) {
  const now = nowIso_();
  const logs = [];
  if (change.statusChanged) {
    logs.push({
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
    logs.push({
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
  appendObjects_(SHEET.ACTIVITY_LOG, logs);
}

function hasExpiredDraftNodes_(nodes, nowMs) {
  const current = Number(nowMs) || Date.now();
  return (nodes || []).some(function (node) {
    if (cleanString_(node.DeletedAt) || !cleanString_(node.DraftOwner)) return false;
    const expiresAt = Date.parse(cleanString_(node.DraftExpiresAt));
    return Number.isFinite(expiresAt) && expiresAt <= current;
  });
}

function cleanupExpiredDraftNodes_(rows, nowMs) {
  const current = Number(nowMs) || Date.now();
  const active = activeNodes_(rows.nodes || []);
  validateNodeTree_(active);
  const nodesById = byId_(active, 'NodeId');
  const children = childrenMap_(active);
  const expiredRoots = active.filter(function (node) {
    if (!cleanString_(node.DraftOwner)) return false;
    const expiresAt = Date.parse(cleanString_(node.DraftExpiresAt));
    return Number.isFinite(expiresAt) && expiresAt <= current;
  });
  if (!expiredRoots.length) return [];

  const targetIds = unique_(expiredRoots.reduce(function (ids, node) {
    return ids.concat([cleanString_(node.NodeId)]).concat(collectDescendantIds_(cleanString_(node.NodeId), children));
  }, []));
  const timestamp = new Date(current).toISOString();
  const targets = targetIds.map(function (id) {
    const node = nodesById[id];
    if (!node) return null;
    const actorId = cleanString_(node.DraftOwner) || cleanString_(expiredRoots[0].DraftOwner);
    node.DeletedAt = timestamp;
    node.DeletedBy = actorId;
    node.UpdatedAt = timestamp;
    node.UpdatedBy = actorId;
    return node;
  }).filter(Boolean);
  const parentIds = unique_(targets.map(function (node) { return cleanString_(node.ParentId); }));
  const rollupWriteMap = {};
  rollupParentStatuses_(rows, parentIds, cleanString_(expiredRoots[0].DraftOwner), rollupWriteMap);
  writeObjects_(SHEET.NODES, targets.concat(Object.keys(rollupWriteMap).map(function (id) { return rollupWriteMap[id]; })));
  return targetIds;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    addNodes: addNodes,
    rollupParentStatuses_: rollupParentStatuses_,
    inProgressStatusColumnId_: inProgressStatusColumnId_,
    deleteNode: deleteNode,
    restoreNode: restoreNode,
    hasExpiredDraftNodes_: hasExpiredDraftNodes_,
    cleanupExpiredDraftNodes_: cleanupExpiredDraftNodes_,
    applyNodePatch_: applyNodePatch_,
    nodeBaseVersionMatches_: nodeBaseVersionMatches_
  };
}
