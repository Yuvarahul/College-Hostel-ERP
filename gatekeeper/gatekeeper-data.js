/* ============================================================
   gatekeeper-data.js
   Core data layer for the GateKeeper Security Module.
   No backend — everything lives in localStorage, exactly like
   students.js/registrations.js do for the Warden ERP. This file
   owns:
     - GateKeeper's own "database" (staff, gate log, visitors,
       audit log, notifications) + seed data
     - Session / auth helpers
     - The ERPAdapter surface (getStudent, verifyOutpass,
       syncNotifications) — the ONLY place that is allowed to
       know the ERP's localStorage key names, so if the ERP's
       storage schema ever changes, this is the one file that
       needs to change.
   ============================================================ */

/* ---------- GateKeeper's own storage keys ---------- */
const GK_STAFF_KEY = "gatekeeper_security_staff_v1";
const GK_SESSION_KEY = "gatekeeper_session_v1";
const GK_GATELOG_KEY = "gatekeeper_gate_log_v1";
const GK_VISITOR_KEY = "gatekeeper_visitors_v1";
const GK_AUDIT_KEY = "gatekeeper_audit_log_v1";
const GK_STUDENT_CACHE_KEY = "gatekeeper_student_cache_v1";
const GK_NOTIF_KEY = "gatekeeper_notifications_v1";
const GK_META_KEY = "gatekeeper_meta_v1";
const GK_DARK_KEY = "gatekeeper_dark_mode";

/* ---------- Frozen ERP integration contract ----------
   These are the ONLY external keys GateKeeper ever reads, and it
   never writes to warden_erp_students_v1 / _registrations_v1.
   Treat this object as a frozen constant (see docs note below) —
   if the ERP ever changes these key names, this is the single
   place to update. */
const ERP_KEYS = Object.freeze({
  students: "warden_erp_students_v1",
  registrations: "warden_erp_registrations_v1",
  notifications: "warden_erp_notifications_v1"
});

/* ---------- Mode / feature flags (config.js folded in here) ---------- */
const GateKeeperConfig = {
  // "standalone" = GateKeeper never assumes ERP is reachable.
  // "integrated" = same-origin demo bridge to ERP localStorage is allowed.
  mode: "integrated",
  features: {
    notifyERP: false,        // opt-in: also push GateKeeper events into ERP's notification bell
    outpassVerification: true // best-effort only — see verifyOutpass() notes below
  }
};

/* ============================================================
   SEED DATA
   ============================================================ */
function seedStaff() {
  return [
    { id: 101, staffCode: "SEC101", name: "Gokul Raj", password: "GokulRaj@123", role: "Security Staff", shift: "Day Shift (6:00 AM – 6:00 PM)", phone: "9000010101", gate: "Main Gate", isActive: true, avatarInitials: "GR", failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString() },
    { id: 102, staffCode: "SEC102", name: "Hari Kumar", password: "HariKumar@123", role: "Security Staff", shift: "Night Shift (6:00 PM – 6:00 AM)", phone: "9000010102", gate: "Main Gate", isActive: true, avatarInitials: "HK", failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString() },
    { id: 103, staffCode: "SEC103", name: "Imran Ali", password: "ImranAli@123", role: "Security Staff", shift: "Day Shift (6:00 AM – 6:00 PM)", phone: "9000010103", gate: "Back Gate", isActive: true, avatarInitials: "IA", failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString() },
    { id: 104, staffCode: "SEC104", name: "Manoj Kumar", password: "ManojKumar@123", role: "Security Staff", shift: "Night Shift (6:00 PM – 6:00 AM)", phone: "9000010104", gate: "Back Gate", isActive: true, avatarInitials: "MK", failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString() },
    { id: 105, staffCode: "SEC105", name: "Naveen Raj", password: "NaveenRaj@123", role: "Supervisor", shift: "General Shift", phone: "9000010105", gate: "All Gates", isActive: true, avatarInitials: "NR", failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString() }
  ];
}

/* ============================================================
   PERSISTENCE HELPERS (generic get/save pattern, mirrors students.js)
   ============================================================ */
