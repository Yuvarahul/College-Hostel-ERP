const express = require('express');
const router = express.Router();
const { readCSV } = require('../services/csvService');
const path = require('path');
const { overview, listWardenApprovals, decideWardenApproval, requestReport } = require('../controllers/adminPortalController');
const { getManagement, toggleUser, saveEntity, saveSupervisor, saveConfig, deleteEntity, report, authAudit, assignStudentToRoom, updateRolePermissions } = require('../controllers/adminManagementController');

const adminCsv = path.join(__dirname,'../database/admin.csv');
const { isStaticAdminId, staticAdminRecord } = require('../config/adminCredentials');
async function requireAdmin(req,res,next){
  try{
    const id=String(req.headers['x-admin-id']||'').trim().toLowerCase();
    if(!id)return res.status(401).json({success:false,message:'Admin authentication required.'});

    // The shared static admin login always has full portal access.
    if(isStaticAdminId(id)){ req.admin=staticAdminRecord(); return next(); }

    const admins=await readCSV(adminCsv); const admin=admins.find(a=>String(a.admin_id).trim().toLowerCase()===id||String(a.email).trim().toLowerCase()===id);
    if(!admin || String(admin.status||'active').toLowerCase()==='inactive') return res.status(403).json({success:false,message:'Active admin access required.'});
    req.admin=admin; next();
  }catch(e){res.status(500).json({success:false,message:'Authentication check failed.'});}
}
router.use(requireAdmin);
router.get('/',getManagement);
router.get('/report',report);
router.get('/overview',overview);
router.get('/warden-approvals',listWardenApprovals);
router.patch('/warden-approvals/:employee_id',decideWardenApproval);
router.get('/reports/requests',requestReport);
router.post('/audit/auth',authAudit);
router.patch('/users/:entity/:id/status',toggleUser);
router.patch('/rooms/:id/assign',assignStudentToRoom);
router.put('/role-permissions',updateRolePermissions);
router.post('/entity/:entity',saveEntity);
router.delete('/entity/:entity/:id',deleteEntity);
router.post('/supervisor',saveSupervisor);
router.put('/settings/:type',saveConfig);
module.exports=router;
