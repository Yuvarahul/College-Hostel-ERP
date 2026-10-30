/* ============================================================
   admin-data.js
   Aggregation layer for the Admin Portal.
   Fetches live statistics, wardens, activity feeds, registrations,
   leave and outpass requests from the Node.js Express REST APIs.
   ============================================================ */

const ADMIN_API_BASE = (window.location.port === "3000") ? "" : "http://localhost:3000";

let backendWardensList = [];
let backendAdminStats = {
  totalStudents: 0,
  totalWardens: 0,
  pendingRegistrations: 0,
  pendingLeave: 0,
  pendingOutpass: 0,
  unreadNotifications: 0,
  approvedStudents: 0,
  rejectedStudents: 0,
  roomStats: { totalRooms: 240, occupiedRooms: 0, availableRooms: 240, vacantBeds: 960 }
};
let backendActivityList = [];
let backendLeaveList = [];
let backendOutpassList = [];

/* ---------- Wardens ---------- */
async function fetchWardensFromBackend() {
  try {
    const res = await fetch(`${ADMIN_API_BASE}/api/wardens`);
    const data = await res.json();
    if (res.ok && data.success) {
      backendWardensList = (data.wardens || []).map(w => ({
        employeeId: w.employee_id,
        name: w.full_name,
        dept: w.department,
        shift: w.shift || w.Shift,
        email: w.email,
        phone: w.phone_no,
        address: w.address,
        status: "Active",
        registeredAt: w.created_at
      }));
    }
    return backendWardensList;
  } catch (e) {
    console.error("fetchWardensFromBackend error:", e);
    return [];
  }
}

function getAllWardens() {
  return backendWardensList;
}

/* ---------- Leave / Outpass requests ---------- */
async function fetchAdminRequests() {
  try {
    const [leaveRes, outpassRes] = await Promise.all([
      fetch(`${ADMIN_API_BASE}/api/leave`).then(r => r.json()).catch(() => ({ leaves: [] })),
      fetch(`${ADMIN_API_BASE}/api/outpass`).then(r => r.json()).catch(() => ({ outpasses: [] }))
    ]);

    if (leaveRes.success) backendLeaveList = leaveRes.leaves || [];
    if (outpassRes.success) backendOutpassList = outpassRes.outpasses || [];
  } catch (e) {
    console.error("fetchAdminRequests error:", e);
  }
}

function getLeaveRequests() {
  return backendLeaveList.map(l => ({
    name: l.name,
    roll: l.roll_no || l.student_id,
    room: l.room_no,
    requestType: "Leave",
    request: {
      status: l.status || "Pending",
      reason: l.reason,
      fromDate: l.from_date,
      toDate: l.to_date,
      token: l.token_no,
      rejectionReason: l.rejection_reason
    }
  }));
}

function getOutpassRequests() {
  return backendOutpassList.map(o => ({
    name: o.name,
    roll: o.roll_no || o.student_id,
    room: o.room_no,
    requestType: "Outpass",
    request: {
      status: o.status || "Pending",
      destination: o.purpose,
      reason: o.purpose,
      fromTime: o.out_date ? `${o.out_date}T${o.out_time || "00:00"}` : "",
      toTime: o.out_date ? `${o.out_date}T${o.return_time || "00:00"}` : "",
      token: o.token_no,
      rejectionReason: o.rejection_reason
    }
  }));
}

function pendingLeaveCount() {
  return backendLeaveList.filter(l => String(l.status).toLowerCase() === "pending").length;
}

function pendingOutpassCount() {
  return backendOutpassList.filter(o => String(o.status).toLowerCase() === "pending").length;
}

/* ---------- Dashboard summary ---------- */
async function fetchAdminStats() {
  try {
    const res = await fetch(`${ADMIN_API_BASE}/api/admin/stats`);
    const data = await res.json();
    if (res.ok && data.success && data.stats) {
      backendAdminStats = data.stats;
    }
    return backendAdminStats;
  } catch (e) {
    console.error("fetchAdminStats error:", e);
    return backendAdminStats;
  }
}

function computeAdminDashboardStats() {
  return backendAdminStats;
}

/* ---------- Warden Activities ---------- */
async function fetchWardenActivityFeed() {
  try {
    const res = await fetch(`${ADMIN_API_BASE}/api/activities`);
    const data = await res.json();
    if (res.ok && data.success) {
      backendActivityList = data.activities || [];
    }
    return backendActivityList;
  } catch (e) {
    console.error("fetchWardenActivityFeed error:", e);
    return [];
  }
}

function getWardenActivityFeed() {
  return backendActivityList;
}

// Initial background sync
Promise.all([
  fetchWardensFromBackend(),
  fetchAdminRequests(),
  fetchAdminStats(),
  fetchWardenActivityFeed()
]);
