const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads/proofs");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `leave_proof_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

const {
    applyLeave,
    getAllLeaves,
    getPendingLeaves,
    getStudentLeaves,
    updateLeaveStatus
} = require("../controllers/leaveController");

router.post("/", upload.single("proof"), applyLeave);
router.get("/pending", getPendingLeaves);
router.get("/student/:id", getStudentLeaves);
router.get("/", getAllLeaves);
router.patch("/:id", updateLeaveStatus);

module.exports = router;
