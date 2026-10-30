/* ============================================================
   gatekeeperController.js
   NEW FILE — added for the Gatekeeper QR Movement workflow.

   Does NOT modify leaveController.js / outpassController.js /
   studentController.js / roomController.js logic. Only READS
   students.csv, leave_requests.csv and outpass_requests.csv,
   and reads/writes the new movements.csv + appends to the
   existing notifications.csv via the same pattern every other
   controller already uses.
   ============================================================ */

const path = require("path");
const { readCSV, writeCSV } = require("../services/csvService");
const { notificationHeaders, movementHeaders } = require("../services/dbInit");
const { verifyQrPayload } = require("../services/qrService");
const { withLock } = require("../services/asyncLock");
// NEW — dynamic single-use return-QR ledger (issue on Student Out,
// validate + atomically redeem on Student In). See qrTokenStore.js.
const qrTokenStore = require("../services/qrTokenStore");

const studentsCsv = path.join(__dirname, "../database/students.csv");
const leaveCsv = path.join(__dirname, "../database/leave_requests.csv");
const outpassCsv = path.join(__dirname, "../database/outpass_requests.csv");
const notifCsv = path.join(__dirname, "../database/notifications.csv");
const movementsCsv = path.join(__dirname, "../database/movements.csv");

// Same notification helper pattern used in every other controller
// (outpassController.js, leaveController.js, ...) — reuses the
// existing notifications.csv / notification API, no second system.
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

// Resolve a { requestType, requestId } pair to its row in the right CSV.
async function findRequest(requestType, requestId) {
    if (requestType === "outpass") {
        const rows = await readCSV(outpassCsv);
        const idx = rows.findIndex(r => String(r.id) === String(requestId));
        return { rows, idx, csvPath: outpassCsv, headers: null, kind: "outpass" };
    }
    if (requestType === "leave") {
        const rows = await readCSV(leaveCsv);
        const idx = rows.findIndex(r => String(r.id) === String(requestId));
        return { rows, idx, csvPath: leaveCsv, headers: null, kind: "leave" };
    }
    return { rows: [], idx: -1, csvPath: null, headers: null, kind: null };
}

async function findStudentByIdOrRoll(studentId, rollNo) {
    const students = await readCSV(studentsCsv);
    return students.find(s =>
        String(s.admission_no || "").trim().toLowerCase() === String(studentId || "").trim().toLowerCase() ||
        String(s.roll_no || "").trim().toLowerCase() === String(rollNo || studentId || "").trim().toLowerCase()
    ) || null;
}

// Dates from the leave/outpass forms come from <input type="date">, which is
// always ISO (YYYY-MM-DD). Some seeded/legacy rows use DD-MM-YYYY instead —
// this parses either so QR validity checks don't misfire on older records.
function parseFlexibleDate(value) {
    if (!value) return null;
    const str = String(value).trim();
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    }
    const dmyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyMatch) {
        return new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
    }
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}

// Is "today" (server local date) within the request's validity window?
function isWithinValidityWindow(kind, request) {
    const now = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = startOfDay(now);

    if (kind === "outpass") {
        const outDate = parseFlexibleDate(request.out_date);
        if (!outDate) return false;
        // Valid for the whole out_date (until end of that day).
        const expiry = new Date(outDate.getFullYear(), outDate.getMonth(), outDate.getDate(), 23, 59, 59);
        return now >= startOfDay(outDate) && now <= expiry;
    }

    if (kind === "leave") {
        const fromDate = parseFlexibleDate(request.from_date);
        const toDateRaw = parseFlexibleDate(request.to_date);
        if (!fromDate || !toDateRaw) return false;
        const toDate = new Date(toDateRaw.getFullYear(), toDateRaw.getMonth(), toDateRaw.getDate(), 23, 59, 59);
        return now >= startOfDay(fromDate) && now <= toDate;
    }

    return false;
}

