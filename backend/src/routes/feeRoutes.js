const express = require('express');
const ctrl = require('../controllers/feeController');
const validate = require('../middleware/validate');
const v = require('../validators/fees');

/** Mounted at /api/fees behind requireAuth + requireRole(student) + loadOwnStudent. */
module.exports = ({ limiters }) => {
  const router = express.Router();
  router.get('/summary', ctrl.summary);
  router.get('/assignments/:id', validate(v.idParam), ctrl.assignment);
  router.get('/history', ctrl.history);
  router.get('/refunds', require('../controllers/financeController').myRefunds);
  router.get('/receipts/:receiptId/pdf', validate(v.receiptParam), ctrl.receiptPdf);

  router.post('/orders', limiters.sensitive, validate(v.createOrder), ctrl.createOrder);
  router.post('/orders/:orderId/verify', limiters.sensitive, validate(v.verify), ctrl.verify);
  router.post('/orders/:orderId/sync', validate(v.orderParam), ctrl.sync);
  router.post('/orders/:orderId/cancel', validate(v.orderParam), ctrl.cancel);
  router.post('/orders/:orderId/simulate', validate(v.simulatorPay), ctrl.simulatorPay);
  return router;
};
