const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { todayISO } = require('../../src/utils/dates');
const { TIME_SLOTS } = require('../../src/config/constants');
const qrService = require('../../src/services/qrAttendanceService');

let ctx; let M; let hod; let t1; let t2; let students; let slotNo = 0;
const today = todayISO('Asia/Kolkata');
const id = x => String(x._id || x);
const CAMPUS = { lat: 30.7333, lng: 76.7794 };

async function newClass() {
  slotNo += 1;
  return M.ClassSession.create({
    college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, teacher: ctx.teacher._id, date: today,
    slot: TIME_SLOTS[slotNo % TIME_SLOTS.length] + (slotNo >= TIME_SLOTS.length ? ` #${slotNo}` : ''), source: 'adhoc'
  });
}
const start = (agent, cls, body = {}) => agent.post(`/api/faculty/sessions/${id(cls)}/qr`, body);
const code = async (agent, cls) => (await agent.get(`/api/faculty/sessions/${id(cls)}/qr`)).body.data;
const scan = (agent, windowId, c, extra = {}) => agent.post('/api/student/qr-attendance', { sessionId: windowId, code: c, ...extra });
const wrongCode = real => String((Number(real) + 1) % 1_000_000).padStart(6, '0');

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'QRA1', students: 4 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  students = [];
  for (const s of ctx.students) students.push(await harness.login(creds(ctx.college, s.user)));
});
after(() => harness.stop());

test('distance maths: one degree of longitude on the equator is about 111 km', () => {
  assert.ok(Math.abs(qrService.distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 200);
  assert.equal(Math.round(qrService.distanceMeters(CAMPUS, CAMPUS)), 0);
});

test('only the teacher of the class (or an administrator) can open a QR window; opening is idempotent', async () => {
  const cls = await newClass();
  assert.equal((await start(t2, cls)).status, 403);
  assert.equal((await start(students[0], cls)).status, 403);
  const a = await start(t1, cls);
  assert.equal(a.status, 201);
  assert.equal(a.body.data.geofence, false);
  const b = await start(t1, cls);
  assert.equal(b.body.data.id, a.body.data.id, 'a second start returns the same window');
  assert.equal(await M.QrSession.countDocuments({ classSession: cls._id, status: 'open' }), 1);
  assert.equal((await M.ClassSession.findById(cls._id)).status, 'open');
  assert.equal((await t2.get(`/api/faculty/sessions/${id(cls)}/qr`)).status, 403);

  const shown = await code(t1, cls);
  assert.match(shown.code, /^\d{6}$/);
  assert.equal(shown.payload, `attendx:qr:${shown.id}:${shown.code}`);
  assert.match(shown.qr, /^data:image\/png;base64,/);
  assert.ok(shown.rotatesInMs > 0 && shown.rotatesInMs <= 30_000);
  assert.ok(!JSON.stringify(shown).includes((await M.QrSession.findById(shown.id).select('+secret')).secret), 'the signing secret is never sent');
  assert.equal((await hod.get(`/api/faculty/sessions/${id(cls)}/qr`)).status, 200);
});

test('a correct code marks the student present once; a wrong code is refused and locks after repeated failures', async () => {
  const cls = await newClass();
  const w = (await start(t1, cls)).body.data;
  const real = (await code(t1, cls)).code;

  const ok = await scan(students[0], w.id, real);
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.data.status, ok.body.data.alreadyMarked], ['P', false]);
  const rec = await M.Attendance.findOne({ classSession: cls._id, student: ctx.students[0].profile._id });
  assert.deepEqual([rec.status, rec.source], ['P', 'qr']);
  assert.equal((await M.ClassSession.findById(cls._id)).counts.present, 1);
  assert.equal((await scan(students[0], w.id, real)).body.data.alreadyMarked, true, 'scanning twice changes nothing');
  assert.equal(await M.Attendance.countDocuments({ classSession: cls._id, student: ctx.students[0].profile._id }), 1);
  assert.equal((await M.QrSession.findById(w.id)).accepted, 1);

  for (let i = 0; i < 5; i += 1) {
    const bad = await scan(students[1], w.id, wrongCode(real));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'BAD_CODE');
  }
  const locked = await scan(students[1], w.id, real);
  assert.equal(locked.status, 429, 'five wrong codes lock this student out of this window, even with the right one');
  assert.equal(await M.Attendance.countDocuments({ classSession: cls._id, student: ctx.students[1].profile._id }), 0);

  const list = (await t1.get(`/api/faculty/sessions/${id(cls)}/qr/scans`)).body.data;
  assert.deepEqual(list.accepted.map(a => a.rollNo), [ctx.students[0].profile.rollNo]);
  assert.equal(list.rejected, 5);
  assert.equal((await t2.get(`/api/faculty/sessions/${id(cls)}/qr/scans`)).status, 403);
});

