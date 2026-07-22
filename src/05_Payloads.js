/**
 * Response payload builders, serializers, and derived values.
 */

function makeFullPayload_(rows) {
  const active = activeNodes_(rows.nodes);
  const root = active.find(function (n) { return !cleanString_(n.ParentId); }) || active[0];
  const currentEmail = getCurrentEmail_();
  const currentMember = rows.members.find(function (m) { return normalizeEmail_(m.Email) === currentEmail; });
  return {
    ok: true,
    setupRequired: false,
    version: APP_VERSION,
    spreadsheetId: SpreadsheetApp.getActive().getId(),
    currentEmail: currentEmail,
    currentMember: currentMember ? clientMember_(currentMember) : null,
    rootId: root ? root.NodeId : '',
    nodes: clientNodes_(rows, active.map(function (n) { return n.NodeId; })),
    members: rows.members.map(clientMember_),
    statusColumns: clientStatusColumns_(rows.statusColumns),
    dependencies: clientDependencies_(rows),
    milestones: rows.milestones.map(clientMilestone_).sort(compareSortOrder_),
    meetings: rows.meetings.map(clientMeeting_).sort(compareSortOrder_),
    calendarOverrides: clientCalendarOverrides_(rows.calendarOverrides),
    slackSettings: publicSlackSettings_(),
    commentCounts: commentCounts_(rows),
    notificationUnreadCount: currentMember ? unreadMentionCountForMember_(currentMember.MemberId, active) : 0,
    unregistered: !currentMember
  };
}

function makeMutationPayload_(rows, affectedIds, requestId, extra) {
  extra = extra || {};
  const payload = {
    ok: true,
    requestId: requestId || '',
    nodes: clientNodes_(rows, affectedIds || [])
  };
  if (sheetWasLoaded_(rows, SHEET.COMMENTS)) {
    payload.commentCounts = commentCounts_(rows);
  }
  Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
  return payload;
}

function makeConflictPayload_(rows, nodeId, requestId) {
  const affected = unique_([nodeId].concat(ancestorIds_(nodeId, activeNodes_(rows.nodes))));
  return {
    ok: false,
    code: 'CONFLICT',
    message: '他のユーザーがこのノードを更新しました。入力内容は保持しています。もう一度保存すると現在の内容で上書きします。',
    requestId: requestId || '',
    nodeId: nodeId,
    nodes: clientNodes_(rows, affected)
  };
}

function clientNodes_(rows, ids) {
  const active = payloadVisibleNodes_(rows);
  const idSet = {};
  (ids || []).forEach(function (id) { if (id) idSet[id] = true; });
  const derived = computeDerived_(active, rows.statusColumns);
  const activityActuals = clientActivityActuals_(rows, derived);
  return active
    .filter(function (node) { return idSet[node.NodeId]; })
    .map(function (node) {
      return clientNode_(node, derived[node.NodeId], activityActuals ? activityActuals[node.NodeId] : undefined);
    });
}

function clientNodesByIds_(rows, ids) {
  return clientNodes_(rows, ids || []);
}

function clientNode_(node, derived, activityActual) {
  derived = derived || {};
  const result = {
    id: cleanString_(node.NodeId),
    parentId: cleanString_(node.ParentId),
    name: cleanString_(node.Name),
    statusColumnId: cleanString_(node.StatusColumnId),
    assigneeIds: splitCsv_(node.AssigneeIds),
    priority: normalizePriority_(node.Priority),
    startDate: cleanString_(node.StartDate),
    endDate: cleanString_(node.EndDate),
    actualStartDate: cleanString_(node.ActualStartDate),
    actualEndDate: cleanString_(node.ActualEndDate),
    description: cleanString_(node.Description),
    deliverable: cleanString_(node.Deliverable),
    note: cleanString_(node.Note),
    manualProgress: validManualProgress_(node.Progress),
    includeInWbs: normalizeIncludeInWbs_(node.IncludeInWbs),
    sortOrder: Number(node.SortOrder) || 0,
    createdAt: cleanString_(node.CreatedAt),
    updatedAt: cleanString_(node.UpdatedAt),
    updatedBy: cleanString_(node.UpdatedBy),
    progress: derived.progress || 0,
    displayStartDate: derived.displayStartDate || '',
    displayEndDate: derived.displayEndDate || '',
    hasChildren: !!derived.hasChildren,
    isLeaf: !derived.hasChildren,
    isDraft: !!cleanString_(node.DraftOwner),
    draftOwner: cleanString_(node.DraftOwner),
    draftExpiresAt: cleanString_(node.DraftExpiresAt)
  };
  if (activityActual !== undefined) {
    result.inferredActualStartDate = cleanString_(activityActual && activityActual.startDate);
    result.inferredActualEndDate = cleanString_(activityActual && activityActual.endDate);
  }
  return result;
}

