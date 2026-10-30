const {
    sendOutpassApprovalEmail
} = require("../services/emailService");
const path = require("path");
const fs = require("fs");
const { readCSV, writeCSV } = require("../services/csvService");
const { outpassHeaders, notificationHeaders } = require("../services/dbInit");
// NEW — Gatekeeper QR workflow: builds/signs the QR payload for approved requests.
const { buildQrPayload, generateQrDataUrl } = require("../services/qrService");
const qrTokenStore = require("../services/qrTokenStore");

const outpassCsv = path.join(__dirname, "../database/outpass_requests.csv");
const notifCsv = path.join(__dirname, "../database/notifications.csv");
const studentsCsv = path.join(__dirname, "../database/students.csv");

// Helper to push notification to CSV
async function addNotification(type, title, text, roll, audience) {
    try {
        const notifs = await readCSV(notifCsv);
        const nextId = String(notifs.reduce((max, n) => Math.max(max, parseInt(n.id || 0)), 0) + 1);
        const newNotif = {
            id: nextId,
            type: type || "info",
            title: title || "",
            text: text || "",
            time: new Date().toISOString(),
            read: "false",
            roll: roll || "",
            audience: audience || "warden"
        };
        notifs.unshift(newNotif);
        await writeCSV(notifCsv, notificationHeaders, notifs);
    } catch (e) {
        console.warn("Could not write notification:", e.message);
    }
}

