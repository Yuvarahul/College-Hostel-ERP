/* ============================================================
   warden_dashboard.js
   Shared shell + utilities used across every page of the
   Warden ERP demo: sidebar, topbar, dark mode, clock, toast,
   modal, loader, notification badge.
   ============================================================ */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "fa-gauge-high", href: "warden_dashboard.html" },
  { key: "profile", label: "Profile", icon: "fa-id-badge", href: "profile.html" },
  { key: "students", label: "Total Students", icon: "fa-users", href: "students.html" },
  { key: "registrations", label: "Registration Requests", icon: "fa-user-plus", href: "registration-requests.html", badgeId: "sidebarRegBadge" },
  { key: "allocation", label: "Room Allocation", icon: "fa-key", href: "room-allocation.html", badgeId: "sidebarAllocBadge" },
  { key: "pending", label: "Pending Requests", icon: "fa-clock-rotate-left", href: "pending-requests.html" },
  { key: "notifications", label: "Notifications", icon: "fa-bell", href: "notifications.html" }
];

/* ---------- Build & inject the sidebar + topbar ---------- */
function renderSidebar(active) {
  const items = NAV_ITEMS.map((item) => `
    <a href="${item.href}" class="nav-item ${active === item.key ? "active" : ""}">
      <i class="fa-solid ${item.icon}"></i>
      <span>${item.label}</span>
      ${item.key === "notifications" ? `<span class="nav-badge" id="sidebarNotifBadge" style="display:none;">0</span>` : ""}
      ${item.badgeId ? `<span class="nav-badge" id="${item.badgeId}" style="display:none;">0</span>` : ""}
    </a>`).join("");

  return `
    <aside class="sidebar" id="sidebar">
      <i class="fa-solid fa-xmark sidebar-close" id="sidebarClose"></i>
      <div class="sidebar-brand">
        <div class="brand-logo">
         <img src="images/logo.png" alt="College Logo">
        </div>
        <div class="brand-text">
          <h1>HostelERP</h1>
          <span>Warden Portal</span>
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

function renderTopbar(showSearch = true) {
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
        <a href="profile.html" class="warden-chip">
          <div class="warden-avatar">${WARDEN.avatarInitials}</div>
          <div>
            <div class="name">${WARDEN.name}</div>
            <div class="role">Warden</div>
          </div>
        </a>
      </div>
    </header>
  `;
}

function initShell(activePage, options = {}) {
  const sidebarRoot = document.getElementById("sidebar-root");
  const topbarRoot = document.getElementById("topbar-root");
  if (sidebarRoot) sidebarRoot.innerHTML = renderSidebar(activePage);
  if (topbarRoot) topbarRoot.innerHTML = renderTopbar(options.showSearch !== false);

  wireMobileSidebar();
  startClock();
  wireLogout();
  refreshNotifBadges();
  if (typeof refreshRegBadge === "function") refreshRegBadge();
  if (typeof refreshAllocBadge === "function") refreshAllocBadge();

  const globalSearch = document.getElementById("globalSearch");
  if (globalSearch && options.onGlobalSearch) {
    globalSearch.addEventListener("input", (e) => options.onGlobalSearch(e.target.value));
    globalSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        window.location.href = `students.html?q=${encodeURIComponent(e.target.value.trim())}`;
      }
    });
  }

  hideLoader();
}

function wireMobileSidebar() {
  const menuToggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const closeBtn = document.getElementById("sidebarClose");
  const open = () => { sidebar.classList.add("open"); backdrop.classList.add("show"); };
  const close = () => { sidebar.classList.remove("open"); backdrop.classList.remove("show"); };
  if (menuToggle) menuToggle.addEventListener("click", open);
  if (backdrop) backdrop.addEventListener("click", close);
  if (closeBtn) closeBtn.addEventListener("click", close);
}

function wireLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    openConfirmModal({
      title: "Log out?",
      message: "You'll need to sign back in to access the Warden dashboard.",
      confirmLabel: "Log Out",
      confirmClass: "btn-danger",
      onConfirm: () => {

        sessionStorage.removeItem("loggedInWarden");

        showToast("info", "Logged out", "Redirecting to login...");

        setTimeout(() => {
          window.location.href = "index.html";
        }, 900);

      }
    });
  });
}

/* ---------- Dark mode ---------- */
function wireDarkMode() {
  const toggle = document.getElementById("darkToggle");
  const icon = toggle ? toggle.querySelector("i") : null;
  const applied = localStorage.getItem("warden_dark_mode") === "1";
  if (applied) document.body.classList.add("dark");
  updateDarkIcon(icon);

  if (toggle) {
    toggle.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      localStorage.setItem("warden_dark_mode", document.body.classList.contains("dark") ? "1" : "0");
      updateDarkIcon(icon);
    });
  }
}
function updateDarkIcon(icon) {
  if (!icon) return;
  icon.className = document.body.classList.contains("dark") ? "fa-solid fa-sun" : "fa-solid fa-moon";
}
/* Apply dark mode instantly on load (before shell renders) to avoid flash */
(function applyDarkModeEarly() {
  if (localStorage.getItem("warden_dark_mode") === "1") {
    document.documentElement.style.background = "#0F172A";
  }
})();

/* ---------- Clock / date / greeting ---------- */
function startClock() {
  const timeEl = document.getElementById("clockTime");
  const dateEl = document.getElementById("clockDate");
  function tick() {
    const now = new Date();
    if (timeEl) timeEl.textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (dateEl) dateEl.textContent = now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }
  tick();
  setInterval(tick, 1000);
}
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

