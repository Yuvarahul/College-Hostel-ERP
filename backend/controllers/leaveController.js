const {
    sendLeaveApprovalEmail,
    sendLeaveRejectionEmail
} = require("../services/emailService");
const path = require("path");
const fs = require("fs");
const { readCSV, writeCSV } = require("../services/csvService");
const { leaveHeaders, notificationHeaders } = require("../services/dbInit");
// NEW — Gatekeeper QR workflow: builds/signs the QR payload for approved requests.
const { buildQrPayload, generateQrDataUrl } = require("../services/qrService");
const qrTokenStore = require("../services/qrTokenStore");

const leaveCsv = path.join(__dirname, "../database/leave_requests.csv");
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

// POST /api/leave - Apply Leave
const applyLeave = async (req, res) => {
    try {
        const {
            student_id,
            admission_no,
            roll_no,
            name,
            room_no,
            from_date,
            to_date,
            reason
        } = req.body;

        const studentId = student_id || roll_no || admission_no || "";

        if (!studentId || !reason || !to_date) {
            return res.status(400).json({
                success: false,
                message: "Student ID, To Date, and Reason are required."
            });
        }

        const leaves = await readCSV(leaveCsv);

        // Check if pending request exists
        const pending = leaves.find(l =>
            String(l.student_id || l.roll_no || "").trim().toLowerCase() === studentId.trim().toLowerCase() &&
            String(l.status || "").toLowerCase() === "pending"
        );

        if (pending) {
            return res.status(400).json({
                success: false,
                message: "You already have a pending leave request awaiting warden review."
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
        const nextId = String(leaves.reduce((max, l) => Math.max(max, parseInt(l.id || 0)), 0) + 1);

        const newLeave = {
            id: nextId,
            student_id: studentId,
            name: studentName,
            roll_no: studentRoll,
            room_no: studentRoom,
            from_date: from_date || new Date().toISOString().split("T")[0],
            to_date: to_date,
            reason: reason,
            proof: proofFile,
            status: "Pending",
            token_no: "",
            rejection_reason: "",
            approved_by: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        leaves.unshift(newLeave);
        await writeCSV(leaveCsv, leaveHeaders, leaves);

        // Send notifications
        await addNotification(
            "info",
            "New Leave Request Received",
            `${studentName} (${studentRoll}) applied for leave until ${to_date}. Reason: ${reason}`,
            studentRoll,
            "warden"
        );

        await addNotification(
            "info",
            "Leave Submitted",
            "Your leave request has been submitted and is awaiting warden approval.",
            studentRoll,
            "student"
        );

        return res.status(201).json({
            success: true,
            message: "Leave application submitted successfully.",
            leave: newLeave
        });

    } catch (error) {
        console.error("Apply leave error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/leave - Get all leaves (supports ?status=Pending, etc.)
const getAllLeaves = async (req, res) => {
    try {
        const { status, student_id, q } = req.query;
        let leaves = await readCSV(leaveCsv);

        if (status) {
            leaves = leaves.filter(l => String(l.status || "").toLowerCase() === status.toLowerCase());
        }
        if (student_id) {
            const sid = student_id.toLowerCase();
            leaves = leaves.filter(l =>
                String(l.student_id || "").toLowerCase() === sid ||
                String(l.roll_no || "").toLowerCase() === sid
            );
        }
        if (q) {
            const query = q.toLowerCase();
            leaves = leaves.filter(l =>
                String(l.name || "").toLowerCase().includes(query) ||
                String(l.roll_no || "").toLowerCase().includes(query) ||
                String(l.reason || "").toLowerCase().includes(query)
            );
        }

        return res.status(200).json({
            success: true,
            total: leaves.length,
            leaves: leaves
        });
    } catch (error) {
        console.error("Get all leaves error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/leave/pending - Get pending leave requests
const getPendingLeaves = async (req, res) => {
    try {
        const leaves = await readCSV(leaveCsv);
        const pending = leaves.filter(l => String(l.status || "").toLowerCase() === "pending");

        return res.status(200).json({
            success: true,
            total: pending.length,
            leaves: pending
        });
    } catch (error) {
        console.error("Get pending leaves error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/leave/student/:id - Get leave history for student
const getStudentLeaves = async (req, res) => {
    try {
        const { id } = req.params;
        const targetId = String(id || "").trim().toLowerCase();
        const leaves = await readCSV(leaveCsv);

        const studentLeaves = leaves.filter(l =>
            String(l.student_id || "").trim().toLowerCase() === targetId ||
            String(l.roll_no || "").trim().toLowerCase() === targetId
        );

        return res.status(200).json({
            success: true,
            total: studentLeaves.length,
            leaves: studentLeaves
        });
    } catch (error) {
        console.error("Get student leaves error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// PATCH /api/leave/:id - Approve / Reject Leave
// PATCH /api/leave/:id - Approve / Reject Leave
const updateLeaveStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejection_reason, reason, approved_by } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required (Approved / Rejected)."
            });
        }

        const leaves = await readCSV(leaveCsv);

        const idx = leaves.findIndex(
            l => String(l.id || "") === String(id)
        );

        if (idx === -1) {
            return res.status(404).json({
                success: false,
                message: "Leave request not found."
            });
        }

        const normStatus =
            status.charAt(0).toUpperCase() +
            status.slice(1).toLowerCase();

        leaves[idx].status = normStatus;
        leaves[idx].approved_by = approved_by || "Warden";
        leaves[idx].updated_at = new Date().toISOString();


        // =====================================================
        // APPROVED
        // =====================================================

        if (normStatus === "Approved") {

            const dateStr =
                new Date()
                    .toISOString()
                    .slice(2, 10)
                    .replace(/-/g, "");

            const randomCode =
                Math.floor(100 + Math.random() * 900);

            leaves[idx].token_no =
                `LEV-${dateStr}-${randomCode}`;

            leaves[idx].rejection_reason = "";


            // -------------------------------------------------
            // STUDENT NOTIFICATION
            // -------------------------------------------------

            await addNotification(
                "success",
                "Leave Approved",
                `Your Leave Request has been approved by the Warden. Token: ${leaves[idx].token_no}`,
                leaves[idx].roll_no || leaves[idx].student_id,
                "student"
            );


            // -------------------------------------------------
            // SEND APPROVAL EMAIL
            // -------------------------------------------------

            try {

                const students =
                    await readCSV(studentsCsv);

                const student =
                    students.find(s =>
                        String(
                            s.admission_no || ""
                        ).trim().toLowerCase() ===
                        String(
                            leaves[idx].student_id || ""
                        ).trim().toLowerCase()

                        ||

                        String(
                            s.roll_no || ""
                        ).trim().toLowerCase() ===
                        String(
                            leaves[idx].roll_no || ""
                        ).trim().toLowerCase()
                    );


                if (student && student.email) {

                    // NEW — Gatekeeper QR workflow: build a signed QR
                    // payload (request type + id + the existing token_no
                    // only, no personal data) and render it for the email.
                    let qrDataUrl = null;
                    try {
                        const qrPayload = buildQrPayload({
                            requestType: "leave",
                            requestId: leaves[idx].id,
                            tokenNo: leaves[idx].token_no
                        });
                        qrDataUrl = await generateQrDataUrl(qrPayload);
                // Register the approval QR as a single-use EXIT authorization.
                try {
                    const issuedExit = await qrTokenStore.issueExitToken({
                        requestType: "leave",
                        requestId: leaves[idx].id,
                        studentId: student.admission_no,
                        rollNo: student.roll_no,
                        tokenNo: leaves[idx].token_no
                    });
                    qrDataUrl = issuedExit.qrDataUrl;
                } catch (ledgerError) {
                    console.error("Could not register single-use exit QR:", ledgerError.message);
                }
                    } catch (qrError) {
                        console.error("Could not generate leave QR code:", qrError.message);
                    }

                    // Fire-and-forget: the leave is already approved and
                    // saved above. Waiting on email delivery here made the
                    // warden's Approve button appear to hang whenever the
                    // mail server was slow or unreachable.
                    sendLeaveApprovalEmail(
                        student,
                        leaves[idx],
                        qrDataUrl
                    ).then(() => {
                        console.log(
                            `Leave approval email sent to ${student.email}`
                        );
                    }).catch((emailError) => {
                        console.error(
                            "Could not send leave approval email:",
                            emailError.message
                        );
                    });

                } else {

                    console.warn(
                        "Student email not found. Leave approval email was not sent."
                    );

                }

            } catch (emailError) {

                // Email failure should NOT cancel approval

                console.error(
                    "Could not send leave approval email:",
                    emailError.message
                );

            }


        // =====================================================
        // REJECTED
        // =====================================================

        } else if (normStatus === "Rejected") {

            leaves[idx].rejection_reason =
                rejection_reason ||
                reason ||
                "Rejected by Warden";

            leaves[idx].token_no = "";


            // -------------------------------------------------
            // STUDENT NOTIFICATION
            // -------------------------------------------------

            await addNotification(
                "alert",
                "Leave Rejected",
                `Your Leave Request was rejected: ${leaves[idx].rejection_reason}`,
                leaves[idx].roll_no || leaves[idx].student_id,
                "student"
            );


            // -------------------------------------------------
            // SEND REJECTION EMAIL
            // -------------------------------------------------

            try {

                const students =
                    await readCSV(studentsCsv);

                const student =
                    students.find(s =>
                        String(
                            s.admission_no || ""
                        ).trim().toLowerCase() ===
                        String(
                            leaves[idx].student_id || ""
                        ).trim().toLowerCase()

                        ||

                        String(
                            s.roll_no || ""
                        ).trim().toLowerCase() ===
                        String(
                            leaves[idx].roll_no || ""
                        ).trim().toLowerCase()
                    );


                if (student && student.email) {

                    // Fire-and-forget: the rejection is already saved
                    // above, so the warden's Reject button shouldn't
                    // wait on the mail server to respond.
                    sendLeaveRejectionEmail(
                        student,
                        leaves[idx]
                    ).then(() => {
                        console.log(
                            `Leave rejection email sent to ${student.email}`
                        );
                    }).catch((emailError) => {
                        console.error(
                            "Could not send leave rejection email:",
                            emailError.message
                        );
                    });

                } else {

                    console.warn(
                        "Student email not found. Leave rejection email was not sent."
                    );

                }

            } catch (emailError) {

                // Email failure should NOT cancel rejection

                console.error(
                    "Could not send leave rejection email:",
                    emailError.message
                );

            }
        }


        // =====================================================
        // SAVE UPDATED LEAVE
        // =====================================================

        await writeCSV(
            leaveCsv,
            leaveHeaders,
            leaves
        );


        return res.status(200).json({
            success: true,
            message:
                `Leave request ${normStatus.toLowerCase()} successfully.`,
            leave: leaves[idx]
        });


    } catch (error) {

        console.error(
            "Update leave status error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

module.exports = {
    applyLeave,
    getAllLeaves,
    getPendingLeaves,
    getStudentLeaves,
    updateLeaveStatus
};
