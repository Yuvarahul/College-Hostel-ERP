/* ============================================================
   gatekeeperRoutes.js
   NEW FILE — added for the Gatekeeper QR Movement workflow.
   Mounted at /api/gatekeeper in server.js.
   ============================================================ */

const express = require("express");
const router = express.Router();

const {
    verifyQr,
    studentOut,
    studentIn,
    searchStudent,
    getHistory,
    getCurrentlyOut,
    getStats
} = require("../controllers/gatekeeperController");

router.post("/verify-qr", verifyQr);
router.post("/student-out", studentOut);
router.post("/student-in", studentIn);
router.get("/student/:roll", searchStudent);
router.get("/history", getHistory);
router.get("/currently-out", getCurrentlyOut);
router.get("/stats", getStats);

module.exports = router;
