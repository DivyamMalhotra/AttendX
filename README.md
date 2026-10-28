# AttendX

A university ERP: attendance, leave, fees and payments, timetables, exams and results, library, announcements and more, with seven roles: Administrator, HOD, Teacher, Student, Accounts Clerk, Exam Cell and Parent.

| Folder | What it is |
|---|---|
| [`frontend/`](frontend/README.md) | The browser app: plain HTML, CSS and JavaScript (no framework, no build step beyond bundling the CSS). |
| [`backend/`](backend/README.md) | The Node.js / Express server, MongoDB models, business rules, tests and scripts. It also serves the frontend files. |
| [`docs/`](docs/architecture.md) | `architecture.md` explains the structure in simple language; `roles-and-onboarding.md` covers the seven roles, Administrator versus HOD, migration and seeding; `reference.md` is the long reference. |

## Run it (first time, or after `git pull`)

Needs Node.js 20+ and internet access for the first install (npm packages, and a one-time MongoDB download for the built-in development database).

```bash
git clone <repo-url> && cd Attendx
npm run install:all      # installs the backend packages
npm run local            # creates backend/.env, starts the database, creates demo data, starts the server
```

`npm run local` also loads the real student list `backend/data/5G3_Student_List.csv` (78 students of BE-CSE AIML Sem 5, group 5G3) into the demo college. **Keep this repository private**: the list holds student names and roll numbers. Sign in as the Administrator and open *Students* to see them. Their own logins get random temporary passwords, written only to a git-ignored file in `backend/credentials/`.

Then open http://localhost:3000 and sign in with:

| | |
|---|---|
| College code | `CAMPUS26` |
| Password (every demo account) | `Attendx@2026` |
| Administrator (college settings, backups, audit logs, all accounts) | `admin@campus26.edu` |
| HOD | `hod.cse@campus26.edu` |
| Teacher | `sameer.khanna@campus26.edu` |
| Student | `aditya.sharma@student.campus26.edu` |
| Accounts Clerk | `accounts.clerk@campus26.edu` |
| Exam Cell | `exam.cell@campus26.edu` |
| Parent | `parent.aditya.sharma@student.campus26.edu` |

This demo password is for local development only: `npm run local` refuses to run with `NODE_ENV=production`. Every teammate gets their own empty database on their own machine, so the demo college is created for them automatically the first time (it is never in Git because `.env` and `.mongodb-data/` are ignored). Change the password of any account you keep.

If something fails, see **Troubleshooting** in [backend/README.md](backend/README.md). Already have MongoDB running on port 27017 (or `MONGODB_URI` pointing elsewhere)? `npm run local` uses it instead of starting its own.

Manual alternative (three steps): `cd backend && npm install`, copy `.env.example` to `.env` and set `SESSION_SECRET` to a random 32+ character string, then `npm run dev:db` in one terminal and `npm run dev` in another.

## Test it

```bash
cd backend && npm test            # integration tests (in-memory MongoDB)
cd backend && npm run test:e2e    # browser tests
```

Read [docs/architecture.md](docs/architecture.md) first if you want to understand or present the project.

## Technology and prerequisites

Node.js 20+ (developed on 24), Express 4, MongoDB (Mongoose 9), vanilla JavaScript modules in the browser (no build step except the CSS bundle), Playwright for browser tests. MongoDB: use your own, or `npm run dev:db` for a local development database.

## Database, migrations and seeding

```bash
cd backend
npm run admin:create                      # creates a college's single Administrator (refuses a second one)
npm run migrate:roles                     # dry run: maps old roles to the seven supported roles
npm run migrate:roles -- --apply          # applies it (repeatable, deletes nothing)
npm run seed:5g3 -- --college-code CODE --file path/to/5G3_Student_List.csv --apply
```

Details, the Administrator/HOD split and the credential-file rules are in [docs/roles-and-onboarding.md](docs/roles-and-onboarding.md). `backend/credentials/` holds temporary passwords: it is git-ignored, never served, and must not be shared.

## PWA

`frontend/public/manifest.webmanifest` and `sw.js` make the app installable. The Install App button is shown only to students (login page and student header) and only after the browser fires `beforeinstallprompt`; Safari and Firefox do not, so no button is shown there (use the browser menu).

## Security notes

Roles, permissions, college and department scope and parent-child links are enforced on the server for every request; the interface only hides what a role cannot use. Passwords are bcrypt-hashed, sessions are server-side, state-changing requests need a CSRF token, and exports neutralise spreadsheet formulas. Never commit `.env` or `backend/credentials/`.
