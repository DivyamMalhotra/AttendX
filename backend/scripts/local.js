/**
 * One command for a fresh clone:  npm run local   (from the repository root or backend/)
 *
 *  1. creates backend/.env from .env.example with a generated SESSION_SECRET (only if .env is missing)
 *  2. uses the MongoDB at MONGODB_URI if one is running, otherwise starts a local development database
 *     (mongodb-memory-server, data kept in <repo>/.mongodb-data)
 *  3. creates the demo college CAMPUS26 with a fixed, documented demo password (only if it does not exist yet)
 *  4. starts the server on http://localhost:3000
 *
 * Development only: it refuses to run when NODE_ENV=production.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const BACKEND = path.join(__dirname, '..');
const ENV_FILE = path.join(BACKEND, '.env');
const DEMO_PASSWORD = 'Attendx@2026';

function ensureEnv() {
  if (fs.existsSync(ENV_FILE)) return false;
  const example = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf8');
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(ENV_FILE, example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
  return true;
}

const portOpen = (port, host = '127.0.0.1') => new Promise(resolve => {
  const s = net.connect({ port, host });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.setTimeout(1500, () => { s.destroy(); resolve(false); });
});

async function ensureDatabase() {
  const { config } = require('../src/config/env');
  const url = new URL(config.mongoUri.replace(/^mongodb(\+srv)?:/, 'http:'));
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  const port = Number(url.port) || 27017;
  if (await portOpen(port, url.hostname)) { console.log(`Using the MongoDB already running at ${url.hostname}:${port}.`); return null; }
  if (!local) throw new Error(`Cannot reach MongoDB at ${config.mongoUri}. Check MONGODB_URI in backend/.env.`);
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbPath = path.join(BACKEND, '..', '.mongodb-data');
  fs.mkdirSync(dbPath, { recursive: true });
  console.log('Starting the local development database (the first run downloads MongoDB, which can take a minute)...');
  const server = await MongoMemoryServer.create({ instance: { dbPath, port, storageEngine: 'wiredTiger' } });
  console.log(`Local MongoDB running at ${server.getUri()} (data in ${dbPath}).`);
  return server;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('npm run local is for development only (NODE_ENV=production is set).');
  if (ensureEnv()) console.log('Created backend/.env with a new random SESSION_SECRET.');

  const dbServer = await ensureDatabase();
  const stopDb = async () => { if (dbServer) await dbServer.stop({ doCleanup: false }); };

  const { connectDb, disconnectDb } = require('../src/config/db');
  const models = require('../src/models');
  await connectDb();
  await Promise.all(Object.values(models).map(m => m.init()));
  const campus = require('./seed-campus-demo');
  const seeded = await campus.run({ password: DEMO_PASSWORD, mustChange: false, quiet: true });
  const listFile = path.join(BACKEND, 'data', '5G3_Student_List.csv');
  if (fs.existsSync(listFile)) {
    const college = await models.College.findOne({ code: campus.CODE });
    const run = await require('./lib/seed5g3').seedStudents({ college, text: fs.readFileSync(listFile, 'utf8'), apply: true, onError: m => console.error(m) });
    if (run.aborted) console.error(`5G3 list skipped: ${run.summary.blocking.join(' ')}`);
    else {
      console.log(`5G3 student list: ${run.result.studentsCreated} students added, ${run.result.studentsReused} already there.`);
      // each machine generates its own random temporary passwords; they go only to this private, git-ignored file
      if (run.credentials.length) console.log(`Temporary student passwords (private, git-ignored): ${require('./seed-5g3').writeCredentials(run.credentials)}`);
    }
  }
  await disconnectDb();
  console.log(seeded.created ? `Demo college ${campus.CODE} created.` : `Demo college ${campus.CODE} already exists.`);

  console.log(`\n  Open ${require('../src/config/env').config.appBaseUrl}\n  College code: ${campus.CODE}\n  Demo password for every demo account: ${DEMO_PASSWORD}\n`
    + `  Administrator: admin@${campus.DOMAIN}   Teacher: sameer.khanna@${campus.DOMAIN}   Student: aditya.sharma@student.${campus.DOMAIN}\n`
    + `  Accounts Clerk: accounts.clerk@${campus.DOMAIN}   Exam Cell: exam.cell@${campus.DOMAIN}\n`);

  ['SIGINT', 'SIGTERM'].forEach(sig => process.once(sig, () => { stopDb().finally(() => process.exit(0)); }));
  require('../src/server');   // starts the web server (it connects to the same database)
}

main().catch(err => { console.error(err.message); process.exit(1); });
