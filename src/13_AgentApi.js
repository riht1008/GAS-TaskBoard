/**
 * Read-only, machine-oriented API for CLI and MCP clients.
 *
 * Mutations intentionally continue to use addNode, saveNode, and addComment so
 * every caller shares the same identity, locking, conflict, rollup, cascade,
 * activity-log, and notification behavior as the web client.
 */

function agentGetContext(payload) {
  payload = payload || {};
  const result = loadAll();
  if (result.setupRequired) {
    return result;
  }

  const query = cleanString_(payload.query).toLowerCase();
  const nodeIds = agentStringSet_(payload.nodeIds);
  const statusColumnIds = agentStringSet_(payload.statusColumnIds);
  const assigneeIds = agentStringSet_(payload.assigneeIds);
  const hasNodeIds = Object.keys(nodeIds).length > 0;
  const hasStatuses = Object.keys(statusColumnIds).length > 0;
  const hasAssignees = Object.keys(assigneeIds).length > 0;
  const leafOnly = payload.leafOnly === true;
  const limit = agentContextLimit_(payload.limit);
  const nodes = (result.nodes || []).filter(function (node) {
    if (hasNodeIds && !nodeIds[cleanString_(node.id)]) return false;
    if (leafOnly && !node.isLeaf) return false;
    if (query) {
      const haystack = [node.name, node.description, node.deliverable, node.note]
        .map(cleanString_)
        .join('\n')
        .toLowerCase();
      if (haystack.indexOf(query) === -1) return false;
    }
    if (hasStatuses && !statusColumnIds[cleanString_(node.statusColumnId)]) {
      return false;
    }
    if (hasAssignees) {
      const matchesAssignee = (node.assigneeIds || []).some(function (id) {
        return !!assigneeIds[cleanString_(id)];
      });
      if (!matchesAssignee) return false;
    }
    return true;
  });

  return {
    ok: true,
    version: result.version,
    spreadsheetId: result.spreadsheetId,
    currentEmail: result.currentEmail,
    currentMember: result.currentMember,
    rootId: result.rootId,
    unregistered: result.unregistered,
    nodes: nodes.slice(0, limit),
    totalMatchedNodes: nodes.length,
    truncated: nodes.length > limit,
    members: result.members || [],
    statusColumns: result.statusColumns || [],
    dependencies: result.dependencies || []
  };
}

function agentStringSet_(value) {
  const values = Array.isArray(value) ? value : splitCsv_(value);
  return values.reduce(function (set, item) {
    const id = cleanString_(item);
    if (id) set[id] = true;
    return set;
  }, {});
}

function agentContextLimit_(value) {
  if (value === undefined || value === null || value === '') return 200;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 500) {
    throw new Error('取得件数は1〜500の整数で指定してください。');
  }
  return numeric;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    agentGetContext: agentGetContext,
    agentContextLimit_: agentContextLimit_
  };
}
