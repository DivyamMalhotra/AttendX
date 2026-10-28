const access = require('../services/accessService');
const asyncHandler = require('../utils/asyncHandler');

const ok = (res, data) => res.json({ data });
const created = (res, data) => res.status(201).json({ data });

exports.permissions = (req, res) => ok(res, access.catalogue());
exports.roles = asyncHandler(async (req, res) => ok(res, await access.listRoles(req.college._id)));
exports.createRole = asyncHandler(async (req, res) => created(res, await access.createRole(req.user, req.perms, req.college._id, req.body)));
exports.updateRole = asyncHandler(async (req, res) => ok(res, await access.updateRole(req.user, req.perms, req.college._id, req.params.id, req.body)));

exports.staff = asyncHandler(async (req, res) => ok(res, await access.listStaff(req.college._id)));
exports.createStaff = asyncHandler(async (req, res) => {
  const u = await access.createStaff(req.user, req.perms, req.college._id, req.body);
  created(res, u.toPublic());
});
exports.updateStaff = asyncHandler(async (req, res) => {
  const u = await access.updateUserAccess(req.user, req.perms, req.college._id, req.params.id, req.body);
  ok(res, u.toPublic());
});

exports.departments = asyncHandler(async (req, res) => ok(res, await access.listDepartments(req.college._id)));
exports.createDepartment = asyncHandler(async (req, res) => created(res, await access.saveDepartment(req.user, req.college._id, null, req.body)));
exports.updateDepartment = asyncHandler(async (req, res) => ok(res, await access.saveDepartment(req.user, req.college._id, req.params.id, req.body)));
exports.setSectionDepartment = asyncHandler(async (req, res) => ok(res, await access.setSectionDepartment(req.user, req.college._id, req.params.id, req.body.departmentId)));
