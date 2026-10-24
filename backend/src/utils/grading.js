/**
 * Pure grading maths. The scale (bands, points, pass flags) always comes from the college's own
 * grading policy; nothing here assumes a universal scale.
 */

/** Highest band whose minimum percentage is reached. Bands may be supplied in any order. */
function bandFor(percent, bands) {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find(b => percent >= b.minPercent) || null;
}

/**
 * One exam result for one student.
 *  absent        -> absent grade, 0 points, failed
 *  marks missing -> incomplete (never graded, never counted in GPA)
 *  otherwise     -> band grade; passed needs both the passing marks and a passing band
 */
function gradeResult({ marks, absent }, exam, policy) {
  if (absent) return { state: 'absent', percent: 0, grade: policy.absentGrade || 'AB', points: 0, passed: false };
  if (marks === null || marks === undefined) return { state: 'incomplete', percent: null, grade: null, points: null, passed: null };
  const percent = Math.round((marks / exam.maxMarks) * 10000) / 100;
  const band = bandFor(percent, policy.bands);
  if (!band) return { state: 'graded', percent, grade: null, points: 0, passed: false };
  return { state: 'graded', percent, grade: band.grade, points: band.points, passed: marks >= exam.passMarks && band.pass !== false };
}

/**
 * Credit weighted GPA: sum(points x credits) / sum(credits) over the given graded subject results.
 * Subjects without credits, or not graded, are left out; no credits at all gives null (not zero).
 */
function gpa(results) {
  let weighted = 0; let credits = 0;
  for (const r of results) {
    if (r.state === 'incomplete' || !(r.credits > 0)) continue;
    weighted += r.points * r.credits;
    credits += r.credits;
  }
  return credits > 0 ? Math.round((weighted / credits) * 100) / 100 : null;
}

/** Validates a grading scale: starts at 0%, unique minimums, sane values. Returns an error string or null. */
function validateBands(bands) {
  if (!Array.isArray(bands) || !bands.length) return 'Add at least one grade band.';
  const mins = bands.map(b => b.minPercent);
  if (new Set(mins).size !== mins.length) return 'Two bands share the same minimum percentage.';
  if (!mins.includes(0)) return 'The scale must include a band starting at 0%, so every mark receives a grade.';
  if (new Set(bands.map(b => b.grade.toLowerCase())).size !== bands.length) return 'Grade names must be unique.';
  return null;
}

module.exports = { bandFor, gradeResult, gpa, validateBands };
