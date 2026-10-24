/**
 * Development convenience: runs a local MongoDB (via mongodb-memory-server, a dev dependency)
 * with data persisted in ./.mongodb-data, so you can try AttendX without installing MongoDB.
 * Do NOT use this for production; point MONGODB_URI at a real MongoDB deployment instead.
 *
 *   npm run dev:db        (leave it running, then in another terminal: npm run dev)
 */
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const dbPath = path.join(process.cwd(), '.mongodb-data');
  fs.mkdirSync(dbPath, { recursive: true });
  const server = await MongoMemoryServer.create({ instance: { dbPath, port: 27017, storageEngine: 'wiredTiger' } });
  console.log(`Local MongoDB running at ${server.getUri()} (data in ${dbPath}). Press Ctrl+C to stop.`);
  const stop = async () => { await server.stop({ doCleanup: false }); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch(err => { console.error(err.message); process.exit(1); });
