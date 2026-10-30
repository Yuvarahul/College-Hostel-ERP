/* ============================================================
   registrations.js
   Data layer for the Registration Approval workflow.
   Connected to Node.js Express REST APIs & CSV persistence.
   ============================================================ */

const REG_API_BASE = (window.location.port === "3000") ? "" : "http://localhost:3000";
let backendRegistrations = [];

async function fetchRegistrationsFromBackend() {
  try {
    const response = await fetch(`${REG_API_BASE}/api/registrations`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Failed to load registrations.");
    }

    backendRegistrations = (result.students || []).map((student, index) => ({
      id: index + 1,
      admissionNo: student.admission_no || "",
      roll: student.roll_no || "",
      name: student.full_name || "",
      email: student.email || "",
      phone: student.phone_no || "",
      dept: student.department || "",
      year: student.year || "",
      parentPhone: student.parents_phone || student.parent_phone || "",
      address: student.address || "",
      idProof: student.id_proof || "",
      passportPhoto: student.passport_photo || "",
      room: student.room_no || "",
      hostellerType: student.roll_no?.trim() ? "Senior" : "Fresher",
      status: student.status?.trim() || "Pending",
      approvedBy: student.approved_by || "",
      approvedDate: student.approved_date || "",
      registeredAt: student.created_at || "",
      rejectionReason: student.rejection_reason || ""
    }));

    return backendRegistrations;
  } catch (error) {
    console.error("Failed to fetch registrations:", error);
    backendRegistrations = [];
    return [];
  }
}

function getRegistrations() {
  return backendRegistrations;
}

function pendingRegistrationCount() {
  return getRegistrations().filter((r) => String(r.status).toLowerCase() === "pending").length;
}

/* ---------- Notification helper ---------- */
async function addRegNotification(type, title, text, roll, audience) {
  try {
    await fetch(`${REG_API_BASE}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, text, roll, audience })
    });
  } catch (e) {
    console.warn("Could not send notification:", e);
  }
}

/* ---------- Registration actions ---------- */
async function submitRegistration(data) {
  try {
    const formData = new FormData();
    formData.append("admission_no", data.admissionNo || "");
    formData.append("roll_no", data.roll || "");
    formData.append("full_name", data.name || "");
    formData.append("email", data.email || "");
    formData.append("phone_no", data.phone || "");
    formData.append("department", data.dept || "");
    formData.append("year", data.year || "");
    formData.append("parents_phone", data.parentPhone || "");
    formData.append("password", data.password || "");
    formData.append("address", data.address || "");
    formData.append("room_no", data.room || "");

    if (data.idProof) formData.append("idProof", data.idProof);
    if (data.passportPhoto) formData.append("passportPhoto", data.passportPhoto);

    const response = await fetch(`${REG_API_BASE}/api/students/register`, {
      method: "POST",
      body: formData
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || `Registration failed (HTTP ${response.status})`);
    }

    return result;
  } catch (error) {
    console.error("Registration error:", error);
    throw error;
  }
}

function findRegistration(id) {
  return getRegistrations().find((r) => r.id === Number(id) || String(r.admissionNo) === String(id));
}

function findRegistrationByLoginId(loginId) {
  const q = (loginId || "").trim().toLowerCase();
  if (!q) return null;
  return getRegistrations().find(
    (r) => (r.roll && r.roll.toLowerCase() === q) || (r.admissionNo && r.admissionNo.toLowerCase() === q) || (r.email && r.email.toLowerCase() === q)
  );
}

async function approveSeniorRegistration(id) {
  try {
    const regs = getRegistrations();
    const reg = regs.find((r) => r.id === Number(id) || String(r.admissionNo) === String(id));

    if (!reg) {
      throw new Error("Registration not found.");
    }

    const admissionNo = reg.admissionNo;
    const loggedInWarden = JSON.parse(sessionStorage.getItem("loggedInWarden") || "null");

    const response = await fetch(
      `${REG_API_BASE}/api/students/${encodeURIComponent(admissionNo)}/approve`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roll_no: reg.roll || admissionNo,
          room_no: reg.room || "",
          approved_by: loggedInWarden?.employee_id || loggedInWarden?.full_name || "Warden"
        })
      }
    );

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Student approval failed.");
    }

    reg.status = "Approved";
    reg.roll = result.student?.roll_no || reg.roll;
    reg.room = result.student?.room_no || reg.room;

    await fetchRegistrationsFromBackend();
    return reg;
  } catch (error) {
    console.error("Student approval error:", error);
    throw error;
  }
}

async function rejectRegistration(id, reason) {
  try {
    const regs = getRegistrations();
    const reg = regs.find((r) => r.id === Number(id) || String(r.admissionNo) === String(id));
    if (!reg) return null;

    const admissionNo = reg.admissionNo;
    const response = await fetch(
      `${REG_API_BASE}/api/students/${encodeURIComponent(admissionNo)}/reject`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || "Rejected by Warden" })
      }
    );

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Student rejection failed.");
    }

    reg.status = "Rejected";
    reg.rejectionReason = reason;

    await fetchRegistrationsFromBackend();
    return reg;
  } catch (error) {
    console.error("Student rejection error:", error);
    throw error;
  }
}

function refreshRegBadge() {
  const count = pendingRegistrationCount();
  const badge = document.getElementById("sidebarRegBadge");
  if (badge) {
    badge.style.display = count > 0 ? "inline-flex" : "none";
    badge.textContent = count > 99 ? "99+" : count;
  }
}

// Auto-fetch registrations on load
fetchRegistrationsFromBackend().then(() => {
  refreshRegBadge();
});
