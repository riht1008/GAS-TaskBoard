/**
 * Member and comment APIs.
 */

function getComments(nodeId, options) {
  requireSchemaExists_();
  const rows = readCommentSnapshot_();
  const active = activeNodes_(rows.nodes);
  if (!byId_(active, 'NodeId')[cleanString_(nodeId)]) {
    throw new Error('ノードが見つかりません。');
  }
  const comments = rows.comments
    .filter(function (c) { return cleanString_(c.NodeId) === cleanString_(nodeId); })
    .sort(function (a, b) { return cleanString_(a.Timestamp).localeCompare(cleanString_(b.Timestamp)); })
    .map(clientComment_);
  if (!options || typeof options !== 'object') {
    return comments;
  }
  return commentPage_(comments, options);
}

function commentPage_(comments, options) {
  const limit = Math.min(100, Math.max(10, Number(options.limit) || 50));
  const beforeTimestamp = cleanString_(options.beforeTimestamp);
  const beforeId = cleanString_(options.beforeId);
  const repliesByParent = {};
  const parents = [];
  (comments || []).forEach(function (comment) {
    const parentId = cleanString_(comment.parentCommentId);
    if (parentId) {
      if (!repliesByParent[parentId]) repliesByParent[parentId] = [];
      repliesByParent[parentId].push(comment);
    } else {
      const timestamp = cleanString_(comment.timestamp);
      const id = cleanString_(comment.id);
      if (!beforeTimestamp || timestamp < beforeTimestamp || (timestamp === beforeTimestamp && id < beforeId)) {
        parents.push(comment);
      }
    }
  });
  parents.sort(function (a, b) {
    return cleanString_(b.timestamp).localeCompare(cleanString_(a.timestamp)) || cleanString_(b.id).localeCompare(cleanString_(a.id));
  });
  const selected = parents.slice(0, limit).reverse();
  const pageComments = [];
  selected.forEach(function (parent) {
    pageComments.push(parent);
    (repliesByParent[cleanString_(parent.id)] || []).forEach(function (reply) { pageComments.push(reply); });
  });
  const oldest = selected[0] || null;
  return {
    ok: true,
    comments: pageComments,
    hasMore: parents.length > selected.length,
    nextCursor: oldest ? {
      beforeTimestamp: cleanString_(oldest.timestamp),
      beforeId: cleanString_(oldest.id)
    } : null
  };
}

function addComment(payload) {
  payload = payload || {};
  let mentionNotification = null;
  const result = withLock_(function () {
    requireSchemaExists_();
    const rows = readCommentSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const activeMap = byId_(activeNodes_(rows.nodes), 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    if (!activeMap[nodeId]) {
      throw new Error('ノードが見つかりません。');
    }
    const text = cleanString_(payload.text);
    if (!text) {
      throw new Error('コメント本文を入力してください。');
    }
    if (text.length > 4000) {
      throw new Error('コメントは4000文字以内で入力してください。');
    }
    const commentId = cleanString_(payload.commentId || payload.clientCommentId);
    const duplicate = rows.comments.some(function (c) { return cleanString_(c.CommentId) === commentId; });
    if (commentId && duplicate) {
      throw new Error('同じIDのコメントが既に存在します。');
    }
    const parentCommentId = cleanString_(payload.parentCommentId);
    if (parentCommentId) {
      const parent = rows.comments.find(function (c) { return cleanString_(c.CommentId) === parentCommentId; });
      if (!parent || cleanString_(parent.NodeId) !== nodeId) {
        throw new Error('返信先コメントが見つかりません。');
      }
      if (cleanString_(parent.ParentCommentId)) {
        throw new Error('返信は親コメントにのみ追加できます。');
      }
    }
    const memberSet = {};
    rows.members.forEach(function (m) { memberSet[cleanString_(m.MemberId)] = true; });
    const mentions = unique_(Array.isArray(payload.mentions) ? payload.mentions.map(cleanString_) : splitCsv_(payload.mentions))
      .filter(function (id) { return !!memberSet[id]; });
    const comment = {
      CommentId: commentId || newId_(),
      NodeId: nodeId,
      AuthorId: actor.MemberId,
      AuthorName: actor.Name,
      Timestamp: nowIso_(),
      Text: text,
      ParentCommentId: parentCommentId,
      Mentions: mentions.join(',')
    };
    appendObject_(SHEET.COMMENTS, comment);
    if (mentions.length) {
      try {
        const mentionedSet = {};
        mentions.forEach(function (id) { mentionedSet[id] = true; });
        const mentionedMembers = rows.members.filter(function (member) { return !!mentionedSet[cleanString_(member.MemberId)]; });
        mentionNotification = buildMentionNotification_(activeMap[nodeId], comment, actor, mentionedMembers, rows);
      } catch (error) {
        mentionNotification = null;
      }
    }
    const nodeCommentCount = rows.comments.filter(function (item) { return cleanString_(item.NodeId) === nodeId; }).length + 1;
    const counts = {};
    counts[nodeId] = nodeCommentCount;
    return { ok: true, comment: clientComment_(comment), nodeId: nodeId, commentCounts: counts };
  });
  if (mentionNotification) {
    postToSlack_(mentionNotification, { type: 'mention' });
    attachPublicSlackSettings_(result);
  }
  return result;
}

function joinAsMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const email = getCurrentEmail_();
    if (!email) {
      throw new Error('ログインユーザーのメールアドレスを取得できません。Workspace ドメイン内のアカウントで開いてください。');
    }
    const rows = readMemberSnapshot_();
    const existing = rows.members.find(function (m) { return normalizeEmail_(m.Email) === email; });
    if (existing) {
      return {
        ok: true,
        members: rows.members.map(clientMember_),
        currentMember: clientMember_(existing)
      };
    }

    const name = requireName_(payload.name || email.split('@')[0]);
    const color = normalizeColor_(payload.color) || '#1E6F5C';
    let memberId = cleanString_(payload.clientMemberId);
    const duplicateId = memberId && rows.members.some(function (m) { return cleanString_(m.MemberId) === memberId; });
    if (!memberId || duplicateId) {
      memberId = newId_();
    }
    appendObject_(SHEET.MEMBERS, {
      MemberId: memberId,
      Name: name,
      Email: email,
      Color: color,
      Company: cleanString_(payload.company)
    });
    const freshMembers = readMemberSnapshot_().members;
    const currentMember = freshMembers.find(function (m) { return normalizeEmail_(m.Email) === email; });
    return {
      ok: true,
      members: freshMembers.map(clientMember_),
      currentMember: currentMember ? clientMember_(currentMember) : null
    };
  });
}

function upsertMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readMemberSnapshot_();
    requireCurrentMember_(rows.members);
    const memberId = cleanString_(payload.memberId);
    const email = normalizeEmail_(payload.email);
    const name = requireName_(payload.name);
    const color = normalizeColor_(payload.color) || '#1E6F5C';
    const company = cleanString_(payload.company);
    const duplicate = rows.members.find(function (m) {
      return normalizeEmail_(m.Email) === email && cleanString_(m.MemberId) !== memberId;
    });
    if (duplicate) {
      throw new Error('同じメールアドレスのメンバーが既に存在します。');
    }

    if (memberId) {
      const member = rows.members.find(function (m) { return cleanString_(m.MemberId) === memberId; });
      if (!member) {
        throw new Error('メンバーが見つかりません。');
      }
      member.Name = name;
      member.Email = email;
      member.Color = color;
      member.Company = company;
      writeObject_(SHEET.MEMBERS, member);
    } else {
      const newMemberId = cleanString_(payload.clientMemberId);
      const duplicateId = rows.members.some(function (m) { return cleanString_(m.MemberId) === newMemberId; });
      if (newMemberId && duplicateId) {
        throw new Error('同じIDのメンバーが既に存在します。');
      }
      appendObject_(SHEET.MEMBERS, {
        MemberId: newMemberId || newId_(),
        Name: name,
        Email: email,
        Color: color,
        Company: company
      });
    }
    return { ok: true, members: readMemberSnapshot_().members.map(clientMember_) };
  });
}

function deleteMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const rows = readMemberSnapshot_();
    const actor = requireCurrentMember_(rows.members);
    const memberId = cleanString_(payload.memberId);
    const member = rows.members.find(function (m) { return cleanString_(m.MemberId) === memberId; });
    if (!member) {
      throw new Error('メンバーが見つかりません。');
    }
    if (rows.members.length <= 1) {
      throw new Error('最後の1人のメンバーは削除できません。');
    }
    if (memberId === actor.MemberId && payload.confirmSelf !== true) {
      throw new Error('自分自身を削除するには再確認が必要です。');
    }

    const affected = [];
    activeNodes_(rows.nodes).forEach(function (node) {
      const ids = splitCsv_(node.AssigneeIds);
      if (ids.indexOf(memberId) !== -1) {
        node.AssigneeIds = ids.filter(function (id) { return id !== memberId; }).join(',');
        node.UpdatedAt = nowIso_();
        node.UpdatedBy = actor.MemberId;
        affected.push(node);
      }
    });
    writeObjects_(SHEET.NODES, affected);
    deleteRow_(SHEET.MEMBERS, member.__row);

    const freshRows = readMemberSnapshot_();
    return {
      ok: true,
      members: freshRows.members.map(clientMember_),
      affectedNodeCount: affected.length,
      nodes: clientNodesByIds_(freshRows, affected.map(function (n) { return n.NodeId; }))
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    addComment: addComment,
    commentPage_: commentPage_
  };
}
