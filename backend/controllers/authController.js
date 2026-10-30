const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { readCSV, writeCSV } = require("../services/csvService");
const { sendPasswordResetEmail } = require("../services/emailService");
const fs = require("fs");

const studentsCsv = path.join(__dirname, "../database/students.csv");
const registrationsCsv = path.join(__dirname, "../database/registrations.csv");
const wardenCsv = path.join(__dirname, "../database/warden.csv");
const adminCsv = path.join(__dirname, "../database/admin.csv");
const { checkStaticAdmin, staticAdminRecord, isStaticAdminId } = require("../config/adminCredentials");
const gatekeeperCsv = path.join(__dirname, "../database/gatekeeper.csv");
const auditCsv = path.join(__dirname, "../database/audit_logs.csv");
const passwordResetsJson = path.join(__dirname, "../database/password_resets.json");

const studentHeaders = [
    { id: "admission_no", title: "admission_no" },
    { id: "roll_no", title: "roll_no" },
    { id: "full_name", title: "full_name" },
    { id: "email", title: "email" },
    { id: "phone_no", title: "phone_no" },
    { id: "department", title: "department" },
    { id: "year", title: "year" },
    { id: "parents_phone", title: "parents_phone" },
    { id: "password", title: "password" },
    { id: "address", title: "address" },
    { id: "id_proof", title: "id_proof" },
    { id: "passport_photo", title: "passport_photo" },
    { id: "room_no", title: "room_no" },
    { id: "status", title: "status" },
    { id: "approved_by", title: "approved_by" },
    { id: "approved_date", title: "approved_date" },
    { id: "created_at", title: "created_at" },
    { id: "rejection_reason", title: "rejection_reason" }
];

const wardenHeaders = [
    { id: "employee_id", title: "employee_id" },
    { id: "full_name", title: "full_name" },
    { id: "department", title: "department" },
    { id: "shift", title: "shift" },
    { id: "email", title: "email" },
    { id: "phone_no", title: "phone_no" },
    { id: "address", title: "address" },
    { id: "password", title: "password" },
    { id: "id_proof", title: "id_proof" },
    { id: "created_at", title: "created_at" },
    { id: "status", title: "status" },
    { id: "approved_by", title: "approved_by" },
    { id: "approved_date", title: "approved_date" },
    { id: "rejection_reason", title: "rejection_reason" }
];

// Helper to atomically update students.csv and registrations.csv together
async function updateStudentsAtomically(studentsList) {
    await writeCSV(studentsCsv, studentHeaders, studentsList);
    try {
        await writeCSV(registrationsCsv, studentHeaders, studentsList);
    } catch (e) {
        console.warn("Could not sync registrations.csv:", e.message);
    }
}

// Helper to read and write password resets JSON
function getPasswordResets() {
    try {
        if (!fs.existsSync(passwordResetsJson)) {
            return [];
        }
        const data = fs.readFileSync(passwordResetsJson, "utf8");
        return JSON.parse(data || "[]");
    } catch (e) {
        console.error("Error reading password_resets.json:", e);
        return [];
    }
}

function savePasswordResets(resets) {
    try {
        const dir = path.dirname(passwordResetsJson);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(passwordResetsJson, JSON.stringify(resets, null, 2), "utf8");
    } catch (e) {
        console.error("Error writing password_resets.json:", e);
    }
}

async function writeAdminAudit(adminId, action) {
    try {
        let rows = fs.existsSync(auditCsv) ? await readCSV(auditCsv) : [];
        rows.unshift({ id: `AUD-${Date.now()}`, admin_id: adminId, action, entity: 'admin', entity_id: adminId, details: `Admin ${action.toLowerCase()}`, created_at: new Date().toISOString() });
        const headers = Object.keys(rows[0] || {}).map(k => ({ id: k, title: k }));
        await writeCSV(auditCsv, headers, rows.slice(0, 2000));
    } catch (e) { console.error('Admin audit error:', e.message); }
}

