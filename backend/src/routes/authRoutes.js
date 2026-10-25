const express = require('express');
const ctrl = require('../controllers/authController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const v = require('../validators/auth');

module.exports = ({ limiters }) => {
  const router = express.Router();
  router.get('/college', validate(v.collegeLookup), ctrl.lookupCollege);
  router.get('/csrf', ctrl.csrf);
  router.post('/login', limiters.login, validate(v.login), ctrl.login);
  router.post('/logout', ctrl.logout);
  router.get('/me', requireAuth({ allowPasswordChange: true }), ctrl.me);
  router.post('/forgot-password', limiters.passwordReset, validate(v.forgotPassword), ctrl.forgotPassword);
  router.post('/reset-password', limiters.passwordReset, validate(v.resetPassword), ctrl.resetPassword);
  router.post('/change-password', limiters.sensitive, requireAuth({ allowPasswordChange: true }), validate(v.changePassword), ctrl.changePassword);
  return router;
};
