/* Builds docs/AttendX-progress-report.pdf (a plain-language summary of the work so far).  node scripts/make-progress-pdf.js */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const out = path.join(__dirname, '..', 'docs', 'AttendX-progress-report.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });

const INK = '#17231F'; const STONE = '#737A74'; const GREEN = '#315A46'; const LINE = '#E3E4DB';
const doc = new PDFDocument({ size: 'A4', margin: 54, info: { Title: 'AttendX progress report', Author: 'AttendX team' } });
doc.pipe(fs.createWriteStream(out));
const W = doc.page.width - 108;

const h1 = t => { doc.moveDown(0.8).font('Helvetica-Bold').fontSize(15).fillColor(GREEN).text(t); doc.moveTo(54, doc.y + 2).lineTo(54 + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5); };
const h2 = t => doc.moveDown(0.3).font('Helvetica-Bold').fontSize(11).fillColor(INK).text(t);
const p = t => doc.font('Helvetica').fontSize(10).fillColor(INK).text(t, { lineGap: 2 });
const li = t => doc.font('Helvetica').fontSize(10).fillColor(INK).text(`•  ${t}`, { indent: 8, lineGap: 2 });
const note = t => doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(STONE).text(t, { lineGap: 2 });

doc.font('Helvetica-Bold').fontSize(26).fillColor(INK).text('AttendX');
doc.font('Helvetica').fontSize(13).fillColor(STONE).text('University ERP: progress report for the team');
doc.moveDown(0.3).fontSize(9.5).text(`Generated ${new Date().toISOString().slice(0, 10)}`);

h1('1. Where the project started');
p('AttendX began as a front-end-only prototype: all data lived in the browser (localStorage), with no server, database, real login, uploads or payments. The whole backend and a large part of the app were built from scratch while keeping the original idea (college code login, attendance, duty leave, fees).');

h1('2. Phase 1: a secure, server-backed system');
li('Node.js, Express and MongoDB backend with server-side sessions, CSRF protection, role-based access and rate limiting.');
li('Fixed the three original bugs: attendance is now unique per class session (a subject can have several sessions a day), duplicate duty-leave dates are blocked, roll numbers are normalised and unique.');
li('Automatic attendance-shortage alerts, with one alert and one notification per shortage.');
li('Fee portal: fee structures, per-student assignments, concessions, online payment (Razorpay integration plus a clearly labelled development simulator), verified payments only, PDF receipts, payment history.');
li('File uploads with type and content checks; audit log; migrations; documentation.');

h1('3. Phase 2: campus-management modules');
p('All of the following have working backend logic, access control and automated tests unless stated otherwise.');
h2('Academics');
li('Timetables with clash detection, automatic daily class sessions, today\'s classes and detection of classes held without attendance.');
li('Exams, marks entry, review, lock and publish workflow, grading policy, GPA/CGPA, report-card PDFs, reopen with reason.');
li('Assignments with file submissions and teacher grading; study material; announcements with audience targeting and read tracking.');
li('Leave types beyond duty leave (medical leave visible only to designated reviewers).');
h2('Finance');
li('Refunds with a request-and-approve workflow (the requester cannot approve their own), gateway idempotency and webhook handling.');
li('Late fees (policy, no double charging, waivers) and scheduled fee reminders.');
li('Library fines and hostel fees become normal charges that students pay through the same payment and receipt flow.');
h2('People and campus');
li('Mentor assignment with history and private counselling notes (not readable even by the administrator unless explicitly granted).');
li('Read-only parent portal tied to verified links, with college-controlled visibility.');
li('Library (catalogue, loans, returns, fines) and hostel (rooms, allocations, transfers, capacity guard).');
li('Custom roles and fine-grained permissions with department scoping.');
h2('Operations and data');
li('Analytics and an at-risk student list; CSV import (preview then confirm) and export with spreadsheet-formula protection.');
li('Email (SMTP) and SMS (Twilio) notifications with queue, retries and honest delivery statuses; self-service password reset.');
li('QR / 6-digit code attendance: a rotating code shown by the teacher, optional location check, teachers keep the final say.');
li('Encrypted, verified backups with restore into a separate database; health endpoints; request ids and structured logs; live updates via Server-Sent Events.');
li('Installable web app with offline viewing of a student\'s own attendance (never queues changes).');

h1('4. The new interface');
p('The interface was redesigned in two rounds. The current version has no sidebar:');
li('Header with workspace tabs, a contextual row for pages inside each workspace, notifications and a profile menu; phones get a bottom bar and a "More" sheet.');
li('Command palette (Ctrl+K / Cmd+K, or "/") to jump to any page you may open and to search students and subjects.');
li('New identity: warm paper and white surfaces, deep ink text, a serif for titles and figures, forest green as the single accent.');
li('Recomposed pages: student Overview, Timetable (weekly grid with a live "now" line), Fees (statement layout), Results (period selector), attendance marking console (keyboard P / A), students list (table or directory view), admin Overview.');
li('Tables become labelled cards on phones; dialogs become bottom sheets; stylesheets are bundled into one file.');

h1('5. How it was tested');
li('277 automated unit and integration tests pass (the isolated in-memory database, real sessions and CSRF).');
li('21 browser tests pass in Chrome: sign-in, every student, teacher and administrator page loads, no sideways scrolling at 320, 375, 768, 1024, 1366 and 1440 px, the command palette, the phone navigation, parent view and QR window.');
li('The visual result was inspected by eye for the student Overview and Timetable only.');

h1('6. Known gaps (please read)');
li('Not every page has a new layout. Teacher Today, the parent portal, analytics, library, hostel, and the older admin pages only use the new header, colours and components.');
li('The settings screen does not yet include the Phase 2 settings (SMS, fee reminders, QR location check, parent visibility, at-risk criteria). They work through the API only.');
li('Real Razorpay payments, email and SMS need credentials from the college; the tests use stand-ins. Nothing has been run against the live services.');
li('The GitHub Actions workflow is written but has never been run.');
li('The upgrade script for older databases (npm run db:phase2) has not been run against a real Phase 1 database.');
li('QR camera scanning has not been tried on a real phone. Uploaded files are not part of backups.');
li('No Lighthouse or other full performance audit has been done.');

h1('7. How to run it');
li('Start the local database: npm run dev:db (leave it running), then start the app: npm run dev. It listens on http://localhost:3000.');
li('Demo data: npm run seed:campus creates a complete demo college and prints a random password once.');
li('Tests: npm test (unit and integration) and npm run test:e2e (browser).');
li('After editing any stylesheet: npm run build:css.');
li('Backup: npm run backup. Restore into a new database: npm run restore -- <file> <database name>.');
doc.moveDown(0.6);
note('Passwords and secrets are deliberately not in this document or in the repository.');

doc.end();
console.log(`Wrote ${out}`);