function gkLoad(key, seedFn) {
  let raw = localStorage.getItem(key);
  if (!raw) {
    const fresh = seedFn ? seedFn() : [];
    localStorage.setItem(key, JSON.stringify(fresh));
    raw = JSON.stringify(fresh);
  }
  return JSON.parse(raw);
}
function gkSave(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function initGKDB() {
  gkLoad(GK_STAFF_KEY, seedStaff);
  gkLoad(GK_GATELOG_KEY, () => []);
  gkLoad(GK_VISITOR_KEY, () => []);
  gkLoad(GK_AUDIT_KEY, () => []);
  gkLoad(GK_STUDENT_CACHE_KEY, () => []);
  gkLoad(GK_NOTIF_KEY, () => []);
  if (!localStorage.getItem(GK_META_KEY)) {
    gkSave(GK_META_KEY, { installedAt: new Date().toISOString(), lastAuditId: 0, lastGateLogId: 0, lastVisitorId: 0, lastNotifId: 0 });
  }
}
initGKDB();

function nextId(counterField) {
  const meta = gkLoad(GK_META_KEY, () => ({}));
  meta[counterField] = (meta[counterField] || 0) + 1;
  gkSave(GK_META_KEY, meta);
  return meta[counterField];
}

/* ============================================================
   SECURITY STAFF
   ============================================================ */
function getStaffList() { return gkLoad(GK_STAFF_KEY, seedStaff); }
function saveStaffList(list) { gkSave(GK_STAFF_KEY, list); }
function findStaffByCode(staffCode) {
  return getStaffList().find(s => s.staffCode.toLowerCase() === String(staffCode).trim().toLowerCase()) || null;
}
function findStaffById(id) {
  return getStaffList().find(s => s.id === id) || null;
}

/* ============================================================
   SESSION / AUTH
   Own real session handling (unlike the ERP demo, which has no
   student-side auth at all) — a signed-looking session object
   with an expiry, stored in localStorage so it survives tab
   refreshes but is fully client-side (documented limitation).
   ============================================================ */
const GK_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8-hour shift session
const GK_MAX_LOGIN_ATTEMPTS = 5;
const GK_LOCKOUT_MS = 5 * 60 * 1000;

function gkLogin(staffCode, password) {
  const staff = findStaffByCode(staffCode);
  if (!staff || !staff.isActive) {
    return { ok: false, error: "Invalid staff code or account disabled." };
  }
  if (staff.lockedUntil && new Date(staff.lockedUntil) > new Date()) {
    const mins = Math.ceil((new Date(staff.lockedUntil) - new Date()) / 60000);
    return { ok: false, error: `Account temporarily locked. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.` };
  }
  if (staff.password !== password) {
    const staffList = getStaffList();
    const idx = staffList.findIndex(s => s.id === staff.id);
    staffList[idx].failedAttempts = (staffList[idx].failedAttempts || 0) + 1;
    if (staffList[idx].failedAttempts >= GK_MAX_LOGIN_ATTEMPTS) {
      staffList[idx].lockedUntil = new Date(Date.now() + GK_LOCKOUT_MS).toISOString();
      staffList[idx].failedAttempts = 0;
    }
    saveStaffList(staffList);
    addAuditEntry({ actorStaffId: staff.id, actorName: staff.name, action: "LOGIN_FAILED", entityType: "security_staff", entityId: staff.id, before: null, after: null });
    return { ok: false, error: "Incorrect password." };
  }

  // Reset lockout counters on success
  const staffList = getStaffList();
  const idx = staffList.findIndex(s => s.id === staff.id);
  staffList[idx].failedAttempts = 0;
  staffList[idx].lockedUntil = null;
  saveStaffList(staffList);

  const session = {
    staffId: staff.id,
    staffCode: staff.staffCode,
    name: staff.name,
    role: staff.role,
    avatarInitials: staff.avatarInitials,
    gate: staff.gate,
    loginTime: new Date().toISOString(),
    expiresAt: new Date(Date.now() + GK_SESSION_TTL_MS).toISOString()
  };
  localStorage.setItem(GK_SESSION_KEY, JSON.stringify(session));
  addAuditEntry({ actorStaffId: staff.id, actorName: staff.name, action: "LOGIN_SUCCESS", entityType: "security_staff", entityId: staff.id, before: null, after: null });
  return { ok: true, session };
}

function gkLogout() {
  const session = getSession();
  if (session) {
    addAuditEntry({ actorStaffId: session.staffId, actorName: session.name, action: "LOGOUT", entityType: "security_staff", entityId: session.staffId, before: null, after: null });
  }
  localStorage.removeItem(GK_SESSION_KEY);
}

function getSession() {
  const raw = localStorage.getItem(GK_SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (new Date(session.expiresAt) < new Date()) {
    localStorage.removeItem(GK_SESSION_KEY);
    return null;
  }
  return session;
}
function isAuthenticated() { return getSession() !== null; }

/* Role-based permission check. Supervisor implicitly has every
   Security Staff permission plus supervisor-only screens. */
function hasRole(...allowedRoles) {
  const session = getSession();
  if (!session) return false;
  if (session.role === "Supervisor") return true;
  return allowedRoles.includes(session.role);
}

/* Call at the top of every protected page's inline script,
   BEFORE initShell(). Redirects to login if no valid session. */
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = "../gatekeeper-login.html";
    return null;
  }
  return getSession();
}

