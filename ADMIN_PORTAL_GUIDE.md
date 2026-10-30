# HostelERP — Admin Portal (updated)

The Admin Portal is a complete, data-driven module set on the existing Express +
CSV backend. This revision simplifies the portal (fewer modules, one shared
login) and fixes the Gatekeeper's QR scanner.

## Logging in

The Admin Portal now uses **one shared login** instead of individual admin
accounts or self-registration. The actual username and password are **not**
written anywhere in this guide or in the project's source files — they live
only in `backend/.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), which is listed
in `.gitignore` so it never gets committed or shared along with the code.

**To find the login:** start the server (`node server.js`) and read it from
the server's own console output — it's printed once at startup, right after
"HostelERP Backend running on...". That is the only place it appears.

**To change the login:** edit `backend/.env` and restart the server. If
`.env` doesn't set `ADMIN_USERNAME`/`ADMIN_PASSWORD`, a fallback in
`backend/config/adminCredentials.js` is used instead — change that fallback
before handing the project to anyone else, since it's visible to anyone who
reads the source.

Because every admin action is logged under the same identity, this approach
doesn't support telling different administrators' actions apart — that's the
trade-off for a single shared password. For a real deployment, switch back to
one `admin.csv` row per person (the login flow already falls back to
`admin.csv` if the shared credential doesn't match, so both can coexist).

## Modules (sidebar)

| Page | Module | What it does |
|---|---|---|
| `admin-dashboard.html` | Dashboard | Counters, outpass/leave/registration summary, module tiles, pending-approval alert |
| `admin-students.html` | Student Details | All students, search + status/department filters, **View Details** modal with full profile and that student's outpass/leave history |
| `admin-wardens-management.html` | Warden Details | All wardens incl. `Pending` registrations, View Details, activate/deactivate |
| `admin-gate-staff.html` | Gatekeeper Details | Gate staff, gate + shift, View Details, activate/deactivate |
| `admin-rooms-management.html` | Room Details | Add/edit/delete rooms, assign a student, View Details with occupant list |
| `admin-warden-approvals.html` | Warden Approvals | Approve / reject new warden registrations + approval history |
| `admin-reports.html` | Outpass / Leave Reports | Approved, rejected and pending counts, per-warden breakdown, detail table, CSV export |
| `admin-audit-logs.html` | Audit Logs | Every admin action, read-only |

**Removed this revision:** Hostel Configuration and Roles & Permissions (pages,
nav entries, and dashboard tiles), and the Admin Register page/link. If you
need either back later, they're straightforward to re-add — ask and I will.

All module pages share `admin-section.js` (set through `window.ADMIN_SECTION`),
`admin-shell.js` (sidebar/topbar/session) and `admin-section.css`.

## Warden approval rule (unchanged from the last revision)

1. A warden registers at `warden-register.html`.
2. The row is written to `warden.csv` with `status = Pending` — **login is blocked**
   (both `/api/wardens/login` and the unified `/api/auth/login`).
3. Admin opens **Warden Approvals**, reviews the details and approves or rejects.
   A rejection requires a reason, which is stored and shown to the warden at login.
4. On approval the status becomes `Active` and the warden can log in.
   `approved_by`, `approved_date` and `rejection_reason` are recorded, plus an audit log entry.

The sidebar badge and the dashboard banner both show how many registrations are waiting.

Approved outpass/leave requests flow straight through to the gate: the warden's
decision issues a token, and the Gatekeeper's **Scan QR Pass** page (below)
verifies that token before recording the student's exit or return. Rejected
requests issue no token and can't be scanned in.

## Gatekeeper: Scan QR Pass — camera fixes

`gatekeeper/qr-scan.html` had two problems: it depended on a CDN for the QR
decoder (so scanning silently stopped working offline), and it gave no useful
error when the camera failed to start.

- **jsQR is now bundled** at `gatekeeper/vendor/jsQR.js` — no CDN dependency.
- **Secure-context check**: browsers hide the camera entirely on a plain LAN
  IP address or a `file://` page. This is the most common reason the scanner
  looks broken, and the page now says so directly instead of failing quietly.
  Always open the gatekeeper pages as `http://localhost:3000/...`, not as a
  file or a raw IP.
