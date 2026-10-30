const express = require("express");
const router = express.Router();

const {
    getNotifications,
    createNotification,
    markAsRead,
    markAllAsRead
} = require("../controllers/notificationController");

router.get("/", getNotifications);
router.post("/", createNotification);
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);

module.exports = router;