/* ============================================================
   GATE LOG (student + visitor entry/exit — the durable source
   of truth for physical presence; GateKeeper never trusts ERP's
   hostelStatus field for this, only its own logged events)
   ============================================================ */
function getGateLog() { return gkLoad(GK_GATELOG_KEY, () => []); }
function saveGateLog(list) { gkSave(GK_GATELOG_KEY, list); }

function addGateLogEntry({ personType, personRefId, personRefSource = "erp", name, identifier, direction, gateId, method = "manual", remarks = "" }) {
  const session = getSession();
  const entry = {
    id: nextId("lastGateLogId"),
    personType,        // "student" | "visitor" | "staff"
    personRefId,        // roll number / visitor id
    personRefSource,    // "erp" | "gatekeeper"
    name,
    identifier,
    direction,          // "in" | "out"
    gateId: gateId || (session ? session.gate : "Main Gate"),
    loggedByStaffId: session ? session.staffId : null,
    loggedByName: session ? session.name : "System",
    timestamp: new Date().toISOString(),
    method,             // "manual" | "qr" | "rfid" | "face"
    remarks
  };
  const log = getGateLog();
  log.unshift(entry);
  saveGateLog(log);
  addAuditEntry({ action: `GATE_${direction.toUpperCase()}`, entityType: personType, entityId: personRefId, before: null, after: entry });
  return entry;
}

/* Live occupancy: "In"/"Out" status derived purely from
   GateKeeper's own log — the most recent entry per identifier. */
function getCurrentGateStatus(personType, personRefId) {
  const log = getGateLog();
  const last = log.find(e => e.personType === personType && e.personRefId === personRefId);
  return last ? last.direction : "out"; // assume outside campus if never logged
}

function getTodayGateLog() {
  const todayStr = new Date().toDateString();
  return getGateLog().filter(e => new Date(e.timestamp).toDateString() === todayStr);
}

/* ============================================================
   VISITORS
   ============================================================ */
function getVisitors() { return gkLoad(GK_VISITOR_KEY, () => []); }
function saveVisitors(list) { gkSave(GK_VISITOR_KEY, list); }

function addVisitorEntry({ name, phone, idProofType, idProofNumber, purpose, hostName, hostRefRoll, gateId }) {
  const session = getSession();
  const visitor = {
    id: nextId("lastVisitorId"),
    name, phone, idProofType, idProofNumber, purpose,
    hostName: hostName || "", hostRefRoll: hostRefRoll || "",
    status: "in",
    entryTime: new Date().toISOString(),
    exitTime: null,
    entryStaffId: session ? session.staffId : null,
    entryStaffName: session ? session.name : "System",
    exitStaffId: null,
    exitStaffName: null,
    gateId: gateId || (session ? session.gate : "Main Gate")
  };
  const visitors = getVisitors();
  visitors.unshift(visitor);
  saveVisitors(visitors);

  addGateLogEntry({ personType: "visitor", personRefId: String(visitor.id), personRefSource: "gatekeeper", name: visitor.name, identifier: visitor.phone, direction: "in", gateId: visitor.gateId, remarks: `Visiting ${visitor.hostName || "N/A"} — ${visitor.purpose}` });
  addAuditEntry({ action: "VISITOR_ENTRY", entityType: "visitor", entityId: visitor.id, before: null, after: visitor });
  return visitor;
}

function closeVisitorExit(visitorId, remarks = "") {
  const session = getSession();
  const visitors = getVisitors();
  const idx = visitors.findIndex(v => v.id === visitorId);
  if (idx === -1) return null;
  const before = { ...visitors[idx] };
  visitors[idx].status = "out";
  visitors[idx].exitTime = new Date().toISOString();
  visitors[idx].exitStaffId = session ? session.staffId : null;
  visitors[idx].exitStaffName = session ? session.name : "System";
  saveVisitors(visitors);

  addGateLogEntry({ personType: "visitor", personRefId: String(visitorId), personRefSource: "gatekeeper", name: visitors[idx].name, identifier: visitors[idx].phone, direction: "out", remarks });
  addAuditEntry({ action: "VISITOR_EXIT", entityType: "visitor", entityId: visitorId, before, after: visitors[idx] });
  return visitors[idx];
}

