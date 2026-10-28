const { config } = require('../../config/env');
const { AppError } = require('../../utils/errors');
const { createRazorpayProvider } = require('./razorpayProvider');
const { createSimulatorProvider } = require('./simulatorProvider');

let current = null;

/**
 * Returns the configured payment provider. Adding another gateway means adding a module
 * that implements the same interface and registering it here; the fee code is untouched.
 */
function getProvider() {
  if (current) return current;
  const { provider, razorpay } = config.payments;
  if (provider === 'razorpay') current = createRazorpayProvider(razorpay);
  else if (provider === 'simulator') current = createSimulatorProvider();
  else {
    throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED',
      'Online payments are not configured on this server. Ask the administrator to set the payment gateway credentials.');
  }
  return current;
}

const isConfigured = () => Boolean(current) || config.payments.provider !== 'none';

/** Test hook: inject a provider instance (e.g. Razorpay with a stubbed fetch). */
function setProviderForTests(provider) {
  current = provider;
}

module.exports = { getProvider, isConfigured, setProviderForTests };
