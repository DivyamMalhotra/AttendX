const mongoose = require('mongoose');

/** Record of every backup attempt, so failures are visible and retention decisions are auditable. */
const schema = new mongoose.Schema({
  status: { type: String, enum: ['running', 'ok', 'failed'], required: true },
  method: { type: String, enum: ['mongodump', 'json'], default: 'json' },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null },
  file: { type: String, default: '' },
  sizeBytes: { type: Number, default: 0 },
  sha256: { type: String, default: '' },
  encrypted: { type: Boolean, default: false },
  collections: { type: Number, default: 0 },
  documents: { type: Number, default: 0 },
  deletedByRetention: { type: [String], default: [] },
  error: { type: String, default: '' }
});
schema.index({ startedAt: -1 });

module.exports = mongoose.model('BackupRun', schema);
