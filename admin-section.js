/* ============================================================
   admin-section.js
   Single controller for every Admin Portal module page.
   Each page sets window.ADMIN_SECTION before loading this file:

     students | wardens | security | rooms
     approvals | reports | audit

   Every module renders a searchable list and a "View Details"
   modal; wardens additionally get the registration approval
   workflow, and reports covers Outpass / Leave approved and
   rejected figures.

   Data source: the existing Express + CSV backend under
   /api/admin-management. No Warden, Student or Gatekeeper
   endpoint is touched.
   ============================================================ */

const ADMIN_API = (window.location.port === '3000') ? '' : 'http://localhost:3000';
const ADMIN_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-admin-id': localStorage.getItem('hostelERP_adminSession') || ''
});

const SECTION = window.ADMIN_SECTION || 'students';

/* ------------------------------------------------------------
   Module definitions
   ------------------------------------------------------------ */
const DEFINITIONS = {
  students: {
    title: 'Student Details',
    icon: 'fa-users',
    key: 'admission_no',
    type: 'users',
    searchHint: 'Search by name, admission no, roll no, department or room...',
    cols: [
      { k: 'admission_no', t: 'Admission No' },
      { k: 'roll_no', t: 'Roll No' },
      { k: 'full_name', t: 'Name' },
      { k: 'department', t: 'Department' },
      { k: 'year', t: 'Year' },
      { k: 'room_no', t: 'Room' },
      { k: 'phone_no', t: 'Phone' },
      { k: 'status', t: 'Status', pill: true }
    ],
    statuses: ['Approved', 'Pending', 'Rejected', 'Inactive']
  },
  wardens: {
    title: 'Warden Details',
    icon: 'fa-user-tie',
    key: 'employee_id',
    type: 'users',
    searchHint: 'Search by name, employee ID, department or email...',
    cols: [
      { k: 'employee_id', t: 'Employee ID' },
      { k: 'full_name', t: 'Name' },
      { k: 'department', t: 'Department / Block' },
      { k: 'shift', t: 'Shift' },
      { k: 'email', t: 'Email' },
      { k: 'phone_no', t: 'Phone' },
      { k: 'status', t: 'Status', pill: true }
    ],
    statuses: ['Active', 'Pending', 'Rejected', 'Inactive']
  },
  security: {
    title: 'Gatekeeper Details',
    icon: 'fa-shield-halved',
    key: 'gatekeeper_id',
    type: 'users',
    searchHint: 'Search by name, gatekeeper ID, gate or shift...',
    cols: [
      { k: 'gatekeeper_id', t: 'Gatekeeper ID' },
      { k: 'full_name', t: 'Name' },
      { k: 'role', t: 'Role' },
      { k: 'shift', t: 'Shift' },
      { k: 'gate', t: 'Gate' },
      { k: 'phone_no', t: 'Phone' },
      { k: 'status', t: 'Status', pill: true }
    ],
    statuses: ['Active', 'Inactive']
  },
  rooms: {
    title: 'Room Details',
    icon: 'fa-bed',
    key: 'room_id',
    type: 'entity',
    searchHint: 'Search by room number, block or status...',
    cols: [
      { k: 'room_id', t: 'Room' },
      { k: 'block', t: 'Block' },
      { k: 'floor', t: 'Floor' },
      { k: 'capacity', t: 'Capacity' },
      { k: 'occupied', t: 'Occupied' },
      { k: 'occupants', t: 'Occupants' },
      { k: 'status', t: 'Status', pill: true }
    ],
    formFields: ['room_id', 'block', 'floor', 'capacity', 'occupied', 'status'],
    statuses: ['Available', 'Partially Filled', 'Full', 'Maintenance']
  },
  audit: {
    title: 'Audit Logs',
    icon: 'fa-clipboard-list',
    key: 'id',
    type: 'readonly',
    searchHint: 'Search by admin, action or entity...',
    cols: [
      { k: 'created_at', t: 'When', date: true },
      { k: 'admin_id', t: 'Admin' },
      { k: 'action', t: 'Action' },
      { k: 'entity', t: 'Module' },
      { k: 'entity_id', t: 'Record' },
      { k: 'details', t: 'Details' }
    ]
  }
};

let data = {};          /* /api/admin-management payload */
let overviewData = {};  /* /api/admin-management/overview payload */

/* ------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------ */
function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));
}

