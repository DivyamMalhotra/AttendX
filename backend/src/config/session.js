const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { config } = require('./env');

const COOKIE_NAME = 'attendx.sid';

/**
 * Builds the express-session middleware. A persistent MongoDB-backed store is used
 * everywhere (never the default MemoryStore), so sessions survive restarts and
 * work across several server instances.
 */
function createSessionMiddleware({ mongoUrl, client } = {}) {
  const store = MongoStore.create({
    ...(client ? { client } : { mongoUrl: mongoUrl || config.mongoUri }),
    collectionName: 'sessions',
    ttl: Math.floor(config.sessionTtlMs / 1000),
    touchAfter: 60
  });

  const middleware = session({
    name: COOKIE_NAME,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionTtlMs
    }
  });
  middleware.store = store;
  return middleware;
}

module.exports = { createSessionMiddleware, COOKIE_NAME };
