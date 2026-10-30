/* ============================================================
   qrTokenStore.js
   NEW FILE — added for the Gatekeeper dynamic single-use QR
   workflow (exit -> outside -> return).

   Responsible for:
     - Issuing a fresh, cryptographically random, single-use
       return-QR token the moment a student is marked OUT.
     - Storing it in qr_tokens.csv with generatedAt / expiresAt
       (both computed from SERVER time only) and status ACTIVE.
     - Validating + atomically redeeming that token when the
       student returns and the same QR is scanned again.
     - Never trusting client-supplied timestamps: all expiry
       checks compare the server's Date.now() against the
       server-computed expires_at stored at issue time.

   Does not touch students.csv / leave_requests.csv /
   outpass_requests.csv / movements.csv directly — the controller
   still owns marking a movement IN; this module only owns the
   life-cycle of the return-QR token itself.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const { readCSV, writeCSV } = require("./csvService");
const { withLock } = require("./asyncLock");
const { QR_TOKENS_CSV, qrTokenHeaders, HOSTEL_CONFIG_JSON } = require("./dbInit");
const { generateSecureToken, buildReturnQrPayload, generateQrDataUrl } = require("./qrService");

const DEFAULT_QR_VALIDITY_MINUTES = 120;

// ------------------------------------------------------------
// Admin-configurable validity window. Reuses the EXISTING Hostel
// Configuration file/UI (admin-management.html "Configuration"
// panel already renders one input per key found in this JSON —
// no new admin page needed) rather than hardcoding the minutes
// value throughout the code.
// ------------------------------------------------------------
function getQrValidityMinutes() {
    try {
        const raw = fs.readFileSync(HOSTEL_CONFIG_JSON, "utf8");
        const cfg = JSON.parse(raw);
        const minutes = Number(cfg.qrValidityMinutes);
        if (Number.isFinite(minutes) && minutes > 0) {
            return minutes;
        }
    } catch (e) {
        // Missing/unreadable/invalid config — fall back to the default
        // rather than failing exit scans entirely.
    }
    return DEFAULT_QR_VALIDITY_MINUTES;
}

// Lazily resolve a stored row's *effective* status using the
// SERVER's current clock — a row can be sitting as ACTIVE in the
// CSV but already past its expires_at if nobody has scanned it
// since it lapsed.
function effectiveStatus(row, nowMs) {
    const stored = String(row.status || "").toUpperCase();
    if (stored === "ACTIVE") {
        const expiresMs = Date.parse(row.expires_at);
        if (Number.isFinite(expiresMs) && nowMs > expiresMs) {
            return "EXPIRED";
        }
        return "ACTIVE";
    }
    return stored || "EXPIRED";
}

/**
 * Issue a brand-new single-use return QR for a student who was just
 * marked OUT. Called once per exit, from gatekeeperController.studentOut.
 */
async function issueReturnToken({ requestType, requestId, studentId, rollNo, movementId }) {
    const validityMinutes = getQrValidityMinutes();

    return withLock(QR_TOKENS_CSV, async () => {
        const rows = await readCSV(QR_TOKENS_CSV);

        const token = generateSecureToken(); // cryptographically random, unpredictable
        const now = new Date();
        const expiresAt = new Date(now.getTime() + validityMinutes * 60000);

        const row = {
            token_id: `RTN-${now.getTime()}-${token.slice(0, 6)}`,
            token,
            request_type: requestType,
            request_id: String(requestId),
            student_id: String(studentId || ""),
            roll_no: String(rollNo || ""),
            movement_id: String(movementId),
            status: "ACTIVE",
            generated_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            used_at: "",
            gatekeeper_in_id: "",
            gatekeeper_in_name: ""
        };

        rows.unshift(row);
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);

        const qrString = buildReturnQrPayload({ token });
        const qrDataUrl = await generateQrDataUrl(qrString);

        return {
            qrString,
            qrDataUrl,
            generatedAt: row.generated_at,
            expiresAt: row.expires_at,
            validityMinutes
        };
    });
}


/** Issue the approval QR as a single-use EXIT authorization.
 * The QR uses the request token_no as its signed payload, while this
 * ledger records whether that approval QR has already been consumed.
 */
