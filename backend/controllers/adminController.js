const path = require("path");
const bcrypt = require("bcrypt");
const { readCSV } = require("../services/csvService");

const adminCsv = path.join(__dirname, "../database/admin.csv");
const { checkStaticAdmin, staticAdminRecord } = require("../config/adminCredentials");
const studentsCsv = path.join(__dirname, "../database/students.csv");
const wardenCsv = path.join(__dirname, "../database/warden.csv");
const leaveCsv = path.join(__dirname, "../database/leave_requests.csv");
const outpassCsv = path.join(__dirname, "../database/outpass_requests.csv");
const notifCsv = path.join(__dirname, "../database/notifications.csv");
const roomsCsv = path.join(__dirname, "../database/rooms.csv");

// POST /api/admin/login
const loginAdmin = async (req, res) => {
    try {
        const { admin_id, password } = req.body;
        const targetId = (admin_id || req.body.username || req.body.email || "").trim().toLowerCase();

        if (!targetId || !password) {
            return res.status(400).json({ success: false, message: "Admin ID and password are required." });
        }

        // The shared static admin login for the portal, checked first.
        if (checkStaticAdmin(targetId, password)) {
            return res.status(200).json({
                success: true,
                message: "Admin login successful",
                admin: staticAdminRecord()
            });
        }

        const admins = await readCSV(adminCsv);
        const admin = admins.find(a =>
            String(a.admin_id || "").trim().toLowerCase() === targetId ||
            String(a.email || "").trim().toLowerCase() === targetId
        );

        if (!admin) {
            return res.status(401).json({ success: false, message: "Invalid Admin ID or password." });
        }

        let passwordCorrect = false;
        if (admin.password.startsWith("$2b$") || admin.password.startsWith("$2a$")) {
            passwordCorrect = await bcrypt.compare(password, admin.password);
        } else {
            passwordCorrect = admin.password === password;
        }

        if (!passwordCorrect) {
            return res.status(401).json({ success: false, message: "Invalid Admin ID or password." });
        }

        if (String(admin.status || "").toLowerCase() === "inactive") {
            return res.status(403).json({ success: false, message: "This admin account is inactive." });
        }

        const { password: _, ...safeAdmin } = admin;
        return res.status(200).json({
            success: true,
            message: "Admin login successful",
            admin: safeAdmin
        });

    } catch (error) {
        console.error("Admin login error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/admin/stats
const getAdminStats = async (req, res) => {
    try {
        const students = await readCSV(studentsCsv);
        const wardens = await readCSV(wardenCsv);
        const leaves = await readCSV(leaveCsv);
        const outpasses = await readCSV(outpassCsv);
        const notifs = await readCSV(notifCsv);
        const rooms = await readCSV(roomsCsv);

        const approvedStudents = students.filter(s => String(s.status || "").toLowerCase() === "approved");
        const pendingRegs = students.filter(s => String(s.status || "").toLowerCase() === "pending");
        const rejectedStudents = students.filter(s => String(s.status || "").toLowerCase() === "rejected");

        const pendingLeaves = leaves.filter(l => String(l.status || "").toLowerCase() === "pending");
        const pendingOutpasses = outpasses.filter(o => String(o.status || "").toLowerCase() === "pending");
        const unreadNotifs = notifs.filter(n => String(n.read || "false").toLowerCase() === "false");

        // Compute room stats
        const totalRooms = rooms.length || 240;
        const occupiedRooms = rooms.filter(r => parseInt(r.occupied || 0) > 0).length;
        const availableRooms = rooms.filter(r => String(r.status || "").toLowerCase() === "available").length;

        const stats = {
            totalStudents: approvedStudents.length,
            totalWardens: wardens.length,
            pendingRegistrations: pendingRegs.length,
            pendingLeave: pendingLeaves.length,
            pendingOutpass: pendingOutpasses.length,
            unreadNotifications: unreadNotifs.length,
            approvedStudents: approvedStudents.length,
            rejectedStudents: rejectedStudents.length,
            roomStats: {
                totalRooms: totalRooms,
                occupiedRooms: occupiedRooms,
                availableRooms: availableRooms || (totalRooms - occupiedRooms),
                vacantBeds: (totalRooms * 4) - approvedStudents.length
            }
        };

        return res.status(200).json({
            success: true,
            stats: stats
        });

    } catch (error) {
        console.error("Get admin stats error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/activities - Merged warden activities feed
const getActivityFeed = async (req, res) => {
    try {
        const students = await readCSV(studentsCsv);
        const leaves = await readCSV(leaveCsv);
        const outpasses = await readCSV(outpassCsv);

        const activities = [];

        // 1. Registrations
        students.forEach(s => {
            if (s.status && s.status !== "Pending") {
                activities.push({
                    date: s.approved_date || s.created_at || new Date().toLocaleDateString("en-IN"),
                    time: "10:00 AM",
                    timestamp: s.created_at || new Date().toISOString(),
                    wardenName: s.approved_by || "Warden Office",
                    studentName: s.full_name,
                    roll: s.roll_no || s.admission_no,
                    action: `Registration ${s.status}`,
                    status: s.status,
                    remarks: s.rejection_reason || (s.room_no ? `Room ${s.room_no} allocated` : "")
                });
            }
        });

        // 2. Leaves
        leaves.forEach(l => {
            if (l.status && l.status !== "Pending") {
                activities.push({
                    date: l.updated_at ? new Date(l.updated_at).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN"),
                    time: l.updated_at ? new Date(l.updated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "11:00 AM",
                    timestamp: l.updated_at || l.created_at || new Date().toISOString(),
                    wardenName: l.approved_by || "Warden",
                    studentName: l.name,
                    roll: l.roll_no,
                    action: `Leave ${l.status}`,
                    status: l.status,
                    remarks: l.rejection_reason || l.reason || ""
                });
            }
        });

        // 3. Outpasses
        outpasses.forEach(o => {
            if (o.status && o.status !== "Pending") {
                activities.push({
                    date: o.updated_at ? new Date(o.updated_at).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN"),
                    time: o.updated_at ? new Date(o.updated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "04:00 PM",
                    timestamp: o.updated_at || o.created_at || new Date().toISOString(),
                    wardenName: o.approved_by || "Warden",
                    studentName: o.name,
                    roll: o.roll_no,
                    action: `Outpass ${o.status}`,
                    status: o.status,
                    remarks: o.rejection_reason || o.purpose || ""
                });
            }
        });

        activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.status(200).json({
            success: true,
            total: activities.length,
            activities: activities
        });

    } catch (error) {
        console.error("Get activity feed error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    loginAdmin,
    getAdminStats,
    getActivityFeed
};
