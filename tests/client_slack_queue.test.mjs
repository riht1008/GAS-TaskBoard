import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { SLACK_DEFAULT_STATUS_TEMPLATE, SLACK_DEFAULT_MENTION_TEMPLATE } = require('../src/09_Notifications.js');

const actionsSource = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
const bindingsSource = fs.readFileSync(new URL('../src/ClientBindings.html', import.meta.url), 'utf8');
const panelsSource = fs.readFileSync(new URL('../src/ClientRenderPanels.html', import.meta.url), 'utf8');
const stateSource = fs.readFileSync(new URL('../src/ClientState.html', import.meta.url), 'utf8');

function slackTestSource() {
  const start = actionsSource.indexOf('    function testSlackSettingsConnection()');
  const end = actionsSource.indexOf('    function disconnectSlackSettings()', start);
  if (start < 0 || end < 0) throw new Error('Slack test action not found');
  return actionsSource.slice(start, end);
}

test('Slack connection test is queued behind settings saves', () => {
  const calls = [];
  const state = { dialog: { type: 'projectSettings', submitting: false } };
  const context = vm.createContext({
    state,
    render: () => {},
    showToast: () => {},
    queueBackgroundMutation: (...args) => {
      calls.push(args);
      return Promise.resolve();
    }
  });
  vm.runInContext(slackTestSource(), context);

  context.testSlackSettingsConnection();

  assert.equal(state.dialog.submitting, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'slack-settings');
  assert.equal(calls[0][1], 'testSlackConnection');
});

test('Slack settings expose independent notification choices and editable default templates', () => {
  assert.match(stateSource, /SLACK_DEFAULT_STATUS_TEMPLATE/);
  assert.match(stateSource, /SLACK_DEFAULT_MENTION_TEMPLATE/);
  assert.match(actionsSource, /mentionEnabled: draft\.mentionEnabled === true/);
  assert.match(actionsSource, /statusTemplate: cleanText\(draft\.statusTemplate\)/);
  assert.match(actionsSource, /mentionTemplate: cleanText\(draft\.mentionTemplate\)/);
  assert.match(bindingsSource, /action === 'reset-slack-template'/);
  assert.match(panelsSource, /data-draft-field="mentionEnabled"/);
  assert.match(panelsSource, /data-draft-field="statusTemplate"/);
  assert.match(panelsSource, /data-draft-field="mentionTemplate"/);
  assert.match(panelsSource, /hooks\.slack\.com\/triggers/);
  assert.match(panelsSource, /data-draft-field="slackUserId"/);
  assert.match(panelsSource, /\{mentionedUsers\}/);
  assert.match(panelsSource, /デフォルトに戻す/);
});

test('client and server use the same Slack default templates', () => {
  const constantsSource = stateSource.slice(0, stateSource.indexOf('    const state ='));
  const context = vm.createContext({});
  vm.runInContext(constantsSource + '\nthis.templates = { status: SLACK_DEFAULT_STATUS_TEMPLATE, mention: SLACK_DEFAULT_MENTION_TEMPLATE };', context);
  assert.equal(context.templates.status, SLACK_DEFAULT_STATUS_TEMPLATE);
  assert.equal(context.templates.mention, SLACK_DEFAULT_MENTION_TEMPLATE);
});
