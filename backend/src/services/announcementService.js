const { Announcement, AnnouncementRead } = require('../models/Announcement');
const { Section } = require('../models');
const { NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { describe, removeFile } = require('../middleware/upload');
const audience = require('./audienceService');
const notifications = require('./notificationService');
const audit = require('./auditService');

const cleanup = files => (files || []).forEach(removeFile);

const normalizeAudience = a => ({
  all: Boolean(a.all), roles: a.roles || [], departments: a.departments || [], courses: a.courses || [],
  semesters: a.semesters || [], sections: a.sections || []
});

/** Department-scoped publishers may only address their own departments' sections; nobody may publish an empty audience. */
async function assertAudienceAllowed(req, aud) {
  const empty = !aud.all && !aud.roles.length && !aud.departments.length && !aud.courses.length && !aud.semesters.length && !aud.sections.length;
  if (empty) throw badRequest('Choose who should receive this announcement.', undefined, 'EMPTY_AUDIENCE');
  const scope = req.perms.scopeFor('announcements.publish');
  if (!scope) throw forbidden();
  if (scope.all) return;
  const sections = await Section.find({ college: req.college._id, department: { $in: scope.departments } }).select('_id').lean();
  const ok = new Set(sections.map(s => String(s._id)));
  const narrowed = aud.sections.length && aud.sections.every(s => ok.has(String(s))) || (aud.departments.length && aud.departments.every(d => scope.departments.includes(String(d))));
  if (aud.all || !narrowed) throw forbidden('You can only address your own departments.', 'OUT_OF_SCOPE');
}

async function validateTargets(collegeId, aud) {
  if (aud.sections.length && (await Section.countDocuments({ _id: { $in: aud.sections }, college: collegeId })) !== aud.sections.length) throw badRequest('A selected section was not found.', undefined, 'SECTION_NOT_FOUND');
}

async function create({ req, input, files }) {
  try {
    const aud = normalizeAudience(input.audience);
    await assertAudienceAllowed(req, aud);
    await validateTargets(req.college._id, aud);
    if (input.expiresAt && input.publishAt && input.expiresAt <= input.publishAt) throw badRequest('The expiry must be after the publication date.', undefined, 'INVALID_EXPIRY');
    const a = await Announcement.create({
      college: req.college._id, title: input.title, body: input.body, priority: input.priority || 'normal', audience: aud,
      publishAt: input.publishAt || null, expiresAt: input.expiresAt || null, attachments: files.map(describe),
      notify: { email: Boolean(input.notifyEmail), sms: Boolean(input.notifySms) }, author: req.user._id
    });
    await audit.fromRequest(req, { action: 'announcement.created', entityType: 'Announcement', entityId: a._id, meta: { title: a.title } });
    return input.publishNow ? publish({ req, id: a._id }) : a;
  } catch (err) { cleanup(files); throw err; }
}

async function load(req, id) {
  const a = await Announcement.findOne({ _id: id, college: req.college._id });
  if (!a) throw notFound('Announcement not found.');
  const mine = String(a.author) === String(req.user._id);
  if (!mine && !req.perms.canAny(['announcements.publish', 'announcements.view'])) throw forbidden();
  return a;
}

/** Edits are allowed before and after publication but never re-notify recipients; each edit is logged. */
async function update({ req, id, input }) {
  const a = await load(req, id);
  if (a.status === 'withdrawn') throw conflict('WITHDRAWN', 'Republish a withdrawn announcement before editing it.');
  const changed = Object.keys(input).filter(k => k !== 'audience');
  if (input.audience) {
    const aud = normalizeAudience(input.audience);
    await assertAudienceAllowed(req, aud);
    await validateTargets(req.college._id, aud);
    a.audience = aud;
    changed.push('audience');
  }
  ['title', 'body', 'priority', 'publishAt', 'expiresAt'].forEach(k => { if (input[k] !== undefined) a[k] = input[k]; });
  if (a.status === 'published') { a.revision += 1; a.edits.push({ at: new Date(), by: req.user._id, changed }); }
  await a.save();
  await audit.fromRequest(req, { action: 'announcement.updated', entityType: 'Announcement', entityId: a._id, meta: { changed } });
  return a;
}

/** Publishes (or republishes) and notifies each recipient exactly once per announcement. */
async function publish({ req, id }) {
  const a = await load(req, id);
  if (!req.perms.can('announcements.publish')) throw forbidden();
  if (a.status === 'published') return a;
  a.status = 'published'; a.publishedAt = a.publishedAt || new Date(); a.publishAt = a.publishAt || a.publishedAt;
  await a.save();
  await audit.fromRequest(req, { action: 'announcement.published', entityType: 'Announcement', entityId: a._id });
  if (!a.notifiedAt) {
    const claimed = await Announcement.updateOne({ _id: a._id, notifiedAt: { $exists: false } }, { $set: { notifiedAt: new Date() } });
    if (claimed.modifiedCount) await fanOut(req.college, a);
  }
  return Announcement.findById(a._id);
}

async function fanOut(college, a) {
  const users = await audience.recipients(college._id, a.audience);
  const urgent = a.priority === 'urgent';
  const force = { email: a.notify.email || urgent || undefined, sms: (a.notify.sms || urgent) && college.settings.smsEnabled ? true : undefined };
  for (const u of users) {
    await notifications.notify({
      collegeId: college._id, userId: u._id, type: NOTIFICATION_TYPES.ANNOUNCEMENT, title: a.title,
      message: a.body.length > 280 ? `${a.body.slice(0, 277)}...` : a.body, data: { announcementId: String(a._id), priority: a.priority },
      dedupeKey: `announce:${a._id}`, link: 'announcements', force: a.notify.email || a.notify.sms || urgent ? force : undefined
    }, { user: u, college });
  }
}

async function withdraw({ req, id }) {
  const a = await load(req, id);
  if (!req.perms.can('announcements.publish')) throw forbidden();
  if (a.status !== 'published') throw conflict('INVALID_TRANSITION', 'Only a published announcement can be withdrawn.');
  a.status = 'withdrawn'; await a.save();
  await audit.fromRequest(req, { action: 'announcement.withdrawn', entityType: 'Announcement', entityId: a._id });
  return a;
}

const live = now => ({ status: 'published', $and: [{ $or: [{ publishAt: null }, { publishAt: { $lte: now } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }] });

/** The signed-in user's announcements (published, started, not expired, addressed to them), newest first. */
async function feed({ college, user, unreadOnly = false, limit = 100 }) {
  const now = new Date();
  const [rows, ctx, reads] = await Promise.all([
    Announcement.find({ college: college._id, ...live(now) }).sort({ priority: -1, publishedAt: -1 }).limit(400).lean(),
    audience.contextFor(user),
    AnnouncementRead.find({ user: user._id }).select('announcement').lean()
  ]);
  const read = new Set(reads.map(r => String(r.announcement)));
  const order = { urgent: 0, high: 1, normal: 2, low: 3 };
  return rows.filter(a => audience.matches(a.audience, ctx)).map(a => ({
    id: String(a._id), title: a.title, body: a.body, priority: a.priority, publishedAt: a.publishedAt, expiresAt: a.expiresAt,
    attachments: a.attachments.map((f, i) => ({ index: i, name: f.originalName, size: f.size })), read: read.has(String(a._id)), edited: a.revision > 1
  })).filter(a => !unreadOnly || !a.read)
    .sort((x, y) => order[x.priority] - order[y.priority] || new Date(y.publishedAt) - new Date(x.publishedAt)).slice(0, limit);
}

/** Records that the user opened it; one row per user, so repeats are harmless. Users can only mark what they can see. */
async function markRead({ college, user, id }) {
  const a = await Announcement.findOne({ _id: id, college: college._id, ...live(new Date()) }).lean();
  if (!a || !audience.matches(a.audience, await audience.contextFor(user))) throw notFound('Announcement not found.');
  await AnnouncementRead.updateOne({ announcement: a._id, user: user._id }, { $setOnInsert: { readAt: new Date() } }, { upsert: true });
}

/** Management list (publishers see all in their scope; authors always see their own). */
async function manageList({ req }) {
  const filter = { college: req.college._id };
  if (!req.perms.canAny(['announcements.publish', 'announcements.view'])) filter.author = req.user._id;
  const rows = await Announcement.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  const now = Date.now();
  return rows.map(a => ({ ...a, expired: Boolean(a.expiresAt && a.expiresAt.getTime() <= now) }));
}

/** Audience size vs readers (and who has not read, for authors/administrators). */
async function stats({ req, id }) {
  const a = await load(req, id);
  const users = await audience.recipients(req.college._id, a.audience);
  const reads = await AnnouncementRead.find({ announcement: a._id }).select('user readAt').lean();
  const readIds = new Set(reads.map(r => String(r.user)));
  const unread = users.filter(u => !readIds.has(String(u._id)));
  return { recipients: users.length, read: users.length - unread.length, unreadNames: unread.slice(0, 200).map(u => ({ name: u.name, role: u.role })) };
}

/** An attachment, only to people the announcement is addressed to (or its managers). */
async function fileFor({ college, user, perms, id, index }) {
  const a = await Announcement.findOne({ _id: id, college: college._id }).lean();
  if (!a || !a.attachments[index]) throw notFound('File not found.');
  const manager = String(a.author) === String(user._id) || perms.canAny(['announcements.publish', 'announcements.view']);
  if (!manager) {
    const visible = a.status === 'published' && (!a.expiresAt || a.expiresAt > new Date()) && audience.matches(a.audience, await audience.contextFor(user));
    if (!visible) throw forbidden();
  }
  return { dir: 'announcements', meta: a.attachments[index], name: a.title };
}

module.exports = { create, update, publish, withdraw, feed, markRead, manageList, stats, fileFor };