// POST /api/outpass - Apply Outpass
const applyOutpass = async (req, res) => {
    try {
        const {
            student_id,
            admission_no,
            roll_no,
            name,
            room_no,
            out_date,
            out_time,
            return_time,
            purpose,
            reason
        } = req.body;

        const studentId = student_id || roll_no || admission_no || "";
        const purposeText = purpose || reason || "";

        if (!studentId || !purposeText || !return_time) {
            return res.status(400).json({
                success: false,
                message: "Student ID, Expected Return Time, and Purpose are required."
            });
        }

        const outpasses = await readCSV(outpassCsv);

        // Check if pending request exists
        const pending = outpasses.find(o =>
            String(o.student_id || o.roll_no || "").trim().toLowerCase() === studentId.trim().toLowerCase() &&
            String(o.status || "").toLowerCase() === "pending"
        );

        if (pending) {
            return res.status(400).json({
                success: false,
                message: "You already have a pending outpass request awaiting warden review."
            });
        }

        // Auto-fetch student name and room if not supplied
        let studentName = name || "";
        let studentRoom = room_no || "";
        let studentRoll = roll_no || studentId;

        if (!studentName || !studentRoom) {
            const students = await readCSV(studentsCsv);
            const stu = students.find(s =>
                String(s.admission_no || "").trim().toLowerCase() === studentId.trim().toLowerCase() ||
                String(s.roll_no || "").trim().toLowerCase() === studentId.trim().toLowerCase()
            );
            if (stu) {
                studentName = studentName || stu.full_name;
                studentRoom = studentRoom || stu.room_no || "Not Allocated";
                studentRoll = stu.roll_no || stu.admission_no;
            }
        }

        const proofFile = req.file?.filename || req.body.proof || "";
        const nextId = String(outpasses.reduce((max, o) => Math.max(max, parseInt(o.id || 0)), 0) + 1);

        const newOutpass = {
            id: nextId,
            student_id: studentId,
            name: studentName,
            roll_no: studentRoll,
            room_no: studentRoom,
            out_date: out_date || new Date().toISOString().split("T")[0],
            out_time: out_time || new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
            return_time: return_time,
            purpose: purposeText,
            proof: proofFile,
            status: "Pending",
            token_no: "",
            rejection_reason: "",
            approved_by: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        outpasses.unshift(newOutpass);
        await writeCSV(outpassCsv, outpassHeaders, outpasses);

        // Send notifications
        await addNotification(
            "info",
            "New Outpass Request Received",
            `${studentName} (${studentRoll}) requested outpass until ${return_time}. Purpose: ${purposeText}`,
            studentRoll,
            "warden"
        );

        await addNotification(
            "info",
            "Outpass Submitted",
            "Your outpass request has been submitted and is awaiting warden approval.",
            studentRoll,
            "student"
        );

        return res.status(201).json({
            success: true,
            message: "Outpass application submitted successfully.",
            outpass: newOutpass
        });

    } catch (error) {
        console.error("Apply outpass error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/outpass - Get all outpasses (supports ?status=Pending, etc.)
const getAllOutpasses = async (req, res) => {
    try {
        const { status, student_id, q } = req.query;
        let outpasses = await readCSV(outpassCsv);

        if (status) {
            outpasses = outpasses.filter(o => String(o.status || "").toLowerCase() === status.toLowerCase());
        }
        if (student_id) {
            const sid = student_id.toLowerCase();
            outpasses = outpasses.filter(o =>
                String(o.student_id || "").toLowerCase() === sid ||
                String(o.roll_no || "").toLowerCase() === sid
            );
        }
        if (q) {
            const query = q.toLowerCase();
            outpasses = outpasses.filter(o =>
                String(o.name || "").toLowerCase().includes(query) ||
                String(o.roll_no || "").toLowerCase().includes(query) ||
                String(o.purpose || "").toLowerCase().includes(query)
            );
        }

        return res.status(200).json({
            success: true,
            total: outpasses.length,
            outpasses: outpasses
        });
    } catch (error) {
        console.error("Get all outpasses error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/outpass/pending - Get pending outpass requests
const getPendingOutpasses = async (req, res) => {
    try {
        const outpasses = await readCSV(outpassCsv);
        const pending = outpasses.filter(o => String(o.status || "").toLowerCase() === "pending");

        return res.status(200).json({
            success: true,
            total: pending.length,
            outpasses: pending
        });
    } catch (error) {
        console.error("Get pending outpasses error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/outpass/student/:id - Get outpass history for student
const getStudentOutpasses = async (req, res) => {
    try {
        const { id } = req.params;
        const targetId = String(id || "").trim().toLowerCase();
        const outpasses = await readCSV(outpassCsv);

        const studentOutpasses = outpasses.filter(o =>
            String(o.student_id || "").trim().toLowerCase() === targetId ||
            String(o.roll_no || "").trim().toLowerCase() === targetId
        );

        return res.status(200).json({
            success: true,
            total: studentOutpasses.length,
            outpasses: studentOutpasses
        });
    } catch (error) {
        console.error("Get student outpasses error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// PATCH /api/outpass/:id - Approve / Reject Outpass
const updateOutpassStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejection_reason, reason, approved_by } = req.body;

        if (!status) {
            return res.status(400).json({ success: false, message: "Status is required (Approved / Rejected)." });
        }

        const outpasses = await readCSV(outpassCsv);
        const idx = outpasses.findIndex(o => String(o.id || "") === String(id));

        if (idx === -1) {
            return res.status(404).json({ success: false, message: "Outpass request not found." });
        }

        const normStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        outpasses[idx].status = normStatus;
        outpasses[idx].approved_by = approved_by || "Warden";
        outpasses[idx].updated_at = new Date().toISOString();

        if (normStatus === "Approved") {

    const dateStr =
        new Date()
            .toISOString()
            .slice(2, 10)
            .replace(/-/g, "");

    const randomCode =
        Math.floor(100 + Math.random() * 900);

    outpasses[idx].token_no =
        `OTP-${dateStr}-${randomCode}`;

    outpasses[idx].rejection_reason = "";


    // STUDENT NOTIFICATION

    await addNotification(
        "success",
        "Outpass Approved",
        `Your Outpass Request has been approved by the Warden. Token: ${outpasses[idx].token_no}`,
        outpasses[idx].roll_no ||
        outpasses[idx].student_id,
        "student"
    );


    // SEND EMAIL TO STUDENT

    try {

        const students =
            await readCSV(studentsCsv);

        const student =
            students.find(s =>
                String(
                    s.admission_no || ""
                ).trim().toLowerCase() ===
                String(
                    outpasses[idx].student_id || ""
                ).trim().toLowerCase()
                ||
                String(
                    s.roll_no || ""
                ).trim().toLowerCase() ===
                String(
                    outpasses[idx].roll_no || ""
                ).trim().toLowerCase()
            );


        if (student && student.email) {

            // NEW — Gatekeeper QR workflow: build a signed QR payload
            // (request type + id + the existing token_no only, no
            // personal data) and render it as an image for the email.
            let qrDataUrl = null;
            try {
                const qrPayload = buildQrPayload({
                    requestType: "outpass",
                    requestId: outpasses[idx].id,
                    tokenNo: outpasses[idx].token_no
                });
                qrDataUrl = await generateQrDataUrl(qrPayload);
                // Register the approval QR as a single-use EXIT authorization.
                try {
                    const issuedExit = await qrTokenStore.issueExitToken({
                        requestType: "outpass",
                        requestId: outpasses[idx].id,
                        studentId: student.admission_no,
                        rollNo: student.roll_no,
                        tokenNo: outpasses[idx].token_no
                    });
                    qrDataUrl = issuedExit.qrDataUrl;
                } catch (ledgerError) {
                    console.error("Could not register single-use exit QR:", ledgerError.message);
                }
            } catch (qrError) {
                console.error("Could not generate outpass QR code:", qrError.message);
            }

            // Fire-and-forget: the outpass is already approved and saved
            // above. Waiting on email delivery here made the warden's
            // Approve button appear to hang (or fail outright behind a
            // reverse-proxy timeout) whenever the mail server was slow
            // or unreachable. The response below no longer waits on this.
            sendOutpassApprovalEmail(
                student,
                outpasses[idx],
                qrDataUrl
            ).then(() => {
                console.log(
                    `Outpass approval email sent to ${student.email}`
                );
            }).catch((emailError) => {
                console.error(
                    "Could not send outpass approval email:",
                    emailError.message
                );
            });

        } else {

            console.warn(
                "Student email not found. Outpass email was not sent."
            );

        }

    } catch (emailError) {

        console.error(
            "Could not send outpass approval email:",
            emailError.message
        );

    }

} else if (normStatus === "Rejected") {
            outpasses[idx].rejection_reason = rejection_reason || reason || "Rejected by Warden";
            outpasses[idx].token_no = "";

            await addNotification(
                "alert",
                "Outpass Rejected",
                `Your Outpass Request was rejected: ${outpasses[idx].rejection_reason}`,
                outpasses[idx].roll_no || outpasses[idx].student_id,
                "student"
            );
        }

        await writeCSV(outpassCsv, outpassHeaders, outpasses);

        return res.status(200).json({
            success: true,
            message: `Outpass request ${normStatus.toLowerCase()} successfully.`,
            outpass: outpasses[idx]
        });

    } catch (error) {
        console.error("Update outpass status error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    applyOutpass,
    getAllOutpasses,
    getPendingOutpasses,
    getStudentOutpasses,
    updateOutpassStatus
};
