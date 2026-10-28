process.env.HEALTH_TOKEN = 'health-secret-for-tests';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let teacher; let clerk; let backups; let config; let dir;
const KEY = 'a1'.repeat(32);

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ({ config } = require('../../src/config/env'));
  backups = require('../../src/services/backupService');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendx-backups-'));
  config.backup.dir = dir;
  config.backup.encryptionKey = '';
  ctx = await seedCollege(M, { code: 'BKP1', students: 3 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  clerk = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'clerk@bkp1.edu' });
});
after(async () => {
  removeFakeProviders();
  fs.rmSync(dir, { recursive: true, force: true });
  await harness.stop();
});

test('backups need system.backup; the admin can create, list and verify one', async () => {
  assert.equal((await teacher.post('/api/admin/system/backups')).status, 403);
  assert.equal((await clerk.post('/api/admin/system/backups')).status, 403);
  assert.equal((await teacher.get('/api/admin/system/backups')).status, 403);

  const made = await hod.post('/api/admin/system/backups');
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.status, 'ok');
  assert.equal(made.body.data.encrypted, false);
  assert.ok(made.body.data.documents > 10);
  const file = path.join(dir, made.body.data.file);
  assert.ok(fs.existsSync(file) && fs.existsSync(`${file}.json`), 'the backup and its manifest exist');

  const list = (await hod.get('/api/admin/system/backups')).body.data;
  assert.equal(list[0].status, 'ok');
  assert.ok(!('file' in list[0]) || !path.isAbsolute(list[0].file), 'no absolute server paths are exposed');
  const check = await hod.post(`/api/admin/system/backups/${made.body.data.id}/verify`);
  assert.equal(check.status, 200);
  assert.equal(check.body.data.documents, made.body.data.documents);
  assert.ok(await M.AuditLog.findOne({ action: 'system.backup_created' }));
});

test('session data and locks are not backed up, but real data is', async () => {
  const run = (await backups.list())[0];
  const full = path.join(dir, run.file);
  const manifest = JSON.parse(fs.readFileSync(`${full}.json`, 'utf8'));
  assert.equal(manifest.documents, run.documents);
  assert.equal(manifest.sha256, run.sha256);
  const v = await backups.verifyFile(full);
  assert.ok(v.collections >= 8);
  assert.equal(await mongoose.connection.db.collection('sessions').countDocuments() > 0, true, 'the live database does have sessions');
});

test('a restore lands in a separate database with identical data; the live database is protected', async () => {
  const run = (await backups.list())[0];
  const file = path.join(dir, run.file);
  await assert.rejects(backups.restoreInto({ file, targetDb: mongoose.connection.name }), /live database/);

  const target = `attendx_restored_${Date.now()}`;
  const res = await backups.restoreInto({ file, targetDb: target });
  assert.equal(res.restored, run.documents);
  const restored = mongoose.connection.getClient().db(target);
  try {
    for (const name of ['users', 'studentprofiles', 'sections', 'colleges', 'academicsessions']) {
      assert.equal(await restored.collection(name).countDocuments(), await mongoose.connection.db.collection(name).countDocuments(), name);
    }
    const live = await mongoose.connection.db.collection('users').findOne({ email: ctx.hod.email });
    const back = await restored.collection('users').findOne({ email: ctx.hod.email });
    assert.deepEqual(back._id, live._id, 'ObjectIds are preserved');
    assert.equal(back.passwordHash, live.passwordHash);
    assert.equal(back.createdAt.getTime(), live.createdAt.getTime(), 'dates survive the round trip');
    assert.equal(await restored.collection('sessions').countDocuments(), 0);

    await assert.rejects(backups.restoreInto({ file, targetDb: target }), e => e.code === 'TARGET_NOT_EMPTY');
  } finally {
    await restored.dropDatabase();
  }
});

test('encrypted backups hide their content, verify with the key, and fail with a wrong key or any tampering', async () => {
  config.backup.encryptionKey = KEY;
  try {
    const run = await backups.createBackup();
    assert.ok(run.file.endsWith('.enc') && run.encrypted);
    const file = path.join(dir, run.file);
    const raw = fs.readFileSync(file);
    assert.ok(!raw.includes(Buffer.from('Test College BKP1')) && !raw.includes(Buffer.from(ctx.hod.email)), 'no plaintext in the file');
    assert.equal(raw.subarray(0, 4).toString(), 'AXB1');
    assert.equal((await backups.verifyFile(file)).documents, run.documents);

    config.backup.encryptionKey = 'b2'.repeat(32);
    await assert.rejects(backups.verifyFile(file), 'a wrong key cannot read it');
    config.backup.encryptionKey = '';
    await assert.rejects(backups.verifyFile(file), /encrypted/);
    config.backup.encryptionKey = 'not-hex';
    await assert.rejects(backups.verifyFile(file), /64 hex/);

    config.backup.encryptionKey = KEY;
    const flipped = Buffer.from(raw); flipped[Math.floor(raw.length / 2)] ^= 0xff;
    const bad = path.join(dir, 'tampered.ndjson.gz.enc');
    fs.writeFileSync(bad, flipped);
    await assert.rejects(backups.verifyFile(bad), 'a flipped byte is detected');
    fs.writeFileSync(bad, raw.subarray(0, raw.length - 200));
    await assert.rejects(backups.verifyFile(bad), 'a truncated file is detected');
    fs.rmSync(bad);
  } finally {
    config.backup.encryptionKey = '';
  }
});

