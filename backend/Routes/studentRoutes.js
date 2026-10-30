const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads/students");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeAdmission = String(req.body.admission_no || "student")
            .replace(/[^a-zA-Z0-9_-]/g, "_");
        cb(null, `${safeAdmission}_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const isPassport = file.fieldname === "passportPhoto";
        const allowed = isPassport
            ? ["image/jpeg", "image/png"]
            : ["image/jpeg", "image/png", "application/pdf"];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error(
                isPassport
                    ? "Passport photo must be JPG or PNG."
                    : "ID proof must be JPG, PNG, or PDF."
            ));
        }
        cb(null, true);
    }
});

const {
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
} = require("../controllers/studentController");

// Static / specialized routes first
router.get("/registrations", getStudentRegistrations);
router.get("/search", searchStudentsByName);
router.get("/profile/:login_id", getStudentProfile);

// Registration & Login
router.post(
    "/register",
    upload.fields([
        { name: "passportPhoto", maxCount: 1 },
        { name: "idProof", maxCount: 1 }
    ]),
    registerStudent
);

router.post("/login", loginStudent);

// Student actions
router.patch("/:admission_no/approve", approveStudent);
router.patch("/:admission_no/reject", rejectStudent);
router.delete("/:admission_no/vacate", vacateStudent);

// General collection & parameterized student ID
router.get("/", getAllStudents);
router.get("/:id", getStudentById);

module.exports = router;