/** Money is always an integer number of paise (1 INR = 100 paise). */

/** Parses a rupee amount like "1250.50" or 1250.5 into integer paise; throws on bad input. */
function rupeesToPaise(value) {
  const str = String(value ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(str)) throw new RangeError('Invalid amount');
  const [whole, frac = ''] = str.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

const isPaise = n => Number.isSafeInteger(n) && n >= 0;

/** Formats paise as an Indian-grouped rupee string, e.g. 12500000 -> "₹1,25,000.00". */
function formatINR(paise) {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const s = String(rupees);
  const grouped = s.length > 3
    ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
    : s;
  return `${negative ? '-' : ''}₹${grouped}.${frac}`;
}

module.exports = { rupeesToPaise, isPaise, formatINR };
