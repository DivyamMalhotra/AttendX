/**
 * Small RFC 4180 CSV reader: quoted fields, escaped quotes (""), commas and line breaks inside quotes,
 * CRLF/LF/CR line endings and a leading byte-order mark. Returns an array of string arrays.
 * It never evaluates anything; spreadsheet formulas are just text (see isFormulaLike for the import checks).
 */
function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = []; let field = ''; let quoted = false; let i = 0; let touched = false;
  const endField = () => { row.push(field); field = ''; touched = true; };
  const endRow = () => { if (touched || field !== '' || row.length) { endField(); rows.push(row); } row = []; touched = false; };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { quoted = true; touched = true; i += 1; continue; }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r') { endRow(); i += src[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (quoted) throw new Error('The file has an unclosed quote.');
  if (field !== '' || row.length) endRow();
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Header keys are compared case-insensitively with spaces/underscores removed ("Roll No" == "rollno"). */
const normalizeHeader = h => String(h).toLowerCase().replace(/[\s_\-.]+/g, '');

/** True for text a spreadsheet would run as a formula. Used to refuse such values in free-text import columns. */
const isFormulaLike = s => /^[=+\-@\t\r]/.test(String(s)) && !/^[+-]?\d+([.,]\d+)?$/.test(String(s).trim());

module.exports = { parseCsv, normalizeHeader, isFormulaLike };
