# AttendX ERP

Attendance, duty-leave and fee management for colleges.

```
AttendX/
├── backend/    Node + Express + MongoDB REST API   (port 3000)
├── frontend/   Web UI (HTML/CSS/ES modules) + small server that proxies /api  (port 5173)
├── docs/       Progress report + the original detailed reference (REFERENCE.md)
├── start.bat   Windows: double-click to run everything
└── start.sh    macOS / Linux: ./start.sh
```

## Run it (after extracting)

Requires **Node.js 18.17+** (https://nodejs.org). Nothing else.

**Windows:** double-click `start.bat`
**macOS / Linux:** `./start.sh`
**Any OS:** `npm run dev` in this folder

The first run installs dependencies, starts a local development MongoDB if none is running
(one-time ~100 MB download), starts the backend, creates demo data, starts the frontend, then prints:

```
AttendX is running -> http://localhost:5173
```

### Demo logins (development only)

Open http://localhost:5173, enter the college code, then sign in. Password for everyone: **`Passw0rd1`**

| College code | Role    | Email                              |
|--------------|---------|------------------------------------|
| `GEC24`      | HOD     | hod@gec.edu                        |
| `GEC24`      | Teacher | r.mathur@gec.edu                   |
| `GEC24`      | Student | aditya.sharma@student.gec.edu      |
| `ABC24`      | HOD     | hod@abcinstitute.edu               |

## Run the two parts separately

```bash
# terminal 1 - database (skip if you have MongoDB / Docker / Atlas)
cd backend && npm install && npm run dev:db

# terminal 2 - API
cd backend && npm run dev
npm run seed:demo:simple     # once: creates the demo colleges above

# terminal 3 - web UI
cd frontend && npm install && npm start
```

## How frontend and backend talk

The browser only ever talks to the **frontend server** (`:5173`). It serves the pages and forwards
`/api/*` to the backend (`BACKEND_URL` in `frontend/.env`). Because the browser sees one origin, the
HttpOnly session cookie, the CSRF token and the service worker work with no CORS or cookie tuning.
Do not open the backend port in the browser for the UI; it only returns JSON.

| File | Setting |
|---|---|
| `backend/.env`  | `PORT`, `MONGODB_URI`, `SESSION_SECRET`, `FRONTEND_URL`, payments, e-mail... (see `.env.example`) |
| `frontend/.env` | `PORT` (UI), `BACKEND_URL` (API address) |

Using your own MongoDB: set `MONGODB_URI` in `backend/.env` (Atlas URI or `docker compose up -d` using the
included `docker-compose.yml`). The launcher only starts its own database when `MONGODB_URI` points at this machine and nothing answers there.

## Can't sign in? Checklist

1. **Wrong or unknown password.** Real installs have no default password. Use the demo logins above, or reset one:
   `cd backend && npm run password:reset -- --college-code GEC24 --email hod@gec.edu`
2. **Locked account / "Too many attempts".** 5 wrong passwords lock an account for 15 minutes; 10 failed sign-ins per IP
   are rate-limited for 15 minutes. `password:reset` unlocks the account immediately; restarting the backend clears the IP limit.
3. **"Cannot reach the AttendX backend".** The backend is not running or `BACKEND_URL` is wrong. Check http://localhost:3000/health.
4. **Server won't start / MongoDB error.** Nothing is listening at `MONGODB_URI`. Run `npm run dev` from the top folder (it starts one), or start your own.
5. **Stale page after upgrading.** Hard-refresh (Ctrl+Shift+R) or clear site data once; an old service worker may be cached.
6. **Create your own admin:** `cd backend && npm run admin:create`.

## Commands

| Where | Command | Purpose |
|---|---|---|
| root | `npm run dev` | database (if needed) + backend + frontend |
| root | `npm run seed` | demo colleges with the known password |
| backend | `npm test` | unit + integration tests (downloads an in-memory MongoDB the first time) |
| backend | `npm run test:e2e` | browser tests (starts backend + frontend) |
| backend | `npm run admin:create` / `password:reset` | accounts |
| frontend | `npm run build:css` | rebuild `public/css/app.css` after editing CSS sources |

## Production notes

Set `NODE_ENV=production`, a real `SESSION_SECRET`, HTTPS, `TRUST_PROXY=1` behind your proxy, real Razorpay keys (the payment
simulator is refused in production), and `FRONTEND_URL`/`APP_BASE_URL` to your public address. Run the frontend with `NODE_ENV=production npm start`
(or serve `frontend/public` from nginx and route `/api`, `/health`, `/ready` to the backend). Point the Razorpay webhook at the **backend**: `https://<host>/api/fees/webhook`.
Full details of the business rules, security model and migrations: `docs/REFERENCE.md`.
