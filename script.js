document.addEventListener("DOMContentLoaded", () => {
  renderDashboard();
});


async function renderDashboard() {

  try {

    // Fetch all required dashboard data
    const [
      students,
      registrations,
      notifications,
      leavesRes,
      outpassesRes
    ] = await Promise.all([

      fetchStudentsFromBackend(),

      fetchRegistrationsFromBackend(),

      fetchNotificationsFromBackend(),

      fetch(
        `${(window.location.port === "3000") ? "" : "http://localhost:3000"}/api/leave`
      )
        .then(r => r.json())
        .catch(() => ({ leaves: [] })),

      fetch(
        `${(window.location.port === "3000") ? "" : "http://localhost:3000"}/api/outpass`
      )
        .then(r => r.json())
        .catch(() => ({ outpasses: [] }))

    ]);


    const leaves = leavesRes.leaves || [];
    const outpasses = outpassesRes.outpasses || [];


    // -----------------------------
    // TOTAL STUDENTS
    // -----------------------------

    document.getElementById("statTotal").textContent =
      students.length;


    // -----------------------------
    // PENDING REQUESTS
    // -----------------------------

    const pendingRegs =
      registrations.filter(
        r => String(r.status).toLowerCase() === "pending"
      ).length;


    const pendingLeaves =
      leaves.filter(
        l => String(l.status).toLowerCase() === "pending"
      ).length;


    const pendingOutpasses =
      outpasses.filter(
        o => String(o.status).toLowerCase() === "pending"
      ).length;


    document.getElementById("statPending").textContent =
      pendingRegs + pendingLeaves + pendingOutpasses;


    // -----------------------------
    // NOTIFICATIONS
    // -----------------------------

    document.getElementById("statNotif").textContent =
      notifications.filter(n => !n.read).length;

  }

  catch (error) {

    console.error(
      "Error loading dashboard:",
      error
    );

  }

}