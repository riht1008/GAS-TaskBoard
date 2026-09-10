import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({
  SpreadsheetApp: { newConditionalFormatRule() {
    const rule = {};
    return {
      whenFormulaSatisfied(value) { rule.formula = value; return this; },
      whenNumberEqualTo(value) { rule.number = value; return this; },
      setBackground(value) { rule.background = value; return this; },
      setFontColor() { return this; },
      setRanges(value) { rule.ranges = value; return this; },
      build() { return rule; }
    };
  } }
});
vm.runInContext(fs.readFileSync(new URL('../src/10_WbsExport.js', import.meta.url), 'utf8'), context);
// Evaluate the numeric/date/blank subset used by the generated formulas.
function evaluate(formula, cells, today = 10) {
  const expression = formula.slice(1).replace(/\$?[A-Z]+\$?\d+/g, ref => JSON.stringify(cells[ref.replaceAll('$', '')] ?? ''))
    .replaceAll('<>', '!==').replace(/(?<![<>!=])=(?!=)/g, '===');
  return vm.runInNewContext(expression, {
    IF: (condition, yes, no) => condition ? yes : no,
    AND: (...values) => values.every(Boolean), OR: (...values) => values.some(Boolean), TODAY: () => today
  });
}

test('actual markers include both endpoints, use today only for an open end, and require a start', () => {
  const formula = context.wbsActualMarkerFormula_(20, 19, 14, 15);
  for (const [start, end, date, expected] of [
    [5, '', 4, ''], [5, '', 5, '★'], [5, '', 10, '★'], [5, '', 11, ''],
    [5, 7, 7, '★'], [5, 7, 8, ''], ['', '', 5, ''], ['', 7, 5, ''], [11, '', 10, '']
  ]) assert.equal(evaluate(formula, { N20: start, O20: end, S4: date }), expected);
});

test('delayed plan dates and bars take priority over normal plan and completed colors', () => {
  const sheet = { getRange: (...range) => range };
  const model = { layout: { taskStartRow: 20, ganttStartCol: 19, leftEndCol: 18, planStartCol: 11 }, taskRows: [{}], dateColumns: [], normalRows: [] };
  const rules = context.buildWbsConditionalFormatRules_(sheet, model);
  const late = rules[0];
  assert.deepEqual(Array.from(late.ranges[0]), [20, 11, 1, 3]);
  for (const [start, end, actualStart, actualEnd, expected] of [
    [5, 9, '', '', true], [10, 12, '', '', false], [5, 9, 5, 9, false],
    [5, 9, 6, 9, true], [5, 9, 5, 10, true], [5, 9, 5, '', true],
    ['', '', '', '', false], [5, 12, 5, '', false]
  ]) {
    const cells = { K20: start, L20: end, N20: actualStart, O20: actualEnd };
    assert.equal(evaluate(late.formula, cells), expected);
    if (start && end) {
      assert.equal(evaluate(rules[1].formula, { ...cells, S4: start }), expected);
      assert.equal(evaluate(rules[1].formula, { ...cells, S4: end + 1 }), false);
    }
  }
  assert.equal(rules[2].background, '#B7E1CD');
});

test('export date range reaches today for an ongoing actual period', () => {
  const result = context.buildWbsDateRange_([{ node: { NodeId: 'task' } }], {}, { today: '2026-09-10' }, [], [], { task: { startDate: '2026-08-01', endDate: '' } });
  assert.ok(result.dateColumns.some(day => day.date === '2026-09-10'));
});