/* ---------- Notification badges ---------- */
function refreshNotifBadges() {
  const count = unreadNotificationCount();
  const sidebarBadge = document.getElementById("sidebarNotifBadge");
  const bellDot = document.getElementById("bellDot");
  if (sidebarBadge) {
    sidebarBadge.style.display = count > 0 ? "inline-flex" : "none";
    sidebarBadge.textContent = count > 99 ? "99+" : count;
  }
  if (bellDot) bellDot.style.display = count > 0 ? "block" : "none";
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
function ensureToastContainer() {
  let c = document.querySelector(".toast-container");
  if (!c) {
    c = document.createElement("div");
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  return c;
}
const TOAST_ICONS = { success: "fa-circle-check", error: "fa-circle-xmark", warning: "fa-triangle-exclamation", info: "fa-circle-info" };
function showToast(type, title, message, duration = 3500) {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${TOAST_ICONS[type] || TOAST_ICONS.info}"></i>
    <div class="toast-text">
      <p>${title}</p>
      <p>${message}</p>
    </div>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ============================================================
   CONFIRM MODAL (reused for Approve / Reject / Logout etc.)
   ============================================================ */
function ensureModalRoot() {
  let overlay = document.getElementById("confirmModalOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "confirmModalOverlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 id="confirmModalTitle">Confirm</h3>
          <button class="modal-close" id="confirmModalClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body"><p id="confirmModalMessage"></p></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="confirmModalCancel">Cancel</button>
          <button class="btn btn-primary" id="confirmModalConfirm">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeConfirmModal(); });
    document.getElementById("confirmModalClose").addEventListener("click", closeConfirmModal);
    document.getElementById("confirmModalCancel").addEventListener("click", closeConfirmModal);
  }
  return overlay;
}
function openConfirmModal({ title, message, confirmLabel = "Confirm", confirmClass = "btn-primary", onConfirm }) {
  const overlay = ensureModalRoot();
  document.getElementById("confirmModalTitle").textContent = title;
  document.getElementById("confirmModalMessage").textContent = message;
  const confirmBtn = document.getElementById("confirmModalConfirm");
  confirmBtn.className = `btn ${confirmClass}`;
  confirmBtn.textContent = confirmLabel;
  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
  newBtn.addEventListener("click", () => { closeConfirmModal(); if (onConfirm) onConfirm(); });
  overlay.classList.add("open");
}
function closeConfirmModal() {
  const overlay = document.getElementById("confirmModalOverlay");
  if (overlay) overlay.classList.remove("open");
}

/* ---------- Generic details modal (used by View Details) ---------- */
function ensureDetailsModalRoot() {
  let overlay = document.getElementById("detailsModalOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "detailsModalOverlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 id="detailsModalTitle">Details</h3>
          <button class="modal-close" id="detailsModalClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body" id="detailsModalBody"></div>
        <div class="modal-footer" id="detailsModalFooter"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDetailsModal(); });
    document.getElementById("detailsModalClose").addEventListener("click", closeDetailsModal);
  }
  return overlay;
}
function openDetailsModal({ title, bodyHtml, footerHtml = `<button class="btn btn-ghost" onclick="closeDetailsModal()">Close</button>` }) {
  const overlay = ensureDetailsModalRoot();
  document.getElementById("detailsModalTitle").textContent = title;
  document.getElementById("detailsModalBody").innerHTML = bodyHtml;
  document.getElementById("detailsModalFooter").innerHTML = footerHtml;
  overlay.classList.add("open");
}
function closeDetailsModal() {
  const overlay = document.getElementById("detailsModalOverlay");
  if (overlay) overlay.classList.remove("open");
}

/* ============================================================
   LOADER
   ============================================================ */
function showLoader() {
  let loader = document.getElementById("pageLoader");
  if (!loader) {
    loader = document.createElement("div");
    loader.className = "loader-overlay";
    loader.id = "pageLoader";
    loader.innerHTML = `<div class="spinner"></div><p>Loading dashboard...</p>`;
    document.body.prepend(loader);
  }
}
function hideLoader() {
  const loader = document.getElementById("pageLoader");
  if (loader) setTimeout(() => loader.classList.add("hide"), 350);
}
showLoader();

/* ---------- Small helpers reused across pages ---------- */
function statusBadge(status) {
  const map = { Pending: "badge-pending", Approved: "badge-approved", Rejected: "badge-rejected" };
  return `<span class="badge ${map[status] || "badge-pending"}"><i></i>${status}</span>`;
}
function initials(name) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}
function paginate(array, page, perPage) {
  const start = (page - 1) * perPage;
  return array.slice(start, start + perPage);
}
function buildPagination(container, total, perPage, current, onChange) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  let html = `<button class="page-btn" ${current === 1 ? "disabled" : ""} data-page="${current - 1}"><i class="fa-solid fa-chevron-left"></i></button>`;
  const windowSize = 2;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || (p >= current - windowSize && p <= current + windowSize)) {
      html += `<button class="page-btn ${p === current ? "active" : ""}" data-page="${p}">${p}</button>`;
    } else if (p === current - windowSize - 1 || p === current + windowSize + 1) {
      html += `<span style="padding:0 4px;color:var(--grey-light);">…</span>`;
    }
  }
  html += `<button class="page-btn" ${current === pages ? "disabled" : ""} data-page="${current + 1}"><i class="fa-solid fa-chevron-right"></i></button>`;
  container.innerHTML = html;
  container.querySelectorAll(".page-btn[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = parseInt(btn.dataset.page, 10);
      if (p >= 1 && p <= pages) onChange(p);
    });
  });
}