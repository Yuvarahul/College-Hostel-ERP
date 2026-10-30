/* ============================================================
   gatekeeper-auth-adapter.js
   Framework-agnostic Auth Adapter for GateKeeper.

   GateKeeper never authenticates anyone itself and never owns a
   login screen. It assumes it is mounted inside a host ERP that
   already has an authenticated session, its own user roles, and
   its own login/logout flow. This file is the ONLY seam between
   "the ERP's idea of a logged-in user" and "GateKeeper's idea of
   a logged-in user." No other GateKeeper file should reach past
   this adapter to ask "who is logged in?" or "what can they do?"

   ------------------------------------------------------------
   INTEGRATION CONTRACT (what the host ERP implements)
   ------------------------------------------------------------
   Provide an object with this shape, by either of two wiring
   styles:

   1) Global, set before gatekeeper-auth-adapter.js loads:

        <script>
          window.GateKeeperHostAdapter = {
            // Required. Return the current user, or null/undefined
            // if nobody is logged in. Shape is up to the host —
            // GateKeeper only reads id, name, role (or hostRole),
            // avatarInitials, gate.
            getCurrentUser() {
              return {
                id: "...",
                name: "...",
                role: "...",       // the ERP's own role name
                avatarInitials: "...", // optional
                gate: "..."            // optional, e.g. assigned gate
              };
            },

            // Optional. If provided and returns a boolean, this
            // wins over GateKeeper's own role->permission table —
            // lets the host apply finer-grained rules than role
            // alone (e.g. per-gate assignment, temp suspensions).
            hasPermission(permissionKey) { return true; },

            // Optional. Called when the operator clicks "Log Out"
            // inside GateKeeper. Should perform the host's real
            // logout (e.g. navigate to the ERP's logout route).
            // If omitted, GateKeeper just warns to the console —
            // it will never redirect to a GateKeeper-owned page.
            logout() { window.location.href = "/logout/"; }
          };
        </script>
        <script src="gatekeeper-auth-adapter.js"></script>
        <script src="gatekeeper-data.js"></script>
        <script src="gatekeeper.js"></script>

   2) Or call GateKeeperAuthAdapter.configure({...}) with the same
      shape at any point before a page calls requireAuth().

   If neither is wired up, GateKeeper falls back to a MOCK adapter
   (below) purely so the module keeps working during standalone
   development. Swap it for a real host adapter before go-live —
   do not ship the mock.
   ============================================================ */

/* ---------- GateKeeper's own role vocabulary ---------- */
const GK_ROLES = Object.freeze({
  SECURITY_STAFF: "Security Staff",
  SUPERVISOR: "Supervisor"
});

/* ---------- Host role -> GateKeeper role map (host-configurable) ----------
   Intentionally empty by default — GateKeeper does not assume any
   particular host ERP's role names. The host application should
   call GateKeeperAuthAdapter.configureRoleMap({ "<HostRole>": "<GateKeeper Role>", ... })
   during integration. Anything not found here falls back to
   whatever the host sends as `role`/`hostRole` verbatim, so
   GateKeeper still degrades gracefully (defaulting unmapped
   roles to Security Staff-level access — see getCurrentRole()). */
let GK_ROLE_MAP = {};

/* ---------- Permission sets per GateKeeper role ----------
   Defaults from the integration brief. The host can extend or
   override individual permissions per-user via hasPermission(). */
const GK_ROLE_PERMISSIONS = {
  [GK_ROLES.SECURITY_STAFF]: [
    "gate.entry_exit",
    "gate.visitor_management",
    "gate.view_logs"
  ],
  [GK_ROLES.SUPERVISOR]: [
    "gate.entry_exit",
    "gate.visitor_management",
    "gate.view_logs",
    "gate.reports",
    "gate.audit_logs",
    "gate.full_access"
  ]
};