async function issueExitToken({ requestType, requestId, studentId, rollNo, tokenNo }) {
    return withLock(QR_TOKENS_CSV, async () => {
        const rows = await readCSV(QR_TOKENS_CSV);
        const existing = rows.find(r =>
            String(r.request_type).toLowerCase() === String(requestType).toLowerCase() &&
            String(r.request_id) === String(requestId) &&
            String(r.token) === String(tokenNo) &&
            !String(r.movement_id || '').trim()
        );
        if (existing) {
            const qrString = require('./qrService').buildQrPayload({ requestType, requestId, tokenNo });
            return { qrString, qrDataUrl: await generateQrDataUrl(qrString) };
        }
        const now = new Date();
        const row = {
            token_id: `EXT-${now.getTime()}-${String(tokenNo).slice(-6)}`,
            token: String(tokenNo),
            request_type: String(requestType),
            request_id: String(requestId),
            student_id: String(studentId || ''),
            roll_no: String(rollNo || ''),
            movement_id: '',
            status: 'ACTIVE',
            generated_at: now.toISOString(),
            expires_at: '',
            used_at: '',
            gatekeeper_in_id: '',
            gatekeeper_in_name: ''
        };
        rows.unshift(row);
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);
        const qrString = require('./qrService').buildQrPayload({ requestType, requestId, tokenNo });
        return { qrString, qrDataUrl: await generateQrDataUrl(qrString) };
    });
}


/** Bind the already-issued approval QR to the OUT movement.
 * The QR remains ACTIVE while the student is outside.
 */
async function bindExitTokenToMovement({ token, requestType, requestId, movementId, gatekeeperId, gatekeeperName }) {
    return withLock(QR_TOKENS_CSV, async () => {
        const rows = await readCSV(QR_TOKENS_CSV);
        let idx = rows.findIndex(r =>
            String(r.token) === String(token) &&
            String(r.request_type).toLowerCase() === String(requestType).toLowerCase() &&
            String(r.request_id) === String(requestId)
        );
        if (idx === -1) {
            return { ok: false, status: 'UNKNOWN', message: 'QR ledger record not found.' };
        }
        const status = String(rows[idx].status || '').toUpperCase();
        if (status === 'USED') {
            return { ok: false, status: 'USED', message: 'This QR code has already been used.' };
        }
        rows[idx].movement_id = String(movementId);
        rows[idx].status = 'ACTIVE';
        rows[idx].gatekeeper_out_id = gatekeeperId || '';
        rows[idx].gatekeeper_out_name = gatekeeperName || '';
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);
        return { ok: true, status: 'ACTIVE', row: rows[idx] };
    });
}

/** Mark the same approval QR as permanently used after the student returns. */
async function consumeExitTokenAfterIn({ token, requestType, requestId, movementId, gatekeeperId, gatekeeperName }) {
    return withLock(QR_TOKENS_CSV, async () => {
        const rows = await readCSV(QR_TOKENS_CSV);
        const idx = rows.findIndex(r =>
            String(r.token) === String(token) &&
            String(r.request_type).toLowerCase() === String(requestType).toLowerCase() &&
            String(r.request_id) === String(requestId)
        );
        if (idx === -1) return { ok: false, status: 'UNKNOWN', message: 'This QR code is invalid or expired.' };
        if (String(rows[idx].status || '').toUpperCase() === 'USED') {
            return { ok: false, status: 'USED', message: 'QR Code Expired or Already Used.' };
        }
        if (String(rows[idx].movement_id || '') !== String(movementId)) {
            return { ok: false, status: 'MISMATCH', message: 'This QR code is not linked to the current OUT movement.' };
        }
        rows[idx].status = 'USED';
        rows[idx].used_at = new Date().toISOString();
        rows[idx].gatekeeper_in_id = gatekeeperId || '';
        rows[idx].gatekeeper_in_name = gatekeeperName || '';
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);
        return { ok: true, status: 'USED', row: rows[idx] };
    });
}

