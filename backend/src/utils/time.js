const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isHHMM = v => typeof v === 'string' && HHMM.test(v);
const toMinutes = v => { const m = HHMM.exec(v); return Number(m[1]) * 60 + Number(m[2]); };

/** Two [start,end) intervals overlap when each starts before the other ends. */
const overlaps = (aStart, aEnd, bStart, bEnd) => toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

/** "09:00" -> "9:00 AM". */
function to12h(v) {
  const [h, m] = v.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Label used as a class session's slot; identical to the fixed slot list for whole-hour classes. */
const slotLabel = (start, end) => `${to12h(start)} – ${to12h(end)}`;

/** ISO weekday (1 = Monday ... 7 = Sunday) of a YYYY-MM-DD calendar date. */
function isoWeekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

/** Current calendar date and minutes-since-midnight in an IANA timezone. */
function nowIn(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now).map(p => [p.type, p.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute) };
}

module.exports = { isHHMM, toMinutes, overlaps, to12h, slotLabel, isoWeekday, nowIn };