function clientActivityActuals_(rows, derived) {
  if (!sheetWasLoaded_(rows, SHEET.ACTIVITY_LOG)) return null;
  const grouped = {};
  (rows.activityLog || []).forEach(function (log) {
    const nodeId = cleanString_(log.NodeId);
    if (!nodeId) return;
    if (!grouped[nodeId]) grouped[nodeId] = [];
    grouped[nodeId].push(log);
  });
  const result = {};
  Object.keys(derived || {}).forEach(function (nodeId) {
    const logs = (grouped[nodeId] || []).slice().sort(function (a, b) {
      return cleanString_(a.ChangedAt).localeCompare(cleanString_(b.ChangedAt));
    });
    const starts = [];
    let endDate = '';
    logs.forEach(function (log) {
      const changedAt = cleanString_(log.ChangedAt);
      const parsed = changedAt ? new Date(changedAt) : null;
      const changedDate = parsed && !Number.isNaN(parsed.getTime()) ? formatDateOnlyCell_(parsed) : '';
      if (!changedDate) return;
      const field = cleanString_(log.Field);
      if (field === 'status' || (field === 'progress' && Number(log.NewValue) > 0)) {
        starts.push(changedDate);
      }
      if (Number(derived[nodeId] && derived[nodeId].progress) === 100 && isTrue_(log.NewValueIsDone)) {
        endDate = changedDate;
      }
    });
    result[nodeId] = {
      startDate: starts.length ? starts.sort()[0] : '',
      endDate: endDate
    };
  });
  return result;
}

function clientMember_(member) {
  return {
    id: cleanString_(member.MemberId),
    name: cleanString_(member.Name),
    email: normalizeEmail_(member.Email),
    color: normalizeColor_(member.Color) || '#1E6F5C',
    company: cleanString_(member.Company),
    slackUserId: cleanString_(member.SlackUserId)
  };
}

function clientStatusColumn_(column) {
  return {
    id: cleanString_(column.ColumnId),
    name: cleanString_(column.Name),
    sortOrder: Number(column.SortOrder) || 0,
    isDoneColumn: isTrue_(column.IsDoneColumn),
    isInProgressColumn: isTrue_(column.IsInProgressColumn),
    color: normalizeStatusColor_(column.Color, column.Name, isTrue_(column.IsDoneColumn))
  };
}

function clientStatusColumns_(columns) {
  const inProgressColumnId = inProgressStatusColumnId_(columns || []);
  return (columns || []).map(function (column) {
    const result = clientStatusColumn_(column);
    result.isInProgressColumn = cleanString_(column.ColumnId) === inProgressColumnId;
    return result;
  }).sort(compareSortOrder_);
}

function clientDependencies_(rows) {
  const activeMap = byId_(payloadVisibleNodes_(rows), 'NodeId');
  return rows.dependencies
    .filter(function (dep) {
      return activeMap[cleanString_(dep.PredecessorNodeId)] && activeMap[cleanString_(dep.SuccessorNodeId)];
    })
    .map(function (dep) {
      return {
        id: cleanString_(dep.DependencyId),
        predecessorId: cleanString_(dep.PredecessorNodeId),
        successorId: cleanString_(dep.SuccessorNodeId)
      };
    });
}

function clientMilestone_(milestone) {
  return {
    id: cleanString_(milestone.MilestoneId),
    name: cleanString_(milestone.Name),
    date: cleanString_(milestone.Date),
    note: cleanString_(milestone.Note),
    sortOrder: Number(milestone.SortOrder) || 0
  };
}

function clientMeeting_(meeting) {
  return {
    id: cleanString_(meeting.MeetingId),
    name: cleanString_(meeting.Name),
    schedule: cleanString_(meeting.Schedule),
    scheduleRule: clientMeetingScheduleRule_(meeting),
    startDate: cleanString_(meeting.StartDate),
    endDate: cleanString_(meeting.EndDate),
    note: cleanString_(meeting.Note),
    sortOrder: Number(meeting.SortOrder) || 0
  };
}

function clientCalendarOverride_(override) {
  return {
    date: cleanString_(override.Date),
    dayType: cleanString_(override.DayType),
    name: cleanString_(override.Name)
  };
}

function clientCalendarOverrides_(overrides) {
  const seen = {};
  const result = (overrides || []).map(function (override) {
    const item = clientCalendarOverride_(override);
    if (!isValidDate_(item.date)) {
      throw new Error('CalendarOverrides シートに不正な日付があります。');
    }
    if (item.dayType !== 'working' && item.dayType !== 'holiday') {
      throw new Error('CalendarOverrides シートの DayType は working または holiday にしてください。');
    }
    if (seen[item.date]) {
      throw new Error('CalendarOverrides シートに同じ日付が複数あります。');
    }
    seen[item.date] = true;
    return item;
  });
  return result.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
}

