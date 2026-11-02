const { College } = require('../models');
const { AppError } = require('../utils/errors');

/**
 * AttendX is deployed for one college. Keeping this lookup in one place prevents
 * authentication and background jobs from accidentally reintroducing tenancy.
 */
async function getCentralCollege({ required = true } = {}) {
  const colleges = await College.find({ active: true }).sort({ createdAt: 1 }).limit(2);
  if (colleges.length > 1) {
    throw new AppError(500, 'MULTIPLE_COLLEGES_CONFIGURED', 'Only one active college may be configured.');
  }
  if (!colleges[0] && required) {
    throw new AppError(503, 'COLLEGE_NOT_CONFIGURED', 'The college is not configured yet. Run the one-time college setup command.');
  }
  return colleges[0] || null;
}

module.exports = { getCentralCollege };