function getVisitorsCurrentlyIn() {
  return getVisitors().filter(v => v.status === "in");
}

/* ============================================================
   AUDIT LOG (append-only — nothing here is ever edited/deleted
   through the UI, matching the security-system requirement that
   every write action is recorded before/after)
   ============================================================ */
function getAuditLog() { return gkLoad(GK_AUDIT_KEY, () => []); }
function saveAuditLog(list) { gkSave(GK_AUDIT_KEY, list); }

function addAuditEntry({ actorStaffId, actorName, action, entityType, entityId, before, after }) {
  const session = getSession();
  const entry = {
    id: nextId("lastAuditId"),
    actorStaffId: actorStaffId !== undefined ? actorStaffId : (session ? session.staffId : null),
    actorName: actorName || (session ? session.name : "System"),
    action,                 // e.g. GATE_IN, GATE_OUT, VISITOR_ENTRY, LOGIN_SUCCESS...
    entityType,              // "student" | "visitor" | "security_staff"
    entityId,
    before: before || null,
    after: after || null,
    timestamp: new Date().toISOString()
  };
  const log = getAuditLog();
  log.unshift(entry);
  saveAuditLog(log);
  return entry;
}

/* ============================================================
   NOTIFICATIONS (GateKeeper's own bell — separate from the ERP's)
   ============================================================ */
function getGKNotifications() { return gkLoad(GK_NOTIF_KEY, () => []); }
function saveGKNotifications(list) { gkSave(GK_NOTIF_KEY, list); }

function addGKNotification(type, text) {
  const notif = { id: nextId("lastNotifId"), type, text, time: new Date().toISOString(), read: false };
  const list = getGKNotifications();
  list.unshift(notif);
  saveGKNotifications(list.slice(0, 100));
  return notif;
}
function markGKNotificationRead(id) {
  const list = getGKNotifications();
  const idx = list.findIndex(n => n.id === id);
  if (idx !== -1) { list[idx].read = true; saveGKNotifications(list); }
}
function markAllGKNotificationsRead() {
  saveGKNotifications(getGKNotifications().map(n => ({ ...n, read: true })));
}
function unreadGKNotificationCount() {
  return getGKNotifications().filter(n => !n.read).length;
}

/* ============================================================
   PHASE 2 INTEGRATION HOOKS — the ERPAdapter surface
   ------------------------------------------------------------
   These three functions are the ONLY integration points that
   read ERP data. Today they read the ERP's localStorage directly
   (same-origin demo bridge). When the ERP grows a real backend,
   only the bodies of these three functions need to change to
   HTTP calls — every page/module that calls getStudent(),
   verifyOutpass(), or syncNotifications() keeps working unmodified.
   ============================================================ */

/** Read-only helper: safely parse an ERP localStorage key. */
function readERPKey(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn(`GateKeeper: could not read ERP key "${key}"`, e);
    return null;
  }
}

/**
 * getStudent(identifier)
 * Looks up a student by roll number, ERP internal id, or name
 * (partial match as last resort). Reads warden_erp_students_v1
 * first; falls back to warden_erp_registrations_v1 for freshers
 * who only exist as an approved registration; then falls back to
 * GateKeeper's own offline student_cache if the ERP data isn't
 * reachable at all (different origin / ERP not deployed here).
 *
 * Returns a normalized shape so the rest of GateKeeper never has
 * to know which source the record came from:
 *   { source, roll, name, dept, year, room, block, phone,
 *     parentPhone, photoRef, hostelStatus }
 * or null if nobody matches.
 */
function getStudent(identifier) {
  if (!identifier) return null;
  const q = String(identifier).trim().toLowerCase();

  const students = readERPKey(ERP_KEYS.students);
  if (students) {
    const match = students.find(s =>
      s.roll.toLowerCase() === q ||
      String(s.id) === q ||
      s.name.toLowerCase().includes(q)
    );
    if (match) {
      cacheStudent(match);
      return {
        source: "erp:students",
        roll: match.roll, name: match.name, dept: match.dept, year: match.year,
        room: match.room, block: match.block, phone: match.phone, parentPhone: match.parentPhone,
        photoRef: null, hostelStatus: match.hostelStatus
      };
    }
  }

  const registrations = readERPKey(ERP_KEYS.registrations);
  if (registrations) {
    const match = registrations.find(r =>
      (r.roll && r.roll.toLowerCase() === q) ||
      (r.admissionNo && r.admissionNo.toLowerCase() === q) ||
      r.name.toLowerCase().includes(q)
    );
    if (match && match.status === "Approved") {
      const normalized = {
        source: "erp:registrations",
        roll: match.roll || match.admissionNo, name: match.name, dept: match.dept, year: match.year,
        room: match.room, block: match.block, phone: match.phone, parentPhone: match.parentPhone,
        photoRef: null, hostelStatus: "In Hostel"
      };
      cacheStudent(normalized);
      return normalized;
    }
  }

  // Offline fallback — GateKeeper's own refreshable cache
  const cached = getStudentCache().find(c => c.roll.toLowerCase() === q || c.name.toLowerCase().includes(q));
  if (cached) return { ...cached, source: "gatekeeper:cache" };

  return null;
}

