const express = require("express");
const router = express.Router();

const {
    getAllRooms,
    getRoomStats,
    getStudentsWaitingForAllocation,
    allocateRoom,
    vacateRoom,
    transferRoom,
    toggleMaintenance
} = require("../controllers/roomController");

router.get("/stats", getRoomStats);
router.get("/waiting-students", getStudentsWaitingForAllocation);
router.get("/waiting", getStudentsWaitingForAllocation);
router.post("/allocate", allocateRoom);
router.post("/vacate", vacateRoom);
router.post("/transfer", transferRoom);
router.post("/maintenance", toggleMaintenance);
router.get("/", getAllRooms);

module.exports = router;

