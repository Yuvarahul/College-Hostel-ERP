const path = require("path");
const bcrypt = require("bcrypt");
const { readCSV, appendCSV, writeCSV } = require("../services/csvService");

const csvFile = path.join(__dirname, "../database/warden.csv");

const header = [
    { id: "employee_id", title: "employee_id" },
    { id: "full_name", title: "full_name" },
    { id: "department", title: "department" },
    { id: "shift", title: "shift" },
    { id: "email", title: "email" },
    { id: "phone_no", title: "phone_no" },
    { id: "address", title: "address" },
    { id: "password", title: "password" },
    { id: "id_proof", title: "id_proof" },
    { id: "created_at", title: "created_at" },
    { id: "status", title: "status" },
    { id: "approved_by", title: "approved_by" },
    { id: "approved_date", title: "approved_date" },
    { id: "rejection_reason", title: "rejection_reason" }
];

const registerWarden = async (req, res) => {
    try {
        const wardens = await readCSV(csvFile);
        const warden = req.body;

        if (
            !warden.employee_id ||
            !warden.full_name ||
            !warden.phone_no ||
            !warden.email ||
            !warden.password
        ) {
            return res.status(400).json({
                success: false,
                message: "Please fill all required fields."
            });
        }

        const employeeExists = wardens.find(
            w =>
                String(w.employee_id || "").trim().toLowerCase() ===
                String(warden.employee_id || "").trim().toLowerCase()
        );

        if (employeeExists) {
            return res.status(409).json({
                success: false,
                message: "Employee ID already registered."
            });
        }

        const emailExists = wardens.find(
            w =>
                String(w.email || "").trim().toLowerCase() ===
                String(warden.email || "").trim().toLowerCase()
        );

        if (emailExists) {
            return res.status(409).json({
                success: false,
                message: "Email already registered."
            });
        }

        warden.password = await bcrypt.hash(warden.password, 10);
        warden.created_at = new Date().toLocaleDateString("en-IN");

        // New warden accounts stay Pending until an Admin approves them
        // from the Admin Portal (Warden Approvals module).
        warden.status = "Pending";
        warden.approved_by = "";
        warden.approved_date = "";
        warden.rejection_reason = "";

        await appendCSV(csvFile, header, warden);

        return res.status(201).json({
            success: true,
            pendingApproval: true,
            message: "Registration submitted. Your warden account is awaiting Admin approval."
        });

    } catch (error) {
        console.error("Warden registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

const loginWarden = async (req, res) => {
    try {
        const { employee_id, password } = req.body;

        if (!employee_id || !password) {
            return res.status(400).json({
                success: false,
                message: "Employee ID and password are required."
            });
        }

        const wardens = await readCSV(csvFile);

        const warden = wardens.find(
            (w) =>
                String(w.employee_id || "").trim().toLowerCase() ===
                String(employee_id || "").trim().toLowerCase() ||
                String(w.email || "").trim().toLowerCase() ===
                String(employee_id || "").trim().toLowerCase()
        );

        if (!warden) {
            return res.status(401).json({
                success: false,
                message: "Invalid Employee ID or password."
            });
        }

        let passwordCorrect = false;
        if (warden.password && (warden.password.startsWith("$2b$") || warden.password.startsWith("$2a$"))) {
            passwordCorrect = await bcrypt.compare(password, warden.password);
        } else {
            passwordCorrect = warden.password === password;
        }

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "Invalid Employee ID or password."
            });
        }

        const wardenStatus = String(warden.status || "Active").trim().toLowerCase();

        if (wardenStatus === "pending" || wardenStatus === "awaiting approval") {
            return res.status(403).json({
                success: false,
                message: "Your warden registration is still awaiting Admin approval."
            });
        }

        if (wardenStatus === "rejected" || wardenStatus === "declined") {
            return res.status(403).json({
                success: false,
                message: warden.rejection_reason
                    ? `Your warden registration was rejected: ${warden.rejection_reason}`
                    : "Your warden registration was rejected by the Admin."
            });
        }

        if (wardenStatus === "inactive") {
            return res.status(403).json({ success: false, message: "This warden account is inactive." });
        }

        return res.status(200).json({
            success: true,
            message: "Login successful.",
            warden: {
                employee_id: warden.employee_id,
                full_name: warden.full_name,
                department: warden.department,
                shift: warden.shift || warden.Shift || "Shift 1",
                email: warden.email,
                phone_no: warden.phone_no,
                address: warden.address || ""
            }
        });

    } catch (error) {
        console.error("Warden login error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

const getAllWardens = async (req, res) => {
    try {
        const wardens = await readCSV(csvFile);
        const safeWardens = wardens.map(({ password, ...w }) => ({
            ...w,
            shift: w.shift || w.Shift || "Shift 1"
        }));

        return res.status(200).json({
            success: true,
            total: safeWardens.length,
            wardens: safeWardens
        });
    } catch (error) {
        console.error("Get all wardens error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

const getWardenProfile = async (req, res) => {
    try {
        const empId = String(req.params.employee_id || req.query.employee_id || req.body.employee_id || "").trim().toLowerCase();
        const wardens = await readCSV(csvFile);

        let warden = null;
        if (empId) {
            warden = wardens.find(
                w =>
                    String(w.employee_id || "").trim().toLowerCase() === empId ||
                    String(w.email || "").trim().toLowerCase() === empId
            );
        }

        // Default fallback to first warden if no specific match
        if (!warden && wardens.length > 0) {
            warden = wardens[0];
        }

        if (!warden) {
            return res.status(404).json({ success: false, message: "Warden profile not found." });
        }

        const { password, ...safeWarden } = warden;
        safeWarden.shift = safeWarden.shift || safeWarden.Shift || "Shift 1";

        return res.status(200).json({ success: true, warden: safeWarden });
    } catch (error) {
        console.error("Get warden profile error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

const updateWardenProfile = async (req, res) => {
    try {
        const empId = String(req.params.employee_id || req.body.employee_id || req.query.employee_id || "").trim().toLowerCase();
        const { full_name, name, email, phone_no, phone, shift, Shift, department, dept, address } = req.body;

        const wardens = await readCSV(csvFile);

        let index = -1;
        if (empId) {
            index = wardens.findIndex(
                w =>
                    String(w.employee_id || "").trim().toLowerCase() === empId ||
                    String(w.email || "").trim().toLowerCase() === empId
            );
        }

        // Fallback to first warden if empty id and wardens exist
        if (index === -1 && wardens.length > 0) {
            index = 0;
        }

        if (index === -1) {
            return res.status(404).json({ success: false, message: "Warden not found." });
        }

        const newName = full_name !== undefined ? full_name : (name !== undefined ? name : wardens[index].full_name);
        const newEmail = email !== undefined ? email : wardens[index].email;
        const newPhone = phone_no !== undefined ? phone_no : (phone !== undefined ? phone : wardens[index].phone_no);
        const newShift = shift !== undefined ? shift : (Shift !== undefined ? Shift : (wardens[index].shift || wardens[index].Shift || "Shift 1"));
        const newDept = department !== undefined ? department : (dept !== undefined ? dept : wardens[index].department);
        const newAddress = address !== undefined ? address : (wardens[index].address || "");

        wardens[index].full_name = newName || "";
        wardens[index].email = newEmail || "";
        wardens[index].phone_no = newPhone || "";
        wardens[index].shift = newShift || "Shift 1";
        wardens[index].department = newDept || "";
        wardens[index].address = newAddress || "";
        wardens[index].status = wardens[index].status || "Active";
        wardens[index].created_at = wardens[index].created_at || "";
        wardens[index].id_proof = wardens[index].id_proof || "";
        wardens[index].password = wardens[index].password || "";

        // Format clean CSV records
        const cleanWardens = wardens.map(w => ({
            employee_id: w.employee_id || "",
            full_name: w.full_name || "",
            department: w.department || "",
            shift: w.shift || w.Shift || "Shift 1",
            email: w.email || "",
            phone_no: w.phone_no || "",
            address: w.address || "",
            password: w.password || "",
            id_proof: w.id_proof || "",
            created_at: w.created_at || "",
            status: w.status || "Active"
        }));

        await writeCSV(csvFile, header, cleanWardens);

        const { password, ...safeWarden } = cleanWardens[index];

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            warden: safeWarden
        });
    } catch (error) {
        console.error("Update warden profile error:", error);
        return res.status(500).json({ success: false, message: error.message || "Server Error" });
    }
};

// GET /api/wardens/dashboard-stats
const getDashboardStats = async (req, res) => {
    try {
        const studentsCsv = path.join(__dirname, "../database/students.csv");
        const leaveCsv = path.join(__dirname, "../database/leave_requests.csv");
        const outpassCsv = path.join(__dirname, "../database/outpass_requests.csv");
        const notifCsv = path.join(__dirname, "../database/notifications.csv");

        const [students, leaves, outpasses, notifs] = await Promise.all([
            readCSV(studentsCsv),
            readCSV(leaveCsv),
            readCSV(outpassCsv),
            readCSV(notifCsv)
        ]);

        const totalStudents = students.filter(s => String(s.status || "").trim().toLowerCase() === "approved").length;
        const pendingRegistrations = students.filter(s => String(s.status || "").trim().toLowerCase() === "pending").length;
        const pendingLeaves = leaves.filter(l => String(l.status || "").trim().toLowerCase() === "pending").length;
        const pendingOutpasses = outpasses.filter(o => String(o.status || "").trim().toLowerCase() === "pending").length;
        const pendingRequests = pendingRegistrations + pendingLeaves + pendingOutpasses;

        const unreadNotifications = notifs.filter(n =>
            String(n.read || "").trim().toLowerCase() === "false" &&
            (String(n.audience || "").trim().toLowerCase() === "warden" || !n.audience || String(n.audience).toLowerCase() === "all")
        ).length;

        return res.status(200).json({
            success: true,
            stats: {
                totalStudents,
                pendingRequests,
                pendingRegistrations,
                pendingLeaves,
                pendingOutpasses,
                unreadNotifications
            }
        });
    } catch (error) {
        console.error("Get dashboard stats error:", error);
        return res.status(500).json({ success: false, message: "Server Error", stats: { totalStudents: 0, pendingRequests: 0, unreadNotifications: 0 } });
    }
};

module.exports = {
    registerWarden,
    loginWarden,
    getAllWardens,
    getWardenProfile,
    updateWardenProfile,
    getDashboardStats
};