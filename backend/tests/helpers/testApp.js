/**
 * Integration test harness: an isolated in-memory MongoDB, a real Express app with
 * persistent (Mongo-backed) sessions, and helpers that sign in through the real login API.
 * Environment must be set before any application module is loaded.
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'simulator';
process.env.BCRYPT_ROUNDS = '4';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), `attendx-test-uploads-${process.pid}`);

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;
let app;
let M;
let sessionMw;

async function start(options = {}) {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('attendx_test');
  await mongoose.connect(uri);
  M = require('../../src/models');
  await Promise.all(Object.values(M).map(m => m.init()));
  const { createSessionMiddleware } = require('../../src/config/session');
  const { createApp } = require('../../src/app');
  sessionMw = createSessionMiddleware({ mongoUrl: uri });
  app = createApp({ sessionMiddleware: sessionMw, limiterOverrides: options.limiterOverrides });
  return { app, models: M };
}

async function stop() {
  if (sessionMw) await sessionMw.store.close();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  require('fs').rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
}

/** A supertest agent that keeps cookies and automatically sends the CSRF header. */
async function login({ collegeCode, email, password }) {
  const agent = request.agent(app);
  const pre = await agent.get('/api/auth/csrf');
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', pre.body.data.csrfToken).send({ collegeCode, email, password });
  if (res.status !== 200) return { agent, res };
  const csrf = res.body.data.csrfToken;
  const wrap = method => (url, body) => {
    const r = agent[method](url).set('X-CSRF-Token', csrf);
    return body === undefined ? r : r.send(body);
  };
  return {
    res, user: res.body.data.user, csrf,
    get: url => agent.get(url), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete'), raw: agent
  };
}

/** POST without signing in (forgot/reset password): gets a CSRF token through a throw-away session first. */
async function postPublic(url, body) {
  const agent = request.agent(app);
  const pre = await agent.get('/api/auth/csrf');
  return agent.post(url).set('X-CSRF-Token', pre.body.data.csrfToken).send(body);
}

const getApp = () => app;
const supertest = () => request(app);

module.exports = { start, stop, login, postPublic, getApp, supertest, models: () => M };
