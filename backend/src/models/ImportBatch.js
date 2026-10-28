const mongoose = require('mongoose');

const rowSchema = new mongoose.Schema({
  line: { type: Number, required: true },                       // line number in the uploaded file (header = 1)
  data: { type: mongoose.Schema.Types.Mixed, default: {} },     // validated values; never contains passwords
  problems: { type: [String], default: [] },
  state: { type: String, enum: ['pending', 'ok', 'skipped', 'failed'], default: 'pending' },
  message: { type: String, default: '' }
}, { _id: false });

/**
 * One bulk import. Nothing is written to the real collections at upload time ("preview"): rows are validated and
 * parked here. Only an explicit confirm applies them, once, and each row records its own outcome, so a batch
 * interrupted half-way can be resumed without redoing finished rows.
 */
const importBatchSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  kind: { type: String, required: true, enum: ['students', 'books', 'marks'] },
  params: { type: mongoose.Schema.Types.Mixed, default: {} },
  fileName: { type: String, default: '' },
  checksum: { type: String, required: true },
  status: { type: String, enum: ['previewed', 'importing', 'completed', 'failed', 'cancelled'], default: 'previewed' },
  rows: { type: [rowSchema], default: [] },
  totals: {
    rows: { type: Number, default: 0 }, valid: { type: Number, default: 0 }, invalid: { type: Number, default: 0 },
    ok: { type: Number, default: 0 }, skipped: { type: Number, default: 0 }, failed: { type: Number, default: 0 }
  },
  extras: { type: mongoose.Schema.Types.Mixed, default: {} },    // kind-specific counters (e.g. welcome e-mails)
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedAt: { type: Date, default: null },
  leaseUntil: { type: Date, default: null },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

importBatchSchema.index({ college: 1, createdAt: -1 });
importBatchSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('ImportBatch', importBatchSchema);