/* ============================================================
   MOCK ADAPTER — development/standalone fallback only.
   Delete this block (and the fallback in activeImpl()) once a
   real host adapter is always present.
   ============================================================ */
const GK_MOCK_USER = Object.freeze({
  id: "mock-user-1",
  name: "Dev Preview User",
  role: "Supervisor",
  avatarInitials: "DP",
  gate: "Main Gate"
});

const GK_MOCK_ADAPTER = {
  getCurrentUser() {
    console.warn("[GateKeeper] No host auth adapter configured — using GK_MOCK_ADAPTER. Do not ship this.");
    return { ...GK_MOCK_USER };
  },
  hasPermission() { return undefined; }, // defer to role-based defaults
  logout() {
    console.warn("[GateKeeper] logout() called with no host adapter configured — nothing to do.");
  }
};

/* ============================================================
   GateKeeperAuthAdapter — the only surface the rest of
   GateKeeper (gatekeeper-data.js / gatekeeper.js / pages) may
   call to answer "who is this?" and "can they do that?"
   ============================================================ */
const GateKeeperAuthAdapter = (function () {
  let hostImpl = (typeof window !== "undefined" && window.GateKeeperHostAdapter) || null;

  function configure(impl) { hostImpl = impl; }
  function configureRoleMap(map) { GK_ROLE_MAP = { ...GK_ROLE_MAP, ...map }; }

  function activeImpl() { return hostImpl || GK_MOCK_ADAPTER; }
  function isUsingMock() { return !hostImpl; }

  function initialsFromName(name) {
    return String(name).split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }

  /* Normalized GateKeeper user, or null if the host reports
     nobody is logged in. Never throws — a misbehaving host
     adapter should degrade to "no session", not crash the page. */
  function getCurrentUser() {
    let raw;
    try {
      raw = activeImpl().getCurrentUser();
    } catch (err) {
      console.error("[GateKeeper] Host auth adapter getCurrentUser() threw:", err);
      return null;
    }
    if (!raw) return null;

    const hostRole = raw.hostRole || raw.role || null;
    const mappedRole = (hostRole && GK_ROLE_MAP[hostRole]) || hostRole || GK_ROLES.SECURITY_STAFF;

    return {
      id: raw.id,
      name: raw.name || "Unknown User",
      hostRole,
      role: mappedRole,
      avatarInitials: raw.avatarInitials || initialsFromName(raw.name || "?"),
      gate: raw.gate || null
    };
  }

  function getCurrentRole() {
    const user = getCurrentUser();
    return user ? user.role : null;
  }

  function hasPermission(permissionKey) {
    if (hostImpl && typeof hostImpl.hasPermission === "function") {
      let hostAnswer;
      try {
        hostAnswer = hostImpl.hasPermission(permissionKey);
      } catch (err) {
        console.error("[GateKeeper] Host auth adapter hasPermission() threw:", err);
        hostAnswer = undefined;
      }
      if (typeof hostAnswer === "boolean") return hostAnswer;
    }
    const role = getCurrentRole();
    if (!role) return false;
    return (GK_ROLE_PERMISSIONS[role] || []).includes(permissionKey);
  }

  /* Role check — Supervisor implicitly has every Security Staff
     permission plus supervisor-only screens, same convention the
     rest of GateKeeper's UI already expects. */
  function hasRole(...gkRoles) {
    const role = getCurrentRole();
    if (!role) return false;
    if (role === GK_ROLES.SUPERVISOR) return true;
    return gkRoles.includes(role);
  }

  function logout() {
    try {
      activeImpl().logout();
    } catch (err) {
      console.error("[GateKeeper] Host auth adapter logout() threw:", err);
    }
  }

  return {
    configure,
    configureRoleMap,
    getCurrentUser,
    getCurrentRole,
    hasPermission,
    hasRole,
    logout,
    isUsingMock,
    ROLES: GK_ROLES,
    PERMISSIONS: GK_ROLE_PERMISSIONS
  };
})();
