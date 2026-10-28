const { normalizeRollNo, isValidRollNo } = require('./rollNumber');

/**
 * Parser for the university's group student list ("5G3_Student_List.csv").
 *
 * The file is not ordinary CSV: every line is ONE quoted cell holding space-aligned columns
 * ("6       2410992506      AGAMYA KAUSHAL      5G3"), rows are separated by empty "" lines, the header repeats on
 * every page, and the file ends with a form-feed. So the quotes are stripped first and each line is split by its
 * structure: serial number, 10-digit roll number, the name (everything between), and the group as the last token.
 *
 * parseStudentList() never throws and never guesses: every line is either a student row, a recognised non-data
 * line (blank, title, repeated header, form feed) or listed in `unparsed`.
 */
const ROW = /^(\d{1,4})\s+(\d{10})\s+(.+?)\s+([A-Za-z0-9]+)$/;
const HEADER = /roll\.?\s*no.*student\s+name/i;

function unquote(line) {
  let s = line.replace(/[\f\u0000]/g, '').trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1).replace(/""/g, '"');
  return s.trim();
}

function parseStudentList(text, { expectedGroup = null } = {}) {
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const students = []; const unparsed = []; const headers = []; const titles = [];
  lines.forEach((raw, i) => {
    const line = unquote(raw);
    if (!line) return;
    if (HEADER.test(line)) { headers.push(i + 1); return; }
    const m = ROW.exec(line.replace(/\s+/g, ' '));
    if (!m) {
      if (!students.length && !titles.length) titles.push({ line: i + 1, text: line }); else unparsed.push({ line: i + 1, text: line });
      return;
    }
    students.push({ line: i + 1, serial: Number(m[1]), rollNo: normalizeRollNo(m[2]), name: m[3].replace(/\s+/g, ' ').trim(), group: m[4].toUpperCase() });
  });
  return { students, unparsed, headers, titles, summary: validate(students, unparsed, expectedGroup) };
}

/** Counts and problems for the summary shown before anything is written. `blocking` problems abort the import. */
function validate(students, unparsed, expectedGroup) {
  const byRoll = new Map(); const bySerial = new Map();
  const duplicateRolls = []; const duplicateSerials = []; const invalidRolls = []; const missing = [];
  for (const s of students) {
    if (!isValidRollNo(s.rollNo)) invalidRolls.push(s);
    if (!s.name || !s.group) missing.push(s);
    if (byRoll.has(s.rollNo)) duplicateRolls.push({ rollNo: s.rollNo, lines: [byRoll.get(s.rollNo).line, s.line], names: [byRoll.get(s.rollNo).name, s.name] }); else byRoll.set(s.rollNo, s);
    if (bySerial.has(s.serial)) duplicateSerials.push({ serial: s.serial, lines: [bySerial.get(s.serial).line, s.line] }); else bySerial.set(s.serial, s);
  }
  const groups = [...new Set(students.map(s => s.group))].sort();
  const blocking = [];
  if (!students.length) blocking.push('No student rows were found.');
  if (unparsed.length) blocking.push(`${unparsed.length} line(s) could not be read (first: line ${unparsed[0].line}).`);
  if (duplicateRolls.length) blocking.push(`${duplicateRolls.length} duplicate roll number(s).`);
  if (invalidRolls.length) blocking.push(`${invalidRolls.length} invalid roll number(s).`);
  if (missing.length) blocking.push(`${missing.length} row(s) with a missing name or group.`);
  if (expectedGroup ? groups.some(g => g !== expectedGroup) : groups.length > 1) blocking.push(`Unexpected group value(s): ${groups.join(', ')}.`);
  return {
    totalRows: students.length, validRows: students.length - new Set([...invalidRolls, ...missing].map(s => s.line)).size,
    invalidRows: new Set([...invalidRolls, ...missing].map(s => s.line)).size, unparsedLines: unparsed.length,
    duplicateRolls, duplicateSerials, missingFields: missing.length, groups, blocking, ok: blocking.length === 0
  };
}

module.exports = { parseStudentList };
