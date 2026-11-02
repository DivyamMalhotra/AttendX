/**
 * One-time bootstrap for the single-college installation.
 *
 * Example:
 *   COLLEGE_ADMIN_PASSWORD='StrongPass1' npm run college:setup -- \
 *     --college-name "Government Engineering College" \
 *     --admin-name "Dr. Anjali Verma" --admin-email admin@college.edu
 */
const { config } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const models = require('../src/models');
const authService = require('../src/services/authService');
const { password: passwordSchema, email: emailSchema } = require('../src/validators/common');
const { parseArgs, ask, fail } = require('./lib/cli');

async function main() {
  const args = parseArgs();
  const name = String(args['college-name'] || process.env.COLLEGE_NAME || await ask('College name: ')).trim();
  const adminName = String(args['admin-name'] || await ask('Administrator full name: ')).trim();
  const adminEmail = String(args['admin-email'] || await ask('Administrator email: ')).trim().toLowerCase();
  const password = process.env.COLLEGE_ADMIN_PASSWORD || await ask('Administrator password (hidden): ', { hidden: true });
  if (!name || !adminName) fail('College and administrator names are required.');
  if (!emailSchema.safeParse(adminEmail).success) fail('That is not a valid administrator email address.');
  const validPassword = passwordSchema.safeParse(password);
  if (!validPassword.success) fail(validPassword.error.issues[0].message);

  await connectDb(config.mongoUri);
  await Promise.all(Object.values(models).map(model => model.init()));
  const existing = await models.College.find({ active: true }).limit(2);
  if (existing.length) fail('An active college is already configured. This setup command is intentionally one-time.');

  const college = await models.College.create({
    code: (process.env.COLLEGE_CODE || 'CENTRAL').toUpperCase(),
    name
  });
  const admin = await models.User.create({
    college: college._id,
    role: 'admin',
    name: adminName,
    email: adminEmail,
    passwordHash: await authService.hashPassword(password)
  });
  console.log(`Configured ${college.name}. Administrator login: ${admin.email}`);
  await disconnectDb();
}

main().catch(async error => {
  console.error(error.message);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