test('codes rotate: the previous one still works for a grace period, older ones do not', async () => {
  const cls = await newClass();
  const w = (await start(t1, cls)).body.data;
  const qr = await M.QrSession.findById(w.id).select('+secret');
  const now = qrService.periodNow(qr);
  const old = qrService.codeFor(qr.secret, w.id, now - 2);
  const prev = qrService.codeFor(qr.secret, w.id, now - 1);
  assert.equal((await scan(students[0], w.id, old)).body.error.code, 'BAD_CODE');
  assert.equal((await scan(students[0], w.id, prev)).status, 200);
});

test('students from another class cannot use a window; windows can be closed and expire', async () => {
  const cls = await newClass();
  const w = (await start(t1, cls)).body.data;
  const real = (await code(t1, cls)).code;

  // a student of a different section sees the same "not valid" answer as for an unknown window
  const other = await M.Section.create({ college: ctx.college._id, name: 'EE-A', nameKey: 'ee-a', sem: 'Sem 3', semesterNumber: 3, course: 'B.Tech', specialization: 'EE', mentor: ctx.teacher._id });
  const studentService = require('../../src/services/studentService');
  const o = await studentService.registerStudent(ctx.hod, ctx.college._id, { name: 'Outsider', email: 'out@qra1.edu', password: 'Passw0rd1', rollNo: 'QRA9001', sectionId: other._id });
  await M.User.updateOne({ _id: o.user._id }, { $set: { mustChangePassword: false } });
  const outsider = await harness.login({ collegeCode: 'QRA1', email: 'out@qra1.edu', password: 'Passw0rd1' });
  assert.equal((await scan(outsider, w.id, real)).status, 404);
  assert.equal((await scan(students[0], '64b7f0f0f0f0f0f0f0f0f0f0', real)).status, 404);
  assert.equal((await scan(students[0], w.id, 'abc')).status, 400);

  assert.equal((await t2.post(`/api/faculty/sessions/${id(cls)}/qr/close`)).status, 403);
  const closed = await t1.post(`/api/faculty/sessions/${id(cls)}/qr/close`);
  assert.equal(closed.body.data.status, 'closed');
  assert.equal((await scan(students[0], w.id, real)).body.error.code, 'QR_CLOSED');
  assert.equal((await t1.get(`/api/faculty/sessions/${id(cls)}/qr`)).status, 404);

  const again = (await start(t1, cls)).body.data;
  assert.notEqual(again.id, w.id, 'a new window can be opened after closing');
  await M.QrSession.updateOne({ _id: again.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await t1.get(`/api/faculty/sessions/${id(cls)}/qr`)).body.error.code, 'QR_EXPIRED');
  assert.equal((await start(t1, cls)).status, 201, 'an expired window is replaced');
});

test('faculty stay in charge: a scan never overwrites their record, and their submission wins', async () => {
  const cls = await newClass();
  const w = (await start(t1, cls)).body.data;
  const real = (await code(t1, cls)).code;
  await M.Attendance.create({ college: ctx.college._id, classSession: cls._id, student: ctx.students[2].profile._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: today, status: 'A' });

  const res = await scan(students[2], w.id, real);
  assert.deepEqual([res.body.data.alreadyMarked, res.body.data.status], [true, 'A']);
  assert.equal((await M.Attendance.findOne({ classSession: cls._id, student: ctx.students[2].profile._id })).status, 'A');

  await scan(students[0], w.id, real);
  await scan(students[1], w.id, real);
  // the teacher reviews the sheet and marks student 2 (a QR scan from a photo, say) absent
  const records = ctx.students.map((s, i) => ({ studentId: id(s.profile), status: i === 1 ? 'A' : i === 3 ? 'A' : 'P' }));
  const submit = await t1.put('/api/faculty/attendance/sessions', { subjectId: id(ctx.subjects.ds), date: today, slot: cls.slot, records });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal((await M.Attendance.findOne({ classSession: cls._id, student: ctx.students[1].profile._id })).status, 'A', 'the teacher\'s correction beats the scan');
  assert.equal((await M.ClassSession.findById(cls._id)).status, 'submitted');
});