const loginUnified = async (req, res) => {
    try {
        const identifier = (req.body.username || req.body.login_id || req.body.employee_id || req.body.admin_id || req.body.gatekeeper_id || req.body.email || "").trim().toLowerCase();
        const password = req.body.password || "";
        const role = (req.body.role || "").trim().toLowerCase();

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Username / ID and password are required."
            });
        }

        // 1. Check Student
        if (!role || role === "student") {
            const students = await readCSV(studentsCsv);
            const student = students.find(s =>
                String(s.admission_no || "").trim().toLowerCase() === identifier ||
                String(s.roll_no || "").trim().toLowerCase() === identifier ||
                String(s.email || "").trim().toLowerCase() === identifier
            );

            if (student) {
                let match = false;
                if (student.password.startsWith("$2b$") || student.password.startsWith("$2a$")) {
                    match = await bcrypt.compare(password, student.password);
                } else {
                    match = student.password === password;
                }

                if (match) {
                    const status = (student.status || "").trim().toLowerCase();
                    if (status === "inactive") {
                        return res.status(403).json({ success: false, message: "This student account is inactive." });
                    }
                    if (status === "pending") {
                        return res.status(403).json({
                            success: false,
                            status: "Pending",
                            message: "Your registration is awaiting warden approval."
                        });
                    }
                    if (status === "rejected") {
                        return res.status(403).json({
                            success: false,
                            status: "Rejected",
                            message: "Your registration was rejected. Please contact the hostel office."
                        });
                    }
                    if (status !== "approved") {
                        return res.status(403).json({
                            success: false,
                            message: "Account not approved."
                        });
                    }

                    const { password: _, ...safeStudent } = student;
                    return res.status(200).json({
                        success: true,
                        role: "student",
                        message: "Student login successful",
                        student: safeStudent,
                        user: safeStudent
                    });
                }
            }
        }

        // 2. Check Warden
        if (!role || role === "warden") {
            const wardens = await readCSV(wardenCsv);
            const warden = wardens.find(w =>
                String(w.employee_id || "").trim().toLowerCase() === identifier ||
                String(w.email || "").trim().toLowerCase() === identifier
            );

            if (warden) {
                let match = false;
                if (warden.password.startsWith("$2b$") || warden.password.startsWith("$2a$")) {
                    match = await bcrypt.compare(password, warden.password);
                } else {
                    match = warden.password === password;
                }

                if (match) {
                    const wardenStatus = String(warden.status || "Active").trim().toLowerCase();
                    if (wardenStatus === "pending" || wardenStatus === "awaiting approval") {
                        return res.status(403).json({ success: false, message: "Your warden registration is still awaiting Admin approval." });
                    }
                    if (wardenStatus === "rejected" || wardenStatus === "declined") {
                        return res.status(403).json({
                            success: false,
                            message: warden.rejection_reason
                                ? `Your warden registration was rejected: ${warden.rejection_reason}`
                                : "Your warden registration was rejected by the Admin."
                        });
                    }
                    if (wardenStatus === "inactive") {
                        return res.status(403).json({ success: false, message: "This warden account is inactive." });
                    }
                    const { password: _, ...safeWarden } = warden;
                    return res.status(200).json({
                        success: true,
                        role: "warden",
                        message: "Warden login successful",
                        warden: safeWarden,
                        user: safeWarden
                    });
                }
            }
        }

        // 3. Check Admin
        if (!role || role === "admin") {

            // 3a. The one shared, static admin login for the portal.
            //     Checked before admin.csv so it always works, even if
            //     the CSV is missing or edited.
            if (checkStaticAdmin(identifier, password)) {
                const safeAdmin = staticAdminRecord();
                await writeAdminAudit(safeAdmin.admin_id, "LOGIN");
                return res.status(200).json({
                    success: true,
                    role: "admin",
                    message: "Admin login successful",
                    admin: safeAdmin,
                    user: safeAdmin
                });
            }

            // 3b. Any per-person accounts still listed in admin.csv.
            const admins = await readCSV(adminCsv);
            const admin = admins.find(a =>
                String(a.admin_id || "").trim().toLowerCase() === identifier ||
                String(a.email || "").trim().toLowerCase() === identifier
            );

            if (admin) {
                let match = false;
                if (admin.password.startsWith("$2b$") || admin.password.startsWith("$2a$")) {
                    match = await bcrypt.compare(password, admin.password);
                } else {
                    match = admin.password === password;
                }

                if (match) {
                    if (String(admin.status || "").toLowerCase() === "inactive") {
                        return res.status(403).json({
                            success: false,
                            message: "This admin account is inactive."
                        });
                    }
                    const { password: _, ...safeAdmin } = admin;
                    await writeAdminAudit(admin.admin_id || identifier, "LOGIN");
                    return res.status(200).json({
                        success: true,
                        role: "admin",
                        message: "Admin login successful",
                        admin: safeAdmin,
                        user: safeAdmin
                    });
                }
            }
        }

        // 4. Check Gatekeeper
        if (!role || role === "gatekeeper" || role === "security") {
            const gatekeepers = await readCSV(gatekeeperCsv);
            const gatekeeper = gatekeepers.find(g =>
                String(g.gatekeeper_id || "").trim().toLowerCase() === identifier ||
                String(g.phone_no || "").trim().toLowerCase() === identifier
            );

            if (gatekeeper) {
                let match = false;
                if (gatekeeper.password.startsWith("$2b$") || gatekeeper.password.startsWith("$2a$")) {
                    match = await bcrypt.compare(password, gatekeeper.password);
                } else {
                    match = gatekeeper.password === password;
                }

                if (match) {
                    if (String(gatekeeper.status || "Active").toLowerCase() === "inactive") {
                        return res.status(403).json({ success: false, message: "This security account is inactive." });
                    }
                    const { password: _, ...safeGatekeeper } = gatekeeper;
                    return res.status(200).json({
                        success: true,
                        role: "gatekeeper",
                        message: "Gatekeeper login successful",
                        gatekeeper: safeGatekeeper,
                        user: safeGatekeeper
                    });
                }
            }
        }

        return res.status(401).json({
            success: false,
            message: "Invalid ID or password."
        });

    } catch (error) {
        console.error("Auth login error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// ============================================================
// FORGOT PASSWORD (Student & Warden)
// ============================================================

const forgotPassword = async (req, res) => {
    try {
        const email = String(req.body.email || req.body.username || "").trim().toLowerCase();
        const role = String(req.body.role || "student").trim().toLowerCase();

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Registered email address is required."
            });
        }

        let user = null;
        if (role === "warden") {
            const wardens = await readCSV(wardenCsv);
            user = wardens.find(w =>
                String(w.email || "").trim().toLowerCase() === email ||
                String(w.employee_id || "").trim().toLowerCase() === email
            );
        } else {
            const students = await readCSV(studentsCsv);
            user = students.find(s =>
                String(s.email || "").trim().toLowerCase() === email ||
                String(s.admission_no || "").trim().toLowerCase() === email ||
                String(s.roll_no || "").trim().toLowerCase() === email
            );
        }

        // Always return success to prevent email enumeration, but only send if user exists
        if (user && user.email) {
            const userEmail = String(user.email).trim().toLowerCase();

            // Generate cryptographically secure raw token (256 bits)
            const rawToken = crypto.randomBytes(32).toString("hex");

            // Store only SHA-256 hash of the token in the database
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            const expiresInMinutes = 30;
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

            const resets = getPasswordResets();
            // Filter out old expired or used records for this email
            const activeResets = resets.filter(r => r.email !== userEmail || (r.role !== role && !r.used));

            activeResets.push({
                token_hash: tokenHash,
                email: userEmail,
                role: role,
                expires_at: expiresAt,
                used: false,
                created_at: new Date().toISOString()
            });

            savePasswordResets(activeResets);

            // Construct link (only the raw unhashed token is in the email)
            const hostHeader = (typeof req.get === "function" ? req.get("host") : null) || "localhost:3000";
            const protocol = req.protocol || "http";
            const origin = (typeof req.get === "function" ? req.get("origin") : null) || `${protocol}://${hostHeader}`;
            const resetLink = `${origin}/forget_password.html?token=${rawToken}&role=${role}`;

            try {
                await sendPasswordResetEmail({
                    name: user.full_name || user.name || (role === "warden" ? "Warden" : "Student"),
                    email: userEmail,
                    resetLink: resetLink,
                    role: role,
                    expiresInMinutes: expiresInMinutes
                });
            } catch (emailErr) {
                console.error("Failed to send password reset email via SMTP:", emailErr.message);
                // Return clear guidance if email fails
                return res.status(500).json({
                    success: false,
                    message: "Unable to send password reset email. Please ensure the email service is properly configured."
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: "If your registered email address is found in our database, a password reset email has been sent."
        });

    } catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error processing password reset request."
        });
    }
};

