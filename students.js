/* ============================================================
   students.js
   Core data layer for the Warden ERP portal.
   Connected directly to the Node.js Express REST APIs.
   ============================================================ */

const STU_API_BASE = (window.location.port === "3000") ? "" : "http://localhost:3000";

let backendStudents = [];
let backendNotifications = [];

/* ---------- Date & Time formatting helpers ---------- */
function fmtDateTime(d) {
  if (!d) return "—";
  const dateObj = typeof d === "string" ? new Date(d) : d;
  return dateObj.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d) {
  if (!d) return "—";
  const dateObj = typeof d === "string" ? new Date(d) : d;
  return isNaN(dateObj.getTime()) ? String(d) : dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(d) {
  if (!d) return "—";
  const dateObj = typeof d === "string" ? new Date(d) : d;
  return isNaN(dateObj.getTime()) ? String(d) : dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/* ---------- Persistence / API Layer ---------- */
async function fetchStudentsFromBackend() {
  try {
    const res = await fetch(`${STU_API_BASE}/api/students`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || "Failed to load students");
    }

    backendStudents = (data.students || []).map((s, idx) => ({
      id: idx + 1,
      admissionNo: s.admission_no || "",
      roll: s.roll_no || s.admission_no || "",
      name: s.full_name || "",
      email: s.email || "",
      phone: s.phone_no || "",
      dept: s.department || "",
      year: s.year || "",
      parentPhone: s.parents_phone || "",
      address: s.address || "",
      room: s.room_no || "",
      block: s.room_no ? s.room_no[0] : "",
      floor: s.room_no && s.room_no.length > 1 ? s.room_no[1] : "",
      status: s.status || "Approved",
      hostelStatus: s.room_no ? "In Hostel" : "Waiting For Allocation",
      hostellerType: s.roll_no?.trim() ? "Senior" : "Fresher",
      passportPhoto: s.passport_photo || "",
      registeredAt: s.created_at || ""
    }));

    return backendStudents;
  } catch (err) {
    console.error("fetchStudentsFromBackend error:", err);
    backendStudents = [];
    return [];
  }
}

async function fetchNotificationsFromBackend() {
  try {
    const res = await fetch(`${STU_API_BASE}/api/notifications?audience=warden`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || "Failed to load notifications");
    }
    backendNotifications = (data.notifications || []).map(n => ({
      id: Number(n.id),
      type: n.type || "info",
      title: n.title || "",
      text: n.text || "",
      time: n.time || new Date().toISOString(),
      read: String(n.read).toLowerCase() === "true",
      roll: n.roll || "",
      audience: n.audience || "warden"
    }));
    return backendNotifications;
  } catch (err) {
    console.error("fetchNotificationsFromBackend error:", err);
    backendNotifications = [];
    return [];
  }
}

function getStudents() {
  return backendStudents;
}

function getNotifications() {
  return backendNotifications;
}

async function markNotificationRead(id) {
  try {
    await fetch(`${STU_API_BASE}/api/notifications/${id}/read`, { method: "PATCH" });
    const idx = backendNotifications.findIndex((n) => n.id === id);
    if (idx !== -1) {
      backendNotifications[idx].read = true;
    }
  } catch (e) {
    console.warn("Could not mark notification read:", e);
  }
}

async function markAllNotificationsRead() {
  try {
    await fetch(`${STU_API_BASE}/api/notifications/read-all`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience: "warden" })
    });
    backendNotifications.forEach((n) => (n.read = true));
  } catch (e) {
    console.warn("Could not mark all notifications read:", e);
  }
}

function unreadNotificationCount() {
  return backendNotifications.filter((n) => !n.read).length;
}

/* Warden profile object */
const loggedInWarden = JSON.parse(sessionStorage.getItem("loggedInWarden") || "null");

const WARDEN = loggedInWarden
  ? {
    empId: loggedInWarden.employee_id || "WRD101",
    name: loggedInWarden.full_name || "Arun Kumar",
    email: loggedInWarden.email || "arun.warden@amjaincollege.edu",
    phone: loggedInWarden.phone_no || "9000000101",
    shift: loggedInWarden.shift || "Shift 1",
    department: loggedInWarden.department || "Hostel Administration",
    hostelBlock: "All Blocks",
    avatarInitials: (loggedInWarden.full_name || "Arun Kumar")
      .split(" ")
      .map(word => word[0])
      .join("")
      .toUpperCase()
  }
  : {
    empId: "WRD101",
    name: "Arun Kumar",
    email: "arun.warden@amjaincollege.edu",
    phone: "9000000101",
    shift: "Shift 1",
    department: "Hostel Administration",
    hostelBlock: "All Blocks",
    avatarInitials: "AK"
  };

// Initial background load
Promise.all([fetchStudentsFromBackend(), fetchNotificationsFromBackend()]).then(() => {
  if (typeof refreshNotifBadges === "function") refreshNotifBadges();
});
