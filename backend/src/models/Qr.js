const mongoose = require('mongoose');

/**
 * A QR attendance window opened by faculty for one class. The signing secret never leaves the server: the code
 * shown on the teacher's screen is derived from it and changes every `periodSeconds`, so a photo of the screen
 * stops working within seconds. The geofence is copied from the college settings when the window opens, so
 * changing the settings later does not alter a window that is already running.
 */
const qrSessionSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  classSession: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSession', required: true },
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  secret: { type: String, required: true, select: false },
  periodSeconds: { type: Number, required: true, min: 5, max: 300 },
  opensAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  closedAt: { type: Date, default: null },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  geofence: {
    enabled: { type: Boolean, default: false },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    radiusMeters: { type: Number, default: 200 }
  },
  accepted: { type: Number, default: 0 }
}, { timestamps: true });

// at most one open window per class
qrSessionSchema.index({ classSession: 1 }, { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_qr_per_class' });
qrSessionSchema.index({ college: 1, createdAt: -1 });

/** Every scan attempt, accepted or not. Location is rounded to ~10 m and the rows disappear after 30 days. */
const qrScanSchema = new mongoose.Schema({
  qrSession: { type: mongoose.Schema.Types.ObjectId, ref: 'QrSession', required: true },
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  outcome: { type: String, enum: ['accepted', 'rejected'], required: true },
  reason: { type: String, default: '' },
  distanceMeters: { type: Number, default: null },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  accuracy: { type: Number, default: null },
  ip: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 30 * 24 * 3600 } }
});
qrScanSchema.index({ qrSession: 1, student: 1 }, { unique: true, partialFilterExpression: { outcome: 'accepted' }, name: 'one_accepted_scan_per_student' });
qrScanSchema.index({ qrSession: 1, student: 1, outcome: 1 });

module.exports = { QrSession: mongoose.model('QrSession', qrSessionSchema), QrScan: mongoose.model('QrScan', qrScanSchema) };
