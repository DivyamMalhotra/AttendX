# AttendX: how the project is organised

This page is written so that you can explain the project in a viva. Everything below describes files that actually exist.

## 1. The big picture

```
Browser (frontend)  ──  HTTP requests (JSON)  ──▶  Express server (backend)  ──▶  MongoDB
  HTML + CSS + JS   ◀──  JSON answers / files  ──                                  (data)
```

* The **frontend** is what the user sees: web pages, styles and JavaScript that run in the browser.
* The **backend** is a Node.js program (Express) that holds the rules, checks who you are and what you may do, and reads or writes the MongoDB database.
* The two are different folders, but the backend also *serves* the frontend files, so one command starts everything.

## 2. Folder layout

```
AttendX/
├── frontend/                  everything that runs in the browser
│   ├── public/                the files the server hands to the browser
│   │   ├── *.html             one page per role: login, student, teacher, hod (administration console), parent
│   │   ├── css/               styles (see "Styling" below)
│   │   ├── js/
│   │   │   ├── api/           the only code that talks to the server (client.js, endpoints.js, phase2.js)
│   │   │   ├── components/    reusable pieces: header (shell), command palette, modal, toast, forms, tables
│   │   │   ├── services/      app start-up, router, install-app logic, offline/PWA, live updates
│   │   │   ├── utils/         small helpers (safe HTML templating, formatting)
│   │   │   └── pages/         one folder per area: student/ teacher/ hod/ parent/ administration/ auth/ shared/
│   │   ├── manifest.webmanifest   makes the site installable
│   │   ├── sw.js              the service worker (offline viewing)
│   │   └── icons/             app icons
│   ├── scripts/               build-css.js (bundles the CSS), make-icons.js
│   └── README.md
│
├── backend/                   everything that runs on the server
│   ├── src/
│   │   ├── server.js          starts the server (connects the database, starts background jobs)
│   │   ├── app.js             builds the Express app: security headers, sessions, CSRF, routes, static files
│   │   ├── config/            settings read from environment variables, session store, constants, permissions list
│   │   ├── routes/            URL → which controller (and which permission is needed)
│   │   ├── controllers/       thin: read the request, call a service, send the answer
│   │   ├── services/          the business rules (attendance, fees, payments, exams, refunds…)
│   │   ├── models/            MongoDB collections (Mongoose schemas)
│   │   ├── middleware/        login check, permission check, CSRF, file uploads, error handling
│   │   ├── validators/        input checks (Zod) for every request
│   │   ├── jobs/              background tasks (alerts, reminders, backups)
│   │   ├── templates/         PDF and e-mail text
│   │   └── utils/             helpers (money, dates, CSV…)
│   ├── tests/
│   │   ├── unit/              fast tests with no database
│   │   ├── integration/       tests that run the real app on a temporary in-memory MongoDB
│   │   └── e2e/               browser tests (Playwright) that drive the real pages
│   ├── scripts/               seed demo data, create admin, backups, database upgrade scripts
│   ├── uploads/               files uploaded by users (never served directly)
│   ├── package.json           all the project's npm dependencies
│   └── .env.example           the list of settings (copy to .env, never commit .env)
│
├── docs/                      this guide and the long reference
└── README.md                  how to run it
```

## 3. How the frontend talks to the backend

1. A page (for example `frontend/public/js/pages/student/fees.js`) calls a function from `js/api/endpoints.js` or `js/api/phase2.js`, such as `feesApi.summary()`.
2. That function uses `js/api/client.js`, which sends `fetch('/api/fees/summary')`. It automatically adds the CSRF token and turns error replies into messages.
3. The request reaches `backend/src/routes/feeRoutes.js`, which checks the user is logged in and has the right role, then calls a controller, which calls a service in `backend/src/services/`.
4. The service reads MongoDB through the models and returns JSON. The page draws it.

The frontend never touches the database and never contains secrets. The URL paths all start with `/api/`.

## 4. Login and roles

* **Login:** `POST /api/auth/login` checks the password (bcrypt) and creates a **server-side session**. The browser only holds a cookie that is `HttpOnly` (JavaScript cannot read it).
* **CSRF:** every request that changes data must carry a token that the page received at login.
* **Roles:** `hod` (head of department), `staff` (administration staff), `teacher` (faculty), `student`, `parent`. After login `login.js` sends each role to its own page: `hod.html` (used by both `hod` and `staff`), `teacher.html`, `student.html`, `parent.html`.
* **Permissions:** inside the console, what a person may do comes from permissions (for example `fees.view`, `payments.view`). `backend/src/config/permissions.js` lists them; `middleware/permissions.js` checks them on every route. The frontend only *hides* menu items it knows the user cannot use. The server checks again on every request, so hiding a link is never the security.

