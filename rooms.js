/* ============================================================
   rooms.js
   Data layer for Room Allocation / Room Management.
   Connected to Node.js Express REST APIs & CSV persistence.
   ============================================================ */

const ROOMS_API_BASE = (window.location.port === "3000") ? "" : "http://localhost:3000";

let backendRoomsList = [];
let backendWaitingStudents = [];
let backendRoomStats = {
  totalRooms: 0,
  occupiedRooms: 0,
  availableRooms: 0,
  partiallyFilledRooms: 0,
  fullRooms: 0,
  maintenanceRooms: 0,
  vacantBeds: 0,
  waitingStudents: 0
};

function pad(n, len = 2) { return String(n).padStart(len, "0"); }
function buildRoomId(block, floor, num) { return `${block}${floor}${pad(num, 2)}`; }
function roomBlock(roomId) { return roomId ? roomId[0] : ""; }
function roomFloor(roomId) { return roomId ? roomId[1] : ""; }

function getAllRoomIds() {
  if (backendRoomsList.length > 0) {
    return backendRoomsList.map(r => r.room_id || r.id);
  }
  return [];
}

function getHostelBlocks() {
  if (backendRoomsList.length > 0) {
    const blocks = backendRoomsList.map(r => r.block).filter(Boolean);
    return [...new Set(blocks)].sort();
  }
  return ["A", "B", "C", "D"];
}

function getFloorsForBlock(block) {
  if (backendRoomsList.length > 0) {
    const floors = backendRoomsList
      .filter(r => !block || r.block === block)
      .map(r => Number(r.floor))
      .filter(f => !isNaN(f));
    return [...new Set(floors)].sort((a, b) => a - b);
  }
  return [1, 2, 3];
}

function getRoomNumbersForFloor(block, floor) {
  if (backendRoomsList.length > 0) {
    return backendRoomsList
      .filter(r => (!block || r.block === block) && (!floor || Number(r.floor) === Number(floor)))
      .map(r => r.room_id || r.id);
  }
  return [];
}

async function fetchWaitingStudentsFromBackend() {
  try {
    const res = await fetch(`${ROOMS_API_BASE}/api/rooms/waiting-students`);
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.students)) {
      backendWaitingStudents = data.students;
    }
    return backendWaitingStudents;
  } catch (err) {
    console.error("fetchWaitingStudentsFromBackend error:", err);
    return [];
  }
}

async function fetchRoomsFromBackend() {
  try {
    const [roomsRes, statsRes, waitingRes] = await Promise.all([
      fetch(`${ROOMS_API_BASE}/api/rooms`).then(r => r.json()).catch(() => ({ rooms: [] })),
      fetch(`${ROOMS_API_BASE}/api/rooms/stats`).then(r => r.json()).catch(() => ({ stats: null })),
      fetchWaitingStudentsFromBackend().catch(() => [])
    ]);

    if (roomsRes.success && Array.isArray(roomsRes.rooms)) {
      backendRoomsList = roomsRes.rooms;
    }
    if (statsRes.success && statsRes.stats) {
      backendRoomStats = statsRes.stats;
    } else if (backendRoomsList.length > 0) {
      // Calculate dynamically if stats endpoint not returned
      const totalRooms = backendRoomsList.length;
      let totalBeds = 0;
      let occupiedBeds = 0;
      let occupiedRooms = 0;
      let fullRooms = 0;
      let partiallyFilledRooms = 0;
      let availableRooms = 0;
      let maintenanceRooms = 0;

      backendRoomsList.forEach(r => {
        const cap = Number(r.capacity) || 4;
        const occ = Number(r.occupied) || 0;
        totalBeds += cap;
        occupiedBeds += occ;
        if (r.maintenance) maintenanceRooms++;
        else if (occ >= cap) fullRooms++;
        else if (occ > 0) partiallyFilledRooms++;
        else availableRooms++;
      });

      backendRoomStats = {
        totalRooms,
        totalBeds,
        occupiedBeds,
        vacantBeds: Math.max(0, totalBeds - occupiedBeds),
        availableRooms,
        partiallyFilledRooms,
        fullRooms,
        occupiedRooms: fullRooms + partiallyFilledRooms,
        maintenanceRooms,
        waitingStudents: backendWaitingStudents.length
      };
    }
    return backendRoomsList;
  } catch (err) {
    console.error("fetchRoomsFromBackend error:", err);
    return [];
  }
}

function getAllRoomsInfo() {
  return backendRoomsList;
}

function getRoomInfo(roomId) {
  const found = backendRoomsList.find(r => r.id === roomId || r.room_id === roomId);
  if (found) return found;

  const occupants = getResidents().filter(r => r.room === roomId);
  const cap = 4;
  return {
    id: roomId,
    room_id: roomId,
    block: roomBlock(roomId),
    floor: roomFloor(roomId),
    capacity: cap,
    occupied: occupants.length,
    available: Math.max(0, cap - occupants.length),
    status: occupants.length >= cap ? "Full" : (occupants.length > 0 ? "Partially Filled" : "Available"),
    maintenance: false,
    occupants: occupants
  };
}

function getRoomStats() {
  return backendRoomStats;
}

function getResidents() {
  return getRegistrations().filter((r) => String(r.status).toLowerCase() === "approved" && r.room);
}

function getUnallocatedResidents() {
  if (backendWaitingStudents.length > 0) {
    return backendWaitingStudents;
  }
  return getRegistrations().filter((r) =>
    String(r.status).toLowerCase() !== "rejected" &&
    String(r.status).toLowerCase() !== "inactive" &&
    (!r.room || r.room === "Not Allocated" || r.room.trim() === "")
  );
}

function residentsOfRoom(roomId) {
  const room = backendRoomsList.find(r => r.id === roomId || r.room_id === roomId);
  return room ? (room.occupants || []) : [];
}

function availableBedsOfRoom(roomId) {
  const room = getRoomInfo(roomId);
  const cap = Number(room.capacity) || 4;
  const occupiedBeds = (room.occupants || []).map(o => Number(o.bed)).filter(b => !isNaN(b) && b > 0);
  const beds = [];
  for (let b = 1; b <= cap; b++) {
    if (!occupiedBeds.includes(b)) beds.push(b);
  }
  return beds;
}

function isRoomUnderMaintenance(roomId) {
  const room = getRoomInfo(roomId);
  return !!room.maintenance;
}

async function setRoomMaintenance(roomId, flag) {
  try {
    await fetch(`${ROOMS_API_BASE}/api/rooms/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, maintenance: flag })
    });
    await fetchRoomsFromBackend();
  } catch (err) {
    console.error("setRoomMaintenance error:", err);
  }
}

async function allocateRoomAndApprove(id, roomData) {
  const reg = findRegistration(id);
  if (!reg) throw new Error("Registration not found.");

  const admissionNo = reg.admissionNo;
  const loggedInWarden = JSON.parse(sessionStorage.getItem("loggedInWarden") || "null");

  // Registration approval + room allocation must use the room allocation
  // endpoint so block/floor/bed validation and the room-aware approval email
  // happen in the same backend workflow.
  const response = await fetch(`${ROOMS_API_BASE}/api/rooms/allocate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      admission_no: admissionNo,
      roll_no: reg.roll || admissionNo,
      room_no: roomData.room,
      block: roomData.block || "",
      floor: roomData.floor || "",
      bed: roomData.bed || "",
      registration_status: reg.status || "Pending",
      approved_by: loggedInWarden?.employee_id || loggedInWarden?.full_name || "Warden"
    })
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Student room allocation and approval failed.");
  }

  await Promise.all([
    fetchRoomsFromBackend(),
    fetchRegistrationsFromBackend(),
    fetchWaitingStudentsFromBackend()
  ]);
  return result.student;
}

async function allocateRoomToRegistration(regId, roomId, bed, opts = {}) {
  try {
    const reg = findRegistration(regId);
    if (!reg) return { error: "Registration not found in active list." };

    const studentId = reg.admissionNo || reg.roll;
    const response = await fetch(`${ROOMS_API_BASE}/api/rooms/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        room_no: roomId,
        bed: bed
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      return { error: result.message || "Allocation failed" };
    }

    await Promise.all([
      fetchRoomsFromBackend(),
      fetchRegistrationsFromBackend(),
      fetchWaitingStudentsFromBackend()
    ]);
    return { success: true, reg: reg };
  } catch (err) {
    console.error("allocateRoomToRegistration error:", err);
    return { error: err.message };
  }
}

// Initial background load
fetchRoomsFromBackend();