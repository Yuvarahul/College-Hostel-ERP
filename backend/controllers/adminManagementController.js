const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { readCSV, writeCSV } = require('../services/csvService');

const DB = path.join(__dirname, '../database');
const FILES = {
  students: path.join(DB, 'students.csv'),
  wardens: path.join(DB, 'warden.csv'),
  security: path.join(DB, 'gatekeeper.csv'),
  supervisors: path.join(DB, 'supervisors.csv'),
  rooms: path.join(DB, 'rooms.csv'),
  blocks: path.join(DB, 'blocks.csv'),
  departments: path.join(DB, 'departments.csv'),
  roles: path.join(DB, 'roles.csv'),
  permissions: path.join(DB, 'permissions.csv'),
  rolePermissions: path.join(DB, 'role_permissions.csv'),
  config: path.join(DB, 'hostel_config.json'),
  settings: path.join(DB, 'system_settings.json'),
  audit: path.join(DB, 'audit_logs.csv')
};

const HEADERS = {
  blocks: [{id:'block_id',title:'block_id'},{id:'name',title:'name'},{id:'description',title:'description'},{id:'status',title:'status'}],
  departments: [{id:'department_id',title:'department_id'},{id:'name',title:'name'},{id:'hod',title:'hod'},{id:'status',title:'status'}],
  roles: [{id:'role_id',title:'role_id'},{id:'name',title:'name'},{id:'description',title:'description'},{id:'status',title:'status'}],
  permissions: [{id:'permission_id',title:'permission_id'},{id:'name',title:'name'},{id:'description',title:'description'},{id:'status',title:'status'}],
  audit: [{id:'id',title:'id'},{id:'admin_id',title:'admin_id'},{id:'action',title:'action'},{id:'entity',title:'entity'},{id:'entity_id',title:'entity_id'},{id:'details',title:'details'},{id:'created_at',title:'created_at'}],
  rolePermissions: [{id:'role_id',title:'role_id'},{id:'permission_id',title:'permission_id'},{id:'status',title:'status'}],
  supervisors: [{id:'supervisor_id',title:'supervisor_id'},{id:'full_name',title:'full_name'},{id:'email',title:'email'},{id:'phone_no',title:'phone_no'},{id:'department',title:'department'},{id:'password',title:'password'},{id:'status',title:'status'},{id:'created_at',title:'created_at'}]
};

function safe(row) { const { password, ...rest } = row || {}; return rest; }
function clean(v) { return v === undefined || v === null ? '' : String(v).trim(); }
async function ensureFile(key) {
  if (key === 'config' || key === 'settings') {
    if (!fs.existsSync(FILES[key])) fs.writeFileSync(FILES[key], JSON.stringify({}, null, 2));
    return;
  }
  if (!fs.existsSync(FILES[key])) await writeCSV(FILES[key], HEADERS[key], []);
}
async function logAudit(adminId, action, entity, entityId, details) {
  await ensureFile('audit');
  const rows = await readCSV(FILES.audit);
  rows.unshift({ id: `AUD-${Date.now()}`, admin_id: adminId, action, entity, entity_id: entityId || '', details: details || '', created_at: new Date().toISOString() });
  await writeCSV(FILES.audit, HEADERS.audit, rows.slice(0, 2000));
}

function identityKey(entity, row) {
  return entity === 'students' ? (row.admission_no || row.roll_no) :
    entity === 'wardens' ? row.employee_id :
    entity === 'security' ? row.gatekeeper_id :
    entity === 'supervisors' ? row.supervisor_id :
    entity === 'rooms' ? row.room_id : row[`${entity.slice(0,-1)}_id`] || row.id;
}

async function listUsers(entity) {
  const rows = await readCSV(FILES[entity]);
  return rows.map(safe);
}

async function getManagement(req, res) {
  try {
    await ensureFile('rolePermissions');
    const [students, wardens, security, supervisors, rooms, blocks, departments, roles, permissions, rolePermissions, audit] = await Promise.all([
      listUsers('students'), listUsers('wardens'), listUsers('security'), listUsers('supervisors'), listUsers('rooms'),
      listUsers('blocks'), listUsers('departments'), listUsers('roles'), listUsers('permissions'), listUsers('rolePermissions'), listUsers('audit')
    ]);
    let config = {}, settings = {};
    try { config = JSON.parse(fs.readFileSync(FILES.config, 'utf8')); } catch {}
    try { settings = JSON.parse(fs.readFileSync(FILES.settings, 'utf8')); } catch {}
    res.json({ success:true, students, wardens, security, supervisors, rooms, blocks, departments, roles, permissions, rolePermissions, config, settings, audit });
  } catch (e) { console.error(e); res.status(500).json({success:false,message:'Unable to load admin management data.'}); }
}

