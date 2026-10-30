const express = require("express");
const router = express.Router();

const {
    registerWarden,
    loginWarden,
    getAllWardens,
    getWardenProfile,
    updateWardenProfile,
    getDashboardStats
} = require("../controllers/wardenController");

router.post("/register", registerWarden);
router.post("/login", loginWarden);

// Dashboard stats endpoint (must be declared before :employee_id to avoid matching "dashboard-stats" as an ID)
router.get("/dashboard-stats", getDashboardStats);
router.get("/stats", getDashboardStats);

// Profile endpoints (support both /profile/:id and /:id, with GET, PUT, PATCH, POST)
router.get("/profile/:employee_id", getWardenProfile);
router.put("/profile/:employee_id", updateWardenProfile);
router.patch("/profile/:employee_id", updateWardenProfile);
router.post("/profile/:employee_id", updateWardenProfile);

router.get("/profile", getWardenProfile);
router.put("/profile", updateWardenProfile);

router.get("/:employee_id", getWardenProfile);
router.put("/:employee_id", updateWardenProfile);
router.patch("/:employee_id", updateWardenProfile);

router.get("/", getAllWardens);

module.exports = router;