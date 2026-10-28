/**
 * Creates (or extends) a college and its first Administrator account.
 *
 *   npm run admin:create                 # prompts for everything, password is hidden
 *   npm run admin:create -- --college-code GEC24 --college-name "Government Engineering College" \
 *        --name "Dr. Anjali Verma" --email admin@gec.edu
 *
 * The password is read from the ADMIN_PASSWORD environment variable or typed at the prompt;
 * it is never accepted as a command line argument (those end up in shell history) and no
 * default administrator password exists anywhere in the code.
 */
const { config } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const models = require('../src/models');
const authService = require('../src/services/authService');
const audit = require('../src/services/auditService');
const { password: passwordSchema, email: emailSchema } = require('../src/validators/common');
const { parseArgs, ask, fail } = require('./lib/cli');

async function main() {
  const args = parseArgs();
  const code = String(args['college-code'] || await ask('College code (e.g. GEC24): ')).toUpperCase();
  const collegeName = String(args['college-name'] || '');
  const name = String(args.name || await ask('Administrator full name: '));
  const emailRaw = String(args.email || await ask('Administrator email: '));
  const password = process.env.ADMIN_PASSWORD || await ask('Password (min 8 chars, letters + a number): ', { hidden: true });

  const email = emailSchema.safeParse(emailRaw);
  if (!email.success) fail('That is not a valid email address.');
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) fail(pw.error.issues[0].message);
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) fail('College code must be 2-20 letters, digits or "-".');
  if (!name) fail('Name is required.');

  await connectDb(config.mongoUri);
  await Promise.all(Object.values(models).map(m => m.init()));

  let college = await models.College.findOne({ code });
  if (!college) {
    const finalName = collegeName || await ask('College name: ');
    if (!finalName) fail('College name is required for a new college.');
    college = await models.College.create({ code, name: finalName });
    console.log(`Created college ${college.code} - ${college.name}`);
  }

  if (await models.User.exists({ college: college._id, role: 'admin' })) fail(`${code} already has its Administrator account. A college has exactly one; use the password reset flow instead of creating another.`);
  if (await models.User.exists({ college: college._id, email: email.data })) fail(`A user with ${email.data} already exists in ${code}.`);
  const hod = await models.User.create({
    college: college._id, role: 'admin', name, email: email.data, passwordHash: await authService.hashPassword(password)
  });
  await audit.record({ actor: null, collegeId: college._id, action: 'admin.created_by_cli', entityType: 'User', entityId: hod._id, meta: { email: hod.email } });
  console.log(`\n✔ Administrator ${hod.email} created for ${college.code}. Sign in at the college code "${college.code}".`);
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
