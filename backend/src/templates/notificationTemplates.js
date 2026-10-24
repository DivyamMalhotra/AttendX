const { escapeHtml: esc, singleLine } = require('../utils/escape');
const { config } = require('../config/env');

/**
 * Message templates. Subjects and SMS texts are deliberately generic (no names, marks, amounts or
 * subject titles) so personal data does not sit in mail previews or on lock screens; the detail is in
 * the e-mail body (only for the recipient) and in the app. Passwords, tokens and counselling content
 * are never part of a notification.
 */
const CATEGORY = {
  attendance_shortage: { subject: 'Attendance alert', sms: 'AttendX: your attendance is below the required level in a subject. Open AttendX for details.' },
  attendance_recovered: { subject: 'Attendance update', sms: 'AttendX: your attendance has recovered.' },
  duty_leave: { subject: 'Leave request update', sms: 'AttendX: there is an update on your leave request.' },
  payment: { subject: 'Payment update', sms: 'AttendX: a payment update is available in your account.' },
  fee_reminder: { subject: 'Fee reminder', sms: 'AttendX: you have a fee payment due. Please check AttendX.' },
  late_fee: { subject: 'Fee account update', sms: 'AttendX: your fee account was updated. Please check AttendX.' },
  refund: { subject: 'Refund update', sms: 'AttendX: there is an update on your refund request.' },
  assignment: { subject: 'Assignment notice', sms: 'AttendX: you have an assignment update.' },
  exam: { subject: 'Examination notice', sms: 'AttendX: an examination notice was published.' },
  result: { subject: 'Results published', sms: 'AttendX: results have been published. Check AttendX.' },
  announcement: { subject: 'New announcement', sms: 'AttendX: an important announcement was published. Please check AttendX.' },
  unmarked_class: { subject: 'Unmarked class report', sms: 'AttendX: classes are waiting for attendance to be marked.' },
  library: { subject: 'Library notice', sms: 'AttendX: you have a library notice.' },
  mentor: { subject: 'Mentoring update', sms: 'AttendX: you have a mentoring update.' },
  system: { subject: 'Notice', sms: 'AttendX: you have a new notice.' }
};

const categoryOf = type => CATEGORY[type] || CATEGORY.system;

/** Renders an e-mail for a stored in-app notification. `appName` is the college name. */
function renderEmail({ type, title, message, link }, { user, collegeName }) {
  const cat = categoryOf(type);
  const subject = singleLine(`AttendX: ${cat.subject}`);
  const url = link ? `${config.appBaseUrl}/${link.startsWith('/') ? link.slice(1) : link}` : config.appBaseUrl;
  const text = `Hello ${singleLine(user.name)},\n\n${title}\n\n${message}\n\nOpen AttendX: ${url}\n\n— ${singleLine(collegeName)} (sent by AttendX)`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#101828;max-width:560px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 12px;color:#1e3a5f">${esc(cat.subject)}</h2>
<p>Hello ${esc(user.name)},</p>
<p style="font-weight:bold;margin-bottom:4px">${esc(title)}</p>
<p style="margin-top:0">${esc(message)}</p>
<p><a href="${esc(url)}" style="background:#1e3a5f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open AttendX</a></p>
<p style="color:#6b7280;font-size:12px">${esc(collegeName)} · sent by AttendX. You can change non-essential notification preferences in your profile.</p>
</body></html>`;
  return { subject, text, html };
}

const renderSms = ({ type }) => categoryOf(type).sms;

/** Password reset mail: the link carries the token in the URL fragment so it never reaches server logs. */
function renderPasswordReset({ user, resetUrl, minutes }) {
  const subject = 'AttendX: reset your password';
  const text = `Hello ${singleLine(user.name)},\n\nWe received a request to reset your AttendX password. Use this link within ${minutes} minutes:\n\n${resetUrl}\n\nIf you did not ask for this, ignore this message; your password stays unchanged.`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#101828;max-width:560px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 12px;color:#1e3a5f">Reset your password</h2>
<p>Hello ${esc(user.name)},</p>
<p>We received a request to reset your AttendX password. The link below works for ${minutes} minutes and only once.</p>
<p><a href="${esc(resetUrl)}" style="background:#1e3a5f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Choose a new password</a></p>
<p style="color:#6b7280;font-size:12px">If you did not ask for this, ignore this e-mail; your password stays unchanged.</p>
</body></html>`;
  return { subject, text, html };
}

module.exports = { renderEmail, renderSms, renderPasswordReset, categoryOf };