- **Specific error messages** for a denied permission, no webcam found, or the
  camera being in use by another app, plus a picker when more than one camera
  is available.
- The camera is released automatically when the browser tab loses focus.
- **Two fallbacks that need no camera:** *Scan from Photo* (upload a picture
  of the QR code) and typing the token printed on the pass. The manual-token
  path used to fail outright ("Malformed QR code") because the backend only
  accepted the signed QR payload — it now also resolves a plain token number
  (e.g. `OTP-260916-531`) against the approved outpass/leave records, with all
  the same approval, expiry and movement checks applied.

## Backend endpoints (admin)

All under `/api/admin-management` and protected by the `x-admin-id` header
(send `admin` to use the shared login, or a per-person `admin_id` from
`admin.csv`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/overview` | Dashboard counters (students, wardens, gatekeepers, rooms, outpass, leave) |
| GET | `/warden-approvals` | Pending warden registrations + decision history |
| PATCH | `/warden-approvals/:employee_id` | Body `{ decision: "approve"\|"reject", remarks }` |
| GET | `/reports/requests` | Query `from`, `to`, `type=all\|outpass\|leave`, `status=all\|approved\|rejected\|pending` |

Implemented in `backend/controllers/adminPortalController.js`; routes in
`backend/Routes/adminManagementRoutes.js`.

## Files changed this revision

**Added:** `backend/config/adminCredentials.js` (shared static admin login),
`gatekeeper/vendor/jsQR.js` (bundled QR decoder).

**Rewritten:** `gatekeeper/qr-scan.html` (camera reliability + manual-token fix).

**Edited:** `admin-shell.js` / `admin-dashboard.html` / `admin-section.js`
(removed Hostel Config + Permissions), `admin-login.html` (removed Register
link, shows the shared credentials), `js/script.js` (removed the admin
self-registration handler and the CSV→localStorage password mirror),
`backend/controllers/authController.js`, `backend/controllers/adminController.js`,
`backend/Routes/adminManagementRoutes.js` (all three now accept the shared
admin login), `backend/controllers/gatekeeperController.js` (accepts a plain
token number, exposes `approved_by` to the gate UI).

**Removed:** `admin-hostel-config.html`, `admin-permissions.html`,
`admin-permissions.js`, `admin-register.html`.

## Running it

```bash
cd collegepro/backend
npm install
node server.js
```

- Admin Portal: `http://localhost:3000/admin-login.html` — the login is
  printed to the server console at startup (see "Logging in" above), not
  written here.
- Gatekeeper Portal (for QR scanning): `http://localhost:3000/gatekeeper-login.html`,
  then **Scan QR Pass** in the sidebar. Must be opened via `localhost`, not a
  raw IP or a file path, or the browser will hide the camera.

**Demo data:** `WRD106 / Demo Pending Warden` is seeded with status `Pending` so
the Warden Approvals page has something to act on. Its password is
`Warden@123`. Delete that row from `warden.csv` when you no longer need it.
`AMJ005 / suresh` is similarly seeded as a `Pending` student registration for
the Registration Requests page.

## Fixed this revision: slow/hanging Approve buttons

The warden's Approve button on outpass and leave requests (and the admin's
student-registration approval) could take up to **two minutes** to respond,
or appear to do nothing at all. The cause: approving a request emails the
student a confirmation, and that email was sent with `await` and no timeout
on the mail connection — so if the mail server was slow, misconfigured, or
unreachable, the whole approval silently hung until the operating system's
own connection timeout gave up.

Fixed by:
- Adding `connectionTimeout` / `greetingTimeout` / `socketTimeout` to the
  mail transporter (`backend/services/emailService.js`), so a broken mail
  server now fails in ~10–15s instead of ~120s.
- Making the approval emails fire-and-forget in `outpassController.js`,
  `leaveController.js`, and `studentController.js` — the record is already
  saved before the email is attempted, so the response to the warden/admin
  no longer waits on mail delivery at all. A failed send is still logged to
  the server console; it just no longer blocks the action.

Verified: outpass and leave approval now respond in well under a second,
confirmed by simulating an actual browser click end-to-end.
