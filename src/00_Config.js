/**
 * Shared configuration and sheet schema.
 */

var APP_VERSION = '1.10.0';
var LOCK_WAIT_MS = 15000;
var DAY_MS = 24 * 60 * 60 * 1000;
var DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
var PROJECT_DATE_MIN = '2000-01-01';
var PROJECT_DATE_MAX = '2100-12-31';
var MAX_SCHEDULE_DAYS = 3660;

var SHEET = {
  NODES: 'Nodes',
  MEMBERS: 'Members',
  STATUS_COLUMNS: 'StatusColumns',
  DEPENDENCIES: 'Dependencies',
  COMMENTS: 'Comments',
  ACTIVITY_LOG: 'ActivityLog',
  MILESTONES: 'Milestones',
  MEETINGS: 'Meetings',
  CALENDAR_OVERRIDES: 'CalendarOverrides',
  NOTIFICATION_READS: 'NotificationReads'
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
HEADERS[SHEET.NOTIFICATION_READS] = ['NotificationKey', 'RecipientMemberId', 'NotificationType', 'SourceId', 'ReadAt'];

var PRIMARY_KEY_HEADER = {};
PRIMARY_KEY_HEADER[SHEET.NODES] = 'NodeId';
PRIMARY_KEY_HEADER[SHEET.MEMBERS] = 'MemberId';
PRIMARY_KEY_HEADER[SHEET.STATUS_COLUMNS] = 'ColumnId';
PRIMARY_KEY_HEADER[SHEET.DEPENDENCIES] = 'DependencyId';
PRIMARY_KEY_HEADER[SHEET.COMMENTS] = 'CommentId';
PRIMARY_KEY_HEADER[SHEET.ACTIVITY_LOG] = 'LogId';
PRIMARY_KEY_HEADER[SHEET.MILESTONES] = 'MilestoneId';
PRIMARY_KEY_HEADER[SHEET.MEETINGS] = 'MeetingId';
PRIMARY_KEY_HEADER[SHEET.CALENDAR_OVERRIDES] = 'Date';
PRIMARY_KEY_HEADER[SHEET.NOTIFICATION_READS] = 'NotificationKey';

var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.NODES] = [
  'NodeId',
  'ParentId',
  'Name',
  'StatusColumnId',
  'AssigneeIds',
  'Priority',
  'Tags',
  'StartDate',
  'EndDate',
  'Description',
  'CreatedAt',
  'UpdatedAt',
  'UpdatedBy',
  'DeletedAt',
  'DeletedBy',
  'Deliverable',
  'Note',
  'DraftOwner',
  'DraftExpiresAt',
  'ActualStartDate',
  'ActualEndDate'
];
TEXT_COLUMNS[SHEET.MEMBERS] = ['MemberId', 'Name', 'Email', 'Color', 'Company', 'SlackUserId'];
TEXT_COLUMNS[SHEET.STATUS_COLUMNS] = ['ColumnId', 'Name', 'Color'];
TEXT_COLUMNS[SHEET.DEPENDENCIES] = ['DependencyId', 'PredecessorNodeId', 'SuccessorNodeId'];
TEXT_COLUMNS[SHEET.COMMENTS] = ['CommentId', 'NodeId', 'AuthorId', 'AuthorName', 'Timestamp', 'Text', 'ParentCommentId', 'Mentions'];
TEXT_COLUMNS[SHEET.ACTIVITY_LOG] = ['LogId', 'NodeId', 'Field', 'OldValue', 'NewValue', 'ChangedAt', 'ChangedBy'];
TEXT_COLUMNS[SHEET.MILESTONES] = ['MilestoneId', 'Name', 'Date', 'Note'];
TEXT_COLUMNS[SHEET.MEETINGS] = ['MeetingId', 'Name', 'Schedule', 'Note', 'ScheduleRuleJson', 'StartDate', 'EndDate'];
TEXT_COLUMNS[SHEET.CALENDAR_OVERRIDES] = ['Date', 'DayType', 'Name'];
TEXT_COLUMNS[SHEET.NOTIFICATION_READS] = ['NotificationKey', 'RecipientMemberId', 'NotificationType', 'SourceId', 'ReadAt'];

var PRIORITIES = ['High', 'Mid', 'Low'];
var PROGRESS_VALUES = [0, 15, 30, 45, 60, 75, 90, 100];
