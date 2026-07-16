import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function slackTestSource() {
  const source = fs.readFileSync(new URL('../src/ClientActions.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function testSlackSettingsConnection()');
  const end = source.indexOf('    function disconnectSlackSettings()', start);
  if (start < 0 || end < 0) throw new Error('Slack test action not found');
  return source.slice(start, end);
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
