import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function stagedWriterSource() {
  const source = fs.readFileSync(new URL('../src/10_WbsExport.js', import.meta.url), 'utf8');
  const start = source.indexOf('function writeWbsSheetStaged_(');
  const end = source.indexOf('function writeWbsSheet_(', start);
  if (start < 0 || end < 0) throw new Error('staged writer source not found');
  return source.slice(start, end);
}

function fakeSpreadsheet(options = {}) {
  let nextId = 2;
  const sheets = [];
  let active = null;
  const makeSheet = (name, id) => ({
    name,
    id,
    rendered: false,
    getName() { return this.name; },
    getSheetId() { return this.id; },
    getIndex() { return sheets.indexOf(this) + 1; },
    setName(nextName) {
      if (sheets.some(sheet => sheet !== this && sheet.name === nextName)) throw new Error('duplicate sheet name');
      this.name = nextName;
      return this;
    }
  });
  const oldWbs = makeSheet('WBS', 1);
  sheets.push(oldWbs);
  return {
    oldWbs,
    sheets,
    getSheetByName(name) { return sheets.find(sheet => sheet.name === name) || null; },
    insertSheet(name) {
      const sheet = makeSheet(name, nextId++);
      sheets.push(sheet);
      return sheet;
    },
    deleteSheet(sheet) {
      const index = sheets.indexOf(sheet);
      if (index >= 0) sheets.splice(index, 1);
    },
    setActiveSheet(sheet) { active = sheet; },
    moveActiveSheet(index) {
      if (options.failMove) throw new Error('simulated move failure');
      const currentIndex = sheets.indexOf(active);
      sheets.splice(currentIndex, 1);
      sheets.splice(index - 1, 0, active);
    }
  };
}

function runStagedWriter(spreadsheet) {
  const context = vm.createContext({
    WBS_SHEET_NAME: 'WBS',
    SpreadsheetApp: { getActive: () => spreadsheet },
    Date,
    newId_: () => 'fixed-id',
    cleanString_: value => value === null || value === undefined ? '' : String(value),
    console,
    writeWbsSheet_: (_model, sheet) => { sheet.rendered = true; }
  });
  vm.runInContext(stagedWriterSource(), context);
  context.writeWbsSheetStaged_({ values: [['ok']] });
}

test('WBS staging publishes a complete new sheet and removes the backup', () => {
  const spreadsheet = fakeSpreadsheet();

  runStagedWriter(spreadsheet);

  assert.equal(spreadsheet.sheets.length, 1);
  assert.equal(spreadsheet.sheets[0].name, 'WBS');
  assert.equal(spreadsheet.sheets[0].rendered, true);
  assert.notEqual(spreadsheet.sheets[0].id, spreadsheet.oldWbs.id);
});

test('WBS staging restores the previous sheet when publication fails', () => {
  const spreadsheet = fakeSpreadsheet({ failMove: true });

  assert.throws(() => runStagedWriter(spreadsheet), /simulated move failure/);

  assert.equal(spreadsheet.sheets.length, 1);
  assert.equal(spreadsheet.sheets[0], spreadsheet.oldWbs);
  assert.equal(spreadsheet.oldWbs.name, 'WBS');
});
