/* ============================================================
   student.js
   Student-facing workflow logic for the Hostel ERP.
   Connects Student Dashboard, Leave, Outpass, History, Profile,
   and Notifications directly to the Node.js Express REST APIs.
   ============================================================ */

const STUDENT_SESSION_KEY = "hostelERP_studentSession";
const API_BASE_URL = (window.location.port === "3000") ? "" : "http://localhost:3000";

/* ---------- Session ---------- */
function getStudentSessionId() {
  return localStorage.getItem(STUDENT_SESSION_KEY);
}

function clearStudentSession() {
  localStorage.removeItem(STUDENT_SESSION_KEY);
}

let backendStudentProfile = null;
let backendStudentProfilePromise = null;

async function fetchCurrentStudentProfile() {
  const sessionId = getStudentSessionId();
  if (!sessionId) return null;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/students/profile/${encodeURIComponent(sessionId)}`
    );
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to load student profile.");
    }
    backendStudentProfile = result.student;
    return backendStudentProfile;
  } catch (error) {
    console.error("Student profile backend error:", error);
    backendStudentProfile = null;
    return null;
  }
}

function mapBackendStudentToReg(student) {
  if (!student) return null;
  const room = student.room_no || "";
  const block = room ? room[0] : "";
  const floor = room && room.length > 1 ? room[1] : "";
  return {
    admissionNo: student.admission_no || "",
    roll: student.roll_no || student.admission_no || "",
    name: student.full_name || "",
    email: student.email || "",
    phone: student.phone_no || "",
    dept: student.department || "",
    year: student.year || "",
    parentPhone: student.parents_phone || student.parent_phone || "",
    address: student.address || "",
    room: room,
    block: block,
    floor: floor,
    passportPhoto: student.passport_photo || student.passportPhoto || "",
    status: student.status || "Pending",
  };
}

function getCurrentStudentReg() {
  return mapBackendStudentToReg(backendStudentProfile);
}

async function requireStudentSessionAsync() {
  const sessionId = getStudentSessionId();
  if (!sessionId) {
    window.location.href = "student-login.html";
    return null;
  }

  const student = await fetchCurrentStudentProfile();
  const reg = mapBackendStudentToReg(student);

  if (!reg || String(reg.status).toLowerCase() !== "approved") {
    clearStudentSession();
    window.location.href = "student-login.html";
    return null;
  }

  return reg;
}

function studentRollKey(reg) {
  return reg.roll || reg.admissionNo || reg.email;
}

/* ---------- Logout ---------- */
function wireStudentLogout() {
  document.querySelectorAll(".logout, .logout-btn").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("Log out of your Hostel ERP account?")) {
        clearStudentSession();
        window.location.href = "student-login.html";
      }
    });
  });
}

/* ---------- Quick-access navigation ---------- */
function openOutpass() { window.location.href = "outpass.html"; }
function openLeave() { window.location.href = "leaveform.html"; }
function openProfile() { window.location.href = "my-profile.html"; }
function openNotification() { window.location.href = "my-notifications.html"; }
function openHistory() { window.location.href = "history.html"; }

/* ============================================================
   DASHBOARD (dashboard.html)
   ============================================================ */
async function initStudentDashboard() {
  const reg = await requireStudentSessionAsync();
  if (!reg) return;
  const roll = studentRollKey(reg);

  const nameEl = document.getElementById("studentWelcomeName");
  const roleEl = document.getElementById("studentWelcomeRole");
  if (nameEl) nameEl.textContent = `Welcome, ${reg.name.split(" ")[0]} 👋`;
  if (roleEl) roleEl.textContent = reg.hostellerType === "Fresher" ? "Fresher Hosteller" : "Hosteller";

  if (reg.passportPhoto) {
    document.querySelectorAll(".profile-pic").forEach(img => {
      img.src = `${API_BASE_URL}/uploads/students/${reg.passportPhoto}`;
      img.onerror = () => { img.src = "students.jpg"; };
    });
  }

  const roomBanner = document.getElementById("roomInfoBanner");
  if (roomBanner) {
    if (reg.room) {
      roomBanner.innerHTML = `<i class="fa-solid fa-bed"></i> Room Allocated — Block <strong>${reg.block || reg.room[0]}</strong>, Room <strong>${reg.room}</strong>`;
      roomBanner.style.display = "flex";
    } else {
      roomBanner.innerHTML = `<i class="fa-solid fa-clock"></i> Your room allocation is pending. Please check back later or contact the Hostel Office.`;
      roomBanner.style.display = "flex";
    }
  }

  await loadStudentNotificationsBanner(roll);
  wireStudentLogout();
}

async function loadStudentNotificationsBanner(roll) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/notifications?roll=${encodeURIComponent(roll)}&audience=student`);
    const data = await res.json();
    if (!res.ok || !data.success) return;

    const notifs = data.notifications || [];
    const unread = notifs.filter(n => String(n.read).toLowerCase() === "false");

    const badge = document.getElementById("studentNotifBadge");
    if (badge) {
      badge.style.display = unread.length > 0 ? "inline-flex" : "none";
      badge.textContent = unread.length > 99 ? "99+" : unread.length;
    }

    const banner = document.getElementById("latestNotifBanner");
    if (banner && unread.length > 0) {
      const latest = unread[0];
      banner.style.display = "block";
      banner.innerHTML = `
        <button class="notif-banner-close" id="dismissNotifBanner" aria-label="Dismiss">&times;</button>
        <strong>${latest.title}</strong>
        <p style="margin-top:6px;white-space:pre-line;">${latest.text}</p>
      `;
      const dismissBtn = document.getElementById("dismissNotifBanner");
      if (dismissBtn) {
        dismissBtn.onclick = async () => {
          await fetch(`${API_BASE_URL}/api/notifications/${latest.id}/read`, { method: "PATCH" });
          banner.style.display = "none";
          if (badge) {
            const rem = unread.length - 1;
            badge.style.display = rem > 0 ? "inline-flex" : "none";
            badge.textContent = rem > 99 ? "99+" : rem;
          }
        };
      }
    }
  } catch (err) {
    console.warn("Could not load notifications banner:", err);
  }
}

