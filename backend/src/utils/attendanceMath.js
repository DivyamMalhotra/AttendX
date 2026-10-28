/**
 * Pure attendance arithmetic. All threshold comparisons use integer maths so that
 * "exactly at the threshold" is never misjudged by floating point rounding.
 */

/** Percentage to one decimal place, or null when there are no eligible classes. */
function percentage(attended, eligible) {
  if (!eligible || eligible <= 0) return null;
  return Math.round((attended / eligible) * 1000) / 10;
}

/** True when attendance is strictly below the threshold. No classes => not below. */
function isBelowThreshold(attended, eligible, threshold) {
  if (!eligible || eligible <= 0) return false;
  return attended * 100 < threshold * eligible;
}

/**
 * Minimum number of consecutive future classes that must all be attended so that
 *   (attended + x) / (eligible + x) >= threshold / 100
 * Returns 0 if already at/above the threshold and null when it can never be reached
 * (threshold of 100% with a missed class).
 */
function classesNeededToReach(attended, eligible, threshold) {
  if (!isBelowThreshold(attended, eligible, threshold)) return 0;
  if (threshold >= 100) return null;
  return Math.ceil((threshold * eligible - 100 * attended) / (100 - threshold));
}

/** Most classes that can still be missed while staying at/above the threshold. */
function classesCanSkip(attended, eligible, threshold) {
  if (!eligible || eligible <= 0 || isBelowThreshold(attended, eligible, threshold)) return 0;
  if (threshold <= 0) return Infinity;
  return Math.max(0, Math.floor((100 * attended) / threshold - eligible));
}

/**
 * Applies the duty leave policy to raw counts.
 *  present/absent: raw attendance records; exempt: absences covered by approved duty leave.
 *  policy 'exclude'       -> exempt absences are removed from the eligible classes
 *  policy 'count_present' -> exempt absences are counted as attended
 * An exempt absence is never counted twice and a present record is never "exempted".
 */
function summarize({ present, absent, exempt }, policy = 'exclude') {
  const exemptAbsences = Math.min(exempt || 0, absent || 0);
  const missed = (absent || 0) - exemptAbsences;
  const attended = (present || 0) + (policy === 'count_present' ? exemptAbsences : 0);
  const eligible = policy === 'count_present'
    ? (present || 0) + (absent || 0)
    : (present || 0) + missed;
  return { attended, missed, exempt: exemptAbsences, eligible, recorded: (present || 0) + (absent || 0) };
}

module.exports = { percentage, isBelowThreshold, classesNeededToReach, classesCanSkip, summarize };