// Find the currently-open (OUT, no in_time yet) movement row for a request, if any.
async function findOpenMovement(requestType, requestId) {
    const movements = await readCSV(movementsCsv);
    const idx = movements.findIndex(m =>
        String(m.request_type) === String(requestType) &&
        String(m.request_id) === String(requestId) &&
        String(m.status).toUpperCase() === "OUT"
    );
    return { movements, idx };
}

// NEW — locate a movement row by its exact movement_id (used for the
// return-QR path, where we already know precisely which OUT trip the
// redeemed token belongs to instead of re-deriving it from request type/id).
function findMovementByMovementId(movements, movementId) {
    return movements.findIndex(m => String(m.movement_id) === String(movementId));
}

// NEW — shared "mark this OUT movement as IN" step, used by both the
// legacy exit-QR return path and the new dynamic return-QR path so the
// actual movement/notification logic is written once.
async function finalizeStudentIn({ movements, openIdx, gatekeeper_id, gatekeeper_name, student, kind, request }) {
    const now = new Date();
    movements[openIdx].status = "IN";
    movements[openIdx].in_time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    movements[openIdx].gatekeeper_in_id = gatekeeper_id || "";
    movements[openIdx].gatekeeper_in_name = gatekeeper_name || "";
    movements[openIdx].updated_at = now.toISOString();

    await writeCSV(movementsCsv, movementHeaders, movements);

    const roll = request.roll_no || student.roll_no;
    const display = buildDisplayRequest(kind, request);
    const noteBody = `${student.full_name} has returned to the hostel. In Time: ${movements[openIdx].in_time} · ${display.request_type} · Out Time: ${movements[openIdx].out_time}`;

    await addNotification("success", "Student Returned to Hostel", noteBody, roll, "student");
    await addNotification("success", "Student Returned to Hostel", `${student.full_name} (${roll}, Room ${movements[openIdx].room_no}) has returned. In: ${movements[openIdx].in_time} · Out was: ${movements[openIdx].out_time}`, roll, "warden");

    return movements[openIdx];
}

function buildDisplayRequest(kind, request) {
    if (kind === "outpass") {
        return {
            request_type: "Outpass",
            request_id: request.id,
            // Who approved it, so the gatekeeper can see the pass really
            // came from a warden decision and not just an open request.
            approved_by: request.approved_by || "",
            approved_date: request.updated_at || "",
            allowed_out_date: request.out_date || "",
            allowed_out_time: request.out_time || "",
            expected_return_time: request.return_time || "",
            leave_start_date: "",
            leave_end_date: "",
            purpose: request.purpose || "",
            token_no: request.token_no || ""
        };
    }
    return {
        request_type: "Leave",
        request_id: request.id,
        approved_by: request.approved_by || "",
        approved_date: request.updated_at || "",
        allowed_out_date: request.from_date || "",
        allowed_out_time: "",
        expected_return_time: request.to_date || "",
        leave_start_date: request.from_date || "",
        leave_end_date: request.to_date || "",
        purpose: request.reason || "",
        token_no: request.token_no || ""
    };
}

// ------------------------------------------------------------
// POST /api/gatekeeper/verify-qr   { qr }
// Backend-only verification. Does not trust any data from the
// QR itself beyond the signed request type/id/token — everything
// else (student identity, approval status, expiry, movement
// state) is re-derived from the CSVs on every scan.
// ------------------------------------------------------------
/* ------------------------------------------------------------
   Accept either a scanned QR payload or a plain token number.

   The QR image holds a signed payload, so typing the token
   printed on the pass (e.g. "OTP-260916-152") used to fail with
   "Malformed QR code" — which left the gatekeeper with no way
   through if the camera was unavailable. This resolves a bare
   token by looking it up in outpass_requests.csv /
   leave_requests.csv and returns the same shape verifyQrPayload
   does, so every downstream check (approved status, validity
   window, movement state) still runs unchanged.
   ------------------------------------------------------------ */
