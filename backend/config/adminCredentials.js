/* ============================================================
   adminCredentials.js
   ONE shared, static admin login for the whole Admin Portal.

   Anyone on the hostel admin desk signs in with the same
   username and password — there is no admin registration
   page any more, so this account is what opens the portal.

   The actual username/password live in backend/.env
   (ADMIN_USERNAME / ADMIN_PASSWORD), NOT in this file and NOT
   in any document that ships with the project. .env is listed
   in .gitignore, so it never gets committed or handed to anyone
   who only has the source code. The active login is printed
   once to the server's own console on startup (see server.js)
   — that's the one place it's meant to be visible, to whoever
   is actually running the server.

   To change the login: edit backend/.env and restart the
   server. If .env doesn't set them, the fallback below is used
   so the project still runs out of the box — change it before
   handing the project to anyone else.

   NOTE: a single shared password means every action is recorded
   against the same identity, and the credential cannot be
   revoked per person. That is fine for a college demo; for real
   deployment use one account per administrator.
   ============================================================ */

const STATIC_ADMIN = {
  admin_id: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'Admin@123',
  full_name: 'Hostel Administrator',
  designation: 'Administrator',
  shift: 'General',
  email: 'admin@amjaincollege.edu',
  phone_no: '-',
  status: 'Active'
};

/* The record handed to the rest of the app — never includes the password. */
function staticAdminRecord() {
  const { password, ...safe } = STATIC_ADMIN;
  return { ...safe };
}

/* True when the given id/username is the shared admin account. */
function isStaticAdminId(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  return id === STATIC_ADMIN.admin_id.toLowerCase() ||
         id === STATIC_ADMIN.email.toLowerCase();
}

/* True when both the username and the password match. */
function checkStaticAdmin(identifier, password) {
  return isStaticAdminId(identifier) && String(password || '') === STATIC_ADMIN.password;
}

module.exports = { STATIC_ADMIN, staticAdminRecord, isStaticAdminId, checkStaticAdmin };
