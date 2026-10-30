require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");

const { initDB } = require("./services/dbInit");

// ============================================================
// ROUTES
// ============================================================

const authRoutes = require("./Routes/authRoutes");
const studentRoutes = require("./Routes/studentRoutes");
const wardenRoutes = require("./Routes/wardenRoutes");
const adminRoutes = require("./Routes/adminRoutes");
const leaveRoutes = require("./Routes/leaveRoutes");
const outpassRoutes = require("./Routes/outpassRoutes");
const roomRoutes = require("./Routes/roomRoutes");
const notificationRoutes = require("./Routes/notificationRoutes");
const gatekeeperRoutes = require("./Routes/gatekeeperRoutes");
const adminManagementRoutes = require("./Routes/adminManagementRoutes");

// ============================================================
// CONTROLLERS
// ============================================================

const {
    getStudentRegistrations
} = require("./controllers/studentController");

const {
    getActivityFeed
} = require("./controllers/adminController");

// ============================================================
// EXPRESS APP
// ============================================================

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);

// ============================================================
// SERVE UPLOADED FILES
// ============================================================

app.use(
    "/uploads",
    express.static(
        path.join(__dirname, "uploads")
    )
);

// ============================================================
// API ROUTES
// ============================================================

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/students",
    studentRoutes
);

app.use(
    "/api/wardens",
    wardenRoutes
);

app.use(
    "/api/warden",
    wardenRoutes
);

app.use(
    "/api/admin",
    adminRoutes
);

app.use(
    "/api/leave",
    leaveRoutes
);

app.use(
    "/api/outpass",
    outpassRoutes
);

app.use(
    "/api/rooms",
    roomRoutes
);

app.use(
    "/api/notifications",
    notificationRoutes
);

app.use(
    "/api/gatekeeper",
    gatekeeperRoutes
);

app.use(
    "/api/admin-management",
    adminManagementRoutes
);

// ============================================================
// DIRECT API ENDPOINTS
// ============================================================

app.get(
    "/api/registrations",
    getStudentRegistrations
);

app.get(
    "/api/activities",
    getActivityFeed
);

// ============================================================
// SERVE FRONTEND
// ============================================================

app.use(
    express.static(
        path.join(__dirname, "..")
    )
);

// ============================================================
// API STATUS
// ============================================================

app.get(
    "/api-status",
    (req, res) => {

        res.json({
            success: true,
            message: "HostelERP Node.js Backend is Running!",
            timestamp: new Date().toISOString()
        });

    }
);

// ============================================================
// 404 HANDLER FOR UNKNOWN API ROUTES
// ============================================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({
            success: false,
            message: "API route not found",
            path: req.originalUrl
        });

    }
);

// ============================================================
// PORT
// ============================================================

const PORT = process.env.PORT || 3000;
const { STATIC_ADMIN } = require("./config/adminCredentials");
const adminUsername = STATIC_ADMIN.admin_id;
const adminPassword = STATIC_ADMIN.password;

// ============================================================
// START SERVER
// ============================================================

async function startServer() {

    try {

        // Initialize database first
        await initDB();

        console.log(
            "HostelERP Database initialized successfully."
        );

        // Start Express server
        const server = app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    "==========================================="
                );

                console.log(
                    ` HostelERP Backend running on http://localhost:${PORT}`
                );

                console.log(
                    ` Frontend available at http://localhost:${PORT}/index.html`
                );

                console.log(
                    ` API Status: http://localhost:${PORT}/api-status`
                );

                // Shown here, in the server's own console, and nowhere
                // else — not in any file that ships with the project —
                // so only whoever actually runs the server sees the
                // Admin Portal login. Change it in backend/.env.
                console.log(
                    "==========================================="
                );
                console.log(
                    ` Admin Portal login  ->  username: ${adminUsername}  |  password: ${adminPassword}`
                );
                console.log(
                    "   (set in backend/.env as ADMIN_USERNAME / ADMIN_PASSWORD)"
                );

                console.log(
                    "==========================================="
                );

                console.log(
                    "Server is actively listening. Keep this terminal open."
                );
            }
        );

        // Catch server-level errors
        server.on(
            "error",
            (err) => {

                console.error(
                    "SERVER ERROR:",
                    err
                );

            }
        );

        // Confirm when server closes
        server.on(
            "close",
            () => {

                console.log(
                    "WARNING: Express server has been closed."
                );

            }
        );

    } catch (err) {

        console.error(
            "Database initialization failed:",
            err
        );

        // Try starting server even if DB initialization has warnings
        const server = app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    "==========================================="
                );

                console.log(
                    `HostelERP Backend running on http://localhost:${PORT} (with DB warnings)`
                );

                console.log(
                    `Frontend available at http://localhost:${PORT}/index.html`
                );

                console.log(
                    ` Admin Portal login  ->  username: ${adminUsername}  |  password: ${adminPassword}`
                );

                console.log(
                    "==========================================="
                );

            }
        );

        server.on(
            "error",
            (serverError) => {

                console.error(
                    "SERVER ERROR:",
                    serverError
                );

            }
        );

    }

}

// ============================================================
// START
// ============================================================

startServer();