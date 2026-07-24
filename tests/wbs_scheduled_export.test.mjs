import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/10_WbsExport.js', import.meta.url), 'utf8');

function exportEntrySource() {
  const start = source.indexOf('function exportWbs()');
  const end = source.indexOf('function acquireWbsExportGuard_(', start);
  if (start < 0 || end < 0) throw new Error('WBS export entry source not found');
  return source.slice(start, end);
}

function exportContext(options = {}) {
  const documentProperties = new Map();
  const members = options.members || [
    { MemberId: 'm1', Name: '定期実行者', Email: 'owner@example.com' }
  ];
  const calls = {
    actorNames: [],
    guardAcquired: 0,
    guardReleased: 0,
    writes: 0
  };
  const context = vm.createContext({
    SHEET: { MEMBERS: 'Members' },
    Session: {
      getEffectiveUser: () => ({
        getEmail: () => options.effectiveEmail === undefined ? 'OWNER@example.com' : options.effectiveEmail
      })
    },
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperty: key => documentProperties.get(key) || null,
        setProperty: (key, value) => documentProperties.set(key, value)
      })
    },
    Date,
    console: { error() {}, info() {} },
    requireSchemaExists_: () => {},
    requireCurrentMember_: () => ({ MemberId: 'manual', Name: '手動実行者', Email: 'manual@example.com' }),
    normalizeEmail_: value => String(value || '').trim().toLowerCase(),
    cleanString_: value => value === null || value === undefined ? '' : String(value).trim(),
    readObjects_: sheet => sheet === 'Members' ? members : [],
    acquireWbsExportGuard_: () => {
      calls.guardAcquired += 1;
      return 'guard-token';
    },
    releaseWbsExportGuard_: token => {
      assert.equal(token, 'guard-token');
      calls.guardReleased += 1;
    },
    readAll_: () => ({ nodes: [] }),
    nowIso_: () => '2026-07-24T00:00:00.000Z',
    buildWbsModel_: (_rows, modelOptions) => {
      calls.actorNames.push(modelOptions.actorName);
      return { taskRows: [{ id: 'task' }], warning: '' };
    },
    writeWbsSheetStaged_: () => {
      calls.writes += 1;
    }
  });
  vm.runInContext(exportEntrySource(), context);
  return { context, calls };
}

test('scheduled WBS export authorizes the trigger creator through Members', () => {
  const { context, calls } = exportContext();

  const result = context.scheduledExportWbs();

  assert.equal(result.ok, true);
  assert.equal(result.version, 1);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(calls.actorNames, ['定期実行者']);
  assert.equal(calls.guardAcquired, 1);
  assert.equal(calls.guardReleased, 1);
  assert.equal(calls.writes, 1);
});

test('scheduled WBS export rejects an unregistered trigger creator before writing', () => {
  const { context, calls } = exportContext({ effectiveEmail: 'outside@example.com' });

  assert.throws(
    () => context.scheduledExportWbs(),
    /トリガー作成者がメンバー登録されていません/
  );
  assert.equal(calls.guardAcquired, 0);
  assert.equal(calls.writes, 0);
});

test('scheduled WBS export rejects execution when the trigger identity is unavailable', () => {
  const { context, calls } = exportContext({ effectiveEmail: '' });

  assert.throws(
    () => context.scheduledExportWbs(),
    /定期WBS出力の実行ユーザーを取得できません/
  );
  assert.equal(calls.guardAcquired, 0);
  assert.equal(calls.writes, 0);
});

test('manual WBS export keeps the existing active-member authorization route', () => {
  const { context, calls } = exportContext();

  context.exportWbs();

  assert.deepEqual(calls.actorNames, ['手動実行者']);
  assert.equal(calls.guardAcquired, 1);
  assert.equal(calls.guardReleased, 1);
});
