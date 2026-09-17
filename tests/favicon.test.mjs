import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = fs.readFileSync(new URL('../src/00_Config.js', import.meta.url), 'utf8');
const code = fs.readFileSync(new URL('../src/Code.js', import.meta.url), 'utf8');

test('favicon can be configured without breaking the platform default', () => {
  assert.match(config, /var APP_FAVICON_URL = '';/);
  assert.match(code, /if \(faviconUrl\) output\.setFaviconUrl\(faviconUrl\);/);
});