## 5. HOD and Administration

* `frontend/public/hod.html` loads `js/pages/hod/main.js`. It builds the menu from a list of pages and each person's permissions, then starts the router.
* **HOD pages** (sections, teachers, students, attendance, exams, …) are in `js/pages/hod/`.
* **Administration pages**, which means fee management, are in `js/pages/administration/`. The menu entry is the **Fees** workspace with these pages:

| Menu item | Route | File |
|---|---|---|
| Overview | `#fees/overview` | `administration/feeOverview.js` |
| Structures | `#fees/structures` | `administration/feeStructures.js` |
| Assign | `#fees/assign` | `administration/feeAssignments.js` |
| Transactions | `#fees/transactions` | `administration/transactions.js` |
| Reports | `#fees/reports` | `administration/feeReports.js` |
| Refunds & late fees | `#fees/refunds` | `administration/finance.js` |

* In the interface, the **head of department (`hod`) account does not get the Fees workspace**; administration `staff` accounts that hold fee permissions do. Only the screens are hidden. The server's permission rules were not changed.
* Old links such as `#fee-structures` still work: `hod/main.js` lists them as redirects to the new routes.

## 6. The "Install app" flow (PWA)

* `manifest.webmanifest` and `sw.js` make the site installable. The browser decides if installation is possible and then fires an event called `beforeinstallprompt`.
* `js/services/install.js` is the one place that handles it. It keeps that event, and shows the button only after the event arrives. Clicking calls the browser's install dialog and waits for the answer. After accepting, declining or `appinstalled`, the button hides. A decline is remembered for the tab session so the button does not keep coming back.
* The button appears on the public login page and in the **student** header only. Safari and Firefox never send the event, so no button is shown there (installing is done from their menus).

## 7. Styling

CSS is split by purpose in `frontend/public/css/` (tokens, base, layout, components, pages). `main.css` lists them; `npm run build:css` joins them into `app.css`, which is the file the pages load (one request instead of many). All colours and sizes are defined once in `base/tokens.css`.

## 8. Running it locally

```bash
# 1. dependencies and settings (once)
cd backend
npm install
cp .env.example .env        # then edit .env: set SESSION_SECRET to a long random string

# 2. database (development only) in one terminal, left running
npm run dev:db

# 3. the server in another terminal; it also serves the frontend
npm run dev                 # open http://localhost:3000

# optional demo data (prints a random password once)
npm run seed:campus
```

From the repository root you can also run `npm start`, `npm run dev:db` and `npm test`; they simply call the backend.

## 9. Tests

```bash
cd backend && node --test "tests/unit/**/*.test.js"      # unit tests (no database)
cd backend && npm test                                     # unit + integration tests
cd backend && npm run test:e2e                             # browser tests (needs Chrome, or: npx playwright install chromium)
```

## 10. Environment variables

Defined in `backend/.env.example` (copy to `backend/.env`; never put real values in the example file or in git).

| Variable | Used for |
|---|---|
| `NODE_ENV`, `PORT` | mode and port |
| `MONGODB_URI` | database address |
| `SESSION_SECRET` | signs session cookies (required, long and random) |
| `SESSION_TTL_HOURS`, `COOKIE_SECURE`, `TRUST_PROXY`, `CORS_ORIGINS` | session and proxy behaviour |
| `BCRYPT_ROUNDS`, `APP_TIMEZONE`, `LOG_LEVEL` | password hashing, time zone, logging |
| `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | online payments (`simulator` for development) |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `RECEIPT_LOGO_PATH` | file uploads and receipts |
| `APP_BASE_URL`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_*` | e-mail |
| `SMS_PROVIDER`, `TWILIO_*` | SMS |
| `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_QUEUE_INTERVAL_MIN`, `ALERT_JOB_INTERVAL_MIN`, `PAYMENT_RECONCILE_INTERVAL_MIN`, `JOBS_ENABLED` | background jobs |
| `HEALTH_TOKEN` | protects the `/ready` status endpoint |
| `BACKUP_DIR`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_RETENTION_DAYS`, `BACKUP_KEEP_MIN`, `BACKUP_INTERVAL_HOURS` | backups |

More detail (business rules, security model, limitations) is in [reference.md](reference.md).
