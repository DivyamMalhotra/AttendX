const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRollNo, isValidRollNo } = require('../../src/utils/rollNumber');
const { rupeesToPaise, formatINR } = require('../../src/utils/money');
const { isValidISODate, todayISO, addDays, diffDays, eachDate } = require('../../src/utils/dates');
const { outstandingPaise, feeStatus } = require('../../src/utils/feeMath');
const { toCsv } = require('../../src/utils/csv');

test('roll numbers normalize case and whitespace to one canonical value', () => {
  for (const v of ['CSE2026001', 'cse2026001', ' CSE2026001 ', 'cse 2026 001', '\tcse2026001\n']) {
    assert.equal(normalizeRollNo(v), 'CSE2026001');
  }
});

test('roll number format rules', () => {
  assert.equal(isValidRollNo('GEC21101'), true);
  assert.equal(isValidRollNo('CS/21-101'), true);
  for (const bad of ['', 'AB', '-ABC', 'AB$1', 'A'.repeat(26), 'ROLL#1']) assert.equal(isValidRollNo(normalizeRollNo(bad)), false, bad);
});

test('money parsing and Indian formatting', () => {
  assert.equal(rupeesToPaise('125000'), 12500000);
  assert.equal(rupeesToPaise('1250.5'), 125050);
  assert.equal(rupeesToPaise(0.1 + 0.2 > 0 ? '0.30' : '0'), 30);
  assert.throws(() => rupeesToPaise('12.345'));
  assert.throws(() => rupeesToPaise('-5'));
  assert.equal(formatINR(12500000), '₹1,25,000.00');
  assert.equal(formatINR(99), '₹0.99');
  assert.equal(formatINR(123456789), '₹12,34,567.89');
});

test('date validation rejects impossible dates', () => {
  assert.equal(isValidISODate('2026-02-28'), true);
  assert.equal(isValidISODate('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', 'tomorrow', null, 20260101]) assert.equal(isValidISODate(bad), false, String(bad));
});

test('date helpers are timezone-safe', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(diffDays('2026-03-01', '2026-03-31'), 30);
  assert.deepEqual(eachDate('2026-01-30', '2026-02-02'), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  // 23:00 UTC on 31 Dec is already 1 Jan in India
  assert.equal(todayISO('Asia/Kolkata', new Date('2026-12-31T23:00:00Z')), '2027-01-01');
  assert.equal(todayISO('UTC', new Date('2026-12-31T23:00:00Z')), '2026-12-31');
});

test('fee math: outstanding balance and status', () => {
  const a = { totalPayablePaise: 12500000, paidPaise: 7500000, dueDate: '2026-08-01' };
  assert.equal(outstandingPaise(a), 5000000);
  assert.deepEqual(feeStatus(a, '2026-07-01'), { status: 'partial', overdue: false, outstandingPaise: 5000000 });
  assert.equal(feeStatus(a, '2026-09-01').overdue, true);
  assert.equal(feeStatus({ ...a, paidPaise: 12500000 }, '2026-09-01').status, 'paid');
  assert.equal(feeStatus({ ...a, paidPaise: 0 }, '2026-07-01').status, 'unpaid');
  assert.equal(outstandingPaise({ totalPayablePaise: 100, paidPaise: 300 }), 0, 'never negative');
});

test('csv export escapes quotes and neutralizes spreadsheet formulas', () => {
  const csv = toCsv([{ label: 'Name', value: 'name' }, { label: 'Note', value: 'note' }], [{ name: 'A, "B"', note: '=cmd()' }]);
  assert.equal(csv, 'Name,Note\r\n"A, ""B""",\'=cmd()\r\n');
});