function pillClass(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'approved' || s === 'active' || s === 'available') return 'pill pill-approved';
  if (s === 'pending' || s === 'partially filled' || s === 'maintenance') return 'pill pill-pending';
  if (s === 'rejected' || s === 'inactive' || s === 'full') return 'pill pill-rejected';
  return 'pill pill-neutral';
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return esc(value);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function notify(type, title, message) {
  if (typeof showToast === 'function') showToast(type, title, message || '');
  else alert(`${title}\n\n${message || ''}`);
}

function el(id) { return document.getElementById(id); }

async function api(url, options = {}) {
  const res = await fetch(`${ADMIN_API}${url}`, { headers: ADMIN_HEADERS(), ...options });
  let body = {};
  try { body = await res.json(); } catch (e) { body = {}; }
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${res.status}).`);
  }
  return body;
}

/* ------------------------------------------------------------
   Data loading
   ------------------------------------------------------------ */
async function loadManagement() {
  data = await api('/api/admin-management');
}

async function loadOverview() {
  const body = await api('/api/admin-management/overview');
  overviewData = body.overview || {};
}

/* ------------------------------------------------------------
   Generic list module (students / wardens / gatekeepers / rooms / audit)
   ------------------------------------------------------------ */
function currentRows() {
  const def = DEFINITIONS[SECTION];
  let rows = data[SECTION] || [];

  const q = (el('search') && el('search').value || '').trim().toLowerCase();
  if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));

  const statusEl = el('statusFilter');
  if (statusEl && statusEl.value !== 'all') {
    rows = rows.filter(r => {
      const s = String(r.status || (SECTION === 'wardens' || SECTION === 'security' ? 'Active' : '')).toLowerCase();
      return s === statusEl.value.toLowerCase();
    });
  }

  const extraEl = el('extraFilter');
  if (extraEl && extraEl.value !== 'all') {
    const field = extraEl.dataset.field;
    rows = rows.filter(r => String(r[field] || '').toLowerCase() === extraEl.value.toLowerCase());
  }

  void def;
  return rows;
}

function renderTable() {
  const def = DEFINITIONS[SECTION];
  const rows = currentRows();

  el('thead').innerHTML = '<tr>' + def.cols.map(c => `<th>${esc(c.t)}</th>`).join('') + '<th>Actions</th></tr>';
  el('resultCount').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    el('tbody').innerHTML = `<tr><td colspan="${def.cols.length + 1}"><div class="empty-state">
      <i class="fa-regular fa-folder-open"></i>No records match the current filters.</div></td></tr>`;
    return;
  }

  el('tbody').innerHTML = rows.map(row => {
    const id = row[def.key] || row.id || '';
    const cells = def.cols.map(c => {
      let value = row[c.k];
      if (c.date) return `<td>${fmtDate(value)}</td>`;
      if (c.pill) {
        const status = value || (def.type === 'users' ? 'Active' : '');
        return `<td><span class="${pillClass(status)}">${esc(status || '—')}</span></td>`;
      }
      if (value === '' || value === undefined || value === null) value = '—';
      return `<td>${esc(value)}</td>`;
    }).join('');

    let actions = '<span class="muted">Read only</span>';
    if (def.type === 'users') {
      const state = String(row.status || 'Active').toLowerCase();
      const inactive = state === 'inactive';
      actions = `<button class="btn-small" onclick="viewDetails('${esc(id)}')">
                   <i class="fa-regular fa-eye"></i> View Details</button>`;
      if (SECTION === 'wardens' && state === 'pending') {
        actions += `<a class="btn-small" href="admin-warden-approvals.html">
                      <i class="fa-solid fa-user-check"></i> Approve</a>`;
      } else {
        actions += `<button class="status-btn ${inactive ? 'inactive' : 'active'}"
                      onclick="toggleStatus('${esc(id)}')">${inactive ? 'Activate' : 'Deactivate'}</button>`;
      }
    } else if (def.type === 'entity') {
      actions = `<button class="btn-small" onclick="viewDetails('${esc(id)}')">
                   <i class="fa-regular fa-eye"></i> View Details</button>
                 <button class="btn-small" onclick="editRecord('${esc(id)}')">Edit</button>`;
      if (SECTION === 'rooms') {
        actions += `<button class="btn-small" onclick="assignStudent('${esc(id)}')">Assign Student</button>`;
      }
      actions += `<button class="btn-small" onclick="deleteRecord('${esc(id)}')">Delete</button>`;
    } else if (SECTION === 'audit') {
      actions = `<button class="btn-small" onclick="viewDetails('${esc(id)}')">
                   <i class="fa-regular fa-eye"></i> View</button>`;
    }

    return `<tr>${cells}<td><div class="actions">${actions}</div></td></tr>`;
  }).join('');
}

/* Details modal — shows every stored field for the clicked record. */
function viewDetails(id) {
  const def = DEFINITIONS[SECTION];
  const row = (data[SECTION] || []).find(x => String(x[def.key] || x.id) === String(id));
  if (!row) return;

  const fields = Object.entries(row)
    .filter(([k]) => k.toLowerCase() !== 'password' && !k.toLowerCase().includes('hash'));

  el('modalTitle').textContent = `${def.title.replace(/ Details$/, '')} — ${row.full_name || row.room_id || id}`;
  el('modalBody').innerHTML = `<div class="detail-grid">${fields.map(([k, v]) => {
    const label = k.replace(/_/g, ' ');
    const isStatus = k === 'status';
    const value = (v === '' || v === undefined || v === null) ? '—' : v;
    return `<div class="detail-item"><strong>${esc(label)}</strong>${
      isStatus ? `<span class="${pillClass(value)}">${esc(value)}</span>` : esc(value)
    }</div>`;
  }).join('')}</div>`;

  /* Students and wardens get their related request history inline. */
  const extra = relatedActivity(row);
  if (extra) el('modalBody').innerHTML += extra;

  el('modal').classList.add('show');
}

function relatedActivity(row) {
  if (SECTION === 'students') {
    const roll = String(row.roll_no || row.admission_no || '').toLowerCase();
    const rows = (overviewData && overviewData.__requests ? overviewData.__requests : [])
      .filter(r => String(r.roll_no || '').toLowerCase() === roll);
    if (!rows.length) return '';
    return `<div class="section-heading">Outpass &amp; Leave history</div>
      <div class="table-wrap"><table class="manage-table"><thead><tr>
        <th>Type</th><th>Token</th><th>Period</th><th>Status</th><th>Decided by</th></tr></thead><tbody>
        ${rows.slice(0, 20).map(r => `<tr><td>${esc(r.kind)}</td><td>${esc(r.token_no || '—')}</td>
          <td>${esc(r.period || '—')}</td><td><span class="${pillClass(r.status)}">${esc(r.status)}</span></td>
          <td>${esc(r.decided_by || '—')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  if (SECTION === 'rooms') {
    const occupants = String(row.occupants || '').split(/[|;,]/).map(s => s.trim()).filter(Boolean);
    if (!occupants.length) return '';
    const students = data.students || [];
    return `<div class="section-heading">Occupants</div>
      <div class="table-wrap"><table class="manage-table"><thead><tr>
        <th>Admission No</th><th>Name</th><th>Department</th><th>Phone</th></tr></thead><tbody>
        ${occupants.map(adm => {
          const s = students.find(x => String(x.admission_no).toLowerCase() === adm.toLowerCase()) || {};
          return `<tr><td>${esc(adm)}</td><td>${esc(s.full_name || '—')}</td>
                  <td>${esc(s.department || '—')}</td><td>${esc(s.phone_no || '—')}</td></tr>`;
        }).join('')}
      </tbody></table></div>`;
  }
  return '';
}

function closeModal() { el('modal').classList.remove('show'); }

/* ------------------------------------------------------------
   User status / entity CRUD
   ------------------------------------------------------------ */
async function toggleStatus(id) {
  if (!confirm('Change this account status?')) return;
  try {
    await api(`/api/admin-management/users/${SECTION}/${encodeURIComponent(id)}/status`, { method: 'PATCH' });
    await loadManagement();
    renderTable();
    notify('success', 'Status updated', `Account ${id} was updated.`);
  } catch (e) { notify('error', 'Could not update status', e.message); }
}

function openForm(item = {}) {
  const def = DEFINITIONS[SECTION];
  const fields = def.formFields || Object.keys(item);
  el('formTitle').textContent = `${item[def.key] ? 'Edit' : 'Add'} ${def.title.replace(/ Details$/, '')}`;
  el('formFields').innerHTML = fields.map(f => `
    <div><label>${esc(f.replace(/_/g, ' '))}</label>
      <input name="${esc(f)}" value="${esc(item[f] || '')}" ${item[def.key] && f === def.key ? 'readonly' : ''}></div>
  `).join('');
  el('formModal').classList.add('show');
}

function closeForm() { el('formModal').classList.remove('show'); }

function editRecord(id) {
  const def = DEFINITIONS[SECTION];
  openForm((data[SECTION] || []).find(x => String(x[def.key]) === String(id)) || {});
}

async function saveRecord(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api(`/api/admin-management/entity/${SECTION}`, { method: 'POST', body: JSON.stringify(payload) });
    closeForm();
    await loadManagement();
    renderTable();
    notify('success', 'Saved', 'The record was saved successfully.');
  } catch (e) { notify('error', 'Could not save', e.message); }
}

async function deleteRecord(id) {
  if (!confirm('Delete this record permanently?')) return;
  try {
    await api(`/api/admin-management/entity/${SECTION}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadManagement();
    renderTable();
    notify('success', 'Deleted', `Record ${id} was removed.`);
  } catch (e) { notify('error', 'Could not delete', e.message); }
}

