/**
 * Repair tool: recomputes the denormalized present/absent counters on every class session
 * from the attendance records (the records are the source of truth). Safe to run any time.
 *
 *   node scripts/migrations/recompute-session-counts.js
 */
const { config } = require('../../src/config/env');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { ClassSession, Attendance } = require('../../src/models');

async function main() {
  await connectDb(config.mongoUri);
  const totals = await Attendance.aggregate([{ $group: { _id: { s: '$classSession', st: '$status' }, n: { $sum: 1 } } }]);
  const bySession = new Map();
  totals.forEach(t => {
    const row = bySession.get(String(t._id.s)) || { present: 0, absent: 0 };
    row[t._id.st === 'P' ? 'present' : 'absent'] += t.n;
    bySession.set(String(t._id.s), row);
  });
  let fixed = 0;
  for await (const session of ClassSession.find({}).cursor()) {
    const want = bySession.get(String(session._id)) || { present: 0, absent: 0 };
    if (session.counts.present !== want.present || session.counts.absent !== want.absent) {
      await ClassSession.updateOne({ _id: session._id }, { $set: { counts: want } });
      fixed += 1;
    }
  }
  console.log(`✔ ${fixed} session counter(s) corrected.`);
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
