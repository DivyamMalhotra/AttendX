/**
 * Resets one user's password and clears any lock-out. Use it when you cannot sign in.
 *
 *   npm run password:reset -- --college-code GEC24 --email hod@gec.edu
 *   ADMIN_PASSWORD='NewPassw0rd1' npm run password:reset -- --college-code GEC24 --email hod@gec.edu
 *
 * The password comes from ADMIN_PASSWORD or a hidden prompt, never from a command-line argument.
 */
const { config } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const models = require('../src/models');
const authService = require('../src/services/authService');
const { password: passwordSchema } = require('../src/validators/common');
const { parseArgs, ask, fail } = require('./lib/cli');

async function main() {
  const args = parseArgs();
  const code = String(args['college-code'] || await ask('College code: ')).trim().toUpperCase();
  const email = String(args.email || await ask('User email: ')).trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || await ask('New password (min 8 chars, letters + a number): ', { hidden: true });
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) fail(pw.error.issues[0].message);

  await connectDb(config.mongoUri);
  const college = await models.College.findOne({ code });
  if (!college) fail(`No college with code ${code}.`);
  const user = await models.User.findOne({ college: college._id, email });
  if (!user) fail(`No user ${email} in ${code}.`);

  await models.User.updateOne({ _id: user._id }, {
    $set: {
      passwordHash: await authService.hashPassword(password), passwordChangedAt: new Date(),
      mustChangePassword: false, failedLogins: 0, lockedUntil: null, active: true
    }
  });
  console.log(`\n✔ Password reset for ${email} (${code}). Account unlocked and active.`);
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
