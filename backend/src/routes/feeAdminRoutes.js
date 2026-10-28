const router = require('express').Router();
const ctrl = require('../controllers/feeAdminController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/fees');
const fin = require('../controllers/financeController');
const fv = require('../validators/finance');

/** Mounted at /api/admin/fees behind a console role + the permission checks. */
router.get('/summary', need('fees.view', 'payments.view', 'dashboard.view'), ctrl.summary);

router.get('/structures', need('fees.configure', 'fees.view', 'fees.assign'), ctrl.listStructures);
router.post('/structures', need('fees.configure'), validate(v.structureCreate), ctrl.createStructure);
router.patch('/structures/:id', need('fees.configure'), validate(v.structureUpdate), ctrl.updateStructure);
router.delete('/structures/:id', need('fees.configure'), validate(v.idParam), ctrl.deleteStructure);

router.post('/assign', need('fees.assign'), validate(v.assign), ctrl.assign);
router.get('/assignments', need('fees.view', 'fees.assign'), validate(v.assignmentList), ctrl.listAssignments);
router.post('/assignments/:id/adjust', need('fees.assign'), validate(v.adjust), ctrl.adjust);

router.get('/transactions', need('payments.view'), validate(v.transactionList), ctrl.listTransactions);
router.get('/transactions/:id', need('payments.view'), validate(v.idParam), ctrl.transaction);
router.post('/transactions/:id/reconcile', need('payments.reconcile'), validate(v.idParam), ctrl.reconcile);
router.get('/receipts/:id/pdf', need('payments.view'), validate(v.idParam), ctrl.receiptPdf);

/* refunds: raised by one person, approved by another (maker-checker) */
router.get('/refunds', need('refunds.request', 'refunds.approve', 'payments.view'), validate(fv.refundList), fin.listRefunds);
router.post('/refunds', need('refunds.request'), validate(fv.refundRequest), fin.requestRefund);
router.post('/refunds/:id/approve', need('refunds.approve'), validate(fv.refundDecision), fin.approveRefund);
router.post('/refunds/:id/reject', need('refunds.approve'), validate(fv.refundDecision), fin.rejectRefund);
router.post('/refunds/:id/retry', need('refunds.approve'), validate(fv.id), fin.retryRefund);

/* late fees */
router.get('/late-fee-policy', need('fees.configure', 'fees.view'), fin.getPolicy);
router.put('/late-fee-policy', need('fees.configure'), validate(fv.policy), fin.savePolicy);
router.get('/late-fees', need('fees.view', 'latefees.waive'), validate(fv.lateFeeList), fin.listLateFees);
router.post('/late-fees/run', need('fees.configure'), fin.runLateFees);
router.post('/late-fees/:id/waive', need('latefees.waive'), validate(fv.waive), fin.waiveLateFee);

router.get('/reports/outstanding', need('fees.view', 'reports.export'), validate(v.outstandingQuery), ctrl.outstanding);

module.exports = router;