async function toggleUser(req, res) {
  try {
    const { entity, id } = req.params;
    if (!FILES[entity] || !['students','wardens','security','supervisors'].includes(entity)) return res.status(400).json({success:false,message:'Unsupported user type.'});
    const rows = await readCSV(FILES[entity]);
    const row = rows.find(r => String(identityKey(entity,r)).toLowerCase() === String(id).toLowerCase());
    if (!row) return res.status(404).json({success:false,message:'User not found.'});
    const current = String(row.status || 'Active').toLowerCase();
    row.status = current === 'inactive' ? 'Active' : 'Inactive';
    await writeCSV(FILES[entity], Object.keys(rows[0] || row).map(k=>({id:k,title:k})), rows);
    await logAudit(req.admin.admin_id, row.status === 'Active' ? 'ACTIVATE' : 'DEACTIVATE', entity, id, `Account changed to ${row.status}`);
    res.json({success:true,status:row.status,user:safe(row)});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:'Unable to change account status.'}); }
}

async function saveEntity(req,res){
  try{
    const entity=req.params.entity;
    if(!['blocks','departments','roles','permissions','rooms'].includes(entity)) return res.status(400).json({success:false,message:'Unsupported entity.'});
    await ensureFile(entity);
    const rows=await readCSV(FILES[entity]);
    const data={}; Object.keys(req.body||{}).forEach(k=>data[k]=clean(req.body[k]));
    const key = entity==='rooms' ? 'room_id' : `${entity.slice(0,-1)}_id`;
    if(!data[key]) data[key]=`${entity.slice(0,-1).toUpperCase()}-${Date.now()}`;
    data.status=data.status||'Active';
    const idx=rows.findIndex(r=>String(r[key]).toLowerCase()===String(data[key]).toLowerCase());
    if(idx>=0) rows[idx]={...rows[idx],...data}; else rows.push(data);
    await writeCSV(FILES[entity], Object.keys(rows[0]||data).map(k=>({id:k,title:k})), rows);
    await logAudit(req.admin.admin_id, idx>=0?'UPDATE':'CREATE', entity, data[key], JSON.stringify(safe(data)));
    res.json({success:true,item:safe(data)});
  }catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to save data.'});}
}

async function saveSupervisor(req,res){
  try{
    await ensureFile('supervisors'); const rows=await readCSV(FILES.supervisors); const d={...req.body};
    if(!d.supervisor_id||!d.full_name) return res.status(400).json({success:false,message:'Supervisor ID and name are required.'});
    const idx=rows.findIndex(r=>r.supervisor_id===d.supervisor_id);
    if(d.password && !d.password.startsWith('$2b$') && !d.password.startsWith('$2a$')) d.password=await bcrypt.hash(d.password,10);
    else if(idx>=0 && !d.password) d.password=rows[idx].password;
    d.status=d.status||'Active'; d.created_at=d.created_at||new Date().toLocaleDateString('en-IN');
    if(idx>=0) rows[idx]={...rows[idx],...d}; else rows.push(d);
    await writeCSV(FILES.supervisors,HEADERS.supervisors,rows); await logAudit(req.admin.admin_id,idx>=0?'UPDATE':'CREATE','supervisors',d.supervisor_id,'Supervisor record updated');
    res.json({success:true,item:safe(d)});
  }catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to save supervisor.'});}
}

async function saveConfig(req,res){
  try{ const key=req.params.type; if(!['config','settings'].includes(key)) return res.status(400).json({success:false,message:'Invalid settings type.'}); fs.writeFileSync(FILES[key],JSON.stringify(req.body||{},null,2)); await logAudit(req.admin.admin_id,'UPDATE',key,'',JSON.stringify(req.body||{})); res.json({success:true,data:req.body||{}}); }catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to save settings.'});}
}

async function deleteEntity(req,res){
  try{const entity=req.params.entity; if(!['blocks','departments','roles','permissions','rooms'].includes(entity)) return res.status(400).json({success:false,message:'Unsupported entity.'}); const rows=await readCSV(FILES[entity]); const key=entity==='rooms'?'room_id':`${entity.slice(0,-1)}_id`; const next=rows.filter(r=>String(r[key]).toLowerCase()!==String(req.params.id).toLowerCase()); if(next.length===rows.length)return res.status(404).json({success:false,message:'Record not found.'}); await writeCSV(FILES[entity],Object.keys(rows[0]||{}).map(k=>({id:k,title:k})),next); await logAudit(req.admin.admin_id,'DELETE',entity,req.params.id,'Record deleted'); res.json({success:true});}catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to delete record.'});}
}

