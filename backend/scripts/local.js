/**
 * One command for a fresh clone:  npm run local   (from the repository root or backend/)
 *
 *  1. creates backend/.env from .env.example with a generated SESSION_SECRET (only if .env is missing)
 *  2. uses the MongoDB at MONGODB_URI if one is running, otherwise starts a local development database
 *     (mongodb-memory-server, data kept in <repo>/.mongodb-data)
 *  3. seeds ONLY an empty database: if the demo college CAMPUS26 and the 5G3 list are already there, nothing is
 *     touched, so you never have to seed again (data lives in <repo>/.mongodb-data between runs)
 *  4. starts the server on http://localhost:3000
 *
 * `npm run dev` runs this same script, so one command is all you need every time.
 *
 * Development only: it refuses to run when NODE_ENV=production.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const BACKEND = path.join(__dirname, '..');
const ENV_FILE = path.join(BACKEND, '.env');
const DEMO_PASSWORD = 'Krish@2006';

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
  const dbPath = process.env.DB_DATA_DIR ? path.resolve(process.env.DB_DATA_DIR) : path.join(BACKEND, '..', '.mongodb-data');
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
  // a database that was stopped abruptly can need a few seconds before it accepts connections: retry instead of failing
  for (let attempt = 1; ; attempt += 1) {
    try { await connectDb(); break; } catch (err) {
      if (attempt >= 6) throw err;
      console.log(`Waiting for the database (attempt ${attempt} of 6)...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  await Promise.all(Object.values(models).map(m => m.init()));
  const campus = require('./seed-campus-demo');
  const hasCollege = await models.College.findOne({ code: campus.CODE }).select('_id').lean();
  const hasList = hasCollege && await models.Section.exists({ college: hasCollege._id, nameKey: '5g3' });
  let seeded = { created: false };
  if (hasCollege && hasList) {
    console.log(`Existing data found (${campus.CODE}). Nothing to seed.`);
  } else {
    seeded = await campus.run({ password: DEMO_PASSWORD, mustChange: false, quiet: true });
    const listFile = path.join(BACKEND, 'data', '5G3_Student_List.csv');
    if (fs.existsSync(listFile)) {
      const college = await models.College.findOne({ code: campus.CODE });
      const run = await require('./lib/seed5g3').seedStudents({ college, text: fs.readFileSync(listFile, 'utf8'), apply: true, fixedPassword: DEMO_PASSWORD, onError: m => console.error(m) });
      if (run.aborted) console.error(`5G3 list skipped: ${run.summary.blocking.join(' ')}`);
      else {
        console.log(`5G3 student list: ${run.result.studentsCreated} students added, ${run.result.studentsReused} already there.`);
      }
    }
  }
  await disconnectDb();
  if (seeded.created) console.log(`Demo college ${campus.CODE} created.`);

  const url = require('../src/config/env').config.appBaseUrl;
  if (seeded.created) {
    console.log(`
  Open ${url}
  College code: ${campus.CODE}
  Demo password for every demo account: ${DEMO_PASSWORD}
`
      + `  Administrator: admin@${campus.DOMAIN}   Teacher: sameer.khanna@${campus.DOMAIN}   Student: aditya.sharma@student.${campus.DOMAIN}
`
      + `  Accounts Clerk: accounts.clerk@${campus.DOMAIN}   Exam Cell: exam.cell@${campus.DOMAIN}
`);
  } else {
    console.log(`
  Open ${url}   (college code ${campus.CODE}; sign in with your existing accounts)
`);
  }

  ['SIGINT', 'SIGTERM'].forEach(sig => process.once(sig, () => { stopDb().finally(() => process.exit(0)); }));
  require('../src/server');   // starts the web server (it connects to the same database)
}

main().catch(err => { console.error(err.message); process.exit(1); });
