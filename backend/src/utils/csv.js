/** Minimal RFC 4180 CSV writer. Also neutralizes spreadsheet formula injection (=, +, -, @ prefixes). */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const head = columns.map(c => cell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => cell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

module.exports = { toCsv };
