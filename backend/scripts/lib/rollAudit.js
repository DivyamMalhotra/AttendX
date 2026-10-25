const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { normalizeRollNo } = require('../../src/utils/rollNumber');

/**
 * Finds students whose roll numbers collide once normalized (case/whitespace).
 * Reads the raw collection so it also works before the unique index exists.
 * Nothing is modified: ambiguous records are reported for an administrator to resolve.
 */
async function findDuplicateRollNumbers() {
  const rows = await mongoose.connection.collection('studentprofiles')
    .find({}, { projection: { college: 1, rollNo: 1, user: 1, section: 1, active: 1, createdAt: 1 } }).toArray();
  const groups = new Map();
  rows.forEach(r => {
    const key = `${r.college}|${normalizeRollNo(r.rollNo)}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  });
  return [...groups.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({
    college: key.split('|')[0], normalizedRollNo: key.split('|')[1],
    records: list.map(r => ({ id: String(r._id), user: String(r.user), section: String(r.section), rollNoAsStored: r.rollNo, active: r.active, createdAt: r.createdAt }))
  }));
}

function writeReport(name, data) {
  const dir = path.join(__dirname, '..', '..', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

module.exports = { findDuplicateRollNumbers, writeReport };