function clientMeetingScheduleRule_(meeting) {
  const text = cleanString_(meeting.ScheduleRuleJson);
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function clientComment_(comment) {
  return {
    id: cleanString_(comment.CommentId),
    nodeId: cleanString_(comment.NodeId),
    authorId: cleanString_(comment.AuthorId),
    authorName: cleanString_(comment.AuthorName),
    timestamp: cleanString_(comment.Timestamp),
    text: cleanString_(comment.Text),
    parentCommentId: cleanString_(comment.ParentCommentId),
    mentions: splitCsv_(comment.Mentions)
  };
}

function computeDerived_(activeNodes, statusColumns) {
  const children = childrenMap_(activeNodes);
  const nodesById = byId_(activeNodes, 'NodeId');
  const doneColumnId = doneStatusColumnId_(statusColumns);
  const progressMemo = {};
  const boundsMemo = {};

  function progressOf(id) {
    if (progressMemo[id] !== undefined) {
      return progressMemo[id];
    }
    const childIds = children[id] || [];
    const node = nodesById[id];
    if (!node) {
      return 0;
    }
    if (!childIds.length) {
      progressMemo[id] = effectiveLeafProgress_(node, doneColumnId);
      return progressMemo[id];
    }
    const sum = childIds.reduce(function (acc, childId) { return acc + progressOf(childId); }, 0);
    progressMemo[id] = Math.round((sum / childIds.length) * 10) / 10;
    return progressMemo[id];
  }

  function boundsOf(id) {
    if (boundsMemo[id]) {
      return boundsMemo[id];
    }
    const node = nodesById[id];
    const starts = [];
    const ends = [];
    if (node && hasSchedule_(node)) {
      starts.push(node.StartDate);
      ends.push(node.EndDate);
    }
    (children[id] || []).forEach(function (childId) {
      const b = boundsOf(childId);
      if (b.startDate && b.endDate) {
        starts.push(b.startDate);
        ends.push(b.endDate);
      }
    });
    if (!starts.length) {
      boundsMemo[id] = { startDate: '', endDate: '' };
      return boundsMemo[id];
    }
    boundsMemo[id] = {
      startDate: starts.sort()[0],
      endDate: ends.sort()[ends.length - 1]
    };
    return boundsMemo[id];
  }

  const derived = {};
  activeNodes.forEach(function (node) {
    const b = boundsOf(node.NodeId);
    derived[node.NodeId] = {
      hasChildren: (children[node.NodeId] || []).length > 0,
      progress: progressOf(node.NodeId),
      displayStartDate: b.startDate,
      displayEndDate: b.endDate
    };
  });
  return derived;
}

function descendantOwnScheduleBounds_(nodeId, activeNodes) {
  const descendants = collectDescendantIds_(nodeId, childrenMap_(activeNodes));
  const scheduled = descendants.map(function (id) {
    return activeNodes.find(function (n) { return n.NodeId === id; });
  }).filter(hasSchedule_);
  if (!scheduled.length) {
    return { startDate: '', endDate: '' };
  }
  const starts = scheduled.map(function (n) { return n.StartDate; }).sort();
  const ends = scheduled.map(function (n) { return n.EndDate; }).sort();
  return { startDate: starts[0], endDate: ends[ends.length - 1] };
}

function commentCounts_(rows) {
  const activeMap = byId_(payloadVisibleNodes_(rows), 'NodeId');
  const counts = {};
  if (rows.commentCounts && typeof rows.commentCounts === 'object') {
    Object.keys(rows.commentCounts).forEach(function (nodeId) {
      if (activeMap[nodeId]) counts[nodeId] = Number(rows.commentCounts[nodeId]) || 0;
    });
    return counts;
  }
  rows.comments.forEach(function (comment) {
    const nodeId = cleanString_(comment.NodeId);
    if (activeMap[nodeId]) {
      counts[nodeId] = (counts[nodeId] || 0) + 1;
    }
  });
  return counts;
}

function payloadVisibleNodes_(rows) {
  const active = activeNodes_(rows.nodes || []);
  const currentEmail = getCurrentEmail_();
  const currentMember = (rows.members || []).find(function (member) {
    return normalizeEmail_(member.Email) === currentEmail;
  });
  const currentMemberId = currentMember ? cleanString_(currentMember.MemberId) : '';
  return active.filter(function (node) {
    const draftOwner = cleanString_(node.DraftOwner);
    return !draftOwner || (currentMemberId && draftOwner === currentMemberId);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeDerived_: computeDerived_,
    clientActivityActuals_: clientActivityActuals_
  };
}
