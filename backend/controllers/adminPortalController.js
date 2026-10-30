/* ============================================================
   adminPortalController.js
   Admin Portal specific endpoints:
     1. Overview counters for the Admin dashboard
     2. New Warden registration approval workflow
     3. Outpass / Leave approved & rejected reports

   All data still lives in the existing CSV "database" and is
   read/written through services/csvService.js, so nothing about
   the Warden, Student or Gatekeeper portals changes.
   ============================================================ */

const path = require('path');
const { readCSV, writeCSV } = require('../services/csvService');

const DB = path.join(__dirname, '../database');

const FILES = {
  students: path.join(DB, 'students.csv'),
  wardens: path.join(DB, 'warden.csv'),
  security: path.join(DB, 'gatekeeper.csv'),
  supervisors: path.join(DB, 'supervisors.csv'),
  rooms: path.join(DB, 'rooms.csv'),
  leaves: path.join(DB, 'leave_requests.csv'),
  outpasses: path.join(DB, 'outpass_requests.csv'),
  audit: path.join(DB, 'audit_logs.csv')
};

const AUDIT_HEADERS = ['id', 'admin_id', 'action', 'entity', 'entity_id', 'details', 'created_at']
  .map(k => ({ id: k, title: k }));

/* Columns the approval workflow needs on warden.csv. They are
   created on demand so an existing warden.csv keeps working. */
const WARDEN_EXTRA_COLUMNS = ['approved_by', 'approved_date', 'rejection_reason'];

function stripPassword(row) {
  const out = {};
  Object.keys(row || {}).forEach(k => {
    if (k.toLowerCase() === 'password' || k.toLowerCase().includes('hash')) return;
    out[k] = row[k];
  });
  return out;
}

/* Build a csv-writer header list from the union of all row keys,
   so newly added columns are never silently dropped. */
