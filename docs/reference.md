# AttendX ERP: detailed reference

> This is the long reference written during development (configuration, business rules, security model, Phase 2 modules, limitations). Commands that start with `npm` are run inside the `backend/` folder unless stated otherwise. For a short, viva-friendly overview start with [architecture.md](architecture.md) and the root README.

Attendance, duty leave and semester-fee management for colleges. Phase 1 turns the original
browser-only AttendX prototype into a server-backed, multi-college ERP with real authentication,
database-enforced data integrity, automatic attendance-shortage alerts and an integrated fee
payment portal.

| Role in the UI | Role in the spec | What they do |
|---|---|---|
| **Student** | Student | Attendance dashboard + alerts, duty leave, fees & payments, receipts, notifications, profile |
| **Teacher** | Faculty | Mark/correct attendance for assigned subjects, subject summaries, review duty leave of mentored sections |
| **HOD** | Administrator | Sections, subjects, teachers, students, duty leave, attendance reports/alerts, fee structures/assignments/transactions, settings, audit log |

Everything is scoped to a **college** (the original "enter your college code" flow is preserved).

---

## Contents
1. [Technology stack](#technology-stack)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [MongoDB setup and migrations](#mongodb-setup-and-migrations)
5. [Initial administrator](#initial-administrator)
6. [Payments: test mode and live mode](#payments-test-mode-and-live-mode)
7. [Running the tests](#running-the-tests)
8. [Architecture and project structure](#architecture-and-project-structure)
9. [Business rules](#business-rules)
10. [Security model](#security-model)
11. [Known limitations](#known-limitations)

---

## Technology stack

* **Frontend:** HTML5, CSS3, vanilla JavaScript **ES modules** (no framework, no build step), served as static files.
* **Backend:** Node.js (>= 18.17), Express 4, RESTful JSON API, middleware pipeline, central error handling.
* **Database:** MongoDB with Mongoose 9 (schema validation, unique/partial indexes, atomic updates).
* **Auth:** server-side sessions (`express-session`) stored in MongoDB (`connect-mongo`), `bcryptjs` password hashing, role-based authorization, CSRF tokens, rate limiting, Helmet security headers.
* **Uploads:** Multer (type + size + magic-byte validation, server-generated names, owner-only access).
* **Payments:** Razorpay (REST API, signature + webhook verification) behind a provider interface, plus a clearly-labelled development **simulator**.
* **PDF receipts:** PDFKit. **Validation:** Zod. **Tests:** Node's built-in test runner, Supertest, an in-memory MongoDB.

## Quick start

Prerequisites: **Node.js 18.17+** and a **MongoDB** you can reach (local install, Docker or Atlas).
No MongoDB handy? `npm run dev:db` starts a local one for development (see below).

```bash
npm install
cp .env.example .env          # then edit .env (at least SESSION_SECRET)
npm run dev:db                # OPTIONAL, terminal 1: local development MongoDB on :27017
npm run admin:create          # creates your college and first administrator (prompts for the password)
npm start                     # http://localhost:3000
```

Want sample data to click around in? `npm run seed:demo` (never in production) creates two demo colleges with
random passwords that it prints once; every demo user must change the password at first sign-in.

## Configuration

All configuration is environment based (`.env`, never committed). See `.env.example` for every variable.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test` or `production`. Production enables Secure cookies and refuses the payment simulator. |
| `PORT`, `MONGODB_URI` | HTTP port and MongoDB connection string. |
| `SESSION_SECRET` | **Required**, 32+ random characters. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SESSION_TTL_HOURS`, `COOKIE_SECURE`, `TRUST_PROXY` | Session lifetime; force Secure cookies on/off; set `1` behind a TLS-terminating proxy. |
| `CORS_ORIGINS` | Comma-separated extra origins allowed to call the API with credentials (same-origin needs none). |
| `PAYMENT_PROVIDER` | `razorpay` or `simulator`. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Gateway credentials (server side only; the browser only receives the public key id). |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | Where duty-leave documents are stored (outside `public/`) and the size limit. |
| `ALERT_JOB_INTERVAL_MIN`, `PAYMENT_RECONCILE_INTERVAL_MIN` | Background job intervals in minutes (`0` disables). |
| `RECEIPT_LOGO_PATH` | Optional PNG/JPEG printed on receipts. |

College-level policy (editable by the administrator in **Settings**): attendance threshold (default **75%**),
duty-leave policy, whether rejected duty leave may be re-submitted, the faculty correction window, and whether part payments are allowed.

## MongoDB setup and migrations

* **Fresh install:** the server builds every index on start-up (`Model.init()`), including the unique indexes that enforce
  roll numbers, attendance, duty leave, transactions and receipts.
* **Local development without installing MongoDB:** `npm run dev:db` (data kept in `./.mongodb-data`, git-ignored).
* **Existing MongoDB data** (back it up first):
  1. `npm run db:audit-rollnos` – read-only; lists students whose roll numbers collide after normalization (writes `reports/duplicate-roll-numbers-*.json`, exit code 2 if any).
  2. Resolve each group in the admin Students page (correct or deactivate the wrong record – nothing is merged or deleted automatically).
  3. `npm run db:sync-indexes` – re-runs the audit and, only if clean, builds all unique indexes.
* **Moving data from the old browser-only AttendX (localStorage):**
  1. In the old app's browser tab: DevTools → Console → `copy(JSON.stringify(localStorage))` → paste into `legacy-export.json`.
  2. Dry run: `npm run db:import-legacy -- --file legacy-export.json` (writes nothing, produces `reports/legacy-import-*.json`).
  3. Review the conflicts (duplicate roll numbers are **held back**, never guessed; overlapping leave requests are imported as *cancelled*; students created in the old HOD screen had no login and need an email added).
  4. `npm run db:import-legacy -- --file legacy-export.json --commit`. Re-running after fixes is safe (existing records are reused).
  Legacy plaintext passwords are hashed and every imported user must change their password at first sign-in.
* `node scripts/migrations/recompute-session-counts.js` repairs denormalized session counters if they ever drift.

## Initial administrator

```bash
npm run admin:create
# or non-interactively (password via environment, never a command-line argument):
ADMIN_PASSWORD='choose-a-strong-one1' npm run admin:create -- --college-code GEC24 --college-name "Government Engineering College" --name "Dr. Anjali Verma" --email hod@gec.edu
```
No default credentials exist anywhere. Create an **academic session** (Settings), then fee structures, then assign them to sections.

## Payments: test mode and live mode

**Never confuses simulated and real money.** Every payment records which provider handled it; simulated ones are flagged
`simulated`, shown as "TEST"/"SIMULATED" in the UI and stamped on the receipt.

* **Development (default): `PAYMENT_PROVIDER=simulator`.** A local stand-in for the gateway so the whole order → pay → verify → receipt flow can be exercised without credentials. It is refused when `NODE_ENV=production`.
* **Razorpay test mode:** put your `rzp_test_…` key id/secret in `.env`, set `PAYMENT_PROVIDER=razorpay`. Use Razorpay's published test cards/UPI. Configure the webhook below.
* **Razorpay live mode:** use `rzp_live_…` keys, `NODE_ENV=production`, HTTPS, and a webhook:
  * Dashboard → Settings → Webhooks → URL `https://<your-host>/api/fees/webhook`, choose your own secret → `RAZORPAY_WEBHOOK_SECRET`.
  * Events: `payment.captured`, `payment.failed` (optionally `payment.authorized`, `order.paid`).
  * Enable auto-capture in the Razorpay settings (authorized-but-uncaptured payments are shown as *pending* and never credited).
* If no provider is configured, the student pages say payments are unavailable and the API answers `503 PAYMENTS_NOT_CONFIGURED`.

How a payment is protected: the amount is computed on the server from the student's own fee record (the browser may only request a smaller part payment, validated against the outstanding balance) → the gateway order is created server-side → the checkout signature is verified (HMAC) → the payment is **re-fetched from the gateway** and its order id, amount and currency must match → the fee record is credited exactly once (atomic, idempotent) → the receipt is created. Webhooks and the reconciliation job use the same idempotent path.

## Running the tests

```bash
npm test                # everything (unit + integration)
npm run test:unit
npm run test:integration
```
Integration tests start an isolated in-memory MongoDB (`mongodb-memory-server`, a dev dependency; the first run downloads
the `mongod` binary), use the real Express app, real sessions and CSRF, and the payment simulator or a stubbed Razorpay gateway. They never touch your configured database.

## Architecture and project structure

See [architecture.md](architecture.md) for the folder layout (frontend/ and backend/) and how the parts talk to each other.

Layering: **routes → middleware → controllers → services → models**. Controllers contain no business rules; services take plain
arguments (not `req`) and are independently testable; the attendance threshold, duty-leave policy and money maths each live in
exactly one place (`attendanceStatsService`/`attendanceMath`, `feeMath`/`money`). A new payment gateway is one new file in
`services/payments/`. Automated tests verify there are no circular dependencies, every import resolves, every frontend module parses and every page route exists.

Data model highlights: `ClassSession` (subject + date + time slot) and `Attendance` (one row per student per session);
`DutyLeaveRequest` + `DutyLeaveDay` (one row per covered date); `FeeStructure` (template) → `FeeAssignment` (per-student snapshot, integer paise) →
`Payment` (every attempt, never deleted) → `Receipt` (immutable snapshot); `AttendanceAlert` + `Notification`; append-only `AuditLog`.
Courses/specializations are fields on **Section** (used to match fee structures); "enrollment" = a student's section.

## Business rules

* **Attendance** is unique per `(student, class session)` and sessions are unique per `(subject, date, slot)` — a subject can have several sessions a day and different subjects never block each other. Re-submitting the same session corrects it (audited). Faculty can correct up to *N* days back (setting); the administrator has no limit. Dates use the college timezone (`Asia/Kolkata` by default); future dates are rejected.
* **Percentage** = attended ÷ eligible classes. **Duty leave never rewrites attendance**: approved leave days are applied when numbers are computed — policy `exclude` removes absences on those days from the total, policy `count_present` credits them. Pending/rejected leave never counts, and a present record is never double-counted.
* **Shortage alert** when attendance in any subject is strictly below the threshold (exactly at the threshold is fine). One alert and one notification per shortage cycle; it updates in place while the shortage continues, resolves with a "recovered" notice, and re-opens as a new cycle. Minimum extra consecutive classes: `x = ceil((t·eligible − 100·attended) / (100 − t))` (28/40 at 75% → **8**).
* **Duty leave** duplicates are blocked per student *and date* (multi-day requests included) by a partial unique index; approval is an atomic compare-and-set so it can only happen once; rejected dates may be re-requested unless the college disables it.
* **Roll numbers** are trimmed, whitespace-stripped and upper-cased (`" cse2026001 "` = `CSE2026001`), 3–25 chars of `A-Z 0-9 - /`, unique per college by index. Only administrators can change them (audited).
* **Fees** are integer paise. `Outstanding = Total payable − verified payments`; concessions/charges are append-only adjustments; editing a fee structure never changes fees already assigned. Failed/pending/cancelled payments never reduce the balance; a verified payment that would exceed the balance is flagged *needs review* (no receipt) instead of over-collecting.

## Security model

Server-side sessions in MongoDB (`HttpOnly`, `SameSite=Lax`, `Secure` in production, session id regenerated at login and password change, other sessions invalidated on password change/reset/deactivation) · bcrypt hashes never returned · generic login errors, timing-safe, lockout after 5 failures, login/sensitive rate limits · synchronizer-token CSRF on every state-changing request · Helmet + strict CSP (no inline scripts) · Zod validation that strips unknown fields (no mass assignment) · every route declares its role; ownership middleware/services guard students, subjects, duty-leave documents and receipts (other students get 404/403) · uploads validated by type, size and magic bytes, stored with random names outside the web root · errors never leak stack traces in production · append-only audit log for sign-ins, attendance corrections, duty-leave decisions, roll changes, fee changes and payments.

## Phase 2: campus management modules

Everything below lives in the same layered structure (routes → controllers → services → models) and is permission-checked per route.
Administrators with the built-in roles *Principal, Department Head, Accounts Clerk/Head, Examination Cell, Librarian, Hostel Warden, Registrar, Mentor, Counsellor*
(or custom roles) use the same console (`hod.html`); department-scoped roles only see their own departments.

| Area | What exists | Where |
|---|---|---|
| Timetable and classes | versioned timetables with clash detection, auto-generated class sessions, today's classes, unmarked-class detection and resolution | `timetableService`, `sessionLifecycleService`, job `generate-sessions`, `detect-unmarked` |
| Exams and results | grading policy, exams, marks entry → review → lock → publish (frozen snapshot), reopen with reason, GPA/CGPA, report-card PDF | `examService`, `resultService` |
| Notifications | in-app always; e-mail (SMTP) and SMS (Twilio) with queue, retries and delivery statuses; generic subjects/SMS texts, no sensitive content | `notificationService`, `deliveryService`, `services/notify/` |
| Fees | reminders, late fees (policy, idempotent per period, waiver), refunds (maker-checker, gateway idempotency, webhook) | `feeReminderService`, `lateFeeService`, `refundService` |
| Password reset | self-service e-mail link (token in the URL fragment, only a hash stored) | `passwordResetService` |
| Coursework | assignments with uploads, grading released by the teacher, study material | `assignmentService` |
| Announcements | audience targeting, attachments, read tracking | `announcementService`, `audienceService` |
| Leave types | duty, medical (restricted reviewers and documents) and personal; whether a type affects attendance is configurable | `leaveTypeService` |
| Mentoring and parents | mentor assignment with history, private counselling notes (not readable even by the wildcard admin), verified read-only parent links with visibility switches | `mentorService`, `parentService` |
| Library and hostel | catalogue/loans/fines, hostels/rooms/allocations; fines and hostel fees become separate charges paid through the normal fee pipeline | `libraryService`, `hostelService`, `chargeService` |
| Analytics | attendance, fees, results, leave aggregates; at-risk list with configurable criteria; department comparison | `analyticsService` |
| Import / export | CSV import with preview → confirm (students, books, marks), resumable; CSV export with formula-injection protection | `importService`, `exportService` |
| Access control | custom roles and per-route permissions, department scope, anti-escalation rules | `permissionService`, `accessService` |
| QR attendance | rotating 6-digit code/QR, optional geofence, faculty keep the final say | `qrAttendanceService` |
| PWA | installable, offline *viewing* of the signed-in student's own attendance/dashboard/timetable; never queues writes; saved copy wiped on sign-out/user change | `public/sw.js`, `js/services/pwa.js` |
| Operations | request ids and structured logs (secrets redacted), `/health`, `/ready`, job history, encrypted verified backups, restore into a separate database | `backupService`, `scripts/backup.js`, `scripts/restore.js` |
| Live updates | Server-Sent Events carrying ids only; pages re-read data through the API | `liveService`, `routes/eventRoutes.js` |

### Upgrading a Phase 1 database
```bash
npm run backup                       # first!
npm run db:phase2 -- --dry-run       # shows what would change
npm run db:phase2
```

### Demo data
`npm run seed:campus` creates one complete college (`CAMPUS26`) and prints a random password once.

### Backups and restore
`npm run backup` writes a gzip (optionally AES-256-GCM encrypted) logical backup to `BACKUP_DIR` and verifies it by reading it back; the `backup` job does the same every `BACKUP_INTERVAL_HOURS`.
Restore goes into a **new** database so it can be checked first: `npm run restore -- backups/<file> attendx_restored`, then point `MONGODB_URI` at it and run `npm run db:sync-indexes`.
`npm run restore -- <file> --verify-only` checks a file without restoring. **Uploaded files are not in the backup**: copy `UPLOAD_DIR` separately.

### Providers (external configuration)
Razorpay live mode, SMTP and Twilio need your own credentials (see `.env.example`). Without them payments use the simulator (development only), e-mail/SMS notifications are recorded as *skipped* (never "sent"), and "delivered" is only set from a signed provider callback.

### Browser tests and CI
`npm run test:e2e` starts an isolated server and runs Playwright against it. Locally it uses the installed Chrome; CI installs Chromium.
`.github/workflows/ci.yml` runs the unit/integration suite, the browser tests and `npm audit`.

## Known limitations

* The supplied project was a **front-end only prototype** (data in the browser's `localStorage`; no Node/Express/MongoDB, sessions, uploads or payments existed). The entire backend is new; the UI keeps the original look, flows and college-code login. Old data can be imported with the script above. In the old app, approving leave **overwrote Absent with Present** in the stored records; that information cannot be recovered, so imported historical attendance keeps those corrected values.
* **Live Razorpay was not exercised against the real gateway** (no credentials in the build environment). The integration follows Razorpay's documented REST API/signature/webhook rules and is covered by tests against a stubbed gateway; do a test-mode run with `rzp_test` keys before going live.
* The development **simulator keeps its orders in memory** (lost on restart) and must not be used in production.
* No MongoDB multi-document transactions (works on a standalone server). Multi-step operations use atomic single-document updates, unique indexes and idempotent steps instead; a crash between steps is repaired by the reconciliation job.
* Overpayment (two simultaneous payments for the same balance) is detected and flagged *needs review*; refunds are not automated. Receipt numbers are unique but may skip a number after a concurrent retry.
* Courses and specializations are plain text on sections, not separate collections. The college timezone is a stored setting without a UI control.
* Browser tests cover only a few flows (sign-in, student fees/timetable/results, console redirect, PWA files); most screens were not exercised by automated browser tests.
* Not every Phase 2 screen has a UI yet (see the status report): the API is complete and tested for them.
* `npm audit`/dependency pinning and a production hardening review (TLS termination, backups, monitoring) remain deployment tasks.
