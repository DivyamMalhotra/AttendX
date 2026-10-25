# AttendX

A university ERP: attendance, leave, fees and payments, timetables, exams and results, library, hostel, announcements and more, for students, faculty, administration staff and parents.

| Folder | What it is |
|---|---|
| [`frontend/`](frontend/README.md) | The browser app: plain HTML, CSS and JavaScript (no framework, no build step beyond bundling the CSS). |
| [`backend/`](backend/README.md) | The Node.js / Express server, MongoDB models, business rules, tests and scripts. It also serves the frontend files. |
| [`docs/`](docs/architecture.md) | `architecture.md` explains the structure in simple language; `reference.md` is the long reference. |

## Run it

```bash
cd backend
npm install
cp .env.example .env     # edit .env: set SESSION_SECRET to a long random string
npm run dev:db           # terminal 1 (development database, leave running)
npm run dev              # terminal 2, then open http://localhost:3000
npm run seed:campus      # optional demo data; prints a random password once
```

## Test it

```bash
cd backend && node --test "tests/unit/**/*.test.js"   # unit tests
cd backend && npm test                                  # unit + integration tests
cd backend && npm run test:e2e                          # browser tests
```

Read [docs/architecture.md](docs/architecture.md) first if you want to understand or present the project.
