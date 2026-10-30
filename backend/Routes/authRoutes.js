const express = require("express");
const router = express.Router();
const {
    loginUnified,
    forgotPassword,
    verifyResetToken,
    resetPassword
} = require("../controllers/authController");

router.post("/login", loginUnified);
router.post("/forgot-password", forgotPassword);
router.get("/verify-reset-token", verifyResetToken);
router.post("/verify-reset-token", verifyResetToken);
router.post("/reset-password", resetPassword);

module.exports = router;

