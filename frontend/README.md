# AttendX frontend

Plain HTML, CSS and JavaScript modules, with no framework. The backend serves `public/` as static files, so there is nothing to build except the stylesheet bundle.

* `public/*.html`: one page per area (login, student, teacher, hod = the console for administrator, HOD, accounts clerk and exam cell; parent = restricted portal).
* `public/js/pages/<role>/`: one file per screen. Fee screens are in `pages/administration/`.
* `public/js/api/`: the only code that calls the server. `components/`, `services/`, `utils/` hold shared pieces.
* `public/css/`: source styles; `app.css` is generated.
* `public/sw.js` and `manifest.webmanifest`: installable app and offline viewing.

After changing any file in `public/css/`, run `node scripts/build-css.js` (or `npm run build:css` from this folder).

Full explanation: [../docs/architecture.md](../docs/architecture.md).