async function assignStudent(roomId) {
  const admission = prompt('Enter the student admission number to assign to this room:');
  if (!admission) return;
  try {
    await api(`/api/admin-management/rooms/${encodeURIComponent(roomId)}/assign`, {
      method: 'PATCH', body: JSON.stringify({ admission_no: admission.trim() })
    });
    await loadManagement();
    renderTable();
    notify('success', 'Student assigned', `${admission} is now allotted to ${roomId}.`);
  } catch (e) { notify('error', 'Could not assign student', e.message); }
}

/* ------------------------------------------------------------
   Warden registration approvals
   ------------------------------------------------------------ */
let approvals = { pending: [], decided: [] };

async function loadApprovals() {
  const body = await api('/api/admin-management/warden-approvals');
  approvals = { pending: body.pending || [], decided: body.decided || [] };
}

function renderApprovals() {
  const pending = approvals.pending;
  el('approvalCount').textContent = `${pending.length} awaiting approval`;

  el('approvalGrid').innerHTML = pending.length ? pending.map(w => `
    <div class="approval-card">
      <h4>${esc(w.full_name || 'Unnamed warden')}</h4>
      <div class="meta">Employee ID ${esc(w.employee_id || '—')} • applied ${esc(w.created_at || '—')}</div>
      <dl>
        <dt>Department</dt><dd>${esc(w.department || '—')}</dd>
        <dt>Shift</dt><dd>${esc(w.shift || '—')}</dd>
        <dt>Email</dt><dd>${esc(w.email || '—')}</dd>
        <dt>Phone</dt><dd>${esc(w.phone_no || '—')}</dd>
        <dt>Address</dt><dd>${esc(w.address || '—')}</dd>
        <dt>ID proof</dt><dd>${esc(w.id_proof || 'Not uploaded')}</dd>
      </dl>
      <div class="approval-actions">
        <button class="btn-approve" onclick="decideWarden('${esc(w.employee_id)}','approve')">
          <i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn-reject" onclick="decideWarden('${esc(w.employee_id)}','reject')">
          <i class="fa-solid fa-xmark"></i> Reject</button>
      </div>
    </div>`).join('')
    : `<div class="empty-state"><i class="fa-regular fa-circle-check"></i>
         No warden registrations are waiting for approval right now.</div>`;

  const decided = approvals.decided;
  el('decidedBody').innerHTML = decided.length ? decided.map(w => `
    <tr>
      <td>${esc(w.employee_id)}</td>
      <td>${esc(w.full_name || '—')}</td>
      <td>${esc(w.department || '—')}</td>
      <td><span class="${pillClass(w.status)}">${esc(w.status || 'Active')}</span></td>
      <td>${esc(w.approved_by || '—')}</td>
      <td>${w.approved_date ? fmtDate(w.approved_date) : '—'}</td>
      <td>${esc(w.rejection_reason || '—')}</td>
    </tr>`).join('')
    : '<tr><td colspan="7"><div class="empty-state">No approval decisions recorded yet.</div></td></tr>';
}