async function resolveScannedValue(rawValue) {
    const value = String(rawValue || "").trim();
    const verification = verifyQrPayload(value);
    if (verification.valid) return verification;

    // Not a signed payload — try it as a token number.
    const token = value.toLowerCase();
    if (!token) return verification;

    const lookups = [
        { requestType: "outpass", rows: await readCSV(outpassCsv) },
        { requestType: "leave", rows: await readCSV(leaveCsv) }
    ];

    for (const { requestType, rows } of lookups) {
        const match = rows.find(r => String(r.token_no || "").trim().toLowerCase() === token);
        if (match) {
            return {
                valid: true,
                data: { t: "exit", rt: requestType, rid: String(match.id), tk: String(match.token_no) },
                source: "token"
            };
        }
    }

    return {
        valid: false,
        reason: "No approved request matches that QR code or token number."
    };
}

const verifyQr = async (req, res) => {
    try {
        const { qr } = req.body;
        if (!qr) {
            return res.status(400).json({ success: false, message: "QR/token value is required." });
        }

        const verification = await resolveScannedValue(qr);
        if (!verification.valid) {
            return res.status(400).json({ success: false, message: verification.reason || "Invalid QR code." });
        }

        // NEW — a dynamic single-use RETURN QR (issued at Student Out)
        // is previewed differently from the original exit-authorization
        // QR: it has no leave/outpass row of its own, and previewing it
        // must never mutate its ACTIVE/USED/EXPIRED status.
        if (verification.data.t === "return") {
            return await previewReturnQr(verification.data.tok, qr, res);
        }

        const { rt: requestType, rid: requestId, tk: tokenNo } = verification.data;
        const { rows, idx, kind } = await findRequest(requestType, requestId);

        if (idx === -1) {
            return res.status(404).json({ success: false, message: "Leave/Outpass request not found." });
        }

        const request = rows[idx];

        if (String(request.token_no || "") !== String(tokenNo)) {
            return res.status(400).json({ success: false, message: "Invalid QR code." });
        }

        if (String(request.status || "").toLowerCase() !== "approved") {
            return res.status(400).json({ success: false, message: "This request has not been approved." });
        }

        if (!isWithinValidityWindow(kind, request)) {
            return res.status(400).json({ success: false, message: "This QR code has expired." });
        }

        const student = await findStudentByIdOrRoll(request.student_id, request.roll_no);
        if (!student) {
            return res.status(404).json({ success: false, message: "Student record not found." });
        }

        // The approval QR is the SAME QR used for OUT and IN. It stays
        // ACTIVE while the student is outside and becomes USED only
        // after the return scan succeeds.
        const ledger = await qrTokenStore.previewToken(tokenNo);
        if (ledger.found && ledger.status === "USED") {
            return res.status(400).json({ success: false, message: "QR Code Expired or Already Used." });
        }
        if (ledger.found && ledger.status === "EXPIRED") {
            return res.status(400).json({ success: false, message: "QR Code Expired. Please generate a new QR." });
        }

        const { idx: openIdx } = await findOpenMovement(kind, request.id);
        const gateStatus = openIdx !== -1 ? "OUT" : "IN";

        return res.status(200).json({
            success: true,
            gate_status: gateStatus,
            qr_type: "exit",
            student: {
                full_name: student.full_name,
                roll_no: student.roll_no,
                admission_no: student.admission_no,
                room_no: request.room_no || student.room_no || "Not Allocated",
                department: student.department || "",
                parents_phone: student.parents_phone || "",
                phone_no: student.phone_no || "",
                passport_photo: student.passport_photo || ""
            },
            request: buildDisplayRequest(kind, request),
            qr
        });
    } catch (error) {
        console.error("Verify QR error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ------------------------------------------------------------
// NEW — read-only preview of a dynamic RETURN QR for the
// "Verification Result" panel. Never changes ACTIVE/USED/EXPIRED
// state — only /student-in redeems the token.
// ------------------------------------------------------------
async function previewReturnQr(token, qr, res) {
    const preview = await qrTokenStore.previewToken(token);

    if (!preview.found) {
        return res.status(400).json({ success: false, message: "QR Code Expired or Already Used." });
    }
    if (preview.status === "USED") {
        return res.status(400).json({ success: false, message: "QR Code Expired or Already Used." });
    }
    if (preview.status === "EXPIRED") {
        return res.status(400).json({ success: false, message: "QR Code Expired. Please generate a new QR." });
    }

    const row = preview.row;
    const { rows, idx, kind } = await findRequest(row.request_type, row.request_id);
    if (idx === -1) {
        return res.status(404).json({ success: false, message: "Leave/Outpass request not found." });
    }
    const request = rows[idx];

    const student = await findStudentByIdOrRoll(row.student_id, row.roll_no);
    if (!student) {
        return res.status(404).json({ success: false, message: "Student record not found." });
    }

    return res.status(200).json({
        success: true,
        gate_status: "OUT", // a return QR only exists while the student is outside
        qr_type: "return",
        qr_status: "ACTIVE",
        valid_until: row.expires_at,
        student: {
            full_name: student.full_name,
            roll_no: student.roll_no,
            admission_no: student.admission_no,
            room_no: request.room_no || student.room_no || "Not Allocated",
            department: student.department || "",
            parents_phone: student.parents_phone || "",
            phone_no: student.phone_no || ""
        },
        request: buildDisplayRequest(kind, request),
        qr
    });
}

// ------------------------------------------------------------
// POST /api/gatekeeper/student-out   { qr, gatekeeper_id, gatekeeper_name }
// ------------------------------------------------------------
const studentOut = async (req, res) => {
    try {
        const { qr, gatekeeper_id, gatekeeper_name } = req.body;
        if (!qr) {
            return res.status(400).json({ success: false, message: "QR/token value is required." });
        }

        const verification = await resolveScannedValue(qr);
        if (!verification.valid) {
            return res.status(400).json({ success: false, message: verification.reason || "Invalid QR code." });
        }
        // NEW — a dynamic return QR is only for scanning on the way BACK
        // in; it carries no request info, so it can never be used to
        // authorize an exit.
        if (verification.data.t === "return") {
            return res.status(400).json({ success: false, message: "This is a return QR. Please scan it on your way back in, not on the way out." });
        }

        const { rt: requestType, rid: requestId, tk: tokenNo } = verification.data;
        const { rows, idx, kind } = await findRequest(requestType, requestId);
        if (idx === -1) return res.status(404).json({ success: false, message: "Leave/Outpass request not found." });

        const request = rows[idx];
        if (String(request.token_no || "") !== String(tokenNo)) {
            return res.status(400).json({ success: false, message: "Invalid QR code." });
        }
        if (String(request.status || "").toLowerCase() !== "approved") {
            return res.status(400).json({ success: false, message: "This request has not been approved." });
        }
        if (!isWithinValidityWindow(kind, request)) {
            return res.status(400).json({ success: false, message: "This QR code has expired." });
        }

        const student = await findStudentByIdOrRoll(request.student_id, request.roll_no);
        if (!student) {
            return res.status(404).json({ success: false, message: "Student record not found." });
        }

        // NEW — the read (find open movement) -> decide -> write
        // (append new OUT row) sequence is wrapped in a lock keyed to
        // movements.csv so two near-simultaneous exit scans for the
        // same request can't both slip past the "already OUT" check.
        const newMovement = await withLock(movementsCsv, async () => {
            const { movements, idx: openIdx } = await findOpenMovement(kind, request.id);
            if (openIdx !== -1) {
                return { alreadyOut: true };
            }

            // IMPORTANT: the approval QR is NOT consumed on OUT.
            // The same QR must remain valid until the student returns.

            const now = new Date();
            const nextId = String(movements.reduce((max, m) => Math.max(max, parseInt(m.movement_id || 0)), 0) + 1);
            const display = buildDisplayRequest(kind, request);

            const movement = {
                movement_id: nextId,
                student_id: request.student_id || student.admission_no,
                roll_no: request.roll_no || student.roll_no,
                name: request.name || student.full_name,
                room_no: request.room_no || student.room_no || "Not Allocated",
                request_id: request.id,
                request_type: kind,
                token_no: request.token_no,
                status: "OUT",
                expected_return: display.expected_return_time,
                out_date: now.toISOString().split("T")[0],
                out_time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
                in_time: "",
                gatekeeper_out_id: gatekeeper_id || "",
                gatekeeper_out_name: gatekeeper_name || "",
                gatekeeper_in_id: "",
                gatekeeper_in_name: "",
                created_at: now.toISOString(),
                updated_at: now.toISOString()
            };

            movements.unshift(movement);
            await writeCSV(movementsCsv, movementHeaders, movements);

            // Create the approval-QR ledger row if this is an older
            // approval, then bind that SAME QR to this OUT movement.
            await qrTokenStore.issueExitToken({
                requestType: kind,
                requestId: request.id,
                studentId: movement.student_id,
                rollNo: movement.roll_no,
                tokenNo: request.token_no
            });
            const bound = await qrTokenStore.bindExitTokenToMovement({
                token: request.token_no,
                requestType: kind,
                requestId: request.id,
                movementId: movement.movement_id,
                gatekeeperId: gatekeeper_id,
                gatekeeperName: gatekeeper_name
            });
            if (!bound.ok) return { qrLedgerError: true, qrMessage: bound.message };

            return movement;
        });

        if (newMovement.alreadyOut) {
            return res.status(400).json({ success: false, message: "Student is already marked OUT." });
        }
        if (newMovement.qrUsed) {
            return res.status(400).json({ success: false, message: newMovement.qrMessage || "This QR code has already been used." });
        }
        if (newMovement.qrLedgerError) {
            return res.status(500).json({ success: false, message: newMovement.qrMessage || "Could not prepare the QR movement record." });
        }

        const display = buildDisplayRequest(kind, request);
        const roll = request.roll_no || student.roll_no;
        const noteBody = `${student.full_name} has exited the hostel. Out Time: ${newMovement.out_time} · ${display.request_type} · Expected Return: ${display.expected_return_time || "N/A"}`;

        await addNotification("info", "Student Exited Hostel", noteBody, roll, "student");
        await addNotification("info", "Student Exited Hostel", `${student.full_name} (${roll}, Room ${newMovement.room_no}) has exited the hostel. ${display.request_type} · Out: ${newMovement.out_time} · Expected Return: ${display.expected_return_time || "N/A"}`, roll, "warden");

        return res.status(200).json({
            success: true,
            message: "Student marked OUT. The same QR code can be scanned once more when the student returns.",
            movement: newMovement,
            qr_mode: "same_qr_out_in"
        });
    } catch (error) {
        console.error("Student out error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ------------------------------------------------------------
// POST /api/gatekeeper/student-in   { qr, gatekeeper_id, gatekeeper_name }
// ------------------------------------------------------------
const studentIn = async (req, res) => {
    try {
        const { qr, gatekeeper_id, gatekeeper_name } = req.body;
        if (!qr) {
            return res.status(400).json({ success: false, message: "QR/token value is required." });
        }

        const verification = await resolveScannedValue(qr);
        if (!verification.valid) {
            return res.status(400).json({ success: false, message: verification.reason || "Invalid QR code." });
        }

        // ------------------------------------------------------------
        // NEW — primary path: dynamic single-use return QR. This is the
        // QR minted at Student Out. Validation + "mark it USED" happen
        // atomically inside qrTokenStore.redeemToken (locked on
        // qr_tokens.csv), so the SAME QR can never be accepted twice —
        // including two devices scanning it at the same moment — and
        // expiry is always judged against the SERVER clock, never any
        // timestamp the client might send.
        // ------------------------------------------------------------
        if (verification.data.t === "return") {
            const redemption = await qrTokenStore.redeemToken({
                token: verification.data.tok,
                gatekeeperId: gatekeeper_id,
                gatekeeperName: gatekeeper_name
            });

            if (!redemption.ok) {
                return res.status(400).json({ success: false, message: redemption.message });
            }

            const tokenRow = redemption.row;
            const { rows, idx, kind } = await findRequest(tokenRow.request_type, tokenRow.request_id);
            if (idx === -1) return res.status(404).json({ success: false, message: "Leave/Outpass request not found." });
            const request = rows[idx];

            const student = await findStudentByIdOrRoll(tokenRow.student_id, tokenRow.roll_no);
            if (!student) {
                return res.status(404).json({ success: false, message: "Student record not found." });
            }

            const movementResult = await withLock(movementsCsv, async () => {
                const movements = await readCSV(movementsCsv);
                const openIdx = findMovementByMovementId(movements, tokenRow.movement_id);
                if (openIdx === -1) {
                    return { notFound: true };
                }
                if (String(movements[openIdx].status || "").toUpperCase() !== "OUT") {
                    return { alreadyIn: true };
                }
                const movement = await finalizeStudentIn({ movements, openIdx, gatekeeper_id, gatekeeper_name, student, kind, request });
                return { movement };
            });

            if (movementResult.notFound) {
                return res.status(404).json({ success: false, message: "Movement record not found." });
            }
            if (movementResult.alreadyIn) {
                return res.status(400).json({ success: false, message: "Student is already marked IN." });
            }

            return res.status(200).json({ success: true, message: "Entry verified successfully. QR code has expired.", movement: movementResult.movement });
        }

        // ------------------------------------------------------------
        // LEGACY path — the original exit-authorization QR, kept for
        // back-compat with any trip that was already marked OUT before
        // this update shipped (so it has no return-QR record) and
        // therefore has no choice but to be closed out with the QR the
        // student already has from their approval email. New trips
        // always use the dynamic return QR above instead.
        // ------------------------------------------------------------
        const { rt: requestType, rid: requestId, tk: tokenNo } = verification.data;
        const { rows, idx, kind } = await findRequest(requestType, requestId);
        if (idx === -1) return res.status(404).json({ success: false, message: "Leave/Outpass request not found." });

        const request = rows[idx];
        if (String(request.token_no || "") !== String(tokenNo)) {
            return res.status(400).json({ success: false, message: "Invalid QR code." });
        }

        const student = await findStudentByIdOrRoll(request.student_id, request.roll_no);
        if (!student) {
            return res.status(404).json({ success: false, message: "Student record not found." });
        }

        const legacyResult = await withLock(movementsCsv, async () => {
            const { movements, idx: openIdx } = await findOpenMovement(kind, request.id);
            if (openIdx === -1) {
                return { alreadyIn: true };
            }
            const movement = await finalizeStudentIn({ movements, openIdx, gatekeeper_id, gatekeeper_name, student, kind, request });

            // The SAME approval QR is consumed only after the student
            // has successfully returned. From this point onward any
            // later scan of that QR is rejected as USED.
            const consumed = await qrTokenStore.consumeExitTokenAfterIn({
                token: request.token_no,
                requestType: kind,
                requestId: request.id,
                movementId: movement.movement_id,
                gatekeeperId: gatekeeper_id,
                gatekeeperName: gatekeeper_name
            });
            if (!consumed.ok) return { qrConsumeError: true, qrMessage: consumed.message, movement };

            return { movement };
        });

        if (legacyResult.qrConsumeError) {
            console.error("Could not consume same QR after IN:", legacyResult.qrMessage);
            return res.status(500).json({ success: false, message: legacyResult.qrMessage || "Student returned, but QR could not be finalized." });
        }
        if (legacyResult.alreadyIn) {
            return res.status(400).json({ success: false, message: "Student is already marked IN." });
        }

        return res.status(200).json({ success: true, message: "Student marked IN.", movement: legacyResult.movement });
    } catch (error) {
        console.error("Student in error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ------------------------------------------------------------
// GET /api/gatekeeper/student/:roll  — manual search by roll or name (query ?q=)
// ------------------------------------------------------------
const searchStudent = async (req, res) => {
    try {
        const { roll } = req.params;
        const students = await readCSV(studentsCsv);
        const target = String(roll || "").trim().toLowerCase();

        const matches = students.filter(s =>
            String(s.roll_no || "").toLowerCase().includes(target) ||
            String(s.admission_no || "").toLowerCase().includes(target) ||
            String(s.full_name || "").toLowerCase().includes(target)
        );

        if (matches.length === 0) {
            return res.status(404).json({ success: false, message: "Student record not found." });
        }

        const movements = await readCSV(movementsCsv);

        const results = await Promise.all(matches.slice(0, 20).map(async (s) => {
            const openMove = movements.find(m =>
                (String(m.roll_no).toLowerCase() === String(s.roll_no).toLowerCase() ||
                 String(m.student_id).toLowerCase() === String(s.admission_no).toLowerCase()) &&
                String(m.status).toUpperCase() === "OUT"
            );
            return {
                full_name: s.full_name,
                roll_no: s.roll_no,
                admission_no: s.admission_no,
                room_no: s.room_no || "Not Allocated",
                department: s.department || "",
                passport_photo: s.passport_photo || "",
                gate_status: openMove ? "OUT" : "IN"
            };
        }));

        return res.status(200).json({ success: true, total: results.length, students: results });
    } catch (error) {
        console.error("Search student error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ------------------------------------------------------------
// GET /api/gatekeeper/history — supports ?q=&roll=&action=OUT|IN&type=leave|outpass&date=YYYY-MM-DD
// ------------------------------------------------------------
const getHistory = async (req, res) => {
    try {
        const { q, roll, action, type, date } = req.query;
        let movements = await readCSV(movementsCsv);

        if (roll) {
            const target = roll.toLowerCase();
            movements = movements.filter(m => String(m.roll_no || "").toLowerCase().includes(target));
        }
        if (q) {
            const query = q.toLowerCase();
            movements = movements.filter(m =>
                String(m.name || "").toLowerCase().includes(query) ||
                String(m.roll_no || "").toLowerCase().includes(query)
            );
        }
        if (action) {
            movements = movements.filter(m => String(m.status || "").toLowerCase() === action.toLowerCase());
        }
        if (type) {
            movements = movements.filter(m => String(m.request_type || "").toLowerCase() === type.toLowerCase());
        }
        if (date) {
            movements = movements.filter(m => String(m.out_date || "") === date);
        }

        movements.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        return res.status(200).json({ success: true, total: movements.length, movements });
    } catch (error) {
        console.error("Get history error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ------------------------------------------------------------
// GET /api/gatekeeper/currently-out
// ------------------------------------------------------------
const getCurrentlyOut = async (req, res) => {
    try {
        const movements = await readCSV(movementsCsv);
        const currentlyOut = movements.filter(m => String(m.status || "").toUpperCase() === "OUT");
        currentlyOut.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        return res.status(200).json({ success: true, total: currentlyOut.length, movements: currentlyOut });
    } catch (error) {
        console.error("Get currently-out error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ------------------------------------------------------------
// GET /api/gatekeeper/stats — dashboard counters
// ------------------------------------------------------------
const getStats = async (req, res) => {
    try {
        const movements = await readCSV(movementsCsv);
        const today = new Date().toISOString().split("T")[0];

        const currentlyOut = movements.filter(m => String(m.status).toUpperCase() === "OUT").length;
        const currentlyIn = movements.filter(m => String(m.status).toUpperCase() === "IN").length;
        const todaysOut = movements.filter(m => m.out_date === today).length;
        const todaysIn = movements.filter(m => m.out_date === today && m.in_time).length;

        const [leaves, outpasses] = await Promise.all([readCSV(leaveCsv), readCSV(outpassCsv)]);
        const activeLeave = leaves.filter(l => String(l.status).toLowerCase() === "approved" && isWithinValidityWindow("leave", l)).length;
        const activeOutpass = outpasses.filter(o => String(o.status).toLowerCase() === "approved" && isWithinValidityWindow("outpass", o)).length;

        return res.status(200).json({
            success: true,
            stats: {
                currently_out: currentlyOut,
                currently_in: currentlyIn,
                todays_out: todaysOut,
                todays_in: todaysIn,
                active_leave: activeLeave,
                active_outpass: activeOutpass
            }
        });
    } catch (error) {
        console.error("Get stats error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    verifyQr,
    studentOut,
    studentIn,
    searchStudent,
    getHistory,
    getCurrentlyOut,
    getStats
};
