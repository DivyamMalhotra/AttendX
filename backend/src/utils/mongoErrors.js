const isDuplicateKey = err => Boolean(err && (err.code === 11000 || err.code === 11001));

/** Returns the list of fields named by a duplicate-key error, e.g. ['college','rollNo']. */
function duplicateFields(err) {
  if (!isDuplicateKey(err)) return [];
  if (err.keyPattern) return Object.keys(err.keyPattern);
  const m = /index: (\S+)/.exec(err.message || '');
  return m ? [m[1]] : [];
}

module.exports = { isDuplicateKey, duplicateFields };