function headersFor(rows, extraColumns = []) {
  const keys = [];
  rows.forEach(r => Object.keys(r).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
  extraColumns.forEach(k => { if (!keys.includes(k)) keys.push(k); });
  return keys.map(k => ({ id: k, title: k }));
}

function lower(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}

async function logAudit(adminId, action, entity, entityId, details) {
  try {
    const rows = await readCSV(FILES.audit);
    rows.unshift({
      id: `AUD-${Date.now()}`,
      admin_id: adminId || '',
      action,
      entity,
      entity_id: entityId || '',
      details: details || '',
      created_at: new Date().toISOString()
    });
    await writeCSV(FILES.audit, AUDIT_HEADERS, rows.filter(r => r.id).slice(0, 2000));
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

/* ------------------------------------------------------------
   Warden status helpers
   A warden is "Pending" until an admin approves the account.
   ------------------------------------------------------------ */
function wardenState(row) {
  const s = lower(row.status) || 'active';
  if (s === 'pending' || s === 'awaiting approval') return 'Pending';
  if (s === 'rejected' || s === 'declined') return 'Rejected';
  if (s === 'inactive') return 'Inactive';
  return 'Active';
}

/* ============================================================
   GET /api/admin-management/overview
   ============================================================ */
async function overview(req, res) {
  try {
    const [students, wardens, security, rooms, leaves, outpasses] = await Promise.all([
      readCSV(FILES.students), readCSV(FILES.wardens), readCSV(FILES.security),
      readCSV(FILES.rooms), readCSV(FILES.leaves), readCSV(FILES.outpasses)
    ]);

    const count = (rows, status) => rows.filter(r => lower(r.status) === status).length;

    res.json({
      success: true,
      overview: {
        generated_at: new Date().toISOString(),
        students: {
          total: students.length,
          approved: count(students, 'approved'),
          pending: count(students, 'pending'),
          rejected: count(students, 'rejected')
        },
        wardens: {
          total: wardens.length,
          active: wardens.filter(w => wardenState(w) === 'Active').length,
          pending: wardens.filter(w => wardenState(w) === 'Pending').length,
          rejected: wardens.filter(w => wardenState(w) === 'Rejected').length,
          inactive: wardens.filter(w => wardenState(w) === 'Inactive').length
        },
        gatekeepers: {
          total: security.length,
          active: security.filter(s => lower(s.status) !== 'inactive').length
        },
        rooms: {
          total: rooms.length,
          available: rooms.filter(r => lower(r.status) === 'available').length,
          occupied: rooms.filter(r => parseInt(r.occupied || 0, 10) > 0).length
        },
        outpass: {
          total: outpasses.length,
          approved: count(outpasses, 'approved'),
          rejected: count(outpasses, 'rejected'),
          pending: count(outpasses, 'pending')
        },
        leave: {
          total: leaves.length,
          approved: count(leaves, 'approved'),
          rejected: count(leaves, 'rejected'),
          pending: count(leaves, 'pending')
        }
      }
    });
  } catch (e) {
    console.error('Admin overview error:', e);
    res.status(500).json({ success: false, message: 'Unable to load admin overview.' });
  }
}

/* ============================================================
   GET /api/admin-management/warden-approvals
   Pending warden registrations + the decisions already taken.
   ============================================================ */
async function listWardenApprovals(req, res) {
  try {
    const wardens = (await readCSV(FILES.wardens)).map(stripPassword);
    const pending = wardens.filter(w => wardenState(w) === 'Pending');
    const decided = wardens
      .filter(w => w.approved_by || w.approved_date || wardenState(w) === 'Rejected')
      .filter(w => wardenState(w) !== 'Pending');

    res.json({
      success: true,
      pending,
      decided,
      counts: { pending: pending.length, decided: decided.length, total: wardens.length }
    });
  } catch (e) {
    console.error('List warden approvals error:', e);
    res.status(500).json({ success: false, message: 'Unable to load warden registration requests.' });
  }
}

/* ============================================================
   PATCH /api/admin-management/warden-approvals/:employee_id
   body: { decision: "approve" | "reject", remarks }
   ============================================================ */
async function decideWardenApproval(req, res) {
  try {
    const employeeId = String(req.params.employee_id || '').trim();
    const decision = lower(req.body && req.body.decision);
    const remarks = String((req.body && req.body.remarks) || '').trim();

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Warden employee ID is required.' });
    }
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be either approve or reject.' });
    }
    if (decision === 'reject' && !remarks) {
      return res.status(400).json({ success: false, message: 'A reason is required when rejecting a warden registration.' });
    }

    const wardens = await readCSV(FILES.wardens);
    const warden = wardens.find(w => lower(w.employee_id) === lower(employeeId));
    if (!warden) {
      return res.status(404).json({ success: false, message: 'Warden registration not found.' });
    }
    if (wardenState(warden) !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `This registration has already been processed (current status: ${wardenState(warden)}).`
      });
    }

    warden.status = decision === 'approve' ? 'Active' : 'Rejected';
    warden.approved_by = (req.admin && (req.admin.admin_id || req.admin.full_name)) || 'Admin';
    warden.approved_date = new Date().toISOString();
    warden.rejection_reason = decision === 'reject' ? remarks : '';

    await writeCSV(FILES.wardens, headersFor(wardens, WARDEN_EXTRA_COLUMNS), wardens);
    await logAudit(
      req.admin && req.admin.admin_id,
      decision === 'approve' ? 'APPROVE_WARDEN' : 'REJECT_WARDEN',
      'wardens',
      warden.employee_id,
      decision === 'approve'
        ? `Warden registration approved${remarks ? ` - ${remarks}` : ''}`
        : `Warden registration rejected - ${remarks}`
    );

    res.json({
      success: true,
      message: decision === 'approve'
        ? 'Warden registration approved. The warden can now log in.'
        : 'Warden registration rejected.',
      warden: stripPassword(warden)
    });
  } catch (e) {
    console.error('Decide warden approval error:', e);
    res.status(500).json({ success: false, message: 'Unable to process the warden registration.' });
  }
}

/* ============================================================
   GET /api/admin-management/reports/requests
   query: from=YYYY-MM-DD, to=YYYY-MM-DD, type=all|outpass|leave,
          status=all|approved|rejected|pending
   Report of Outpass approved/rejected and Leave approved/rejected.
   ============================================================ */
function parseAnyDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // ISO timestamp / YYYY-MM-DD
  const iso = new Date(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !isNaN(iso)) return iso;

  // DD-MM-YYYY or DD/MM/YYYY
  const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  return isNaN(iso) ? null : iso;
}

function dayKey(date) {
  if (!date) return '';
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

async function requestReport(req, res) {
  try {
    const type = lower(req.query.type) || 'all';
    const statusFilter = lower(req.query.status) || 'all';
    const from = parseAnyDate(req.query.from);
    const to = parseAnyDate(req.query.to);
    if (to) to.setHours(23, 59, 59, 999);

    const [leaves, outpasses] = await Promise.all([
      readCSV(FILES.leaves), readCSV(FILES.outpasses)
    ]);

    const normalise = (row, kind) => {
      const decidedAt = parseAnyDate(row.updated_at) || parseAnyDate(row.created_at);
      const status = String(row.status || 'Pending').trim() || 'Pending';
      return {
        kind,                                   // "Outpass" | "Leave"
        id: row.id,
        token_no: row.token_no || '',
        student_id: row.student_id || '',
        name: row.name || '',
        roll_no: row.roll_no || '',
        room_no: row.room_no || '',
        status,
        reason: kind === 'Outpass' ? (row.purpose || '') : (row.reason || ''),
        period: kind === 'Outpass'
          ? [row.out_date, row.out_time, row.return_time].filter(Boolean).join(' ')
          : [row.from_date, row.to_date].filter(Boolean).join(' to '),
        decided_by: row.approved_by || '',
        rejection_reason: row.rejection_reason || '',
        decided_at: decidedAt ? decidedAt.toISOString() : '',
        decided_on: dayKey(decidedAt),
        _date: decidedAt
      };
    };

    let rows = [];
    if (type === 'all' || type === 'outpass') rows = rows.concat(outpasses.map(o => normalise(o, 'Outpass')));
    if (type === 'all' || type === 'leave') rows = rows.concat(leaves.map(l => normalise(l, 'Leave')));

    rows = rows.filter(r => {
      if (from && (!r._date || r._date < from)) return false;
      if (to && (!r._date || r._date > to)) return false;
      if (statusFilter !== 'all' && lower(r.status) !== statusFilter) return false;
      return true;
    });

    rows.sort((a, b) => (b._date ? b._date.getTime() : 0) - (a._date ? a._date.getTime() : 0));

    const tally = kind => {
      const set = rows.filter(r => r.kind === kind);
      return {
        total: set.length,
        approved: set.filter(r => lower(r.status) === 'approved').length,
        rejected: set.filter(r => lower(r.status) === 'rejected').length,
        pending: set.filter(r => lower(r.status) === 'pending').length
      };
    };

    /* Per-warden breakdown so the admin can see who decided what. */
    const byWarden = {};
    rows.forEach(r => {
      if (!r.decided_by) return;
      const key = r.decided_by;
      byWarden[key] = byWarden[key] || { warden: key, approved: 0, rejected: 0, total: 0 };
      byWarden[key].total += 1;
      if (lower(r.status) === 'approved') byWarden[key].approved += 1;
      if (lower(r.status) === 'rejected') byWarden[key].rejected += 1;
    });

    res.json({
      success: true,
      report: {
        generated_at: new Date().toISOString(),
        filters: { type, status: statusFilter, from: req.query.from || '', to: req.query.to || '' },
        outpass: tally('Outpass'),
        leave: tally('Leave'),
        by_warden: Object.values(byWarden).sort((a, b) => b.total - a.total),
        rows: rows.map(({ _date, ...rest }) => rest)
      }
    });
  } catch (e) {
    console.error('Request report error:', e);
    res.status(500).json({ success: false, message: 'Unable to generate the outpass / leave report.' });
  }
}

module.exports = {
  overview,
  listWardenApprovals,
  decideWardenApproval,
  requestReport
};
