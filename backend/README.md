# AttendX backend

Node.js + Express API with a MongoDB database. It also serves the browser app from `../frontend/public`.

* `src/` is the server: `routes → controllers → services → models`, plus `middleware`, `validators`, `jobs`, `templates`, `config`, `utils`.
* `tests/integration` (in-memory MongoDB) and `tests/e2e` (Playwright browser tests).
* `scripts/` seed data, create an administrator, run backups and database upgrades.
* `.env.example` lists every setting. Copy it to `.env` and never commit `.env`.

```bash
npm install
npm run local       # one command: .env + database + demo data + server on http://localhost:3000
# or step by step: npm run dev:db (terminal 1), npm run dev (terminal 2)
npm test
npm run test:e2e
```

Full explanation: [../docs/architecture.md](../docs/architecture.md).

## Troubleshooting (teammates who cannot sign in)

* **"College code not recognized"**: your database is empty. Git never contains data. Run `npm run local` (creates the demo college `CAMPUS26`, password `Attendx@2026`) or create your own with `npm run admin:create`.
* **Server exits with "SESSION_SECRET must be set"**: `backend/.env` is missing (it is git-ignored). `npm run local` creates it, or copy `.env.example` to `.env`.
* **"connect ECONNREFUSED 127.0.0.1:27017"**: no database is running. Use `npm run local`, or start `npm run dev:db`, or install MongoDB.
* **Port 3000 or 27017 already in use**: stop the other copy, or change `PORT` / `MONGODB_URI` in `backend/.env`.
* **Passwords from someone else's machine do not work**: each machine has its own database. Use the demo password above.
