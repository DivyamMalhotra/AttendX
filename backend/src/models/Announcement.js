const mongoose = require('mongoose');

const who = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };
const oid = ref => ({ type: [{ type: mongoose.Schema.Types.ObjectId, ref }], default: [] });

const announcementSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  body: { type: String, required: true, trim: true, maxlength: 10000 },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  /**
   * Who sees it. Each non-empty dimension narrows the audience (AND between dimensions, OR inside one).
   * `all` = everyone in the college; roles/departments/courses/semesters/sections narrow it down.
   */
  audience: {
    all: { type: Boolean, default: false },
    roles: { type: [String], default: [] },
    departments: oid('Department'),
    courses: { type: [String], default: [] },
    semesters: { type: [Number], default: [] },
    sections: oid('Section')
  },
  publishAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  status: { type: String, enum: ['draft', 'published', 'withdrawn'], default: 'draft' },
  attachments: { type: [{ storedName: String, originalName: String, mimeType: String, size: Number, _id: false }], default: [] },
  notify: { email: { type: Boolean, default: false }, sms: { type: Boolean, default: false } },
  author: who,
  publishedAt: Date,
  notifiedAt: Date,        // set the first time recipients were notified; editing or republishing never notifies again
  revision: { type: Number, default: 1 },
  edits: { type: [{ at: Date, by: who, changed: [String], _id: false }], default: [] }
}, { timestamps: true });
announcementSchema.index({ college: 1, status: 1, publishAt: -1 });

const readSchema = new mongoose.Schema({
  announcement: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  readAt: { type: Date, default: Date.now }
});
readSchema.index({ announcement: 1, user: 1 }, { unique: true });
readSchema.index({ user: 1 });

module.exports = {
  Announcement: mongoose.model('Announcement', announcementSchema),
  AnnouncementRead: mongoose.model('AnnouncementRead', readSchema)
};