/* ============================================================
   LEAVE APPLICATION (leaveform.html)
   ============================================================ */
async function initLeaveForm() {
  const reg = await requireStudentSessionAsync();
  if (!reg) return;
  const roll = studentRollKey(reg);
  wireStudentLogout();

  const nameInput = document.getElementById("leaveStudentName");
  const rollInput = document.getElementById("leaveRollNumber");
  const roomInput = document.getElementById("leaveRoomNumber");
  const fromInput = document.getElementById("fromDate");
  const toInput = document.getElementById("toDate");
  const reasonInput = document.getElementById("leaveReason");
  const proofInput = document.getElementById("proof");
  const submitBtn = document.getElementById("leaveSubmitBtn");
  const alertBox = document.getElementById("leaveAlert");

  if (nameInput) { nameInput.value = reg.name; nameInput.readOnly = true; }
  if (rollInput) { rollInput.value = roll; rollInput.readOnly = true; }
  if (roomInput) { roomInput.value = reg.room || "Not Allocated"; roomInput.readOnly = true; }

  // Check if pending leave exists in backend
  try {
    const res = await fetch(`${API_BASE_URL}/api/leave/student/${encodeURIComponent(roll)}`);
    const data = await res.json();
    if (res.ok && data.success) {
      const pending = (data.leaves || []).find(l => String(l.status).toLowerCase() === "pending");
      if (pending) {
        showFormAlert(alertBox, `You already have a pending Leave request submitted on ${pending.from_date || "recently"} awaiting Warden review.`, "error");
        if (submitBtn) submitBtn.disabled = true;
      }
    }
  } catch (err) {
    console.warn("Could not check pending leaves:", err);
  }

  if (!submitBtn) return;

  submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    hideFormAlert(alertBox);

    const reason = reasonInput ? reasonInput.value.trim() : "";
    const fromDate = fromInput ? fromInput.value.trim() : "";
    const toDate = toInput ? toInput.value.trim() : "";

    if (!fromDate) {
      showFormAlert(alertBox, "Please select a From Date.", "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!toDate) {
      showFormAlert(alertBox, "Please select a To Date.", "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!reason) {
      showFormAlert(alertBox, "Please enter a reason for leave.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const formData = new FormData();
      formData.append("student_id", roll);
      formData.append("name", reg.name);
      formData.append("roll_no", roll);
      formData.append("room_no", reg.room || "Not Allocated");
      formData.append("from_date", fromDate);
      formData.append("to_date", toDate);
      formData.append("reason", reason);
      if (proofInput && proofInput.files && proofInput.files[0]) {
        formData.append("proof", proofInput.files[0]);
      }

      const res = await fetch(`${API_BASE_URL}/api/leave`, {
        method: "POST",
        body: formData
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || "Failed to submit leave request.");
      }

      showFormAlert(alertBox, "Leave request submitted successfully! You will be notified once the Warden reviews it.", "success");
      submitBtn.textContent = "Applied";

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    } catch (err) {
      console.error("Leave submit error:", err);
      showFormAlert(alertBox, err.message || "Unable to submit leave request.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Apply Leave";
    }
  });
}

/* ============================================================
   OUTPASS APPLICATION (outpass.html)
   ============================================================ */
async function initOutpassForm() {
  const reg = await requireStudentSessionAsync();
  if (!reg) return;
  const roll = studentRollKey(reg);
  wireStudentLogout();

  const nameInput = document.getElementById("outpassStudentName");
  const rollInput = document.getElementById("outpassRollNumber");
  const roomInput = document.getElementById("outpassRoomNumber");
  const fromDateInput = document.getElementById("fromDate");
  const outTimeInput = document.getElementById("outTime");
  const returnInput = document.getElementById("returnTime");
  const purposeInput = document.getElementById("outpassPurpose");
  const proofInput = document.getElementById("proof");
  const submitBtn = document.getElementById("outpassSubmitBtn");
  const alertBox = document.getElementById("outpassAlert");

  if (nameInput) { nameInput.value = reg.name; nameInput.readOnly = true; }
  if (rollInput) { rollInput.value = roll; rollInput.readOnly = true; }
  if (roomInput) { roomInput.value = reg.room || "Not Allocated"; roomInput.readOnly = true; }

  // Check if pending outpass exists in backend
  try {
    const res = await fetch(`${API_BASE_URL}/api/outpass/student/${encodeURIComponent(roll)}`);
    const data = await res.json();
    if (res.ok && data.success) {
      const pending = (data.outpasses || []).find(o => String(o.status).toLowerCase() === "pending");
      if (pending) {
        showFormAlert(alertBox, `You already have a pending Outpass request awaiting Warden review.`, "error");
        if (submitBtn) submitBtn.disabled = true;
      }
    }
  } catch (err) {
    console.warn("Could not check pending outpasses:", err);
  }

  if (!submitBtn) return;

  submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    hideFormAlert(alertBox);

    const outDate = fromDateInput ? fromDateInput.value.trim() : "";
    const outTime = outTimeInput ? outTimeInput.value : "";
    const returnTime = returnInput ? returnInput.value : "";
    const purpose = purposeInput ? purposeInput.value.trim() : "";

    if (!outDate) {
      showFormAlert(alertBox, "Please select an Outpass date.", "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!outTime) {
      showFormAlert(alertBox, "Please select an Out time.", "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!purpose) {
      showFormAlert(alertBox, "Please enter a purpose for the outpass.", "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!returnTime) {
      showFormAlert(alertBox, "Please select an expected return time.", "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const formData = new FormData();
      formData.append("student_id", roll);
      formData.append("name", reg.name);
      formData.append("roll_no", roll);
      formData.append("room_no", reg.room || "Not Allocated");
      formData.append("out_date", outDate);
      formData.append("out_time", outTime);
      formData.append("return_time", returnTime);
      formData.append("purpose", purpose);
      if (proofInput && proofInput.files && proofInput.files[0]) {
        formData.append("proof", proofInput.files[0]);
      }

      const res = await fetch(`${API_BASE_URL}/api/outpass`, {
        method: "POST",
        body: formData
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || "Failed to submit outpass request.");
      }

      showFormAlert(alertBox, "Outpass request submitted successfully! You will be notified once the Warden reviews it.", "success");
      submitBtn.textContent = "Submitted";

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    } catch (err) {
      console.error("Outpass submit error:", err);
      showFormAlert(alertBox, err.message || "Unable to submit outpass request.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Outpass";
    }
  });
}

function showFormAlert(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = `form-alert show ${type}`;
}
function hideFormAlert(el) {
  if (!el) return;
  el.className = "form-alert";
}

/* ============================================================
   NOTIFICATIONS (my-notifications.html)
   ============================================================ */
async function initStudentNotifications() {
  const reg = await requireStudentSessionAsync();
  if (!reg) return;
  const roll = studentRollKey(reg);
  wireStudentLogout();

  const list = document.getElementById("notifList");
  if (!list) return;

  async function render() {
    list.innerHTML = `<p style="color:#666;text-align:center;padding:20px 0;">Loading notifications...</p>`;
    try {
      const res = await fetch(`${API_BASE_URL}/api/notifications?roll=${encodeURIComponent(roll)}&audience=student`);
      const data = await res.json();
      const items = (data.notifications || []).sort((a, b) => new Date(b.time) - new Date(a.time));

      if (items.length === 0) {
        list.innerHTML = `<p style="color:#666;text-align:center;padding:30px 0;">No notifications yet.</p>`;
        return;
      }

      list.innerHTML = items.map((n) => {
        const d = new Date(n.time);
        const isUnread = String(n.read).toLowerCase() === "false";
        return `
        <div class="notif-item ${isUnread ? "unread" : ""}" data-id="${n.id}">
          <div class="notif-item-top">
            <h4>${n.title || "Notification"}</h4>
            <span class="notif-status">${isUnread ? "Unread" : "Read"}</span>
          </div>
          <p class="notif-text">${n.text}</p>
          <div class="notif-meta"><span>${d.toLocaleDateString("en-IN")}</span><span>${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
        </div>`;
      }).join("");

      list.querySelectorAll(".notif-item").forEach((el) => {
        el.addEventListener("click", async () => {
          const notifId = el.dataset.id;
          await fetch(`${API_BASE_URL}/api/notifications/${notifId}/read`, { method: "PATCH" });
          render();
        });
      });
    } catch (err) {
      console.error("Student notifications error:", err);
      list.innerHTML = `<p style="color:#c00;text-align:center;padding:20px 0;">Failed to load notifications.</p>`;
    }
  }

  render();
}

/* ============================================================
   HISTORY (history.html) - With Token Number & Status Support
   ============================================================ */
async function initStudentHistory() {
  const reg = await requireStudentSessionAsync();
  if (!reg) return;
  const roll = studentRollKey(reg);
  wireStudentLogout();

  const tbody = document.getElementById("historyBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#666;padding:25px;">Loading history...</td></tr>`;

  try {
    const [leaveRes, outpassRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/leave/student/${encodeURIComponent(roll)}`).then(r => r.json()).catch(() => ({ leaves: [] })),
      fetch(`${API_BASE_URL}/api/outpass/student/${encodeURIComponent(roll)}`).then(r => r.json()).catch(() => ({ outpasses: [] }))
    ]);

    const leaves = (leaveRes.leaves || []).map(l => ({
      action: "Leave",
      reason: l.reason,
      date: l.from_date || (l.created_at ? l.created_at.split("T")[0] : "—"),
      time: l.to_date ? `Until ${l.to_date}` : "—",
      status: l.status || "Pending",
      token: l.token_no || "",
      rejectionReason: l.rejection_reason || "",
      timestamp: l.created_at || ""
    }));

    const outpasses = (outpassRes.outpasses || []).map(o => ({
      action: "Outpass",
      reason: o.purpose,
      date: o.out_date || (o.created_at ? o.created_at.split("T")[0] : "—"),
      time: o.return_time ? `Return: ${o.return_time}` : (o.out_time || "—"),
      status: o.status || "Pending",
      token: o.token_no || "",
      rejectionReason: o.rejection_reason || "",
      timestamp: o.created_at || ""
    }));

    const records = [...leaves, ...outpasses].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#666;padding:25px;">No activity yet.</td></tr>`;
      return;
    }

    const statusClass = { Approved: "approved", Pending: "pending", Rejected: "rejected" };

    tbody.innerHTML = records.map((r, i) => {
      let statusHtml = `<span class="badge ${statusClass[r.status] || "pending"}">${r.status || "—"}</span>`;
      if (r.status === "Approved" && r.token) {
        statusHtml += `<div style="font-size:11px;font-weight:700;color:#0B3D91;margin-top:4px;"><i class="fa-solid fa-ticket"></i> Token: ${r.token}</div>`;
      } else if (r.status === "Rejected" && r.rejectionReason) {
        statusHtml += `<div style="font-size:11px;color:#991B1B;margin-top:4px;">Reason: ${r.rejectionReason}</div>`;
      }

      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${r.action}</strong><br><span style="font-size:11px;color:#666;">${r.reason || ""}</span></td>
          <td>${r.date}</td>
          <td>${r.time}</td>
          <td>${statusHtml}</td>
        </tr>`;
    }).join("");

  } catch (err) {
    console.error("Student history error:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#c00;padding:25px;">Unable to load history.</td></tr>`;
  }
}

/* ============================================================
   PROFILE (my-profile.html)
   ============================================================ */
async function initStudentProfile() {
  const reg = await requireStudentSessionAsync();
  if (!reg) return;
  const roll = studentRollKey(reg);
  wireStudentLogout();

  const fields = {
    profileName: reg.name,
    profileRoll: roll,
    profileDept: reg.dept,
    profileYear: reg.year,
    profilePhone: reg.phone,
    profileEmail: reg.email,
    profileParentPhone: reg.parentPhone,
    profileAddress: reg.address,
    profileRoom: reg.room ? `Room ${reg.room} (Block ${reg.block || reg.room[0]})` : "Not Allocated"
  };

  Object.keys(fields).forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = fields[id] || "—";
    }
  });

  const photoImg = document.querySelector(".profile-image img") || document.getElementById("profilePhotoImg");
  if (photoImg && reg.passportPhoto) {
    photoImg.src = `${API_BASE_URL}/uploads/students/${reg.passportPhoto}`;
    photoImg.onerror = () => { photoImg.src = "students.jpg"; };
  }
}

/* ============================================================
   Auto-init on page load
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("studentWelcomeName")) initStudentDashboard();
  if (document.getElementById("leaveSubmitBtn")) initLeaveForm();
  if (document.getElementById("outpassSubmitBtn")) initOutpassForm();
  if (document.getElementById("notifList")) initStudentNotifications();
  if (document.getElementById("historyBody")) initStudentHistory();
  if (document.getElementById("profileName")) initStudentProfile();
});