/**
 * verifyOutpass(rollOrIdentifier)
 * BEST-EFFORT ONLY. The ERP has no addressable outpass record
 * today — `request` is just an embedded field on the student
 * object, not a lookup-by-ID resource (see integration-contract
 * notes). This checks whether the student's *current* embedded
 * request is an Approved Outpass/Leave whose time window covers
 * "now", and reports that as a pass/fail. Once the ERP exposes a
 * real outpass id, replace the body of this function only.
 *
 * Returns { valid, studentRef, requestType, validFrom, validTo }
 * or null if the student/request can't be found at all.
 */
function verifyOutpass(rollOrIdentifier) {
  const students = readERPKey(ERP_KEYS.students);
  if (!students) return null;
  const q = String(rollOrIdentifier).trim().toLowerCase();
  const student = students.find(s => s.roll.toLowerCase() === q || String(s.id) === q);
  if (!student || !student.request) return null;

  const req = student.request;
  const now = new Date();
  const from = new Date(req.fromTime || req.fromDate);
  const to = new Date(req.toTime || req.toDate);
  const withinWindow = now >= from && now <= to;
  const valid = req.status === "Approved" && withinWindow;

  return {
    valid,
    studentRef: student.roll,
    requestType: student.requestType,
    validFrom: from.toISOString(),
    validTo: to.toISOString(),
    status: req.status
  };
}

/**
 * syncNotifications(event)
 * Always logs the event to GateKeeper's own notification bell.
 * If GateKeeperConfig.features.notifyERP is turned on, ALSO
 * best-effort appends to the ERP's notification array so the
 * warden's bell shows gate events too (opt-in, same-origin only).
 * event: { type: "alert"|"success"|"warning"|"info", text, roll? }
 * Returns { ok: boolean, erpNotified: boolean }
 */
function syncNotifications(event) {
  addGKNotification(event.type, event.text);

  if (!GateKeeperConfig.features.notifyERP) {
    return { ok: true, erpNotified: false };
  }
  try {
    const existing = readERPKey(ERP_KEYS.notifications) || [];
    existing.unshift({
      id: existing.length ? Math.max(...existing.map(n => n.id)) + 1 : 1,
      type: event.type,
      text: `[GateKeeper] ${event.text}`,
      time: new Date().toISOString(),
      read: false,
      roll: event.roll || ""
    });
    localStorage.setItem(ERP_KEYS.notifications, JSON.stringify(existing));
    return { ok: true, erpNotified: true };
  } catch (e) {
    console.warn("GateKeeper: best-effort ERP notification sync failed", e);
    return { ok: false, erpNotified: false };
  }
}

/** getStudentCurrentStatus(studentRef) — part of the ERPAdapter
 *  contract from the architecture doc (§7b). Uses GateKeeper's
 *  OWN gate log (source of truth for physical presence), not
 *  the ERP's hostelStatus field, which can go stale. */
function getStudentCurrentStatus(studentRef) {
  const direction = getCurrentGateStatus("student", studentRef);
  return direction === "in" ? "In Hostel" : "Out of Hostel";
}

/* ---------- student_cache table (offline-safe local copy) ---------- */
function getStudentCache() { return gkLoad(GK_STUDENT_CACHE_KEY, () => []); }
function saveStudentCache(list) { gkSave(GK_STUDENT_CACHE_KEY, list); }
function cacheStudent(student) {
  const cache = getStudentCache();
  const idx = cache.findIndex(c => c.roll === student.roll);
  const record = { roll: student.roll, name: student.name, dept: student.dept, year: student.year, room: student.room, block: student.block, phone: student.phone, parentPhone: student.parentPhone, syncedAt: new Date().toISOString() };
  if (idx === -1) cache.push(record); else cache[idx] = record;
  saveStudentCache(cache);
}

/* ---------- Small shared formatters (mirrors students.js) ---------- */
function fmtDateTime(d) { return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
function fmtTime(d) { return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }