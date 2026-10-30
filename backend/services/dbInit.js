const fs = require("fs");
const path = require("path");
const { readCSV, writeCSV } = require("./csvService");

const dbDir = path.join(__dirname, "../database");

const STUDENTS_CSV = path.join(dbDir, "students.csv");
const REGISTRATIONS_CSV = path.join(dbDir, "registrations.csv");
const LEAVE_CSV = path.join(dbDir, "leave_requests.csv");
const OUTPASS_CSV = path.join(dbDir, "outpass_requests.csv");
const ROOMS_CSV = path.join(dbDir, "rooms.csv");
const NOTIFICATIONS_CSV = path.join(dbDir, "notifications.csv");
// NEW — Gatekeeper QR movement (gate in/out) log. Added for the
// Gatekeeper <-> Student <-> Warden <-> Admin QR workflow.
const MOVEMENTS_CSV = path.join(dbDir, "movements.csv");
// NEW — dynamic single-use return-QR ledger. One row per QR issued
// at Student Out; redeemed (ACTIVE -> USED) at Student In, or lazily
// treated as EXPIRED once past expires_at. See qrTokenStore.js.
const QR_TOKENS_CSV = path.join(dbDir, "qr_tokens.csv");

const BLOCKS_CSV = path.join(dbDir, "blocks.csv");
const DEPARTMENTS_CSV = path.join(dbDir, "departments.csv");
const ROLES_CSV = path.join(dbDir, "roles.csv");
const PERMISSIONS_CSV = path.join(dbDir, "permissions.csv");
const SUPERVISORS_CSV = path.join(dbDir, "supervisors.csv");
const AUDIT_CSV = path.join(dbDir, "audit_logs.csv");
const HOSTEL_CONFIG_JSON = path.join(dbDir, "hostel_config.json");
const SYSTEM_SETTINGS_JSON = path.join(dbDir, "system_settings.json");


const studentHeaders = [
    { id: "admission_no", title: "admission_no" },
    { id: "roll_no", title: "roll_no" },
    { id: "full_name", title: "full_name" },
    { id: "email", title: "email" },
    { id: "phone_no", title: "phone_no" },
    { id: "department", title: "department" },
    { id: "year", title: "year" },
    { id: "parents_phone", title: "parents_phone" },
    { id: "password", title: "password" },
    { id: "address", title: "address" },
    { id: "id_proof", title: "id_proof" },
    { id: "passport_photo", title: "passport_photo" },
    { id: "room_no", title: "room_no" },
    { id: "status", title: "status" },
    { id: "approved_by", title: "approved_by" },
    { id: "approved_date", title: "approved_date" },
    { id: "created_at", title: "created_at" },
    { id: "rejection_reason", title: "rejection_reason" }
];

const leaveHeaders = [
    { id: "id", title: "id" },
    { id: "student_id", title: "student_id" },
    { id: "name", title: "name" },
    { id: "roll_no", title: "roll_no" },
    { id: "room_no", title: "room_no" },
    { id: "from_date", title: "from_date" },
    { id: "to_date", title: "to_date" },
    { id: "reason", title: "reason" },
    { id: "proof", title: "proof" },
    { id: "status", title: "status" },
    { id: "token_no", title: "token_no" },
    { id: "rejection_reason", title: "rejection_reason" },
    { id: "approved_by", title: "approved_by" },
    { id: "created_at", title: "created_at" },
    { id: "updated_at", title: "updated_at" }
];

const outpassHeaders = [
    { id: "id", title: "id" },
    { id: "student_id", title: "student_id" },
    { id: "name", title: "name" },
    { id: "roll_no", title: "roll_no" },
    { id: "room_no", title: "room_no" },
    { id: "out_date", title: "out_date" },
    { id: "out_time", title: "out_time" },
    { id: "return_time", title: "return_time" },
    { id: "purpose", title: "purpose" },
    { id: "proof", title: "proof" },
    { id: "status", title: "status" },
    { id: "token_no", title: "token_no" },
    { id: "rejection_reason", title: "rejection_reason" },
    { id: "approved_by", title: "approved_by" },
    { id: "created_at", title: "created_at" },
    { id: "updated_at", title: "updated_at" }
];

const roomHeaders = [
    { id: "room_id", title: "room_id" },
    { id: "block", title: "block" },
    { id: "floor", title: "floor" },
    { id: "capacity", title: "capacity" },
    { id: "occupied", title: "occupied" },
    { id: "status", title: "status" },
    { id: "maintenance", title: "maintenance" },
    { id: "occupants", title: "occupants" }
];

const notificationHeaders = [
    { id: "id", title: "id" },
    { id: "type", title: "type" },
    { id: "title", title: "title" },
    { id: "text", title: "text" },
    { id: "time", title: "time" },
    { id: "read", title: "read" },
    { id: "roll", title: "roll" },
    { id: "audience", title: "audience" }
];

// NEW — headers for the Gatekeeper QR movement log (movements.csv).
// One row per student "trip": created on Student OUT, updated in
// place (in_time filled) on the matching Student IN. Does not
// duplicate or modify leaveHeaders / outpassHeaders / studentHeaders.
const movementHeaders = [
    { id: "movement_id", title: "movement_id" },
    { id: "student_id", title: "student_id" },
    { id: "roll_no", title: "roll_no" },
    { id: "name", title: "name" },
    { id: "room_no", title: "room_no" },
    { id: "request_id", title: "request_id" },
    { id: "request_type", title: "request_type" },
    { id: "token_no", title: "token_no" },
    { id: "status", title: "status" },
    { id: "expected_return", title: "expected_return" },
    { id: "out_date", title: "out_date" },
    { id: "out_time", title: "out_time" },
    { id: "in_time", title: "in_time" },
    { id: "gatekeeper_out_id", title: "gatekeeper_out_id" },
    { id: "gatekeeper_out_name", title: "gatekeeper_out_name" },
    { id: "gatekeeper_in_id", title: "gatekeeper_in_id" },
    { id: "gatekeeper_in_name", title: "gatekeeper_in_name" },
    { id: "created_at", title: "created_at" },
    { id: "updated_at", title: "updated_at" }
];

// NEW — headers for the dynamic single-use return-QR ledger
// (qr_tokens.csv). One row per QR issued when a student is marked
// OUT; token is an opaque random string embedded in the return QR
// (no personal data). status moves ACTIVE -> USED on a successful
// return scan, or is treated as EXPIRED once now > expires_at.
const qrTokenHeaders = [
    { id: "token_id", title: "token_id" },
    { id: "token", title: "token" },
    { id: "request_type", title: "request_type" },
    { id: "request_id", title: "request_id" },
    { id: "student_id", title: "student_id" },
    { id: "roll_no", title: "roll_no" },
    { id: "movement_id", title: "movement_id" },
    { id: "status", title: "status" },
    { id: "generated_at", title: "generated_at" },
    { id: "expires_at", title: "expires_at" },
    { id: "used_at", title: "used_at" },
    { id: "gatekeeper_in_id", title: "gatekeeper_in_id" },
    { id: "gatekeeper_in_name", title: "gatekeeper_in_name" }
];

async function initDB() {
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    // 1. Check students.csv & registrations.csv
    let students = [];
    if (fs.existsSync(STUDENTS_CSV)) {
        students = await readCSV(STUDENTS_CSV);
    } else {
        await writeCSV(STUDENTS_CSV, studentHeaders, []);
    }

    if (!fs.existsSync(REGISTRATIONS_CSV)) {
        await writeCSV(REGISTRATIONS_CSV, studentHeaders, students);
    }

    // 2. Initialize leave_requests.csv if missing
    if (!fs.existsSync(LEAVE_CSV)) {
        const initialLeaves = [
            {
                id: "1",
                student_id: "24AI001",
                name: "Srividhya",
                roll_no: "24AI001",
                room_no: "A102",
                from_date: "2026-08-15",
                to_date: "2026-08-18",
                reason: "Family function in hometown",
                proof: "",
                status: "Approved",
                token_no: "LEV-240815-101",
                rejection_reason: "",
                approved_by: "WRD101",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            },
            {
                id: "2",
                student_id: "26AI015",
                name: "Lavanya",
                roll_no: "26AI015",
                room_no: "A102",
                from_date: "2026-08-20",
                to_date: "2026-08-23",
                reason: "Sister's wedding ceremony",
                proof: "",
                status: "Pending",
                token_no: "",
                rejection_reason: "",
                approved_by: "",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        ];
        await writeCSV(LEAVE_CSV, leaveHeaders, initialLeaves);
    }

    // 3. Initialize outpass_requests.csv if missing
    if (!fs.existsSync(OUTPASS_CSV)) {
        const initialOutpasses = [
            {
                id: "1",
                student_id: "24AI001",
                name: "Srividhya",
                roll_no: "24AI001",
                room_no: "A102",
                out_date: "2026-08-14",
                out_time: "17:00",
                return_time: "20:30",
                purpose: "Library & Book Purchase",
                proof: "",
                status: "Approved",
                token_no: "OTP-240814-204",
                rejection_reason: "",
                approved_by: "WRD101",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            },
            {
                id: "2",
                student_id: "24AI009",
                name: "janu",
                roll_no: "24AI009",
                room_no: "A118",
                out_date: "2026-08-14",
                out_time: "18:00",
                return_time: "21:00",
                purpose: "Medical checkup at clinic",
                proof: "",
                status: "Pending",
                token_no: "",
                rejection_reason: "",
                approved_by: "",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        ];
        await writeCSV(OUTPASS_CSV, outpassHeaders, initialOutpasses);
    }

    // 4. Initialize rooms.csv if missing
    if (!fs.existsSync(ROOMS_CSV)) {
        const blocks = ["A", "B", "C", "D"];
        const floors = [1, 2, 3];
        const roomsList = [];

        // Read students to map allocated occupants
        const approvedWithRoom = students.filter(s => s.status?.toLowerCase() === "approved" && s.room_no);

        blocks.forEach(b => {
            floors.forEach(f => {
                for (let num = 1; num <= 20; num++) {
                    const padNum = String(num).padStart(2, "0");
                    const roomId = `${b}${f}${padNum}`;
                    const occupantsList = approvedWithRoom.filter(s => s.room_no.trim() === roomId);
                    const occupiedCount = occupantsList.length;
                    let status = "Available";
                    if (occupiedCount >= 4) {
                        status = "Full";
                    } else if (occupiedCount > 0) {
                        status = "Partially Filled";
                    }

                    roomsList.push({
                        room_id: roomId,
                        block: b,
                        floor: String(f),
                        capacity: "4",
                        occupied: String(occupiedCount),
                        status: status,
                        maintenance: "false",
                        occupants: occupantsList.map(o => o.roll_no || o.admission_no).join(";")
                    });
                }
            });
        });
        await writeCSV(ROOMS_CSV, roomHeaders, roomsList);
    }

    // 5. Initialize notifications.csv if missing
    if (!fs.existsSync(NOTIFICATIONS_CSV)) {
        const initialNotifs = [
            {
                id: "1",
                type: "info",
                title: "Welcome to HostelERP",
                text: "Your hostel management system is fully connected and active.",
                time: new Date().toISOString(),
                read: "false",
                roll: "24AI001",
                audience: "student"
            },
            {
                id: "2",
                type: "success",
                title: "Outpass Approved",
                text: "Your Outpass Request has been approved by the Warden. Token: OTP-240814-204",
                time: new Date().toISOString(),
                read: "false",
                roll: "24AI001",
                audience: "student"
            },
            {
                id: "3",
                type: "info",
                title: "New Outpass Request",
                text: "janu (24AI009) applied for an Outpass.",
                time: new Date().toISOString(),
                read: "false",
                roll: "",
                audience: "warden"
            },
            {
                id: "4",
                type: "info",
                title: "New Leave Request",
                text: "Lavanya (26AI015) applied for a 3-day leave.",
                time: new Date().toISOString(),
                read: "false",
                roll: "",
                audience: "warden"
            }
        ];
        await writeCSV(NOTIFICATIONS_CSV, notificationHeaders, initialNotifs);
    }

    // 6. Initialize movements.csv if missing (NEW — Gatekeeper QR log)
    if (!fs.existsSync(MOVEMENTS_CSV)) {
        await writeCSV(MOVEMENTS_CSV, movementHeaders, []);
    }

    // 6b. Initialize qr_tokens.csv if missing (NEW — return-QR ledger)
    if (!fs.existsSync(QR_TOKENS_CSV)) {
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, []);
    }


    // 7. Admin management data
    const adminManagementHeaders = {
      blocks: [{id:'block_id',title:'block_id'},{id:'name',title:'name'},{id:'description',title:'description'},{id:'status',title:'status'}],
      departments: [{id:'department_id',title:'department_id'},{id:'name',title:'name'},{id:'hod',title:'hod'},{id:'status',title:'status'}],
      roles: [{id:'role_id',title:'role_id'},{id:'name',title:'name'},{id:'description',title:'description'},{id:'status',title:'status'}],
      permissions: [{id:'permission_id',title:'permission_id'},{id:'name',title:'name'},{id:'description',title:'description'},{id:'status',title:'status'}],
      supervisors: [{id:'supervisor_id',title:'supervisor_id'},{id:'full_name',title:'full_name'},{id:'email',title:'email'},{id:'phone_no',title:'phone_no'},{id:'department',title:'department'},{id:'password',title:'password'},{id:'status',title:'status'},{id:'created_at',title:'created_at'}],
      audit: [{id:'id',title:'id'},{id:'admin_id',title:'admin_id'},{id:'action',title:'action'},{id:'entity',title:'entity'},{id:'entity_id',title:'entity_id'},{id:'details',title:'details'},{id:'created_at',title:'created_at'}]
    };
    const seed = {
      blocks: [{block_id:'BLK-A',name:'Block A',description:'Boys Hostel Block A',status:'Active'},{block_id:'BLK-B',name:'Block B',description:'Boys Hostel Block B',status:'Active'},{block_id:'BLK-C',name:'Block C',description:'Girls Hostel Block A',status:'Active'},{block_id:'BLK-D',name:'Block D',description:'Girls Hostel Block B',status:'Active'}],
      departments: [{department_id:'DEP-CS',name:'Computer Science',hod:'',status:'Active'},{department_id:'DEP-AI',name:'Artificial Intelligence',hod:'',status:'Active'},{department_id:'DEP-BCA',name:'BCA',hod:'',status:'Active'}],
      roles: [{role_id:'ROLE-ADMIN',name:'Admin',description:'Full system management',status:'Active'},{role_id:'ROLE-WARDEN',name:'Warden',description:'Hostel and student management',status:'Active'},{role_id:'ROLE-SECURITY',name:'Security Staff',description:'Gate QR scanning and gate logs',status:'Active'},{role_id:'ROLE-SUPERVISOR',name:'Supervisor',description:'Supervisory hostel operations',status:'Active'}],
      permissions: [{permission_id:'P-STUDENTS',name:'Manage Students',description:'Create, edit and activate/deactivate students',status:'Active'},{permission_id:'P-STAFF',name:'Manage Staff',description:'Manage wardens, security and supervisors',status:'Active'},{permission_id:'P-REPORTS',name:'View Reports',description:'Generate administrative reports',status:'Active'},{permission_id:'P-AUDIT',name:'View Audit Logs',description:'Review administrative actions',status:'Active'}],
      supervisors: [], audit: []
    };
    for (const key of Object.keys(seed)) {
      const file = {blocks:BLOCKS_CSV,departments:DEPARTMENTS_CSV,roles:ROLES_CSV,permissions:PERMISSIONS_CSV,supervisors:SUPERVISORS_CSV,audit:AUDIT_CSV}[key];
      if (!fs.existsSync(file)) await writeCSV(file, adminManagementHeaders[key], seed[key]);
    }
    // qrValidityMinutes: NEW — max minutes a dynamic return QR stays
    // ACTIVE after Student Out before it auto-expires. Admin-editable
    // from the existing Hostel Configuration panel (admin-management.html),
    // since that panel already renders one input per key in this file.
    if (!fs.existsSync(HOSTEL_CONFIG_JSON)) fs.writeFileSync(HOSTEL_CONFIG_JSON, JSON.stringify({name:'HostelERP',capacityPerRoom:4,totalBlocks:4,qrValidityMinutes:120},null,2));
    if (!fs.existsSync(SYSTEM_SETTINGS_JSON)) fs.writeFileSync(SYSTEM_SETTINGS_JSON, JSON.stringify({maintenanceMode:false,allowStudentRegistration:true,allowWardenRegistration:true,requireApproval:true},null,2));

    console.log("HostelERP Database initialized successfully.");
}

module.exports = {
    initDB,
    STUDENTS_CSV,
    REGISTRATIONS_CSV,
    LEAVE_CSV,
    OUTPASS_CSV,
    ROOMS_CSV,
    NOTIFICATIONS_CSV,
    MOVEMENTS_CSV,
    QR_TOKENS_CSV,
    studentHeaders,
    leaveHeaders,
    outpassHeaders,
    roomHeaders,
    notificationHeaders,
    movementHeaders,
    qrTokenHeaders,
    BLOCKS_CSV, DEPARTMENTS_CSV, ROLES_CSV, PERMISSIONS_CSV, SUPERVISORS_CSV, AUDIT_CSV, HOSTEL_CONFIG_JSON, SYSTEM_SETTINGS_JSON
};
