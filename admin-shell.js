/* ============================================================
   admin-shell.js
   Shared shell for every Admin page: session guard, sidebar,
   topbar, dark mode, clock, logout.

   This is a deliberate sibling of warden_dashboard.js rather
   than a modification of it — the Warden Portal's shell,
   NAV_ITEMS and WARDEN identity stay exactly as they are.
   Both shells reuse the same warden_dashboard.css classes, so
   the Admin Portal looks and feels identical, without
   duplicating or overriding any Warden-facing behaviour.

   Data flows one way here: this file only ever READS from
   students.js / registrations.js / rooms.js (the real,
   already-existing data layer) — it never approves, rejects,
   or otherwise mutates a request. That keeps the Admin role
   strictly read-only for the approval workflow, exactly as
   specified.
   ============================================================ */

const ADMIN_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "fa-gauge-high", href: "admin-dashboard.html" },
  { key: "students", label: "Students", icon: "fa-users", href: "admin-students.html" },
  { key: "wardens", label: "Wardens", icon: "fa-user-tie", href: "admin-wardens-management.html" },
  { key: "approvals", label: "Warden Approvals", icon: "fa-user-check", href: "admin-warden-approvals.html", badgeId: "navPendingWardens" },
  { key: "security", label: "Gate Staff", icon: "fa-shield-halved", href: "admin-gate-staff.html" },
  { key: "rooms", label: "Rooms", icon: "fa-bed", href: "admin-rooms-management.html" },
  { key: "reports", label: "Outpass / Leave Reports", icon: "fa-chart-column", href: "admin-reports.html" },
  { key: "audit", label: "Audit Logs", icon: "fa-clipboard-list", href: "admin-audit-logs.html" }
];

/* ---------------------------------------------------------
   Session
   --------------------------------------------------------- */
function getLoggedInAdminId() {
  return localStorage.getItem(STORE_KEYS.adminSession);
}
function getLoggedInAdmin() {
  const id = getLoggedInAdminId();
  if (!id) return null;
  const admin = getStore(STORE_KEYS.admins)[id];
  return admin ? { ...admin, adminId: id } : null;
}

/* Every admin page (except login/register) calls this first.
   No session -> straight back to Admin Login. */
function requireAdminSession() {
  const admin = getLoggedInAdmin();
  if (!admin) {
    window.location.href = "admin-login.html";
    return null;
  }
  return admin;
}

async function adminLogout() {
  try {
    const apiBase = (window.location.port === "3000") ? "" : "http://localhost:3000";
    await fetch(`${apiBase}/api/admin-management/audit/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-id": localStorage.getItem(STORE_KEYS.adminSession) || "" },
      body: JSON.stringify({ action: "LOGOUT" })
    });
  } catch (e) { console.error("Admin logout audit error:", e); }
  localStorage.removeItem(STORE_KEYS.adminSession);
  sessionStorage.removeItem("loggedInAdmin");
  window.location.href = "admin-login.html";
}

/* ---------------------------------------------------------
   Sidebar + Topbar
   --------------------------------------------------------- */
function renderAdminSidebar(active) {
  const items = ADMIN_NAV_ITEMS.map((item) => `
    <a href="${item.href}" class="nav-item ${active === item.key ? "active" : ""}">
      <i class="fa-solid ${item.icon}"></i>
      <span>${item.label}</span>
      ${item.badgeId ? `<span class="nav-badge" id="${item.badgeId}" style="display:none;">0</span>` : ""}
    </a>`).join("");

  return `
    <aside class="sidebar" id="sidebar">
      <i class="fa-solid fa-xmark sidebar-close" id="sidebarClose"></i>
      <div class="sidebar-brand">
        <div class="brand-logo"><img src="images/logo.png" alt="College Logo"></div>
        <div class="brand-text">
          <h1>HostelERP</h1>
          <span>Admin Portal</span>
        </div>
      </div>
      <nav class="sidebar-nav">${items}</nav>
      <div class="sidebar-footer">
        <a href="#" class="nav-item" id="logoutBtn">
          <i class="fa-solid fa-right-from-bracket"></i>
          <span>Logout</span>
        </a>
      </div>
    </aside>
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
  `;
}

function renderAdminTopbar(admin, showSearch = true) {
  return `
    <header class="topbar">
      <div class="topbar-left">
        <i class="fa-solid fa-bars menu-toggle" id="menuToggle"></i>
        ${showSearch ? `
        <div class="search-box">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="globalSearch" placeholder="Search students by name or roll number...">
        </div>` : ""}
      </div>
      <div class="topbar-right">
        <div class="topbar-clock">
          <div class="time" id="clockTime">--:--</div>
          <div class="date" id="clockDate">-- --- ----</div>
        </div>
        <button class="icon-btn" id="darkToggle" title="Toggle dark mode">
          <i class="fa-solid fa-moon"></i>
        </button>
        <div class="warden-chip">
          <div class="warden-avatar">${initials(admin.name || "Admin")}</div>
          <div>
            <div class="name">${admin.name || "Admin"}</div>
            <div class="role">Administrator</div>
          </div>
        </div>
      </div>
    </header>
  `;
}

function wireAdminLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    openConfirmModal({
      title: "Log out?",
      message: "You'll need to sign back in to access the Admin dashboard.",
      confirmLabel: "Log Out",
      confirmClass: "btn-danger",
      onConfirm: () => {
        showToast("info", "Logged out", "Redirecting to Admin Login...");
        setTimeout(adminLogout, 900);
      }
    });
  });
}

/* Reuses wireMobileSidebar / wireDarkMode / startClock / refreshNotifBadges
   from warden_dashboard.js — those helpers are generic UI utilities, not
   tied to the Warden role, so admin pages load that file purely for them. */
function initAdminShell(activePage, options = {}) {
  const admin = requireAdminSession();
  if (!admin) return null;

  const sidebarRoot = document.getElementById("sidebar-root");
  const topbarRoot = document.getElementById("topbar-root");
  if (sidebarRoot) sidebarRoot.innerHTML = renderAdminSidebar(activePage);
  if (topbarRoot) topbarRoot.innerHTML = renderAdminTopbar(admin, options.showSearch !== false);

  wireMobileSidebar();
  wireDarkMode();
  startClock();
  wireAdminLogout();

  /* Student-notification badge helper only exists on pages that also load
     students.js, so it is called defensively here. */
  if (typeof refreshNotifBadges === "function") {
    try { refreshNotifBadges(); } catch (e) { /* no notification store on admin pages */ }
  }

  const globalSearch = document.getElementById("globalSearch");
  if (globalSearch) {
    globalSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        window.location.href = `students.html?q=${encodeURIComponent(e.target.value.trim())}`;
      }
    });
  }

  refreshAdminBadges();

  hideLoader();
  return admin;
}

/* Sidebar badge: how many warden registrations are awaiting approval. */
async function refreshAdminBadges() {
  const badge = document.getElementById("navPendingWardens");
  if (!badge) return;
  try {
    const apiBase = (window.location.port === "3000") ? "" : "http://localhost:3000";
    const res = await fetch(`${apiBase}/api/admin-management/warden-approvals`, {
      headers: { "x-admin-id": localStorage.getItem(STORE_KEYS.adminSession) || "" }
    });
    const body = await res.json();
    const count = (body && body.pending) ? body.pending.length : 0;
    badge.style.display = count > 0 ? "inline-flex" : "none";
    badge.textContent = count > 99 ? "99+" : count;
  } catch (e) {
    badge.style.display = "none";
  }
}
