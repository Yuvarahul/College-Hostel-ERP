const path = require("path");
const { readCSV, writeCSV } = require("../services/csvService");
const { roomHeaders, studentHeaders } = require("../services/dbInit");
const { sendStudentApprovalEmail } = require("../services/emailService");

const roomsCsv = path.join(__dirname, "../database/rooms.csv");
const studentsCsv = path.join(__dirname, "../database/students.csv");
const registrationsCsv = path.join(__dirname, "../database/registrations.csv");

// Atomic student sync helper
async function updateStudentsAtomically(studentsList) {
    await writeCSV(studentsCsv, studentHeaders, studentsList);
    try {
        await writeCSV(registrationsCsv, studentHeaders, studentsList);
    } catch (e) {
        console.warn("Could not sync registrations.csv:", e.message);
    }
}

// Helper to compute live room details from students and rooms CSV
async function getLiveRooms() {
    let rooms = await readCSV(roomsCsv);
    const students = await readCSV(studentsCsv);

    // Fallback: If rooms is completely empty, initialize from defaults
    if (!rooms || rooms.length === 0) {
        const blocks = ["A", "B", "C", "D"];
        const floors = [1, 2, 3];
        rooms = [];
        blocks.forEach(b => {
            floors.forEach(f => {
                for (let num = 1; num <= 20; num++) {
                    const padNum = String(num).padStart(2, "0");
                    rooms.push({
                        room_id: `${b}${f}${padNum}`,
                        block: b,
                        floor: String(f),
                        capacity: "4",
                        occupied: "0",
                        status: "Available",
                        maintenance: "false",
                        occupants: ""
                    });
                }
            });
        });
        await writeCSV(roomsCsv, roomHeaders, rooms);
    }

    // Only students who are Approved with a valid room count as actively occupying a bed
    const approvedWithRoom = students.filter(s =>
        String(s.status || "").trim().toLowerCase() === "approved" &&
        s.room_no &&
        String(s.room_no).trim() !== "" &&
        String(s.room_no).trim().toLowerCase() !== "not allocated"
    );

    const liveRooms = rooms.map(room => {
        const matchingStudents = approvedWithRoom.filter(s =>
            String(s.room_no || "").trim().toUpperCase() === String(room.room_id || "").trim().toUpperCase()
        );

        const occupiedCount = matchingStudents.length;
        const capacity = parseInt(room.capacity || 4, 10);
        const isMaintenance = String(room.maintenance || "").toLowerCase() === "true";

        let status = "Available";
        if (isMaintenance) {
            status = "Maintenance";
        } else if (occupiedCount >= capacity) {
            status = "Full";
        } else if (occupiedCount > 0) {
            status = "Partially Filled";
        }

        const occupantsDetails = matchingStudents.map((s, idx) => ({
            id: s.admission_no || s.roll_no,
            roll: s.roll_no || s.admission_no,
            admissionNo: s.admission_no || "",
            name: s.full_name || "",
            dept: s.department || "",
            year: s.year || "",
            phone: s.phone_no || "",
            bed: idx + 1
        }));

        return {
            id: room.room_id,
            room_id: room.room_id,
            block: room.block || room.room_id[0] || "A",
            floor: room.floor || room.room_id[1] || "1",
            capacity: capacity,
            occupied: occupiedCount,
            available: Math.max(0, capacity - occupiedCount),
            status: status,
            maintenance: isMaintenance,
            occupants: occupantsDetails
        };
    });

    return { liveRooms, students, rooms };
}