async function updateRolePermissions(req,res){
  try {
    await ensureFile('rolePermissions');
    const roleId=String(req.body.role_id||'').trim(); const permissions=Array.isArray(req.body.permissions)?req.body.permissions.map(String):[];
    if(!roleId)return res.status(400).json({success:false,message:'Role ID is required.'});
    const roles=await readCSV(FILES.roles); if(!roles.some(r=>String(r.role_id).toLowerCase()===roleId.toLowerCase()))return res.status(404).json({success:false,message:'Role not found.'});
    const all=await readCSV(FILES.rolePermissions); const next=all.filter(x=>String(x.role_id).toLowerCase()!==roleId.toLowerCase());
    permissions.forEach(pid=>next.push({role_id:roleId,permission_id:pid,status:'Active'}));
    await writeCSV(FILES.rolePermissions,HEADERS.rolePermissions,next);
    await logAudit(req.admin.admin_id,'UPDATE','role_permissions',roleId,`Assigned ${permissions.length} permissions to role`);
    res.json({success:true,role_id:roleId,permissions});
  } catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to update role permissions.'});}
}

async function assignStudentToRoom(req,res){
  try {
    const roomId=String(req.params.id||'').trim();
    const admission=String(req.body.admission_no||'').trim();
    if(!roomId||!admission)return res.status(400).json({success:false,message:'Room ID and student admission number are required.'});
    const rooms=await readCSV(FILES.rooms); const room=rooms.find(r=>String(r.room_id).toLowerCase()===roomId.toLowerCase());
    if(!room)return res.status(404).json({success:false,message:'Room not found.'});
    const students=await readCSV(FILES.students); const student=students.find(r=>String(r.admission_no).toLowerCase()===admission.toLowerCase());
    if(!student)return res.status(404).json({success:false,message:'Student not found.'});
    const capacity=parseInt(room.capacity||0,10); const occupied=parseInt(room.occupied||0,10);
    if(capacity && occupied>=capacity && String(student.room_no||'')!==roomId)return res.status(400).json({success:false,message:'Room is already full.'});
    student.room_no=roomId;
    if(String(student.status||'').toLowerCase()==='inactive')return res.status(400).json({success:false,message:'Cannot assign an inactive student.'});
    const studentHeaders=Object.keys(students[0]||student).map(k=>({id:k,title:k}));
    await writeCSV(FILES.students,studentHeaders,students);
    if(String(room.occupants||'').split('|').filter(Boolean).indexOf(admission)<0){room.occupants=room.occupants?`${room.occupants}|${admission}`:admission;room.occupied=String(occupied+1);}
    if(capacity && parseInt(room.occupied,10)>=capacity)room.status='Full'; else if(parseInt(room.occupied,10)>0 && String(room.status).toLowerCase()==='available')room.status='Partially Filled';
    await writeCSV(FILES.rooms,Object.keys(rooms[0]||room).map(k=>({id:k,title:k})),rooms);
    await logAudit(req.admin.admin_id,'ASSIGN','rooms',roomId,`Student ${admission} assigned to room`);
    res.json({success:true,room,user:safe(student)});
  } catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to assign student to room.'});}
}

async function report(req,res){
  try{const [students,wardens,security,supervisors,rooms]=await Promise.all(['students','wardens','security','supervisors','rooms'].map(e=>readCSV(FILES[e]))); res.json({success:true,report:{generated_at:new Date().toISOString(),students:{total:students.length,active:students.filter(x=>String(x.status).toLowerCase()!=='inactive').length},wardens:{total:wardens.length,active:wardens.filter(x=>String(x.status||'active').toLowerCase()!=='inactive').length},security:{total:security.length,active:security.filter(x=>String(x.status||'active').toLowerCase()!=='inactive').length},supervisors:{total:supervisors.length,active:supervisors.filter(x=>String(x.status||'active').toLowerCase()!=='inactive').length},rooms:{total:rooms.length,available:rooms.filter(x=>String(x.status).toLowerCase()==='available').length,occupied:rooms.filter(x=>parseInt(x.occupied||0)>0).length}}});}catch(e){console.error(e);res.status(500).json({success:false,message:'Unable to generate report.'});}
}

async function authAudit(req,res){
  try {
    const action = String(req.body.action || '').toUpperCase();
    if (!['LOGIN','LOGOUT'].includes(action)) return res.status(400).json({success:false,message:'Invalid audit action.'});
    const adminId = req.admin?.admin_id || String(req.headers['x-admin-id'] || '');
    await logAudit(adminId, action, 'admin', adminId, `Admin ${action.toLowerCase()}`);
    res.json({success:true});
  } catch(e) {
    console.error(e);
    res.status(500).json({success:false,message:'Unable to write audit log.'});
  }
}

module.exports={getManagement,toggleUser,saveEntity,saveSupervisor,saveConfig,deleteEntity,report,authAudit,assignStudentToRoom,updateRolePermissions};
