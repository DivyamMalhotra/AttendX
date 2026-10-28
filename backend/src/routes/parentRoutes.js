const express = require('express');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const parents = require('../services/parentService');
const results = require('../services/resultService');
const audit = require('../services/auditService');
const { StudentProfile, User } = require('../models');
const { notFound, forbidden } = require('../utils/errors');

/**
 * Parent portal, mounted at /api/parent behind requireAuth + requireRole(parent). A parent can do exactly three things for
 * a child they hold an active, institution-verified link to: list their children, read PUBLISHED marks, and view and pay
 * that child's fees (through the same trusted payment pipeline students use). Nothing else is routed here.
 */
module.exports = ({ limiters }) => {
  const router = express.Router();
  router.get('/children', asyncHandler(async (req, res) => res.json({ data: await parents.children(req.user) })));

  const child = express.Router({ mergeParams: true });
  // Turns the client-supplied id into a verified link or a 404; every route below sees only req.student.
  child.use(asyncHandler(async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.studentId)) throw notFound('Student not found.');
    req.student = await parents.authoriseChild(req.user, req.params.studentId);
    req.studentUser = await User.findById(req.student.user).select('name').lean();
    next();
  }));
  const shares = area => (req, res, next) => {
    if (!req.college.settings.parentVisibility[area]) return next(forbidden('The college does not share this with parents.', 'NOT_SHARED'));
    return next();
  };

  child.get('/results', shares('results'), asyncHandler(async (req, res) => {
    await audit.record({ actor: req.user, collegeId: req.college._id, action: 'parent.viewed', entityType: 'StudentProfile', entityId: req.student._id, meta: { area: 'results' } });
    res.json({ data: await results.forStudent(req.student._id) });   // published results only
  }));
  child.use('/fees', shares('fees'), require('./feeRoutes')({ limiters }));

  router.use('/children/:studentId', child);
  return router;
};
