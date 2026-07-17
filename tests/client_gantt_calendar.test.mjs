import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const utils = fs.readFileSync(new URL('../src/ClientUtils.html', import.meta.url), 'utf8');
const views = fs.readFileSync(new URL('../src/ClientRenderViews.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/Styles.html', import.meta.url), 'utf8');

function holidayContext() {
  const context = {};
  vm.runInNewContext(utils, context);
  return context;
}

test('2026 Japanese holidays match the published national and statutory holidays', () => {
  const context = holidayContext();
  const dates = Array.from(context.japaneseHolidaysForYear(2026).keys()).sort();
  assert.deepEqual(dates, [
    '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
    '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
    '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
    '2026-10-12', '2026-11-03', '2026-11-23'
  ]);
  assert.equal(context.japaneseHolidayName('2026-05-06'), '振替休日');
  assert.equal(context.japaneseHolidayName('2026-09-22'), '国民の休日');
});

test('2027 equinox and substitute holidays match the published calendar', () => {
  const context = holidayContext();
  const dates = Array.from(context.japaneseHolidaysForYear(2027).keys()).sort();
  assert.deepEqual(dates, [
    '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21',
    '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
    '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11',
    '2027-11-03', '2027-11-23'
  ]);
  assert.equal(context.japaneseHolidayName('2027-03-22'), '振替休日');
});

test('Olympic holiday moves and the following substitute holiday remain supported', () => {
  const context = holidayContext();
  assert.equal(context.japaneseHolidayName('2021-07-22'), '海の日');
  assert.equal(context.japaneseHolidayName('2021-07-23'), 'スポーツの日');
  assert.equal(context.japaneseHolidayName('2021-08-08'), '山の日');
  assert.equal(context.japaneseHolidayName('2021-08-09'), '振替休日');
  assert.equal(context.japaneseHolidayName('2021-10-11'), '');
});

test('gantt uses full-day bands for today and Japanese holidays', () => {
  assert.match(views, /renderNonWorkingDayBands\(scale, height\)/);
  assert.match(views, /class="gantt-holiday-band" data-holiday-name=/);
  assert.match(views, /class="gantt-saturday-band"/);
  assert.match(views, /class="today-column" style="left:\$\{todayLeft\}px;width:\$\{scale\.dayWidth\}px;/);
  assert.match(styles, /\.gantt-saturday-band\s*\{[\s\S]*#d7edff/);
  assert.match(styles, /\.gantt-holiday-band\s*\{[\s\S]*background:/);
  assert.match(styles, /\.today-column\s*\{[\s\S]*background:[\s\S]*z-index:\s*0;/);
  assert.doesNotMatch(styles, /\.today-column\s*\{[\s\S]{0,160}width:\s*1px/);
});

test('project calendar uses blue Saturday, pink Sunday/holiday, and manual overrides', () => {
  const context = {
    state: {
      calendarOverrideByDate: new Map([
        ['2026-07-20', { date: '2026-07-20', dayType: 'working', name: '通常稼働' }],
        ['2026-07-21', { date: '2026-07-21', dayType: 'holiday', name: '夏季休暇' }]
      ])
    }
  };
  vm.runInNewContext(utils, context);
  assert.equal(context.projectCalendarDayInfo('2026-07-18').kind, 'saturday');
  assert.equal(context.projectCalendarDayInfo('2026-07-19').kind, 'holiday');
  assert.equal(context.projectCalendarDayInfo('2026-07-20').kind, 'working');
  assert.equal(context.projectCalendarDayInfo('2026-07-20').name, '通常稼働');
  assert.equal(context.projectCalendarDayInfo('2026-07-21').kind, 'holiday');
  assert.equal(context.projectCalendarDayInfo('2026-07-21').name, '夏季休暇');
});

test('every day header in day zoom opens the period override dialog and today wins the color priority', () => {
  assert.match(views, /function renderCalendarAxisDayButtons\(scale\)/);
  assert.match(views, /data-action="calendar-edit-day" data-calendar-date=/);
  assert.match(styles, /\.axis-day-action\.saturday[\s\S]*\.axis-day-action\.holiday[\s\S]*\.axis-day-action\.today/);
});
