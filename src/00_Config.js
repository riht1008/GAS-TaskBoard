/**
 * Shared configuration and sheet schema.
 */

var APP_VERSION = '1.6.0';
var LOCK_WAIT_MS = 15000;
var DAY_MS = 24 * 60 * 60 * 1000;
var DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

var SHEET = {
  NODES: 'Nodes',
  MEMBERS: 'Members',
  STATUS_COLUMNS: 'StatusColumns',
  DEPENDENCIES: 'Dependencies',
  COMMENTS: 'Comments',
  ACTIVITY_LOG: 'ActivityLog',
  MILESTONES: 'Milestones',
  MEETINGS: 'Meetings',
  CALENDAR_OVERRIDES: 'CalendarOverrides'
};

var HEADERS = {};
HEADERS[SHEET.NODES] = [
  'NodeId',
  'ParentId',
  'Name',
  'StatusColumnId',
  'AssigneeIds',
  'Priority',
  'Tags', // app no longer reads/writes this; kept here so column positions for existing sheets don't shift
  'StartDate',
  'EndDate',
  'Description',
  'SortOrder',
  'CreatedAt',
  'UpdatedAt',
  'UpdatedBy',
  'DeletedAt',
  'DeletedBy',
  'Deliverable',
  'Note',
  'Progress',
  'IncludeInWbs',
  'DraftOwner',
  'DraftExpiresAt',
  'ActualStartDate',
  'ActualEndDate'
];
HEADERS[SHEET.MEMBERS] = ['MemberId', 'Name', 'Email', 'Color', 'Company', 'SlackUserId'];
HEADERS[SHEET.STATUS_COLUMNS] = ['ColumnId', 'Name', 'SortOrder', 'IsDoneColumn', 'Color', 'IsInProgressColumn'];
HEADERS[SHEET.DEPENDENCIES] = ['DependencyId', 'PredecessorNodeId', 'SuccessorNodeId'];
HEADERS[SHEET.COMMENTS] = ['CommentId', 'NodeId', 'AuthorId', 'AuthorName', 'Timestamp', 'Text', 'ParentCommentId', 'Mentions'];
HEADERS[SHEET.ACTIVITY_LOG] = ['LogId', 'NodeId', 'Field', 'OldValue', 'NewValue', 'NewValueIsDone', 'ChangedAt', 'ChangedBy'];
HEADERS[SHEET.MILESTONES] = ['MilestoneId', 'Name', 'Date', 'Note', 'SortOrder'];
HEADERS[SHEET.MEETINGS] = ['MeetingId', 'Name', 'Schedule', 'Note', 'SortOrder', 'ScheduleRuleJson', 'StartDate', 'EndDate'];
HEADERS[SHEET.CALENDAR_OVERRIDES] = ['Date', 'DayType', 'Name'];

var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.NODES] = [
  'NodeId',
  'ParentId',
  'StatusColumnId',
  'AssigneeIds',
  'Tags',
  'StartDate',
  'EndDate',
  'CreatedAt',
  'UpdatedAt',
  'UpdatedBy',
  'DeletedAt',
  'DeletedBy',
  'DraftOwner',
  'DraftExpiresAt',
  'ActualStartDate',
  'ActualEndDate'
];
TEXT_COLUMNS[SHEET.MEMBERS] = ['MemberId', 'Email', 'Color', 'SlackUserId'];
TEXT_COLUMNS[SHEET.STATUS_COLUMNS] = ['ColumnId', 'Color'];
TEXT_COLUMNS[SHEET.DEPENDENCIES] = ['DependencyId', 'PredecessorNodeId', 'SuccessorNodeId'];
TEXT_COLUMNS[SHEET.COMMENTS] = ['CommentId', 'NodeId', 'AuthorId', 'Timestamp', 'ParentCommentId', 'Mentions'];
TEXT_COLUMNS[SHEET.ACTIVITY_LOG] = ['LogId', 'NodeId', 'Field', 'ChangedAt', 'ChangedBy'];
TEXT_COLUMNS[SHEET.MILESTONES] = ['MilestoneId', 'Date'];
TEXT_COLUMNS[SHEET.MEETINGS] = ['MeetingId', 'ScheduleRuleJson', 'StartDate', 'EndDate'];
TEXT_COLUMNS[SHEET.CALENDAR_OVERRIDES] = ['Date', 'DayType', 'Name'];

var PRIORITIES = ['High', 'Mid', 'Low'];
var PROGRESS_VALUES = [0, 15, 30, 45, 60, 75, 90, 100];