async function decideWarden(employeeId, decision) {
  let remarks = '';
  if (decision === 'reject') {
    remarks = (prompt('Reason for rejecting this warden registration:') || '').trim();
    if (!remarks) return notify('warning', 'Reason required', 'A rejection needs a reason.');
  } else {
    if (!confirm(`Approve warden ${employeeId}? The account will be activated for login.`)) return;
    remarks = (prompt('Optional remarks for the approval:') || '').trim();
  }

  try {
    const body = await api(`/api/admin-management/warden-approvals/${encodeURIComponent(employeeId)}`, {
      method: 'PATCH', body: JSON.stringify({ decision, remarks })
    });
    await loadApprovals();
    renderApprovals();
    notify(decision === 'approve' ? 'success' : 'info',
      decision === 'approve' ? 'Warden approved' : 'Warden rejected', body.message);
  } catch (e) { notify('error', 'Could not process registration', e.message); }
}

/* ------------------------------------------------------------
   Reports — Outpass / Leave approved and rejected
   ------------------------------------------------------------ */
let reportData = null;

function reportQuery() {
  const params = new URLSearchParams();
  const from = el('reportFrom').value;
  const to = el('reportTo').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('type', el('reportType').value);
  params.set('status', el('reportStatus').value);
  return params.toString();
}

