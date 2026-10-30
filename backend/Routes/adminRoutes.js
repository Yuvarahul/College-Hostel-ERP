const express = require("express");
const router = express.Router();

const {
    loginAdmin,
    getAdminStats,
    getActivityFeed
} = require("../controllers/adminController");

router.post("/login", loginAdmin);
router.get("/stats", getAdminStats);
router.get("/activities", getActivityFeed);

module.exports = router;
