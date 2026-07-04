/**
 * Dependency APIs and cascade rescheduling.
 */

function addDependency(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    let rows = readAll_();
    let active = activeNodes_(rows.nodes);
    let nodesById = byId_(active, 'NodeId');
    const predecessorId = cleanString_(payload.predecessorId);
    const successorId = cleanString_(payload.successorId);
    validateDependency_(predecessorId, successorId, active, rows.dependencies);

    const dependencyId = cleanString_(payload.dependencyId || payload.clientDependencyId);
    const duplicateId = rows.dependencies.some(function (dep) { return cleanString_(dep.DependencyId) === dependencyId; });
    if (dependencyId && duplicateId) {
      throw new Error('同じIDの依存関係が既に存在します。');
    }
    appendObject_(SHEET.DEPENDENCIES, {
      DependencyId: dependencyId || newId_(),
      PredecessorNodeId: predecessorId,
      SuccessorNodeId: successorId
    });

    rows = readAll_();
    active = activeNodes_(rows.nodes);
    nodesById = byId_(active, 'NodeId');
    const writeMap = {};
    const rescheduleResult = rescheduleFromSeeds_([successorId], active, visibleDependencies_(rows.dependencies, nodesById), actor.MemberId, writeMap);
    writeObjects_(SHEET.NODES, Object.keys(writeMap).map(function (id) { return writeMap[id]; }));

    rows = readAll_();
    const writeIds = Object.keys(writeMap);
    const affectedIds = unique_(writeIds.concat(ancestorIdsForMany_(writeIds, activeNodes_(rows.nodes))));
    return makeMutationPayload_(rows, affectedIds, requestId, {
      dependencies: clientDependencies_(rows),
      rescheduledCount: rescheduleResult.shiftedIds.length
    });
  });
}

function deleteDependency(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const dependencyId = cleanString_(payload.dependencyId);
    const dep = rows.dependencies.find(function (d) { return cleanString_(d.DependencyId) === dependencyId; });
    if (!dep) {
      throw new Error('依存関係が見つかりません。');
    }
    deleteRow_(SHEET.DEPENDENCIES, dep.__row);
    return {
      ok: true,
      requestId: cleanString_(payload.requestId),
      dependencies: clientDependencies_(readAll_())
    };
  });
}

function rescheduleFromSeeds_(seedIds, activeNodes, dependencies, actorMemberId, writeMap) {
  const nodesById = byId_(activeNodes, 'NodeId');
  const affectedSet = {};
  const stack = seedIds.slice();
  while (stack.length) {
    const id = stack.pop();
    if (affectedSet[id]) {
      continue;
    }
    affectedSet[id] = true;
    dependencies.forEach(function (dep) {
      if (cleanString_(dep.PredecessorNodeId) === id) {
        stack.push(cleanString_(dep.SuccessorNodeId));
      }
    });
  }

  const affectedIds = Object.keys(affectedSet).filter(function (id) { return !!nodesById[id]; });
  const order = topoSortSubset_(affectedIds, dependencies);
  const shiftedIds = [];
  order.forEach(function (id) {
    const node = writeMap[id] || nodesById[id];
    if (!node || !hasSchedule_(node)) {
      return;
    }
    const predecessors = dependencies
      .filter(function (dep) { return cleanString_(dep.SuccessorNodeId) === id; })
      .map(function (dep) { return cleanString_(dep.PredecessorNodeId); })
      .filter(function (predId) { return !!nodesById[predId]; });
    if (!predecessors.length) {
      return;
    }

    let maxEndDay = null;
    predecessors.forEach(function (predId) {
      const pred = writeMap[predId] || nodesById[predId];
      if (hasSchedule_(pred)) {
        const day = dateToDay_(pred.EndDate);
        maxEndDay = maxEndDay === null ? day : Math.max(maxEndDay, day);
      }
    });
    if (maxEndDay === null) {
      return;
    }

    const startDay = dateToDay_(node.StartDate);
    if (startDay < maxEndDay) {
      const delta = maxEndDay - startDay;
      const updated = cloneRow_(node);
      updated.StartDate = shiftDate_(updated.StartDate, delta);
      updated.EndDate = shiftDate_(updated.EndDate, delta);
      updated.UpdatedAt = nowIso_();
      updated.UpdatedBy = actorMemberId;
      writeMap[id] = updated;
      shiftedIds.push(id);
    }
  });
  return { affectedIds: affectedIds, shiftedIds: shiftedIds };
}

function topoSortSubset_(ids, dependencies) {
  const set = {};
  ids.forEach(function (id) { set[id] = true; });
  const indegree = {};
  const outgoing = {};
  ids.forEach(function (id) {
    indegree[id] = 0;
    outgoing[id] = [];
  });
  dependencies.forEach(function (dep) {
    const from = cleanString_(dep.PredecessorNodeId);
    const to = cleanString_(dep.SuccessorNodeId);
    if (set[from] && set[to]) {
      outgoing[from].push(to);
      indegree[to] += 1;
    }
  });
  const queue = ids.filter(function (id) { return indegree[id] === 0; });
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    outgoing[id].forEach(function (to) {
      indegree[to] -= 1;
      if (indegree[to] === 0) {
        queue.push(to);
      }
    });
  }
  if (order.length !== ids.length) {
    throw new Error('依存関係に循環があるためリスケジュールできません。');
  }
  return order;
}

function validateDependency_(predecessorId, successorId, activeNodes, dependencies) {
  if (!predecessorId || !successorId) {
    throw new Error('先行タスクと後続タスクを選択してください。');
  }
  if (predecessorId === successorId) {
    throw new Error('自己参照の依存関係は作成できません。');
  }
  const nodesById = byId_(activeNodes, 'NodeId');
  const predecessor = nodesById[predecessorId];
  const successor = nodesById[successorId];
  if (!predecessor || !successor) {
    throw new Error('対象ノードが見つかりません。');
  }
  const children = childrenMap_(activeNodes);
  if ((children[predecessorId] || []).length || (children[successorId] || []).length) {
    throw new Error('依存関係は末端ノード同士にのみ設定できます。');
  }
  if (!hasSchedule_(predecessor) || !hasSchedule_(successor)) {
    throw new Error('日付未設定のノードには依存関係を設定できません。');
  }
  const visibleDeps = visibleDependencies_(dependencies, nodesById);
  const duplicate = visibleDeps.some(function (dep) {
    return cleanString_(dep.PredecessorNodeId) === predecessorId && cleanString_(dep.SuccessorNodeId) === successorId;
  });
  if (duplicate) {
    throw new Error('同じ依存関係が既に存在します。');
  }
  const testDeps = visibleDeps.concat([{
    DependencyId: '__new__',
    PredecessorNodeId: predecessorId,
    SuccessorNodeId: successorId
  }]);
  topoSortSubset_(Object.keys(nodesById), testDeps);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    rescheduleFromSeeds_: rescheduleFromSeeds_,
    topoSortSubset_: topoSortSubset_,
    validateDependency_: validateDependency_
  };
}