async function runReport() {
  try {
    const body = await api(`/api/admin-management/reports/requests?${reportQuery()}`);
    reportData = body.report;
    renderReport();
  } catch (e) { notify('error', 'Could not generate report', e.message); }
}

function renderReport() {
  if (!reportData) return;
  const o = reportData.outpass, l = reportData.leave;

  el('reportSummary').innerHTML = `
    <div class="report-card">
      <h4><i class="fa-solid fa-door-open"></i> Outpass Requests</h4>
      <div class="report-line"><span>Approved</span><b style="color:#166534">${o.approved}</b></div>
      <div class="report-line"><span>Rejected</span><b style="color:#991b1b">${o.rejected}</b></div>
      <div class="report-line"><span>Pending</span><b style="color:#92400e">${o.pending}</b></div>
      <div class="report-line"><span>Total</span><b>${o.total}</b></div>
    </div>
    <div class="report-card">
      <h4><i class="fa-solid fa-plane-departure"></i> Leave Requests</h4>
      <div class="report-line"><span>Approved</span><b style="color:#166534">${l.approved}</b></div>
      <div class="report-line"><span>Rejected</span><b style="color:#991b1b">${l.rejected}</b></div>
      <div class="report-line"><span>Pending</span><b style="color:#92400e">${l.pending}</b></div>
      <div class="report-line"><span>Total</span><b>${l.total}</b></div>
    </div>
    <div class="report-card">
      <h4><i class="fa-solid fa-user-tie"></i> Decisions by Warden</h4>
      ${(reportData.by_warden || []).length
        ? reportData.by_warden.slice(0, 8).map(w => `<div class="report-line">
            <span>${esc(w.warden)}</span>
            <span><b style="color:#166534">${w.approved}</b> / <b style="color:#991b1b">${w.rejected}</b></span>
          </div>`).join('')
        : '<p class="muted">No decisions in this period.</p>'}
    </div>`;

  const rows = reportData.rows || [];
  el('reportCount').textContent = `${rows.length} request${rows.length === 1 ? '' : 's'}`;
  el('reportBody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.kind)}</td>
      <td>${esc(r.token_no || '—')}</td>
      <td>${esc(r.name || '—')}</td>
      <td>${esc(r.roll_no || '—')}</td>
      <td>${esc(r.room_no || '—')}</td>
      <td>${esc(r.period || '—')}</td>
      <td>${esc(r.reason || '—')}</td>
      <td><span class="${pillClass(r.status)}">${esc(r.status)}</span></td>
      <td>${esc(r.decided_by || '—')}</td>
      <td>${r.decided_at ? fmtDate(r.decided_at) : '—'}</td>
      <td>${esc(r.rejection_reason || '—')}</td>
    </tr>`).join('')
    : `<tr><td colspan="11"><div class="empty-state"><i class="fa-regular fa-file"></i>
         No outpass or leave requests match this filter.</div></td></tr>`;
}

function exportReportCsv() {
  if (!reportData || !(reportData.rows || []).length) {
    return notify('warning', 'Nothing to export', 'Generate a report with at least one row first.');
  }
  const cols = ['kind', 'token_no', 'name', 'roll_no', 'room_no', 'period', 'reason', 'status', 'decided_by', 'decided_on', 'rejection_reason'];
  const csv = [cols.join(',')].concat(
    reportData.rows.map(r => cols.map(c => `"${String(r[c] === undefined ? '' : r[c]).replace(/"/g, '""')}"`).join(','))
  ).join('\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `hostelerp-request-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------
   Filters + stat strip
   ------------------------------------------------------------ */
function renderStatStrip() {
  const o = overviewData;
  if (!o || !o.students) return;
  const sets = {
    students: [['info', o.students.total, 'Total'], ['ok', o.students.approved, 'Approved'],
      ['warn', o.students.pending, 'Pending'], ['bad', o.students.rejected, 'Rejected']],
    wardens: [['info', o.wardens.total, 'Total'], ['ok', o.wardens.active, 'Active'],
      ['warn', o.wardens.pending, 'Awaiting Approval'], ['bad', o.wardens.rejected, 'Rejected']],
    security: [['info', o.gatekeepers.total, 'Total'], ['ok', o.gatekeepers.active, 'Active']],
    rooms: [['info', o.rooms.total, 'Total Rooms'], ['ok', o.rooms.available, 'Available'],
      ['warn', o.rooms.occupied, 'Occupied']],
    approvals: [['warn', o.wardens.pending, 'Pending'], ['ok', o.wardens.active, 'Approved / Active'],
      ['bad', o.wardens.rejected, 'Rejected']],
    reports: [['ok', o.outpass.approved, 'Outpass Approved'], ['bad', o.outpass.rejected, 'Outpass Rejected'],
      ['ok', o.leave.approved, 'Leave Approved'], ['bad', o.leave.rejected, 'Leave Rejected']]
  };
  const cards = sets[SECTION];
  if (!cards) return;
  const strip = el('statStrip');
  strip.style.display = 'grid';
  strip.innerHTML = cards.map(([cls, value, label]) =>
    `<div class="admin-stat ${cls}"><b>${value === undefined ? 0 : value}</b><span>${esc(label)}</span></div>`).join('');
}

function buildFilters() {
  const def = DEFINITIONS[SECTION];
  el('search').placeholder = def.searchHint || 'Search...';

  if (def.statuses) {
    el('statusFilter').innerHTML = '<option value="all">All statuses</option>' +
      def.statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    el('statusFilter').style.display = 'inline-block';
  }

  const extraField = SECTION === 'students' ? 'department'
    : SECTION === 'wardens' ? 'department'
    : SECTION === 'security' ? 'gate'
    : SECTION === 'rooms' ? 'block' : null;

  if (extraField) {
    const values = [...new Set((data[SECTION] || []).map(r => String(r[extraField] || '').trim()).filter(Boolean))].sort();
    const sel = el('extraFilter');
    sel.dataset.field = extraField;
    sel.innerHTML = `<option value="all">All ${extraField.replace(/_/g, ' ')}s</option>` +
      values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.style.display = 'inline-block';
  }
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
(async () => {
  const admin = initAdminShell(SECTION, { showSearch: false });
  if (!admin) return;

  const def = DEFINITIONS[SECTION];
  if (el('pageTitle') && def) el('pageTitle').textContent = def.title;
  if (el('pageIcon') && def) el('pageIcon').className = `fa-solid ${def.icon} greet-icon`;

  try {
    if (SECTION === 'approvals') {
      await Promise.all([loadApprovals(), loadOverview().catch(() => {})]);
      el('approvalPanel').style.display = 'block';
      renderStatStrip();
      renderApprovals();
      return;
    }

    if (SECTION === 'reports') {
      await loadOverview().catch(() => {});
      el('reportPanel').style.display = 'block';
      renderStatStrip();
      el('reportRun').onclick = runReport;
      el('reportExport').onclick = exportReportCsv;
      await runReport();
      return;
    }

    await loadManagement();

    /* List modules */
    await loadOverview().catch(() => {});
    if (SECTION === 'students') {
      try {
        const body = await api('/api/admin-management/reports/requests?type=all&status=all');
        overviewData.__requests = (body.report && body.report.rows) || [];
      } catch (e) { overviewData.__requests = []; }
    }

    el('tablePanel').style.display = 'block';
    buildFilters();
    renderStatStrip();

    el('search').oninput = renderTable;
    if (el('statusFilter')) el('statusFilter').onchange = renderTable;
    if (el('extraFilter')) el('extraFilter').onchange = renderTable;

    const addBtn = el('addButton');
    if (addBtn) {
      addBtn.style.display = def.type === 'entity' ? 'inline-flex' : 'none';
      addBtn.onclick = () => openForm();
    }

    renderTable();
  } catch (e) {
    notify('error', 'Unable to load data', e.message);
    console.error(e);
  }
})();