/** Atomically consume a single-use approval/EXIT QR. */
async function consumeExitToken({ token, requestType, requestId, gatekeeperId, gatekeeperName }) {
    return withLock(QR_TOKENS_CSV, async () => {
        const rows = await readCSV(QR_TOKENS_CSV);
        const idx = rows.findIndex(r =>
            String(r.token) === String(token) &&
            String(r.request_type).toLowerCase() === String(requestType).toLowerCase() &&
            String(r.request_id) === String(requestId) &&
            !String(r.movement_id || '').trim()
        );
        if (idx === -1) return { ok: false, status: 'UNKNOWN', message: 'This QR code is invalid or was issued before the single-use QR update.' };
        if (String(rows[idx].status).toUpperCase() === 'USED') {
            return { ok: false, status: 'USED', message: 'This QR code has already been used.' };
        }
        rows[idx].status = 'USED';
        rows[idx].used_at = new Date().toISOString();
        rows[idx].gatekeeper_in_id = gatekeeperId || '';
        rows[idx].gatekeeper_in_name = gatekeeperName || '';
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);
        return { ok: true, status: 'USED', row: rows[idx] };
    });
}

/**
 * Read-only lookup for the "Verify" step (before the gatekeeper taps
 * the action button). Never mutates state — just reports the
 * server-computed current status so the UI can show ACTIVE / EXPIRED
 * / USED clearly.
 */
async function previewToken(token) {
    const rows = await readCSV(QR_TOKENS_CSV);
    const row = rows.find(r => r.token === token);
    if (!row) {
        return { found: false, status: "UNKNOWN" };
    }
    return { found: true, status: effectiveStatus(row, Date.now()), row };
}

/**
 * Validate AND atomically redeem a return token on a return scan.
 * Guarantees the same token can never be accepted twice, even if two
 * scans arrive at (almost) the same instant, by doing the whole
 * read -> check -> flip -> write sequence inside a single lock for
 * this file (see asyncLock.js).
 */
async function redeemToken({ token, gatekeeperId, gatekeeperName }) {
    return withLock(QR_TOKENS_CSV, async () => {
        const rows = await readCSV(QR_TOKENS_CSV);
        const idx = rows.findIndex(r => r.token === token);

        if (idx === -1) {
            // QR exists as a signed payload but we have no matching
            // record (never issued, or database was reset) — do not
            // reveal which, just reject.
            return { ok: false, status: "UNKNOWN", message: "QR Code Expired or Already Used." };
        }

        const now = Date.now();
        const status = effectiveStatus(rows[idx], now);

        if (status === "USED") {
            return { ok: false, status, message: "QR Code Expired or Already Used." };
        }

        if (status === "EXPIRED") {
            // Persist the lazily-detected expiry so later reads/reports
            // (dashboards, admin views) see it as EXPIRED too, not ACTIVE.
            if (String(rows[idx].status || "").toUpperCase() === "ACTIVE") {
                rows[idx].status = "EXPIRED";
                await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);
            }
            return { ok: false, status, message: "QR Code Expired. Please generate a new QR." };
        }

        // status === "ACTIVE" and not expired -> redeem it now, before
        // releasing the lock, so a second concurrent scan of the same
        // QR (already queued behind this lock) will see USED.
        rows[idx].status = "USED";
        rows[idx].used_at = new Date(now).toISOString();
        rows[idx].gatekeeper_in_id = gatekeeperId || "";
        rows[idx].gatekeeper_in_name = gatekeeperName || "";
        await writeCSV(QR_TOKENS_CSV, qrTokenHeaders, rows);

        return { ok: true, status: "USED", row: rows[idx] };
    });
}

/**
 * NEW — used by the legacy exit-QR fallback in studentIn to check
 * whether THIS specific trip already had a dynamic return QR issued
 * for it. If it has, the original exit QR must no longer be able to
 * close out the trip — otherwise the single-use/expiry protection
 * would be pointless (the approval-email QR never expires or gets
 * consumed on its own). Only trips with no return-QR record at all
 * (opened before this feature existed) may fall back to the legacy
 * close-out.
 */
async function hasIssuedTokenForMovement(movementId) {
    const rows = await readCSV(QR_TOKENS_CSV);
    return rows.some(r => String(r.movement_id) === String(movementId));
}

module.exports = {
    getQrValidityMinutes,
    issueReturnToken,
    issueExitToken,
    bindExitTokenToMovement,
    consumeExitTokenAfterIn,
    consumeExitToken,
    previewToken,
    redeemToken,
    hasIssuedTokenForMovement
};
