/* ============================================================
   js/forget_password.js
   Frontend logic for Forgot Password & Reset Password flows.
   Connects to /api/auth/forgot-password, /api/auth/verify-reset-token,
   and /api/auth/reset-password.
   ============================================================ */

const API_BASE = (window.location.port === "3000") ? "" : "http://localhost:3000";

let currentRole = "student";
let resetToken = "";

// DOM Elements
const authAlert = document.getElementById("authAlert");
const roleBtnStudent = document.getElementById("roleBtnStudent");
const roleBtnWarden = document.getElementById("roleBtnWarden");
const roleToggleWrap = document.getElementById("roleToggleWrap");
const identifierLabel = document.getElementById("identifierLabel");
const identifierInput = document.getElementById("identifierInput");
const emailInput = document.getElementById("emailInput");
const submitForgotBtn = document.getElementById("submitForgotBtn");

const step1Box = document.getElementById("step1Box");
const stepEmailSentBox = document.getElementById("stepEmailSentBox");
const step2Box = document.getElementById("step2Box");
const step3Box = document.getElementById("step3Box");

const forgotPassForm = document.getElementById("forgotPassForm");
const resetPassForm = document.getElementById("resetPassForm");
const newPassInput = document.getElementById("newPass");
const confirmPassInput = document.getElementById("confirmPass");
const submitResetBtn = document.getElementById("submitResetBtn");

const backToLoginLink = document.getElementById("backToLoginLink");
const finalLoginBtn = document.getElementById("finalLoginBtn");

function showAlert(message, type = "error") {
  if (!authAlert) return;
  authAlert.textContent = message;
  authAlert.className = `alert show ${type}`;
}

function hideAlert() {
  if (!authAlert) return;
  authAlert.className = "alert";
  authAlert.textContent = "";
}

function selectRole(role) {
  currentRole = (role === "warden") ? "warden" : "student";
  if (currentRole === "warden") {
    roleBtnWarden.classList.add("active");
    roleBtnStudent.classList.remove("active");
    if (identifierLabel) identifierLabel.textContent = "Employee ID / Username";
    if (identifierInput) identifierInput.placeholder = "e.g. WRD1001 or warden";
    if (backToLoginLink) {
      backToLoginLink.href = "warden-login.html";
      backToLoginLink.textContent = "← Back to Warden Login";
    }
  } else {
    roleBtnStudent.classList.add("active");
    roleBtnWarden.classList.remove("active");
    if (identifierLabel) identifierLabel.textContent = "Admission No / Roll No";
    if (identifierInput) identifierInput.placeholder = "e.g. 24AI018 or AMJ2024001";
    if (backToLoginLink) {
      backToLoginLink.href = "student-login.html";
      backToLoginLink.textContent = "← Back to Student Login";
    }
  }
}

function resetFormState() {
  hideAlert();
  stepEmailSentBox.classList.add("hidden");
  step2Box.classList.add("hidden");
  step3Box.classList.add("hidden");
  step1Box.classList.remove("hidden");
  if (roleToggleWrap) roleToggleWrap.style.display = "flex";
}

// Password toggle eye button
document.querySelectorAll(".toggle-pass").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "🙈";
    } else {
      input.type = "password";
      btn.textContent = "👁️";
    }
  });
});

// Step 1: Submit Forgot Password Request
if (forgotPassForm) {
  forgotPassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const identifier = identifierInput ? identifierInput.value.trim() : "";
    const email = emailInput ? emailInput.value.trim() : "";

    if (!identifier && !email) {
      showAlert("Please enter your Identifier or registered Email address.");
      return;
    }

    submitForgotBtn.disabled = true;
    submitForgotBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Link...';

    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: currentRole,
          identifier: identifier,
          email: email
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to process password reset request.");
      }

      // Hide step 1 and show Email Sent confirmation
      step1Box.classList.add("hidden");
      if (roleToggleWrap) roleToggleWrap.style.display = "none";
      stepEmailSentBox.classList.remove("hidden");

    } catch (err) {
      console.error("Forgot password error:", err);
      showAlert(err.message || "Unable to send reset email. Please try again later.");
    } finally {
      submitForgotBtn.disabled = false;
      submitForgotBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Reset Link';
    }
  });
}

// Step 2: Verify Token & Submit New Password
if (resetPassForm) {
  resetPassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const newPassword = newPassInput ? newPassInput.value.trim() : "";
    const confirmPassword = confirmPassInput ? confirmPassInput.value.trim() : "";

    if (!newPassword || newPassword.length < 6) {
      showAlert("Password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      showAlert("Passwords do not match. Please re-enter.");
      return;
    }

    if (!resetToken) {
      showAlert("Invalid or missing reset token. Please request a new link.");
      return;
    }

    submitResetBtn.disabled = true;
    submitResetBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating Password...';

    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: resetToken,
          role: currentRole,
          newPassword: newPassword
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Password reset failed.");
      }

      // Show Step 3 Success Card
      step2Box.classList.add("hidden");
      step3Box.classList.remove("hidden");

      if (finalLoginBtn) {
        finalLoginBtn.onclick = () => {
          window.location.href = (currentRole === "warden") ? "warden-login.html" : "student-login.html";
        };
      }

    } catch (err) {
      console.error("Reset password error:", err);
      showAlert(err.message || "Unable to update password. Please try again.");
    } finally {
      submitResetBtn.disabled = false;
      submitResetBtn.innerHTML = '<i class="fa-solid fa-key"></i> Update Password';
    }
  });
}

// On page load: Check URL parameters
async function checkUrlParamsOnLoad() {
  const urlParams = new URLSearchParams(window.location.search);
  const roleParam = (urlParams.get("role") || "").trim().toLowerCase();
  const tokenParam = (urlParams.get("token") || "").trim();

  if (roleParam === "warden") {
    selectRole("warden");
  } else {
    selectRole("student");
  }

  if (tokenParam) {
    resetToken = tokenParam;
    // Verify token with backend
    try {
      showAlert("Verifying reset token...", "info");
      const res = await fetch(`${API_BASE}/api/auth/verify-reset-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: resetToken,
          role: currentRole
        })
      });

      const data = await res.json();
      hideAlert();

      if (!res.ok || !data.success) {
        showAlert(data.message || "Reset link is invalid or has expired. Please request a new one.");
        step1Box.classList.remove("hidden");
        return;
      }

      // Valid token -> show step 2 reset box directly
      step1Box.classList.add("hidden");
      if (roleToggleWrap) roleToggleWrap.style.display = "none";
      step2Box.classList.remove("hidden");

    } catch (err) {
      console.error("Token verification error:", err);
      showAlert("Could not verify reset token. Please check your network connection.");
    }
  }
}

document.addEventListener("DOMContentLoaded", checkUrlParamsOnLoad);