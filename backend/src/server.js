const mongoose = require('mongoose');
const { config, assertStartupConfig } = require('./config/env');
const { connectDb, disconnectDb } = require('./config/db');
const { createSessionMiddleware } = require('./config/session');
const { createApp } = require('./app');
const models = require('./models');
const { startJobs } = require('./jobs');
const logger = require('./utils/logger');

async function main() {
  assertStartupConfig();
  await connectDb();
  // Make sure every unique index (roll numbers, attendance, duty leave, payments...) exists before serving traffic.
  await Promise.all(Object.values(models).map(m => m.init()));

  const sessionMiddleware = createSessionMiddleware({ client: mongoose.connection.getClient() });
  const app = createApp({ sessionMiddleware });
  const stopJobs = startJobs();

  const server = app.listen(config.port, () => {
    logger.info(`AttendX listening on port ${config.port}`, { env: config.nodeEnv, payments: config.payments.provider });
    if (config.payments.provider === 'none') logger.warn('Online payments are disabled: no payment provider is configured.');
    if (config.payments.provider === 'simulator') logger.warn('Payment SIMULATOR active: no real money moves. Configure Razorpay for live payments.');
  });

  const shutdown = async signal => {
    logger.info(`${signal} received, shutting down`);
    stopJobs();
    server.close(async () => { await disconnectDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  ['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
}

main().catch(err => {
  logger.error('Failed to start', { error: err.message });
  process.exit(1);
});
