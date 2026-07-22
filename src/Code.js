/**
 * @OnlyCurrentDoc
 *
 * GAS task management app web entrypoints.
 * The spreadsheet is the source of truth; derived values are always calculated
 * at read/write time and are never persisted.
 */

function doGet(e) {
  e = e || {};
  const parameters = e.parameter || {};
  const template = HtmlService.createTemplateFromFile('Index');
  template.bootstrapEmail = getCurrentEmail_();
  template.bootstrapNodeId = safeBootstrapId_(parameters.node);
  template.bootstrapCommentId = safeBootstrapId_(parameters.comment);
  return template.evaluate().setTitle('タスク管理');
}

function safeBootstrapId_(value) {
  const id = cleanString_(value);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) ? id : '';
}

function include(filename) {
  // Client*.html and Styles.html are fragments injected into <script>/<style>.
  // Reading them as standalone HtmlOutput makes GAS validate JS template
  // literals such as `<aside ...>` as real HTML and reject otherwise valid code.
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

function loadAll() {
  ensureSchema_();
  let rows = readAll_({ includeCommentCounts: true });
  if (hasExpiredDraftNodes_(rows.nodes)) {
    rows = withLock_(function () {
      const freshRows = readAll_({ includeCommentCounts: true });
      cleanupExpiredDraftNodes_(freshRows);
      return readAll_({ includeCommentCounts: true });
    });
  }
  const activeNodes = activeNodes_(rows.nodes);
  const setupRequired = rows.nodes.length === 0;
  if (setupRequired) {
    return {
      ok: true,
      setupRequired: true,
      setupIncomplete: rows.members.length > 0 || rows.statusColumns.length > 0,
      currentEmail: getCurrentEmail_(),
      spreadsheetId: SpreadsheetApp.getActive().getId(),
      version: APP_VERSION
    };
  }
  if (activeNodes.length === 0 || rows.members.length === 0 || rows.statusColumns.length === 0) {
    throw new Error('初期データが不完全です。Nodes / Members / StatusColumns を確認してください。');
  }
  validateNodeTree_(activeNodes);
  assertExactlyOneDone_(rows.statusColumns);
  validateDependencySet_(activeNodes, rows.dependencies);
  return makeFullPayload_(rows);
}

function setupProject(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const rows = readAll_();
    if (rows.nodes.length) {
      throw new Error('初回セットアップはルートノードが未作成の案件でのみ実行できます。');
    }

    const email = getCurrentEmail_();
    if (!email) {
      throw new Error('ログインユーザーのメールアドレスを取得できません。Workspace ドメイン内のアカウントで開いてください。');
    }

    const now = nowIso_();
    let member = rows.members.find(function (item) { return normalizeEmail_(item.Email) === email; });
    const memberId = member ? cleanString_(member.MemberId) : newId_();
    const memberName = cleanString_(payload.memberName) || email.split('@')[0];
    const memberColor = normalizeColor_(payload.color) || '#1E6F5C';
    const rootId = newId_();
    const projectName = cleanString_(payload.projectName) || '新規案件';

    if (!member) {
      member = appendObject_(SHEET.MEMBERS, {
        MemberId: memberId,
        Name: memberName,
        Email: email,
        Color: memberColor,
        Company: '',
        SlackUserId: ''
      });
      rows.members.push(member);
    }

    const defaultStatuses = [
      { Name: '未着手', SortOrder: 1000, IsDoneColumn: false, IsInProgressColumn: false, Color: '#DCE5DE' },
      { Name: '進行中', SortOrder: 2000, IsDoneColumn: false, IsInProgressColumn: true, Color: '#CFE0F5' },
      { Name: '完了', SortOrder: 3000, IsDoneColumn: true, IsInProgressColumn: false, Color: '#CFE8DE' }
    ];
    const missingStatuses = defaultStatuses.filter(function (seed) {
      return !rows.statusColumns.some(function (column) { return cleanString_(column.Name) === seed.Name; });
    }).map(function (seed) {
      return {
        ColumnId: newId_(),
        Name: seed.Name,
        SortOrder: seed.SortOrder,
        IsDoneColumn: false,
        Color: seed.Color,
        IsInProgressColumn: seed.IsInProgressColumn
      };
    });
    rows.statusColumns = rows.statusColumns.concat(appendObjects_(SHEET.STATUS_COLUMNS, missingStatuses));
    const doneColumn = rows.statusColumns.find(function (column) { return cleanString_(column.Name) === '完了'; });
    if (!doneColumn) {
      throw new Error('初期完了列を作成できませんでした。');
    }
    rows.statusColumns.forEach(function (column) {
      column.IsDoneColumn = cleanString_(column.ColumnId) === cleanString_(doneColumn.ColumnId);
    });
    const inProgressColumn = rows.statusColumns.find(function (column) { return cleanString_(column.Name) === '進行中'; });
    rows.statusColumns.forEach(function (column) {
      column.IsInProgressColumn = !!inProgressColumn && cleanString_(column.ColumnId) === cleanString_(inProgressColumn.ColumnId);
    });
    writeObjects_(SHEET.STATUS_COLUMNS, rows.statusColumns);
    const todoColumn = rows.statusColumns.find(function (column) { return cleanString_(column.Name) === '未着手'; }) || sortByOrder_(rows.statusColumns)[0];

    appendObject_(SHEET.NODES, {
      NodeId: rootId,
      ParentId: '',
      Name: projectName,
      StatusColumnId: todoColumn.ColumnId,
      AssigneeIds: memberId,
      Priority: 'Mid',
      StartDate: '',
      EndDate: '',
      Description: '',
      SortOrder: 1000,
      CreatedAt: now,
      UpdatedAt: now,
      UpdatedBy: memberId,
      DeletedAt: '',
      DeletedBy: '',
      Deliverable: '',
      Note: '',
      Progress: '',
      IncludeInWbs: true,
      DraftOwner: '',
      DraftExpiresAt: '',
      ActualStartDate: '',
      ActualEndDate: ''
    });

    const completedRows = readAll_({ includeCommentCounts: true });
    assertExactlyOneDone_(completedRows.statusColumns);
    return makeFullPayload_(completedRows);
  });
}

function ping() {
  return { ok: true, version: APP_VERSION, email: getCurrentEmail_() };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setupProject: setupProject,
    loadAll: loadAll,
    safeBootstrapId_: safeBootstrapId_
  };
}
