const svc = require('../services/assignmentService');
const { sendStored } = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/errors');

const ok = (res, data) => res.json({ data });
const ctx = req => ({ actor: req.user, perms: req.perms, college: req.college });

/* ---- faculty ---- */
exports.list = asyncHandler(async (req, res) => ok(res, await svc.listForFaculty(ctx(req))));
exports.create = asyncHandler(async (req, res) => res.status(201).json({ data: await svc.create({ ...ctx(req), input: req.body, files: req.files }) }));
exports.update = asyncHandler(async (req, res) => ok(res, await svc.update({ ...ctx(req), id: req.params.id, input: req.body })));
exports.publish = asyncHandler(async (req, res) => ok(res, await svc.publish({ ...ctx(req), id: req.params.id })));
exports.close = asyncHandler(async (req, res) => ok(res, await svc.close({ ...ctx(req), id: req.params.id })));
exports.submissions = asyncHandler(async (req, res) => ok(res, await svc.submissionsFor({ ...ctx(req), id: req.params.id })));
exports.grade = asyncHandler(async (req, res) => ok(res, await svc.grade({ ...ctx(req), id: req.params.id, studentId: req.params.studentId, ...req.body })));
exports.release = asyncHandler(async (req, res) => ok(res, await svc.release({ ...ctx(req), id: req.params.id })));

exports.addMaterial = asyncHandler(async (req, res) => res.status(201).json({ data: await svc.addMaterial({ ...ctx(req), input: req.body, file: req.files[0] }) }));
exports.removeMaterial = asyncHandler(async (req, res) => { await svc.removeMaterial({ ...ctx(req), id: req.params.id }); ok(res, { ok: true }); });
exports.materials = asyncHandler(async (req, res) => {
  const { Subject } = require('../models');
  const mine = req.perms.isSuper ? {} : { subject: { $in: (await Subject.find({ college: req.college._id, teacher: req.user._id }).select('_id').lean()).map(s => s._id) } };
  ok(res, await svc.listMaterials({ college: req.college, filter: { ...mine, ...(req.validatedQuery.subjectId ? { subject: req.validatedQuery.subjectId } : {}) } }));
});

/* ---- students ---- */
exports.myAssignments = asyncHandler(async (req, res) => ok(res, await svc.listForStudent({ college: req.college, profile: req.student })));
exports.submit = asyncHandler(async (req, res) => {
  const s = await svc.submit({ college: req.college, profile: req.student, user: req.user, assignmentId: req.params.id, files: req.files, note: req.body.note });
  res.status(201).json({ data: { id: String(s._id), late: s.late, attempt: s.attempt, submittedAt: s.submittedAt } });
});
exports.myMaterials = asyncHandler(async (req, res) => {
  const filter = { section: req.student.section, ...(req.validatedQuery.subjectId ? { subject: req.validatedQuery.subjectId } : {}) };
  const rows = await svc.listMaterials({ college: req.college, filter });
  ok(res, rows.map(r => ({ id: String(r._id), title: r.title, topic: r.topic, resourceType: r.resourceType, subject: r.subject, fileName: r.file.originalName, size: r.file.size, createdAt: r.createdAt })));
});

/** Authenticated downloads of private coursework files; access rules live in the service. */
exports.download = asyncHandler(async (req, res) => {
  const profile = req.user.role === 'student' ? req.student : null;
  const index = req.params.index || 0;
  // announcement attachments follow audience rules; coursework files follow enrolment/teaching rules
  const { dir, meta, name } = req.params.kind === 'announcement'
    ? await require('../services/announcementService').fileFor({ college: req.college, user: req.user, perms: req.perms, id: req.params.id, index })
    : await svc.fileFor({ ...ctx(req), kind: req.params.kind, id: req.params.id, index, profile });
  if (!sendStored(res, dir, meta, name)) throw notFound('The file is no longer available.');
});
