const mongoose = require('mongoose');
const { config } = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

async function connectDb(uri = config.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  logger.info('MongoDB connected');
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
