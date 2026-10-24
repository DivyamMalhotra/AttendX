/**
 * Institutional roll number policy:
 *  - surrounding and internal whitespace is removed
 *  - letters are upper-cased
 *  - 3-25 characters from A-Z, 0-9, "-" and "/" (must start with a letter or digit)
 * So "CSE2026001", "cse2026001" and " CSE2026001 " all normalize to "CSE2026001".
 */
const ROLL_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,24}$/;

function normalizeRollNo(raw) {
  return String(raw ?? '').replace(/\s+/g, '').toUpperCase();
}

function isValidRollNo(normalized) {
  return ROLL_PATTERN.test(normalized);
}

module.exports = { normalizeRollNo, isValidRollNo, ROLL_PATTERN };