test('with the geofence on, the position is checked on the server; the rule is frozen per window', async () => {
  assert.equal((await hod.patch('/api/admin/settings', { qr: { geofence: { enabled: true, lat: CAMPUS.lat, lng: CAMPUS.lng, radiusMeters: 100 } } })).status, 200);
  const cls = await newClass();
  const w = (await start(t1, cls)).body.data;
  assert.equal(w.geofence, true);
  const real = (await code(t1, cls)).code;

  const none = await scan(students[0], w.id, real);
  assert.equal(none.body.error.code, 'LOCATION_REQUIRED');
  const far = await scan(students[0], w.id, real, { lat: CAMPUS.lat + 0.01, lng: CAMPUS.lng, accuracy: 20 });
  assert.equal(far.status, 403);
  assert.equal(far.body.error.code, 'OUTSIDE_GEOFENCE');
  const vague = await scan(students[0], w.id, real, { lat: CAMPUS.lat, lng: CAMPUS.lng, accuracy: 900 });
  assert.equal(vague.body.error.code, 'LOCATION_IMPRECISE');
  assert.equal(await M.Attendance.countDocuments({ classSession: cls._id }), 0, 'none of the refused scans marked anyone');

  const near = await scan(students[0], w.id, real, { lat: CAMPUS.lat + 0.0004, lng: CAMPUS.lng, accuracy: 15 });
  assert.equal(near.status, 200, JSON.stringify(near.body));
  const stored = await M.QrScan.findOne({ qrSession: w.id, outcome: 'accepted' });
  assert.ok(stored.distanceMeters > 30 && stored.distanceMeters < 60);
  assert.equal(stored.lat, 30.7337, 'coordinates are stored rounded to about 10 m');
  assert.equal(await M.QrScan.countDocuments({ qrSession: w.id, outcome: 'rejected' }), 3);

  // switching the geofence off does not loosen a window that is already open
  await hod.patch('/api/admin/settings', { qr: { geofence: { enabled: false } } });
  assert.equal((await scan(students[1], w.id, real)).body.error.code, 'LOCATION_REQUIRED');
  const fresh = (await start(t1, await newClass())).body.data;
  assert.equal(fresh.geofence, false, 'new windows follow the new setting');
  assert.ok(await M.QrScan.collection.indexes().then(ix => ix.some(i => i.expireAfterSeconds === 30 * 24 * 3600)), 'location rows expire after 30 days');
});

test('QR attendance can be switched off per college', async () => {
  await hod.patch('/api/admin/settings', { qr: { enabled: false } });
  assert.equal((await start(t1, await newClass())).body.error.code, 'QR_DISABLED');
  await hod.patch('/api/admin/settings', { qr: { enabled: true } });
  assert.equal((await start(t1, await newClass())).status, 201);
});

test('students can list the windows open for their own class (to type the code when the camera is unusable)', async () => {
  const cls = await newClass();
  const w = (await start(t1, cls)).body.data;
  const open = (await students[0].get('/api/student/qr-attendance/open')).body.data;
  const mine = open.find(o => o.id === w.id);
  assert.ok(mine);
  assert.deepEqual([mine.subject, mine.marked], ['Data Structures', false]);
  assert.ok(!JSON.stringify(open).includes('secret') && !('code' in mine), 'no code is ever listed');
  await scan(students[0], w.id, (await code(t1, cls)).code);
  assert.equal((await students[0].get('/api/student/qr-attendance/open')).body.data.find(o => o.id === w.id).marked, true);
  assert.equal((await t1.get('/api/student/qr-attendance/open')).status, 403);
});
