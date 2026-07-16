import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { slackDeliveryErrorMessage_ } = require('../src/09_Notifications.js');

test('Slack delivery errors are translated into actionable messages', () => {
  assert.match(slackDeliveryErrorMessage_(404, ''), /削除または無効/);
  assert.match(slackDeliveryErrorMessage_(429, ''), /送信制限/);
  assert.match(slackDeliveryErrorMessage_(400, 'channel_is_archived'), /アーカイブ/);
});