// ============================================================
// VERIFY RESET TOKEN
// ============================================================

const verifyResetToken = async (req, res) => {
    try {
        const token = String((req.query && req.query.token) || (req.body && req.body.token) || "").trim();
        const role = String((req.query && req.query.role) || (req.body && req.body.role) || "").trim().toLowerCase();

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "Password reset token is required."
            });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const resets = getPasswordResets();

        const match = resets.find(r => r.token_hash === tokenHash);

        if (!match) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired password reset link."
            });
        }

        if (match.used) {
            return res.status(400).json({
                success: false,
                message: "This password reset link has already been used. Please request a new one."
            });
        }

        if (new Date(match.expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                message: "This password reset link has expired. Please request a new one."
            });
        }

        if (role && match.role && match.role.toLowerCase() !== role) {
            return res.status(400).json({
                success: false,
                message: "Invalid token for the requested role."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Token is valid.",
            email: match.email,
            role: match.role
        });

    } catch (error) {
        console.error("Verify reset token error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error verifying token."
        });
    }
};

// ============================================================
// RESET PASSWORD
// ============================================================

const resetPassword = async (req, res) => {
    try {
        const { token, newPassword, confirmPassword, password } = req.body;
        const pass = newPassword || password;
        const role = String(req.body.role || "").trim().toLowerCase();

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "Password reset token is required."
            });
        }

        if (!pass || pass.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long."
            });
        }

        if (confirmPassword && pass !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match."
            });
        }

        const tokenHash = crypto.createHash("sha256").update(String(token).trim()).digest("hex");
        const resets = getPasswordResets();

        const matchIndex = resets.findIndex(r => r.token_hash === tokenHash);

        if (matchIndex === -1) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired password reset link."
            });
        }

        const resetRecord = resets[matchIndex];

        if (resetRecord.used) {
            return res.status(400).json({
                success: false,
                message: "This password reset link has already been used. Please request a new one."
            });
        }

        if (new Date(resetRecord.expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                message: "This password reset link has expired. Please request a new one."
            });
        }

        const targetRole = (role || resetRecord.role || "student").toLowerCase();
        const userEmail = resetRecord.email.toLowerCase();
        const hashedPassword = await bcrypt.hash(pass, 10);

        if (targetRole === "warden") {
            const wardens = await readCSV(wardenCsv);
            const wIdx = wardens.findIndex(w => String(w.email || "").trim().toLowerCase() === userEmail);
            if (wIdx === -1) {
                return res.status(404).json({ success: false, message: "Warden account not found in database." });
            }
            wardens[wIdx].password = hashedPassword;
            await writeCSV(wardenCsv, wardenHeaders, wardens);
        } else {
            const students = await readCSV(studentsCsv);
            const sIdx = students.findIndex(s => String(s.email || "").trim().toLowerCase() === userEmail);
            if (sIdx === -1) {
                return res.status(404).json({ success: false, message: "Student account not found in database." });
            }
            students[sIdx].password = hashedPassword;
            await updateStudentsAtomically(students);
        }

        // Invalidate token
        resets[matchIndex].used = true;
        resets[matchIndex].used_at = new Date().toISOString();
        savePasswordResets(resets);

        return res.status(200).json({
            success: true,
            message: "Your password has been reset successfully. You can now login with your new password."
        });

    } catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error resetting password."
        });
    }
};

module.exports = {
    loginUnified,
    forgotPassword,
    verifyResetToken,
    resetPassword,
    updateStudentsAtomically
};
