const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../src/utils/attendanceMath');

test('28 of 40 classes is 70% and needs the next 8 classes to reach 75%', () => {
  assert.equal(m.percentage(28, 40), 70);
  assert.equal(m.isBelowThreshold(28, 40, 75), true);
  assert.equal(m.classesNeededToReach(28, 40, 75), 8);
  assert.ok((28 + 8) / (40 + 8) >= 0.75);
  assert.ok((28 + 7) / (40 + 7) < 0.75, '7 classes would not be enough');
});

test('classesNeededToReach is minimal for many combinations', () => {
  for (let eligible = 1; eligible <= 60; eligible += 1) {
    for (let attended = 0; attended <= eligible; attended += 1) {
      for (const t of [50, 65, 75, 80, 90]) {
        const x = m.classesNeededToReach(attended, eligible, t);
        assert.ok((attended + x) * 100 >= t * (eligible + x), `reach ${attended}/${eligible}@${t}`);
        if (x > 0) assert.ok((attended + x - 1) * 100 < t * (eligible + x - 1), `minimal ${attended}/${eligible}@${t}`);
      }
    }
  }
});

test('exactly at the threshold is not a shortage (strictly below policy)', () => {
  assert.equal(m.isBelowThreshold(30, 40, 75), false);
  assert.equal(m.classesNeededToReach(30, 40, 75), 0);
  assert.equal(m.isBelowThreshold(29, 40, 75), true);
});

test('zero eligible classes never divides by zero or raises an alert', () => {
  assert.equal(m.percentage(0, 0), null);
  assert.equal(m.isBelowThreshold(0, 0, 75), false);
  assert.equal(m.classesNeededToReach(0, 0, 75), 0);
  assert.equal(m.classesCanSkip(0, 0, 75), 0);
});

test('a 100% threshold cannot be reached after a missed class', () => {
  assert.equal(m.classesNeededToReach(9, 10, 100), null);
  assert.equal(m.classesNeededToReach(10, 10, 100), 0);
});

test('classesCanSkip keeps attendance at or above the threshold', () => {
  const skip = m.classesCanSkip(36, 40, 75);
  assert.equal(skip, 8);
  assert.ok(36 * 100 >= 75 * (40 + skip));
  assert.ok(36 * 100 < 75 * (40 + skip + 1));
});

test('summarize: duty leave policy "exclude" removes exempt absences from eligible classes', () => {
  const s = m.summarize({ present: 28, absent: 12, exempt: 4 }, 'exclude');
  assert.deepEqual(s, { attended: 28, missed: 8, exempt: 4, eligible: 36, recorded: 40 });
});

test('summarize: duty leave policy "count_present" credits exempt absences as attended', () => {
  const s = m.summarize({ present: 28, absent: 12, exempt: 4 }, 'count_present');
  assert.deepEqual(s, { attended: 32, missed: 8, exempt: 4, eligible: 40, recorded: 40 });
});

test('summarize never exempts more absences than exist (no double counting)', () => {
  const s = m.summarize({ present: 5, absent: 1, exempt: 9 }, 'exclude');
  assert.equal(s.exempt, 1);
  assert.equal(s.eligible, 5);
});