// GET /api/rooms
const getAllRooms = async (req, res) => {
    try {
        const { block, floor, status, q } = req.query;
        const { liveRooms } = await getLiveRooms();
        let rooms = liveRooms;

        if (block) {
            rooms = rooms.filter(r => String(r.block).toUpperCase() === block.toUpperCase());
        }
        if (floor) {
            rooms = rooms.filter(r => String(r.floor) === String(floor));
        }
        if (status) {
            rooms = rooms.filter(r => String(r.status).toLowerCase() === status.toLowerCase());
        }
        if (q) {
            const query = q.toLowerCase();
            rooms = rooms.filter(r =>
                r.room_id.toLowerCase().includes(query) ||
                r.occupants.some(o => o.name.toLowerCase().includes(query) || (o.roll && o.roll.toLowerCase().includes(query)))
            );
        }

        return res.status(200).json({
            success: true,
            total: rooms.length,
            rooms: rooms
        });
    } catch (error) {
        console.error("Get rooms error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/rooms/stats
const getRoomStats = async (req, res) => {
    try {
        const { liveRooms, students } = await getLiveRooms();

        // Dynamically compute total room capacity from the room records in database
        const totalRooms = liveRooms.length;
        const totalBeds = liveRooms.reduce((sum, r) => sum + (parseInt(r.capacity, 10) || 0), 0);

        // Count only approved students who have a room allocated
        const occupiedBeds = students.filter(s =>
            String(s.status || "").trim().toLowerCase() === "approved" &&
            s.room_no &&
            String(s.room_no).trim() !== "" &&
            String(s.room_no).trim().toLowerCase() !== "not allocated"
        ).length;

        const availableBeds = Math.max(0, totalBeds - occupiedBeds);

        const occupiedRooms = liveRooms.filter(r => r.occupied > 0).length;
        const availableRooms = liveRooms.filter(r => r.status === "Available").length;
        const partiallyFilledRooms = liveRooms.filter(r => r.status === "Partially Filled").length;
        const fullRooms = liveRooms.filter(r => r.status === "Full").length;
        const maintenanceRooms = liveRooms.filter(r => r.status === "Maintenance").length;

        // Waiting for allocation: students whose room is empty or unallocated and not rejected/inactive
        const waitingStudents = students.filter(s =>
            String(s.status || "").trim().toLowerCase() !== "rejected" &&
            String(s.status || "").trim().toLowerCase() !== "inactive" &&
            (!s.room_no || String(s.room_no).trim() === "" || String(s.room_no).trim().toLowerCase() === "not allocated")
        ).length;

        const stats = {
            totalRooms,
            totalBeds,
            occupiedBeds,
            filledBeds: occupiedBeds,
            availableBeds,
            vacantBeds: availableBeds,
            occupiedRooms,
            availableRooms,
            partiallyFilledRooms,
            fullRooms,
            maintenanceRooms,
            waitingStudents
        };

        return res.status(200).json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error("Get room stats error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/rooms/waiting-students
const getStudentsWaitingForAllocation = async (req, res) => {
    try {
        const students = await readCSV(studentsCsv);
        // A waiting student is any student whose room is empty or "Not Allocated" and status is not rejected or inactive
        const waiting = students.filter(s =>
            String(s.status || "").trim().toLowerCase() !== "rejected" &&
            String(s.status || "").trim().toLowerCase() !== "inactive" &&
            (!s.room_no || String(s.room_no).trim() === "" || String(s.room_no).trim().toLowerCase() === "not allocated")
        ).map((s, idx) => {
            const { password, ...safeStudent } = s;
            return {
                id: idx + 1,
                admissionNo: s.admission_no || "",
                roll: s.roll_no || s.admission_no || "",
                name: s.full_name || "",
                email: s.email || "",
                phone: s.phone_no || "",
                dept: s.department || "",
                year: s.year || "",
                parentPhone: s.parents_phone || "",
                address: s.address || "",
                room: s.room_no || "",
                status: s.status || "Pending",
                hostellerType: s.roll_no?.trim() ? "Senior" : "Fresher",
                registeredAt: s.created_at || ""
            };
        });

        return res.status(200).json({
            success: true,
            total: waiting.length,
            students: waiting
        });
    } catch (error) {
        console.error("Get waiting students error:", error);
        return res.status(500).json({ success: false, message: "Server Error", students: [] });
    }
};

// POST /api/rooms/allocate
const allocateRoom = async (req, res) => {
    try {
        const { student_id, admission_no, roll_no, room_no, bed, block, floor, approved_by, registration_status } = req.body;
        const targetId = String(student_id || roll_no || admission_no || "").trim().toLowerCase();
        const targetRoom = String(room_no || "").trim().toUpperCase();

        if (!targetId || !targetRoom) {
            return res.status(400).json({ success: false, message: "Student ID and Room Number are required." });
        }

        const { liveRooms, students } = await getLiveRooms();

        const sIdx = students.findIndex(s =>
            String(s.admission_no || "").trim().toLowerCase() === targetId ||
            String(s.roll_no || "").trim().toLowerCase() === targetId
        );

        if (sIdx === -1) {
            return res.status(404).json({ success: false, message: "Student not found in database." });
        }

        const currentStudent = students[sIdx];
        const existingRoom = String(currentStudent.room_no || "").trim().toUpperCase();

        // A room is an ACTIVE allocation only when the student is already Approved.
        // During a pending registration, room_no may contain stale/old data from a
        // previous attempt. Warden approval must be allowed to replace that value
        // with the newly selected Block/Floor/Room/Bed.
        const studentStatus = String(currentStudent.status || "").trim().toLowerCase();
        const requestStatus = String(registration_status || "").trim().toLowerCase();

        // A pending registration is a NEW allocation request. If an old/stale
        // room number exists on that pending row, it must not block allocation.
        // The frontend sends registration_status explicitly, so this remains true
        // even if the student record contains stale room data.
        const isPendingRegistration = requestStatus === "pending" || studentStatus === "pending";
        const hasActiveApprovedRoom =
            !isPendingRegistration &&
            studentStatus === "approved" &&
            existingRoom &&
            existingRoom !== "NOT ALLOCATED";

        if (hasActiveApprovedRoom && existingRoom !== targetRoom) {
            return res.status(400).json({
                success: false,
                message: `Student already has an active room allocation (Room ${existingRoom}). Please use Transfer Room instead.`
            });
        }

        const roomObj = liveRooms.find(r => String(r.room_id || "").toUpperCase() === targetRoom);
        if (!roomObj) {
            return res.status(404).json({ success: false, message: `Room ${targetRoom} not found in database.` });
        }

        if (roomObj.maintenance) {
            return res.status(400).json({ success: false, message: `Room ${targetRoom} is currently under maintenance.` });
        }

        // Prevent allocation into full room
        if (existingRoom !== targetRoom && roomObj.occupied >= roomObj.capacity) {
            return res.status(400).json({
                success: false,
                message: `Room ${targetRoom} is full (${roomObj.occupied}/${roomObj.capacity} capacity).`
            });
        }

        // Prevent double bed occupancy if bed number is specified
        if (bed) {
            const bedNum = parseInt(bed, 10);
            if (isNaN(bedNum) || bedNum < 1 || bedNum > roomObj.capacity) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid bed number ${bed}. Room ${targetRoom} has beds 1 to ${roomObj.capacity}.`
                });
            }
            const bedOccupied = (roomObj.occupants || []).some(o =>
                parseInt(o.bed, 10) === bedNum &&
                String(o.roll || o.id || "").toLowerCase() !== targetId
            );
            if (bedOccupied) {
                return res.status(400).json({
                    success: false,
                    message: `Bed ${bedNum} in Room ${targetRoom} is already occupied.`
                });
            }
        }

        // Update student record
        students[sIdx].room_no = targetRoom;
        students[sIdx].status = "Approved";
        students[sIdx].approved_date = students[sIdx].approved_date || new Date().toLocaleDateString("en-IN");
        students[sIdx].approved_by = approved_by || students[sIdx].approved_by || "Warden";

        // Save atomically to students.csv and registrations.csv
        await updateStudentsAtomically(students);

        // Sync rooms.csv occupancy records
        const freshRooms = (await getLiveRooms()).liveRooms;
        const updatedRawRooms = freshRooms.map(r => ({
            room_id: r.room_id,
            block: r.block,
            floor: r.floor,
            capacity: String(r.capacity),
            occupied: String(r.occupied),
            status: r.status,
            maintenance: String(r.maintenance),
            occupants: r.occupants.map(o => o.roll || o.admissionNo).join(";")
        }));
        await writeCSV(roomsCsv, roomHeaders, updatedRawRooms);

        const { password, ...safeStudent } = students[sIdx];
        const allocatedRoom = freshRooms.find(r => String(r.room_id).toUpperCase() === targetRoom);

        // Approval email is sent only after the room has been successfully allocated.
        // This keeps registration approval and room allocation as one Warden action.
        sendStudentApprovalEmail({
            ...students[sIdx],
            room_no: targetRoom,
            room_block: allocatedRoom?.block || block || "",
            room_floor: allocatedRoom?.floor || floor || "",
            room_bed: bed || ""
        }).catch(emailError => {
            console.error("Could not send student approval email:", emailError.message);
        });

        return res.status(200).json({
            success: true,
            message: `Room ${targetRoom} allocated successfully to ${students[sIdx].full_name}.`,
            student: safeStudent,
            room: freshRooms.find(r => r.room_id === targetRoom)
        });

    } catch (error) {
        console.error("Allocate room error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// POST /api/rooms/vacate
const vacateRoom = async (req, res) => {
    try {
        const { student_id, admission_no, roll_no, reason } = req.body;
        const targetId = String(student_id || roll_no || admission_no || "").trim().toLowerCase();

        if (!targetId) {
            return res.status(400).json({ success: false, message: "Student ID is required." });
        }

        const students = await readCSV(studentsCsv);
        const sIdx = students.findIndex(s =>
            String(s.admission_no || "").trim().toLowerCase() === targetId ||
            String(s.roll_no || "").trim().toLowerCase() === targetId
        );

        if (sIdx === -1) {
            return res.status(404).json({ success: false, message: "Student not found in database." });
        }

        const oldRoom = students[sIdx].room_no;
        students[sIdx].room_no = "";

        await updateStudentsAtomically(students);

        // Sync rooms.csv
        const freshRooms = (await getLiveRooms()).liveRooms;
        const updatedRawRooms = freshRooms.map(r => ({
            room_id: r.room_id,
            block: r.block,
            floor: r.floor,
            capacity: String(r.capacity),
            occupied: String(r.occupied),
            status: r.status,
            maintenance: String(r.maintenance),
            occupants: r.occupants.map(o => o.roll || o.admissionNo).join(";")
        }));
        await writeCSV(roomsCsv, roomHeaders, updatedRawRooms);

        return res.status(200).json({
            success: true,
            message: `Student ${students[sIdx].full_name} vacated from Room ${oldRoom || "unallocated"}.`,
            oldRoom: oldRoom
        });
    } catch (error) {
        console.error("Vacate room error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// POST /api/rooms/transfer
const transferRoom = async (req, res) => {
    try {
        const { student_id, admission_no, roll_no, new_room_no, reason } = req.body;
        const targetId = String(student_id || roll_no || admission_no || "").trim().toLowerCase();
        const targetRoom = String(new_room_no || "").trim().toUpperCase();

        if (!targetId || !targetRoom) {
            return res.status(400).json({ success: false, message: "Student ID and New Room Number are required." });
        }

        const { liveRooms, students } = await getLiveRooms();

        const sIdx = students.findIndex(s =>
            String(s.admission_no || "").trim().toLowerCase() === targetId ||
            String(s.roll_no || "").trim().toLowerCase() === targetId
        );

        if (sIdx === -1) {
            return res.status(404).json({ success: false, message: "Student not found." });
        }

        const roomObj = liveRooms.find(r => String(r.room_id || "").toUpperCase() === targetRoom);
        if (!roomObj) {
            return res.status(404).json({ success: false, message: `Room ${targetRoom} not found.` });
        }

        if (roomObj.maintenance) {
            return res.status(400).json({ success: false, message: `Room ${targetRoom} is under maintenance.` });
        }

        if (roomObj.occupied >= roomObj.capacity) {
            return res.status(400).json({ success: false, message: `Room ${targetRoom} is full.` });
        }

        const oldRoom = students[sIdx].room_no;
        students[sIdx].room_no = targetRoom;

        await updateStudentsAtomically(students);

        return res.status(200).json({
            success: true,
            message: `Student ${students[sIdx].full_name} transferred from Room ${oldRoom} to Room ${targetRoom}.`,
            oldRoom,
            newRoom: targetRoom
        });
    } catch (error) {
        console.error("Transfer room error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// POST /api/rooms/maintenance
const toggleMaintenance = async (req, res) => {
    try {
        const { room_id, maintenance } = req.body;
        if (!room_id) {
            return res.status(400).json({ success: false, message: "Room ID is required." });
        }

        const rooms = await readCSV(roomsCsv);
        const idx = rooms.findIndex(r => String(r.room_id || "").trim().toUpperCase() === String(room_id).trim().toUpperCase());

        if (idx !== -1) {
            rooms[idx].maintenance = String(maintenance === undefined ? (rooms[idx].maintenance !== "true") : maintenance);
            await writeCSV(roomsCsv, roomHeaders, rooms);
        }

        return res.status(200).json({
            success: true,
            message: `Maintenance status updated for room ${room_id}.`
        });
    } catch (error) {
        console.error("Toggle maintenance error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

module.exports = {
    getAllRooms,
    getRoomStats,
    getStudentsWaitingForAllocation,
    allocateRoom,
    vacateRoom,
    transferRoom,
    toggleMaintenance
};

