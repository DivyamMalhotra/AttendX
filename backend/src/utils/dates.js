const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

/** True only for real calendar dates in YYYY-MM-DD form (rejects 2026-02-30). */
function isValidISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today's calendar date (YYYY-MM-DD) in the institution's timezone. */
function todayISO(timeZone = 'Asia/Kolkata', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const toUTC = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

function addDays(iso, days) {
  return new Date(toUTC(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

function diffDays(fromIso, toIso) {
  return Math.round((toUTC(toIso) - toUTC(fromIso)) / DAY_MS);
}

/** Inclusive list of calendar dates between two ISO dates. */
function eachDate(fromIso, toIso) {
  const out = [];
  for (let cur = fromIso; cur <= toIso; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

module.exports = { isValidISODate, todayISO, addDays, diffDays, eachDate };