test('plain-file tampering and a wrong recorded checksum are detected', async () => {
  const run = await backups.createBackup();
  const file = path.join(dir, run.file);
  await assert.rejects(backups.verifyFile(file, { expectSha: '0'.repeat(64) }), /checksum/);
  const raw = fs.readFileSync(file);
  fs.writeFileSync(file, raw.subarray(0, raw.length - 40));
  await assert.rejects(backups.verifyFile(file), 'truncated gzip is rejected');
  const stored = await M.BackupRun.findOne({ file: run.file });
  await assert.rejects(backups.verifyRun(stored._id), 'verifying through the run record also fails');
});

test('a failed backup is recorded, leaves no partial file, and does not block the next one', async () => {
  const before = fs.readdirSync(dir).length;
  const broken = { databaseName: 'x', listCollections: () => ({ toArray: async () => [{ name: 'boom' }] }), collection: () => ({ find: () => { throw new Error('disk on fire'); } }) };
  await assert.rejects(backups.createBackup({ db: broken }), /disk on fire/);
  assert.equal(fs.readdirSync(dir).length, before, 'the partial file was removed');
  const failed = await M.BackupRun.findOne({ status: 'failed' }).sort({ startedAt: -1 });
  assert.match(failed.error, /disk on fire/);
  assert.equal((await backups.createBackup()).status, 'ok');
});

test('a second backup cannot start while one is running', async () => {
  await M.BackupRun.create({ status: 'running' });
  await assert.rejects(backups.createBackup(), e => e.code === 'BACKUP_RUNNING');
  await M.BackupRun.deleteMany({ status: 'running' });
});

test('retention removes old backups but always keeps the newest few', async () => {
  await M.BackupRun.deleteMany({});
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
  const old = Date.now() - 30 * 86400000;
  const names = [];
  for (let i = 0; i < 5; i += 1) {
    const name = `attendx-old-${i}.ndjson.gz`;
    fs.writeFileSync(path.join(dir, name), 'x'); fs.writeFileSync(path.join(dir, `${name}.json`), '{}');
    await M.BackupRun.create({ status: 'ok', file: name, startedAt: new Date(old - i * 86400000) });
    names.push(name);
  }
  config.backup.retentionDays = 14; config.backup.keepMin = 3;
  const removed = await backups.applyRetention();
  assert.deepEqual(removed.sort(), [names[3], names[4]].sort(), 'only the two oldest are beyond keepMin');
  assert.ok(names.slice(0, 3).every(n => fs.existsSync(path.join(dir, n))), 'the newest three stay even though all are old');
  assert.ok(names.slice(3).every(n => !fs.existsSync(path.join(dir, n)) && !fs.existsSync(path.join(dir, `${n}.json`))));
});

test('the readiness endpoint reports the latest backup only to authorised callers', async () => {
  const anon = await harness.supertest().get('/ready');
  assert.equal(anon.status, 401);
  assert.equal((await harness.supertest().get('/ready').set('x-health-token', 'wrong')).status, 401);
  assert.equal((await teacher.get('/ready')).status, 403);
  const ok = await harness.supertest().get('/ready').set('x-health-token', config.healthToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.checks.database.ok, true);
  assert.ok(['ok', 'failed', 'running', 'none'].includes(ok.body.checks.backup.status));
  assert.ok(!JSON.stringify(ok.body).includes('mongodb://'), 'no connection string in the response');
  assert.equal((await harness.supertest().get('/health')).body.status, 'ok');
  assert.equal((await hod.get('/ready')).status, 200, 'users holding system.health may read it too');
});

test('the cleanup job removes stale import previews and expired reset tokens', async () => {
  const old = new Date(Date.now() - 20 * 86400000);
  await M.ImportBatch.create({ college: ctx.college._id, kind: 'books', checksum: 'x', status: 'previewed', createdBy: ctx.hod._id, expiresAt: old });
  await M.ImportBatch.create({ college: ctx.college._id, kind: 'books', checksum: 'y', status: 'previewed', createdBy: ctx.hod._id, expiresAt: new Date(Date.now() + 3600000) });
  await M.PasswordResetToken.create({ user: ctx.hod._id, tokenHash: 'h'.repeat(64), expiresAt: old });
  const jobs = require('../../src/jobs');
  assert.ok(jobs.jobNames().includes('backup') && jobs.jobNames().includes('cleanup'));
  const r = await jobs.runJob('cleanup');
  assert.equal(r.status, 'ok');
  assert.equal(r.stats.importPreviewsDeleted, 1);
  assert.equal(r.stats.resetTokensDeleted, 1);
  assert.equal(await M.ImportBatch.countDocuments(), 1, 'the live preview is kept');
});
