const path = require("path");
const bcrypt = require("bcrypt");
const { sendStudentApprovalEmail } = require("../services/emailService");
const { readCSV, appendCSV, writeCSV } = require("../services/csvService");

const csvFile = path.join(__dirname, "../database/students.csv");
const regCsvFile = path.join(__dirname, "../database/registrations.csv");

const header = [
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

// Helper to keep registrations.csv in sync
async function syncRegistrationsCSV(students) {
    try {
        await writeCSV(regCsvFile, header, students);
    } catch (e) {
        console.warn("Could not sync registrations.csv:", e.message);
    }
}

// GET all students (supports filtering by status, dept, year, query)
const getAllStudents = async (req, res) => {
    try {
        const { status, dept, year, q } = req.query;
        let students = await readCSV(csvFile);

        let filtered = students.map(({ password, ...s }) => s);

        if (status) {
            filtered = filtered.filter(s => String(s.status || "").toLowerCase() === status.toLowerCase());
        }
        if (dept) {
            filtered = filtered.filter(s => String(s.department || "").toLowerCase() === dept.toLowerCase());
        }
        if (year) {
            filtered = filtered.filter(s => String(s.year || "").toLowerCase() === year.toLowerCase());
        }
        if (q) {
            const query = q.toLowerCase();
            filtered = filtered.filter(s =>
                String(s.full_name || "").toLowerCase().includes(query) ||
                String(s.roll_no || "").toLowerCase().includes(query) ||
                String(s.admission_no || "").toLowerCase().includes(query)
            );
        }

        return res.status(200).json({
            success: true,
            total: filtered.length,
            students: filtered
        });
    } catch (error) {
        console.error("Get all students error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET student by ID (admission_no, roll_no, or email)
const getStudentById = async (req, res) => {
    try {
        const { id } = req.params;
        const targetId = String(id || "").trim().toLowerCase();
        const students = await readCSV(csvFile);

        const student = students.find(s =>
            String(s.admission_no || "").trim().toLowerCase() === targetId ||
            String(s.roll_no || "").trim().toLowerCase() === targetId ||
            String(s.email || "").trim().toLowerCase() === targetId
        );

        if (!student) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        const { password, ...safeStudent } = student;
        return res.status(200).json({
            success: true,
            student: safeStudent
        });
    } catch (error) {
        console.error("Get student by ID error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

const registerStudent = async (req, res) => {
    try {
        const students = await readCSV(csvFile);
        const student = req.body;

        // Uploaded file paths supplied by multer middleware
        student.id_proof = req.files?.idProof?.[0]?.filename || req.body.id_proof || "";
        student.passport_photo = req.files?.passportPhoto?.[0]?.filename || req.body.passport_photo || "";

        const admissionExists = students.find(
            s => String(s.admission_no || "").trim().toLowerCase() === String(student.admission_no || "").trim().toLowerCase()
        );

        if (admissionExists) {
            return res.status(409).json({
                success: false,
                message: "Admission Number Already Exists"
            });
        }

        const emailExists = students.find(
            s => String(s.email || "").trim().toLowerCase() === String(student.email || "").trim().toLowerCase()
        );

        if (emailExists) {
            return res.status(409).json({
                success: false,
                message: "Email Already Registered"
            });
        }

        student.password = await bcrypt.hash(student.password || "password123", 10);
        student.roll_no = student.roll_no || "";
        student.room_no = student.room_no || "";
        student.status = "Pending";
        student.approved_by = "";
        student.approved_date = "";
        student.created_at = new Date().toLocaleDateString("en-IN");
        student.rejection_reason = "";

        const normalizedStudent = {};
        header.forEach(({ id }) => {
            normalizedStudent[id] = student[id] || "";
        });

        const finalStudents = [...students, normalizedStudent];
        await writeCSV(csvFile, header, finalStudents);
        await syncRegistrationsCSV(finalStudents);

        res.status(201).json({
            success: true,
            message: "Registration Submitted Successfully",
            student: normalizedStudent
        });

    } catch (err) {
        console.error("Register student error:", err);
        res.status(500).json({
            success: false,
            message: err.message || "Server Error"
        });
    }
};

const loginStudent = async (req, res) => {
    try {
        const { login_id, password } = req.body;

        if (!login_id || !password) {
            return res.status(400).json({
                success: false,
                message: "Admission/Roll Number and password are required."
            });
        }

        const students = await readCSV(csvFile);

        const student = students.find(
            (s) =>
                String(s.admission_no || "").trim().toLowerCase() === login_id.trim().toLowerCase() ||
                String(s.roll_no || "").trim().toLowerCase() === login_id.trim().toLowerCase() ||
                String(s.email || "").trim().toLowerCase() === login_id.trim().toLowerCase()
        );

        if (!student) {
            return res.status(401).json({
                success: false,
                message: "Invalid Admission/Roll Number or password."
            });
        }

        const passwordCorrect = await bcrypt.compare(password, student.password);

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "Invalid Admission/Roll Number or password."
            });
        }

        const status = (student.status || "").trim().toLowerCase();

        if (status === "pending") {
            return res.status(403).json({
                success: false,
                status: "Pending",
                message: "Your registration is awaiting warden approval."
            });
        }

        if (status === "rejected") {
            return res.status(403).json({
                success: false,
                status: "Rejected",
                message: "Your hostel registration has been rejected. Please contact the hostel office."
            });
        }

        if (status !== "approved") {
            return res.status(403).json({
                success: false,
                message: "Your account is not approved for login."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Login Successful",
            student: {
                admission_no: student.admission_no,
                roll_no: student.roll_no,
                full_name: student.full_name,
                email: student.email,
                phone_no: student.phone_no,
                department: student.department,
                year: student.year,
                room_no: student.room_no,
                passport_photo: student.passport_photo || ""
            }
        });

    } catch (error) {
        console.error("Student login error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

const getStudentProfile = async (req, res) => {
    try {
        const loginId = String(req.params.login_id || "").trim().toLowerCase();
        if (!loginId) {
            return res.status(400).json({ success: false, message: "Login ID is required." });
        }

        const students = await readCSV(csvFile);
        const student = students.find((s) =>
            String(s.admission_no || "").trim().toLowerCase() === loginId ||
            String(s.roll_no || "").trim().toLowerCase() === loginId ||
            String(s.email || "").trim().toLowerCase() === loginId
        );

        if (!student) {
            return res.status(404).json({ success: false, message: "Student not found." });
        }

        const { password, ...safeStudent } = student;
        return res.status(200).json({ success: true, student: safeStudent });
    } catch (error) {
        console.error("Student profile error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

const searchStudentsByName = async (req, res) => {
    try {
        const query = String(req.query.name || "").trim().toLowerCase();

        if (!query) {
            return res.status(200).json({
                success: true,
                students: []
            });
        }

        const students = await readCSV(csvFile);

        const matches = students
            .filter(student => {
                const name = student.full_name || student.name || "";
                return String(name).trim().toLowerCase().startsWith(query) ||
                    String(student.admission_no || "").toLowerCase().startsWith(query) ||
                    String(student.roll_no || "").toLowerCase().startsWith(query);
            })
            .slice(0, 30)
            .map(student => {
                const { password, ...safe } = student;
                return safe;
            });

        return res.status(200).json({
            success: true,
            students: matches
        });

    } catch (error) {
        console.error("Student name search error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to search students."
        });
    }
};

const getStudentRegistrations = async (req, res) => {
    try {
        const students = await readCSV(csvFile);
        const safeStudents = students.map(({ password, ...student }) => student);

        return res.status(200).json({
            success: true,
            students: safeStudents
        });

    } catch (error) {
        console.error("Get registrations error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

const approveStudent = async (req, res) => {
    try {
        const { admission_no } = req.params;
        const { roll_no, room_no, approved_by } = req.body;

        const students = await readCSV(csvFile);

        const index = students.findIndex(
            student =>
                String(student.admission_no || "").trim().toLowerCase() ===
                String(admission_no || "").trim().toLowerCase()
        );

        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        students[index].status = "Approved";

        if (roll_no) {
            students[index].roll_no = roll_no;
        }

        if (room_no) {
            students[index].room_no = room_no;
        }

        students[index].approved_by = approved_by || "Warden";
        students[index].approved_date = new Date().toLocaleDateString("en-IN");
        students[index].rejection_reason = "";

        await writeCSV(csvFile, header, students);
        await syncRegistrationsCSV(students);

        // Fire-and-forget: the student is already approved and saved
        // above, so this action shouldn't hang waiting on the mail
        // server. The response no longer reports emailSent — the caller
        // gets confirmation the approval itself succeeded immediately.
        sendStudentApprovalEmail(students[index]).catch((emailError) => {
            console.error(
                "Could not send student approval email:",
                emailError.message
            );
        });

        const { password, ...safeStudent } = students[index];

        return res.status(200).json({
            success: true,
            message: "Student approved successfully.",
            student: safeStudent
        });

    } catch (error) {
        console.error("Approve student error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

const rejectStudent = async (req, res) => {
    try {
        const { admission_no } = req.params;
        const { reason, rejection_reason } = req.body;

        const students = await readCSV(csvFile);

        const index = students.findIndex(
            student =>
                String(student.admission_no || "").trim().toLowerCase() ===
                String(admission_no || "").trim().toLowerCase()
        );

        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        students[index].status = "Rejected";
        students[index].rejection_reason = reason || rejection_reason || "Rejected by Warden";
        students[index].approved_by = "";
        students[index].approved_date = "";

        await writeCSV(csvFile, header, students);
        await syncRegistrationsCSV(students);

        const { password, ...safeStudent } = students[index];

        return res.status(200).json({
            success: true,
            message: "Student registration rejected.",
            student: safeStudent
        });

    } catch (error) {
        console.error("Reject student error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

const vacateStudent = async (req, res) => {
    try {
        const { admission_no } = req.params;
        const students = await readCSV(csvFile);

        const index = students.findIndex(
            s => String(s.admission_no || "").trim().toLowerCase() ===
                String(admission_no || "").trim().toLowerCase()
        );

        if (index === -1) {
            return res.status(404).json({ success: false, message: "Student not found." });
        }

        const vacated = students[index];
        students.splice(index, 1);

        await writeCSV(csvFile, header, students);
        await syncRegistrationsCSV(students);

        return res.status(200).json({
            success: true,
            message: `Student ${vacated.full_name} has been vacated and removed from the system.`,
            student: { admission_no: vacated.admission_no, full_name: vacated.full_name }
        });
    } catch (error) {
        console.error("Vacate student error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    getAllStudents,
    getStudentById,
    registerStudent,
    loginStudent,
    getStudentProfile,
    getStudentRegistrations,
    searchStudentsByName,
    approveStudent,
    rejectStudent,
    vacateStudent
};