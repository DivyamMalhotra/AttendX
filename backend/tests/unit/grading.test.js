const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bandFor, gradeResult, gpa, validateBands } = require('../../src/utils/grading');

const policy = {
  absentGrade: 'AB',
  bands: [
    { minPercent: 90, grade: 'A', points: 10 }, { minPercent: 75, grade: 'B', points: 8 },
    { minPercent: 50, grade: 'C', points: 5 }, { minPercent: 0, grade: 'F', points: 0, pass: false }
  ]
};
const exam = { maxMarks: 100, passMarks: 40 };

test('bands are matched from the highest minimum down, whatever order they were entered in', () => {
  const shuffled = { bands: [...policy.bands].reverse() };
  assert.equal(bandFor(90, shuffled.bands).grade, 'A');
  assert.equal(bandFor(89.99, shuffled.bands).grade, 'B');
  assert.equal(bandFor(0, shuffled.bands).grade, 'F');
  assert.equal(bandFor(100, shuffled.bands).grade, 'A');
});

test('grading: pass needs the passing marks AND a passing band; absent and incomplete are handled', () => {
  assert.deepEqual(gradeResult({ marks: 80, absent: false }, exam, policy), { state: 'graded', percent: 80, grade: 'B', points: 8, passed: true });
  assert.equal(gradeResult({ marks: 55, absent: false }, exam, policy).passed, true);
  assert.equal(gradeResult({ marks: 45, absent: false }, exam, policy).passed, false, '45% is in the failing F band of this scale');
  assert.equal(gradeResult({ marks: 39, absent: false }, exam, policy).passed, false, 'below the passing marks');
  assert.equal(gradeResult({ marks: 30, absent: false }, { maxMarks: 100, passMarks: 20 }, policy).passed, false, 'F band is a failing band even above the passing marks');
  assert.deepEqual(gradeResult({ marks: null, absent: true }, exam, policy), { state: 'absent', percent: 0, grade: 'AB', points: 0, passed: false });
  assert.deepEqual(gradeResult({ marks: null, absent: false }, exam, policy), { state: 'incomplete', percent: null, grade: null, points: null, passed: null });
  assert.equal(gradeResult({ marks: 0, absent: false }, exam, policy).state, 'graded', 'zero marks is a result, not missing');
});

test('percent uses the exam maximum, not 100', () => {
  const r = gradeResult({ marks: 18, absent: false }, { maxMarks: 20, passMarks: 8 }, policy);
  assert.equal(r.percent, 90);
  assert.equal(r.grade, 'A');
});

test('GPA is credit weighted, skips incomplete and zero-credit subjects, and is null without credits', () => {
  assert.equal(gpa([{ state: 'graded', points: 8, credits: 4 }, { state: 'graded', points: 0, credits: 2 }]), 5.33);
  assert.equal(gpa([{ state: 'graded', points: 10, credits: 3 }, { state: 'incomplete', points: null, credits: 3 }]), 10);
  assert.equal(gpa([{ state: 'graded', points: 9, credits: 0 }]), null);
  assert.equal(gpa([]), null);
});

test('a grading scale must start at 0%, have unique minimums and unique grade names', () => {
  assert.equal(validateBands(policy.bands), null);
  assert.match(validateBands([{ minPercent: 40, grade: 'P', points: 5 }]), /0%/);
  assert.match(validateBands([{ minPercent: 0, grade: 'F', points: 0 }, { minPercent: 0, grade: 'G', points: 1 }]), /same minimum/);
  assert.match(validateBands([{ minPercent: 0, grade: 'F', points: 0 }, { minPercent: 50, grade: 'f', points: 1 }]), /unique/);
  assert.match(validateBands([]), /at least one/);
});
