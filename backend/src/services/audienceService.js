const { User, StudentProfile, Subject } = require('../models');
const { ROLES } = require('../config/constants');

/**
 * Works out, for a user, the organisational facts an announcement audience is matched against
 * (sections they study/teach, departments, courses, semesters). One function per base role keeps the
 * matching rule in a single place for both "who sees this?" and "who should be notified?".
 */
const emptyCtx = role => ({ role, sections: new Set(), departments: new Set(), courses: new Set(), semesters: new Set() });

function addSection(ctx, section) {
  if (!section) return;
  ctx.sections.add(String(section._id));
  if (section.department) ctx.departments.add(String(section.department));
  if (section.course) ctx.courses.add(section.course);
  if (section.semesterNumber) ctx.semesters.add(section.semesterNumber);
}

/** Contexts for many users at once (bulk fan-out). Returns Map(userId -> ctx). */
async function contextsFor(collegeId, users) {
  const out = new Map(users.map(u => [String(u._id), emptyCtx(u.role)]));
  const byRole = role => users.filter(u => u.role === role);

  const students = byRole(ROLES.STUDENT);
  if (students.length) {
    const profiles = await StudentProfile.find({ user: { $in: students.map(s => s._id) }, active: true }).populate('section').lean();
    profiles.forEach(p => addSection(out.get(String(p.user)), p.section));
  }
  const teachers = byRole(ROLES.TEACHER);
  if (teachers.length) {
    const subjects = await Subject.find({ college: collegeId, teacher: { $in: teachers.map(t => t._id) } }).populate('section').lean();
    subjects.forEach(s => addSection(out.get(String(s.teacher)), s.section));
  }
  [...byRole(ROLES.STAFF), ...byRole(ROLES.TEACHER), ...byRole(ROLES.HOD)].forEach(u => (u.departments || []).forEach(d => out.get(String(u._id)).departments.add(String(d))));

  const parents = byRole(ROLES.PARENT);
  if (parents.length) {
    // children's sections (the parent module registers its model; absent before it exists)
    const { ParentLink } = require('../models');
    if (ParentLink) {
      const links = await ParentLink.find({ parent: { $in: parents.map(p => p._id) }, status: 'active' }).populate({ path: 'student', populate: { path: 'section' } }).lean();
      links.forEach(l => l.student && addSection(out.get(String(l.parent)), l.student.section));
    }
  }
  return out;
}

const intersects = (set, list) => list.some(x => set.has(x));

/** Does this announcement's audience include a user with that context? */
function matches(audience, ctx) {
  if (ctx.role === ROLES.HOD) return true;                         // the college administrator sees everything
  if (audience.roles.length && !audience.roles.includes(ctx.role)) return false;
  if (audience.all) return true;
  const dims = [];
  if (audience.departments.length) dims.push(intersects(ctx.departments, audience.departments.map(String)));
  if (audience.courses.length) dims.push(intersects(ctx.courses, audience.courses));
  if (audience.semesters.length) dims.push(intersects(ctx.semesters, audience.semesters));
  if (audience.sections.length) dims.push(intersects(ctx.sections, audience.sections.map(String)));
  if (!dims.length) return audience.roles.length > 0;            // only roles were given: everyone with that role
  return dims.every(Boolean);
}

/** Active users that should receive an announcement. */
async function recipients(collegeId, audience) {
  const roleFilter = audience.roles.length ? { role: { $in: audience.roles } } : {};
  const users = await User.find({ college: collegeId, active: true, ...roleFilter }).select('name email phone role departments notificationPrefs').lean();
  const contexts = await contextsFor(collegeId, users);
  return users.filter(u => matches(audience, contexts.get(String(u._id))));
}

async function contextFor(user) {
  return (await contextsFor(user.college, [user])).get(String(user._id));
}

module.exports = { contextsFor, contextFor, matches, recipients };
