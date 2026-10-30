const nodemailer = require("nodemailer");

// ============================================================
// Gmail Transporter
// ============================================================

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    // Without these, a broken/unreachable mail server (wrong
    // credentials, no network route to Gmail, etc.) makes every
    // send*Email() call below hang for minutes on the OS default
    // socket timeout — which, since approvals await these calls,
    // made warden/admin approve-reject buttons look completely dead.
    // Fail fast instead so the surrounding try/catch can handle it.
    connectionTimeout: 10000, // 10s to establish the connection
    greetingTimeout: 10000,   // 10s to receive the server greeting
    socketTimeout: 15000      // 15s of socket inactivity
});


// ============================================================
// Send Student Registration Approval Email
// ============================================================

const sendStudentApprovalEmail = async (student) => {

    const mailOptions = {
        from: `"Hostel Management ERP" <${process.env.EMAIL_USER}>`,
        to: student.email,
        subject: "Hostel Registration Approved",

        html: `
            <h2>Hostel Registration Approved</h2>

            <p>Dear ${student.full_name},</p>

            <p>
                Your hostel registration has been approved successfully.
            </p>

            <p>
                <strong>Admission Number:</strong>
                ${student.admission_no}
            </p>

            <p>
                <strong>Roll Number:</strong>
                ${student.roll_no}
            </p>

            <p>
                <strong>Hostel Block:</strong>
                ${student.room_block || "Not Available"}
            </p>

            <p>
                <strong>Floor:</strong>
                ${student.room_floor || "Not Available"}
            </p>

            <p>
                <strong>Room Number:</strong>
                ${student.room_no || "Not Allocated"}
            </p>

            ${student.room_bed ? `<p><strong>Bed Number:</strong> ${student.room_bed}</p>` : ""}

            <p>
                You can now login to the Hostel Management ERP
                using your Admission Number or Roll Number.
            </p>

            <br>

            <p>Regards,</p>

            <p>
                <strong>Hostel Management Team</strong>
            </p>
        `
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(
        "Registration approval email sent:",
        info.messageId
    );

    return info;
};


// ============================================================
// Send Outpass Approval Email
// ============================================================

const sendOutpassApprovalEmail = async (
    student,
    outpass,
    qrDataUrl = null
) => {

    // --------------------------------------------------------
    // QR SECTION
    // --------------------------------------------------------

    const qrSection = qrDataUrl ? `
        <hr>

        <h3 style="color:#0B3D91;">
            Present this QR code at the hostel gate
        </h3>

        <p>
            Show this QR code to the Gatekeeper when you exit.
            This approval QR can be used only once. After you are marked OUT,
            the Gatekeeper will generate a separate single-use return QR for entry.
        </p>

        <p>
            Keep this QR safe and do not share it with anyone.
        </p>

        <div style="
            text-align:center;
            margin:25px 0;
        ">

            <img
                src="cid:outpassqr-${outpass.id}@hostelerp"
                alt="Outpass QR Code"
                width="220"
                height="220"
                style="
                    display:block;
                    margin:auto;
                    border:1px solid #ddd;
                    padding:8px;
                    border-radius:8px;
                    background:#ffffff;
                "
            >

        </div>
    ` : "";


    // --------------------------------------------------------
    // EMAIL
    // --------------------------------------------------------

    const mailOptions = {

        from: `"Hostel Management ERP" <${process.env.EMAIL_USER}>`,

        to: student.email,

        subject: "Hostel Outpass Approved",

        html: `
            <div style="
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color:#222;
                max-width:600px;
                margin:auto;
            ">

                <h2 style="color:#0B3D91;">
                    Hostel Management ERP
                </h2>

                <h3 style="
                    color:#0B3D91;
                    margin-top:0;
                ">
                    Leave/Outpass Approved
                </h3>

                <p>
                    Dear ${student.full_name},
                </p>

                <p>
                    Your outpass request has been
                    <strong style="color:green;">
                        approved
                    </strong>
                    by the Warden.
                </p>

                <hr>

                <h3>
                    Outpass Details
                </h3>

                <p>
                    <strong>Student Name:</strong>
                    ${student.full_name}
                </p>

                <p>
                    <strong>Admission/Student Number:</strong>
                    ${student.admission_no}
                </p>

                <p>
                    <strong>Roll Number:</strong>
                    ${student.roll_no}
                </p>

                <p>
                    <strong>Room Number:</strong>
                    ${outpass.room_no ||
            student.room_no ||
            "Not Allocated"}
                </p>

                <p>
                    <strong>Department:</strong>
                    ${student.department || ""}
                </p>

                <p>
                    <strong>Out Date:</strong>
                    ${outpass.out_date || ""}
                </p>

                <p>
                    <strong>Out Time:</strong>
                    ${outpass.out_time || ""}
                </p>

                <p>
                    <strong>Expected Return Time:</strong>
                    ${outpass.return_time || ""}
                </p>

                <p>
                    <strong>Purpose:</strong>
                    ${outpass.purpose || ""}
                </p>

                <p>
                    <strong>Outpass Token:</strong>
                    ${outpass.token_no || ""}
                </p>

                ${qrSection}

                <hr>

                <p>
                    Please return to the hostel before the
                    permitted return time.
                </p>

                <p>
                    Regards,<br>
                    <strong>Hostel Management Team</strong>
                </p>

            </div>
        `,

        // ----------------------------------------------------
        // INLINE QR ATTACHMENT
        // ----------------------------------------------------

        attachments: qrDataUrl ? [
            {
                filename: "outpass-qr.png",

                content: Buffer.from(
                    qrDataUrl.split(",")[1],
                    "base64"
                ),

                contentType: "image/png",

                contentDisposition: "inline",

                cid: `outpassqr-${outpass.id}@hostelerp`
            }
        ] : []
    };


    const info = await transporter.sendMail(mailOptions);

    console.log(
        "Outpass approval email sent:",
        info.messageId
    );

    return info;
};


// ============================================================
// Send Leave Approval Email
// ============================================================

const sendLeaveApprovalEmail = async (
    student,
    leave,
    qrDataUrl = null
) => {
    console.log("QR received:", !!qrDataUrl);
    console.log(
        "QR prefix:",
        qrDataUrl ? qrDataUrl.substring(0, 50) : "NULL"
    );
    console.log(
        "QR length:",
        qrDataUrl ? qrDataUrl.length : 0
    );


    // --------------------------------------------------------
    // Calculate Leave Duration
    // --------------------------------------------------------

    let durationDays = "";

    try {

        if (
            leave.from_date &&
            leave.to_date
        ) {

            const ms =
                new Date(leave.to_date) -
                new Date(leave.from_date);

            const days =
                Math.round(
                    ms / (1000 * 60 * 60 * 24)
                ) + 1;

            if (
                !isNaN(days) &&
                days > 0
            ) {

                durationDays =
                    `${days} day${days > 1 ? "s" : ""}`;
            }
        }

    } catch (e) {

        // Leave duration remains blank
    }


    // --------------------------------------------------------
    // QR SECTION
    // --------------------------------------------------------

    const qrSection = qrDataUrl ? `
        <hr>

        <h3 style="color:#0B3D91;">
            Present this QR code at the hostel gate
        </h3>

        <p>
            Show this QR code to the Gatekeeper when you exit.
            This approval QR can be used only once. After you are marked OUT,
            the Gatekeeper will generate a separate single-use return QR for entry.
        </p>

        <p>
            Keep this QR safe and do not share it with anyone.
        </p>

        <div style="
            text-align:center;
            margin:25px 0;
        ">

            <img
                src="cid:leaveqr-${leave.id}@hostelerp"
                alt="Leave QR Code"
                width="220"
                height="220"
                style="
                    display:block;
                    margin:auto;
                    border:1px solid #ddd;
                    padding:8px;
                    border-radius:8px;
                    background:#ffffff;
                "
            >

        </div>
    ` : "";


    // --------------------------------------------------------
    // EMAIL
    // --------------------------------------------------------

    const mailOptions = {

        from: `"Hostel Management ERP" <${process.env.EMAIL_USER}>`,

        to: student.email,

        subject: "Hostel Leave Approved",

        html: `
            <div style="
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color:#222;
                max-width:600px;
                margin:auto;
            ">

                <h2 style="color:#0B3D91;">
                    Hostel Management ERP
                </h2>

                <h3 style="
                    color:#0B3D91;
                    margin-top:0;
                ">
                    Leave/Outpass Approved
                </h3>

                <p>
                    Dear ${student.full_name},
                </p>

                <p>
                    Your leave request has been
                    <strong style="color:green;">
                        approved
                    </strong>
                    by the Warden.
                </p>

                <hr>

                <h3>
                    Leave Details
                </h3>

                <p>
                    <strong>Student Name:</strong>
                    ${student.full_name}
                </p>

                <p>
                    <strong>Admission/Student Number:</strong>
                    ${student.admission_no}
                </p>

                <p>
                    <strong>Roll Number:</strong>
                    ${student.roll_no}
                </p>

                <p>
                    <strong>Room Number:</strong>
                    ${leave.room_no ||
            student.room_no ||
            "Not Allocated"}
                </p>

                <p>
                    <strong>Department:</strong>
                    ${student.department || ""}
                </p>

                <p>
                    <strong>Leave Start Date:</strong>
                    ${leave.from_date || ""}
                </p>

                <p>
                    <strong>Leave End Date:</strong>
                    ${leave.to_date || ""}
                </p>

                <p>
                    <strong>Leave Duration:</strong>
                    ${durationDays || "—"}
                </p>

                <p>
                    <strong>Reason:</strong>
                    ${leave.reason || ""}
                </p>

                <p>
                    <strong>Leave Token:</strong>
                    ${leave.token_no || ""}
                </p>

                ${qrSection}

                <hr>

                <p>
                    Please ensure that you return to the hostel
                    according to the approved leave period.
                </p>

                <p>
                    Regards,<br>
                    <strong>Hostel Management Team</strong>
                </p>

            </div>
        `,

        // ----------------------------------------------------
        // INLINE QR ATTACHMENT
        // ----------------------------------------------------
        attachments: qrDataUrl ? [
            {
                filename: "leave-qr.png",

                content: Buffer.from(
                    qrDataUrl.split(",")[1],
                    "base64"
                ),

                contentType: "image/png",

                contentDisposition: "inline",

                cid: `leaveqr-${leave.id}@hostelerp`
            }
        ] : []
    };


    const info = await transporter.sendMail(mailOptions);

    console.log(
        "Leave approval email sent:",
        info.messageId
    );

    return info;
};


// ============================================================
// Send Leave Rejection Email
// ============================================================

const sendLeaveRejectionEmail = async (
    student,
    leave
) => {

    const mailOptions = {

        from: `"Hostel Management ERP" <${process.env.EMAIL_USER}>`,

        to: student.email,

        subject: "Hostel Leave Request Rejected",

        html: `
            <div style="
                font-family: Arial, sans-serif;
                line-height: 1.6;
            ">

                <h2 style="color:#dc2626;">
                    Hostel Leave Request Rejected
                </h2>

                <p>
                    Dear ${student.full_name},
                </p>

                <p>
                    Your leave request has been
                    <strong style="color:red;">
                        rejected
                    </strong>
                    by the Warden.
                </p>

                <hr>

                <h3>
                    Leave Details
                </h3>

                <p>
                    <strong>Admission Number:</strong>
                    ${student.admission_no}
                </p>

                <p>
                    <strong>Roll Number:</strong>
                    ${student.roll_no}
                </p>

                <p>
                    <strong>From Date:</strong>
                    ${leave.from_date || ""}
                </p>

                <p>
                    <strong>To Date:</strong>
                    ${leave.to_date || ""}
                </p>

                <p>
                    <strong>Reason:</strong>
                    ${leave.reason || ""}
                </p>

                <p>
                    <strong>Rejection Reason:</strong>
                    ${leave.rejection_reason ||
            "Not specified"}
                </p>

                <hr>

                <p>
                    Please contact the Hostel Office if you need
                    further clarification.
                </p>

                <p>
                    Regards,<br>
                    <strong>Hostel Management Team</strong>
                </p>

            </div>
        `
    };


    const info =
        await transporter.sendMail(mailOptions);

    console.log(
        "Leave rejection email sent:",
        info.messageId
    );

    return info;
};


// ============================================================
// Send Password Reset Email (Student & Warden)
// ============================================================

const sendPasswordResetEmail = async ({
    name,
    email,
    resetLink,
    role = "Student",
    expiresInMinutes = 30
}) => {
    const roleTitle = role.charAt(0).toUpperCase() + role.slice(1);

    const mailOptions = {
        from: `"Hostel Management ERP" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Password Reset Request - Hostel Management ERP (${roleTitle})`,
        html: `
            <div style="
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #222;
                max-width: 600px;
                margin: auto;
                padding: 24px;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                background: #ffffff;
            ">
                <div style="border-bottom: 2px solid #0B3D91; padding-bottom: 12px; margin-bottom: 20px;">
                    <h2 style="color: #0B3D91; margin: 0;">Hostel Management ERP</h2>
                    <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Password Reset Assistance</p>
                </div>

                <p>Dear <strong>${name || roleTitle}</strong>,</p>

                <p>We received a request to reset the password for your <strong>${roleTitle}</strong> account associated with this email address.</p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" style="
                        background-color: #0B3D91;
                        color: #ffffff;
                        padding: 12px 28px;
                        font-size: 15px;
                        font-weight: bold;
                        text-decoration: none;
                        border-radius: 6px;
                        display: inline-block;
                        box-shadow: 0 4px 6px rgba(11, 61, 145, 0.2);
                    " target="_blank">Reset My Password</a>
                </div>

                <p style="font-size: 13px; color: #475569;">
                    If the button above does not work, copy and paste the following link into your browser:
                </p>
                <p style="font-size: 12px; word-break: break-all; background: #f8fafc; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <a href="${resetLink}" style="color: #0B3D91;">${resetLink}</a>
                </p>

                <p style="font-size: 13px; color: #dc2626;">
                    <strong>Note:</strong> This password reset link is valid for ${expiresInMinutes} minutes and can only be used once.
                </p>

                <p style="font-size: 13px; color: #64748b;">
                    If you did not request this password reset, please ignore this email or notify the Hostel Administration Office immediately. Your password will remain unchanged.
                </p>

                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">

                <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                    Regards,<br>
                    <strong>Hostel Management Team</strong><br>
                    Agurchand Manmull Jain College
                </p>
            </div>
        `
    };

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn("\n⚠️  [EMAIL SERVICE NOTE] EMAIL_USER / EMAIL_PASS not configured in backend/.env.");
        console.warn(`📩  Simulated Password Reset Email for ${email}:`);
        console.warn(`🔗  Reset Link: ${resetLink}\n`);
        return { messageId: "simulated-dev-id", simulated: true };
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${email}:`, info.messageId);
    return info;
};


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    sendStudentApprovalEmail,

    sendOutpassApprovalEmail,

    sendLeaveApprovalEmail,

    sendLeaveRejectionEmail,

    sendPasswordResetEmail

};