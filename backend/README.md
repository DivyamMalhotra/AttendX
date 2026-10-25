# AttendX backend

Node.js + Express API with a MongoDB database. It also serves the browser app from `../frontend/public`.

* `src/` is the server: `routes → controllers → services → models`, plus `middleware`, `validators`, `jobs`, `templates`, `config`, `utils`.
* `tests/unit` (no database), `tests/integration` (in-memory MongoDB) and `tests/e2e` (Playwright browser tests).
* `scripts/` seed data, create an administrator, run backups and database upgrades.
* `.env.example` lists every setting. Copy it to `.env` and never commit `.env`.

```bash
npm install
npm run dev:db      # development database
npm run dev         # server on http://localhost:3000
node --test "tests/unit/**/*.test.js"
npm test
npm run test:e2e
```

Full explanation: [../docs/architecture.md](../docs/architecture.md).
