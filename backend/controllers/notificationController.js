const path = require("path");
const { readCSV, writeCSV } = require("../services/csvService");
const { notificationHeaders } = require("../services/dbInit");

const notifCsv = path.join(__dirname, "../database/notifications.csv");

// GET /api/notifications
const getNotifications = async (req, res) => {
    try {
        const { audience, roll, read } = req.query;
        let notifs = await readCSV(notifCsv);

        if (audience) {
            notifs = notifs.filter(n => String(n.audience || "").toLowerCase() === audience.toLowerCase());
        }
        if (roll) {
            const targetRoll = roll.toLowerCase();
            notifs = notifs.filter(n =>
                String(n.roll || "").toLowerCase() === targetRoll ||
                String(n.audience || "").toLowerCase() === "all"
            );
        }
        if (read !== undefined) {
            notifs = notifs.filter(n => String(n.read || "false").toLowerCase() === String(read).toLowerCase());
        }

        // Sort latest first
        notifs.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

        return res.status(200).json({
            success: true,
            total: notifs.length,
            notifications: notifs
        });
    } catch (error) {
        console.error("Get notifications error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// POST /api/notifications
const createNotification = async (req, res) => {
    try {
        const { type, title, text, roll, audience } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, message: "Notification text is required." });
        }

        const notifs = await readCSV(notifCsv);
        const nextId = String(notifs.reduce((max, n) => Math.max(max, parseInt(n.id || 0)), 0) + 1);

        const newNotif = {
            id: nextId,
            type: type || "info",
            title: title || "",
            text: text,
            time: new Date().toISOString(),
            read: "false",
            roll: roll || "",
            audience: audience || "all"
        };

        notifs.unshift(newNotif);
        await writeCSV(notifCsv, notificationHeaders, notifs);

        return res.status(201).json({
            success: true,
            message: "Notification created successfully.",
            notification: newNotif
        });
    } catch (error) {
        console.error("Create notification error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// PATCH /api/notifications/:id/read
const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notifs = await readCSV(notifCsv);
        const idx = notifs.findIndex(n => String(n.id) === String(id));

        if (idx !== -1) {
            notifs[idx].read = "true";
            await writeCSV(notifCsv, notificationHeaders, notifs);
        }

        return res.status(200).json({
            success: true,
            message: "Notification marked as read."
        });
    } catch (error) {
        console.error("Mark notification read error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// PATCH /api/notifications/read-all
const markAllAsRead = async (req, res) => {
    try {
        const { audience, roll } = req.body;
        let notifs = await readCSV(notifCsv);

        notifs = notifs.map(n => {
            if (audience && String(n.audience).toLowerCase() !== audience.toLowerCase()) return n;
            if (roll && String(n.roll).toLowerCase() !== roll.toLowerCase()) return n;
            return { ...n, read: "true" };
        });

        await writeCSV(notifCsv, notificationHeaders, notifs);

        return res.status(200).json({
            success: true,
            message: "All notifications marked as read."
        });
    } catch (error) {
        console.error("Mark all read error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    getNotifications,
    createNotification,
    markAsRead,
    markAllAsRead
};
