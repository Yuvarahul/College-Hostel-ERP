/* =========================================================
   Agurchand Manmull Jain College — Hostel Management ERP
   script.js  (demo-only, no backend)
   ========================================================= */

/* ---------------------------------------------------------
   Demo "database" — pre-admitted students eligible to
   register. In a real system this would come from a server.
   --------------------------------------------------------- */
const DEMO_ADMITTED_STUDENTS = [
  { admissionNo: "AMJ2024001", dob: "2005-06-14", name: "Karthik Raja S" },
  { admissionNo: "AMJ2024002", dob: "2005-11-02", name: "Divya Priya M" },
  { admissionNo: "AMJ2024003", dob: "2004-09-21", name: "Mohammed Aslam K" },
  { admissionNo: "AMJ2024004", dob: "2005-03-30", name: "Sowmiya R" },
  { admissionNo: "AMJ2024005", dob: "2004-12-08", name: "Praveen Kumar V" }
];

/* localStorage keys used to persist demo registrations */
const STORE_KEYS = {
  students: "hostelERP_students",
  wardens: "hostelERP_wardens",
  admins: "hostelERP_admins",
  gatekeepers: "hostelERP_gatekeepers",
  verifiedStudent: "hostelERP_verifiedStudent",
  studentSession: "hostelERP_studentSession",
  adminSession: "hostelERP_adminSession"
};

/* ---------------------------------------------------------
   CSV login account bootstrap (Admin)
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   Small helpers
   --------------------------------------------------------- */
function getStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch (e) {
    return {};
  }
}

function setStore(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

function goTo(url) {
  window.location.href = url;
}

function showAlert(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = "alert show " + type;
}

function hideAlert(el) {
  if (!el) return;
  el.className = "alert";
}

/* File upload validation — JPG / PNG / PDF, max 2 MB */
const ALLOWED_FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

function validateFileInput(fileInput, alertBox) {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    return true; // presence is checked separately via "required"
  }
  const file = fileInput.files[0];
  const nameLower = file.name.toLowerCase();
  const looksAllowed =
    ALLOWED_FILE_TYPES.includes(file.type) ||
    nameLower.endsWith(".jpg") ||
    nameLower.endsWith(".jpeg") ||
    nameLower.endsWith(".png") ||
    nameLower.endsWith(".pdf");

  if (!looksAllowed) {
    showAlert(alertBox, "ID proof must be a JPG, PNG, or PDF file.", "error");
    return false;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    showAlert(alertBox, "ID proof file must be under 2 MB.", "error");
    return false;
  }
  return true;
}

/* Passport photo validation — JPG / PNG, max 2 MB */
const PASSPORT_PHOTO_MAX_SIZE = 2 * 1024 * 1024;

function validatePassportPhoto(fileInput, alertBox) {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showAlert(alertBox, "Please upload your passport size photo.", "error");
    return false;
  }

  const file = fileInput.files[0];
  const nameLower = file.name.toLowerCase();
  const allowed =
    ["image/jpeg", "image/png"].includes(file.type) ||
    nameLower.endsWith(".jpg") ||
    nameLower.endsWith(".jpeg") ||
    nameLower.endsWith(".png");

  if (!allowed) {
    showAlert(alertBox, "Passport photo must be a JPG or PNG image.", "error");
    return false;
  }

  if (file.size > PASSPORT_PHOTO_MAX_SIZE) {
    showAlert(alertBox, "Passport photo must be under 2 MB.", "error");
    return false;
  }

  return true;
}

function initPassportPhotoPreview() {
  const input = document.getElementById("regPassportPhoto");
  const preview = document.getElementById("passportPhotoPreview");
  if (!input || !preview) return;

  input.addEventListener("change", () => {
    preview.innerHTML = "";
    const file = input.files && input.files[0];
    if (!file) return;

    if (!validatePassportPhoto(input, document.getElementById("registerAlert"))) {
      input.value = "";
      return;
    }

    const img = document.createElement("img");
    img.alt = "Passport photo preview";
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    preview.appendChild(img);
  });
}

/* ---------------------------------------------------------
   Role card navigation (index.html)
   --------------------------------------------------------- */
function initRoleCards() {
  const cards = document.querySelectorAll("[data-href]");
  cards.forEach((card) => {
    card.addEventListener("click", () => goTo(card.getAttribute("data-href")));
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goTo(card.getAttribute("data-href"));
      }
    });
  });
}

/* ---------------------------------------------------------
   Show / hide password toggles
   --------------------------------------------------------- */
function initPasswordToggles() {
  document.querySelectorAll(".toggle-pass").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (!input) return;
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.textContent = isHidden ? "🙈" : "👁️";
      btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  });
}

/* ---------------------------------------------------------
   Generic login handler
   storeKey   -> which localStorage bucket to check
   idField    -> id of the ID/number input
   passField  -> id of the password input
   alertId    -> id of the alert box
   successMsg -> message shown briefly before "redirect"
   --------------------------------------------------------- */
function handleLogin({
  formId,
  storeKey,
  idField,
  passField,
  alertId,
  roleLabel,
  redirectUrl = null,
  invalidMsg = "Invalid ID or password. Please check your credentials or register first.",
  approvalCheck = null,
  onSuccess = null
}) {
  const form = document.getElementById(formId);
  if (!form) return;
  const alertBox = document.getElementById(alertId);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const idVal = document.getElementById(idField).value.trim();
    const passVal = document.getElementById(passField).value;

    if (!idVal || !passVal) {
      showAlert(alertBox, "Please fill in both fields.", "error");
      return;
    }

    const store = getStore(storeKey);
    const record = store[idVal];

    if (record && record.password === passVal) {
      if (typeof approvalCheck === "function") {
        const check = approvalCheck(idVal);
        if (check && check.allowed === false) {
          showAlert(alertBox, check.message, "error");
          return;
        }
      }

      if (typeof onSuccess === "function") onSuccess(idVal, record);

      if (redirectUrl) {
        showAlert(alertBox, `Login successful. Welcome, ${record.name || roleLabel}! Redirecting…`, "success");
        setTimeout(() => goTo(redirectUrl), 800);
      } else {
        showAlert(alertBox, `Login successful. Welcome, ${record.name || roleLabel}! (Demo mode — no dashboard configured yet.)`, "success");
        form.reset();
      }
    } else {
      showAlert(alertBox, invalidMsg, "error");
    }
  });
}

/* ---------------------------------------------------------
   Student registration approval check — reads the warden-side
   registration record (registrations.js) if that script is
   present on the page. Pending/Rejected students are blocked
   from logging in until the warden approves them.
   --------------------------------------------------------- */
function studentApprovalCheck(idVal) {
  if (typeof findRegistrationByLoginId !== "function") return null; // registrations.js not loaded here
  const reg = findRegistrationByLoginId(idVal);
  if (!reg) return null; // no matching registration record — don't block

  if (reg.status === "Pending") {
    return { allowed: false, message: "Your registration is still awaiting warden approval. Please check back later." };
  }
  if (reg.status === "Rejected") {
    return { allowed: false, message: `Your registration was rejected (${reg.rejectionReason || "contact the hostel office"}).` };
  }
  return { allowed: true };
}

/* ---------------------------------------------------------
   Student registration — saves login credentials locally
   AND submits a Pending record into the warden-side
   registration-approval workflow (registrations.js), if that
   script is present on the page.
   --------------------------------------------------------- */
function handleStudentRegistration() {
  const form = document.getElementById("studentRegisterForm");
  if (!form) return;
  const alertBox = document.getElementById("registerAlert");

  form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert(alertBox);

  // Get form values
  const idVal = document.getElementById("regAdmissionNo").value.trim();
  const name = document.getElementById("regName").value.trim();
  const dept = document.getElementById("regDept").value;
  const year = document.getElementById("regYear").value;
  const phone = document.getElementById("regStudentContact").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const parentPhone = document.getElementById("regParentContact").value.trim();
  const address = document.getElementById("regAddress").value.trim();
  const passVal = document.getElementById("regPassword").value;
  const confirmVal = document.getElementById("regConfirmPassword").value;
  const fileInput = document.getElementById("regIdProof");
  const passportPhotoInput = document.getElementById("regPassportPhoto");

  // Email validation
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    showAlert(
      alertBox,
      "Please enter a valid email address.",
      "error"
    );
    return;
  }

  // Passport photo validation
  if (!validatePassportPhoto(passportPhotoInput, alertBox)) {
    return;
  }

  // ID proof validation
  if (!fileInput.files || fileInput.files.length === 0) {
    showAlert(
      alertBox,
      "Please upload your ID proof (JPG, PNG, or PDF, max 2 MB).",
      "error"
    );
    return;
  }

  if (!validateFileInput(fileInput, alertBox)) {
    return;
  }

  // Password validation
  if (passVal !== confirmVal) {
    showAlert(
      alertBox,
      "Passwords do not match.",
      "error"
    );
    return;
  }

  if (passVal.length < 6) {
    showAlert(
      alertBox,
      "Password must be at least 6 characters.",
      "error"
    );
    return;
  }

  try {

    // Send registration to Node.js backend
    const result = await submitRegistration({
      name: name,

      // Admission number is available when the student registers
      admissionNo: idVal,

      // Roll number will be added later
      roll: "",

      dept: dept,
      year: year,
      phone: phone,
      email: email,
      parentPhone: parentPhone,
      address: address,

      // Room allocation is handled later by the hostel/warden workflow.
      room: "",

      password: passVal,

      idProof: fileInput.files[0],
      passportPhoto: passportPhotoInput.files[0]
    });

    // Registration successful
    showAlert(
      alertBox,
      result.message ||
        "Registration submitted! Your account will be active once the warden approves it.",
      "success"
    );

    // Clear every form field and the uploaded-photo preview after a successful submission.
    form.reset();
    const photoPreview = document.getElementById("passportPhotoPreview");
    if (photoPreview) photoPreview.innerHTML = "";

  } catch (error) {

    showAlert(
      alertBox,
      error.message ||
        "Registration failed. Please try again.",
      "error"
    );

  }
});
}

/* ---------------------------------------------------------
   Gatekeeper login — delegates entirely to the GateKeeper
   module's own gkLogin() (gatekeeper/gatekeeper-data.js), which
   owns its own staff list, session, and lockout logic. Redirects
   into the module's dashboard on success.
   --------------------------------------------------------- */
function handleGatekeeperLogin() {
  const form = document.getElementById("gatekeeperLoginForm");
  if (!form) return;
  const alertBox = document.getElementById("loginAlert");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const idVal = document.getElementById("gGatekeeperId").value.trim();
    const passVal = document.getElementById("gPassword").value;

    if (!idVal || !passVal) {
      showAlert(alertBox, "Please fill in both fields.", "error");
      return;
    }

    if (typeof gkLogin !== "function") {
      showAlert(alertBox, "Gatekeeper module failed to load. Please contact the administrator.", "error");
      return;
    }

    const result = gkLogin(idVal, passVal);
    if (result.ok) {
      showAlert(alertBox, `Login successful. Welcome, ${result.session.name}! Redirecting…`, "success");
      setTimeout(() => goTo("gatekeeper/dashboard.html"), 800);
    } else {
      showAlert(alertBox, result.error, "error");
    }
  });
}

/* ---------------------------------------------------------
   Generic "forgot password" handler
   --------------------------------------------------------- */
function initForgotPassword() {
  document.querySelectorAll(".forgot-pass-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      alert("Please contact the Hostel Administration Office to reset your password. (Demo — self-service reset is not available.)");
    });
  });
}

/* ---------------------------------------------------------
   Generic registration handler
   --------------------------------------------------------- */
function handleRegister({
  formId,
  storeKey,
  idField,
  nameField,
  alertId,
  confirmField,
  passField,
  redirectUrl,
  emailField = null,
  fileFieldIds = [],
  extraFields = null // optional () => {...} merged into the saved record (e.g. status, registeredAt)
}) {
  const form = document.getElementById(formId);
  if (!form) return;
  const alertBox = document.getElementById(alertId);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const idVal = document.getElementById(idField).value.trim();
    const passVal = document.getElementById(passField).value;
    const confirmVal = document.getElementById(confirmField).value;

    if (emailField) {
      const emailInput = document.getElementById(emailField);
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(emailInput.value.trim())) {
        showAlert(alertBox, "Please enter a valid email address.", "error");
        return;
      }
    }

    for (const fid of fileFieldIds) {
      const fileInput = document.getElementById(fid);
      if (!fileInput) continue;
      if (fileInput.hasAttribute("required") && (!fileInput.files || fileInput.files.length === 0)) {
        showAlert(alertBox, "Please upload your ID proof (JPG, PNG, or PDF, max 2 MB).", "error");
        return;
      }
      if (!validateFileInput(fileInput, alertBox)) return;
    }

    if (passVal !== confirmVal) {
      showAlert(alertBox, "Passwords do not match.", "error");
      return;
    }
    if (passVal.length < 6) {
      showAlert(alertBox, "Password must be at least 6 characters.", "error");
      return;
    }

    const store = getStore(storeKey);
    if (store[idVal]) {
      showAlert(alertBox, "An account with this ID already exists. Please login instead.", "error");
      return;
    }

    // collect all named fields into a record
    const record = { password: passVal };
    form.querySelectorAll("input, select, textarea").forEach((input) => {
      if (!input.name) return;
      if (input.type === "file") {
        record[input.name] = input.files && input.files.length > 0 ? input.files[0].name : "";
      } else {
        record[input.name] = input.value.trim();
      }
    });
    record.name = document.getElementById(nameField) ? document.getElementById(nameField).value.trim() : "";
    if (typeof extraFields === "function") Object.assign(record, extraFields());

    store[idVal] = record;
    setStore(storeKey, store);

    showAlert(alertBox, "Registration successful! Redirecting to login…", "success");
    setTimeout(() => goTo(redirectUrl), 1200);
  });
}

/* ---------------------------------------------------------
   Student registration — CSV student name autocomplete
   Typing one or more starting letters searches students.csv
   through the Node.js backend and lets the user select a
   student. Selecting a student fills the registration fields.
   Password and ID proof remain manual for security/browser
   restrictions.
   --------------------------------------------------------- */
function initStudentCsvAutocomplete() {
  const nameInput = document.getElementById("regName");
  const list = document.getElementById("studentNameSuggestions");

  if (!nameInput || !list) return;

  let currentStudents = [];
  let activeIndex = -1;
  let searchTimer = null;
  let controller = null;

  function hideSuggestions() {
    list.style.display = "none";
    list.innerHTML = "";
    currentStudents = [];
    activeIndex = -1;
  }

  function showMessage(message) {
    list.innerHTML = `<div class="autocomplete-empty">${message}</div>`;
    list.style.display = "block";
  }

  function renderStudents(students) {
    currentStudents = students;
    activeIndex = -1;

    if (!students.length) {
      showMessage("No student found in students.csv.");
      return;
    }

    list.innerHTML = students.map((student, index) => `
      <div class="autocomplete-item" role="option" data-index="${index}">
        <div class="autocomplete-name">${escapeHtml(student.full_name || student.name || student.Student_Name || "Unnamed student")}</div>
        <div class="autocomplete-meta">
          ${escapeHtml(student.admission_no || "No admission number")}
          ${student.department ? " • " + escapeHtml(student.department) : ""}
        </div>
      </div>
    `).join("");

    list.style.display = "block";

    list.querySelectorAll(".autocomplete-item").forEach((item) => {
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectStudent(Number(item.dataset.index));
      });
    });
  }

  function setValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value || "";
  }

  function selectStudent(index) {
    const student = currentStudents[index];
    if (!student) return;

    setValue("regName", student.full_name || student.name || student.Student_Name || "");
    setValue("regAdmissionNo", student.admission_no);
    setValue("regStudentContact", student.phone_no);
    setValue("regEmail", student.email);
    setValue("regParentContact", student.parents_phone);
    setValue("regAddress", student.address);

    const dept = document.getElementById("regDept");
    if (dept) {
      const option = Array.from(dept.options).find(
        option => option.value.trim().toLowerCase() ===
                  String(student.department || "").trim().toLowerCase()
      );
      if (option) dept.value = option.value;
      else if (student.department) {
        // Keep the CSV value visible even if it is not one of
        // the existing predefined department options.
        const newOption = new Option(student.department, student.department);
        dept.add(newOption);
        dept.value = student.department;
      }
    }

    const year = document.getElementById("regYear");
    if (year) {
      const csvYear = String(student.year || "").trim();
      const option = Array.from(year.options).find(
        option => option.value.trim().toLowerCase() === csvYear.toLowerCase()
      );
      if (option) year.value = option.value;
      else if (csvYear) {
        const newOption = new Option(csvYear, csvYear);
        year.add(newOption);
        year.value = csvYear;
      }
    }

    hideSuggestions();
    nameInput.focus();
  }

  async function searchStudents(query) {
    if (controller) controller.abort();
    controller = new AbortController();

    showMessage("Searching students…");

    try {
      const response = await fetch(
        `/api/students/search?name=${encodeURIComponent(query)}`,
        {
          signal: controller.signal,
          headers: { "Accept": "application/json" }
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Student search failed.");
      }

      renderStudents(result.students || []);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Student CSV search error:", error);
      showMessage("Unable to connect to the student database. Make sure backend/server.js is running on port 3000.");
    }
  }

  nameInput.addEventListener("input", () => {
    const query = nameInput.value.trim();

    clearTimeout(searchTimer);

    if (!query) {
      hideSuggestions();
      return;
    }

    searchTimer = setTimeout(() => searchStudents(query), 180);
  });

  nameInput.addEventListener("keydown", (event) => {
    if (list.style.display !== "block" || !currentStudents.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentStudents.length - 1);
      updateActiveItem();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveItem();
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectStudent(activeIndex);
    } else if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".student-name-autocomplete")) {
      hideSuggestions();
    }
  });

  function updateActiveItem() {
    list.querySelectorAll(".autocomplete-item").forEach((item, index) => {
      item.classList.toggle("active", index === activeIndex);
    });
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }
}

/* ---------------------------------------------------------
   Student verification (student-verification.html)
   --------------------------------------------------------- */
function initStudentVerification() {
  const form = document.getElementById("verifyForm");
  if (!form) return;
  const alertBox = document.getElementById("verifyAlert");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const admissionNo = document.getElementById("vAdmissionNo").value.trim();
    const dob = document.getElementById("vDob").value;

    const match = DEMO_ADMITTED_STUDENTS.find(
      (s) => s.admissionNo.toLowerCase() === admissionNo.toLowerCase() && s.dob === dob
    );

    if (match) {
      showAlert(alertBox, `Verified! Welcome, ${match.name}. Redirecting to registration…`, "success");
      sessionStorage.setItem(STORE_KEYS.verifiedStudent, JSON.stringify(match));
      setTimeout(() => goTo("student-register.html"), 1000);
    } else {
      showAlert(alertBox, "Student Details Not Found", "error");
    }
  });
}

/* ---------------------------------------------------------
   Pre-fill student registration if verified
   --------------------------------------------------------- */
function prefillStudentRegistration() {
  const nameInput = document.getElementById("regName");
  const admInput = document.getElementById("regAdmissionNo");
  if (!nameInput || !admInput) return;

  const raw = sessionStorage.getItem(STORE_KEYS.verifiedStudent);
  if (!raw) return; // not verified this session — leave fields open for manual entry
  try {
    const data = JSON.parse(raw);
    admInput.value = data.admissionNo;
    nameInput.value = data.name;
    // Keep the fields editable so the CSV student autocomplete remains usable.
  } catch (e) {
    /* ignore */
  }
}

/* ---------------------------------------------------------
   Init on load — each page calls only what it needs
   --------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initRoleCards();
  initPasswordToggles();
  initPassportPhotoPreview();
  initForgotPassword();
  initStudentVerification();
  prefillStudentRegistration();
  initStudentCsvAutocomplete();


  const wardenLoginForm = document.getElementById("wardenLoginForm");

if (wardenLoginForm) {

  wardenLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const alertBox = document.getElementById("loginAlert");

    const employeeId =
      document.getElementById("wEmployeeId").value.trim();

    const password =
      document.getElementById("wPassword").value;

    if (!employeeId || !password) {
      showAlert(
        alertBox,
        "Please enter Employee ID and Password.",
        "error"
      );
      return;
    }

    try {

      const response = await fetch(
        "/api/wardens/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            employee_id: employeeId,
            password: password
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        showAlert(
          alertBox,
          result.message || "Invalid Employee ID or Password.",
          "error"
        );
        return;
      }

      sessionStorage.setItem(
        "loggedInWarden",
        JSON.stringify(result.warden)
      );

      showAlert(
        alertBox,
        "Login successful!",
        "success"
      );

      setTimeout(() => {
        window.location.href = "warden_dashboard.html";
      }, 800);

    } catch (error) {

      console.error(error);

      showAlert(
        alertBox,
        "Unable to connect to the server.",
        "error"
      );
    }
  });
}

  const adminLoginForm = document.getElementById("adminLoginForm");
  if (adminLoginForm) {
    adminLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const alertBox = document.getElementById("loginAlert");
      hideAlert(alertBox);

      const adminId = document.getElementById("aAdminId").value.trim();
      const password = document.getElementById("aPassword").value;

      if (!adminId || !password) {
        showAlert(alertBox, "Please enter Admin ID and password.", "error");
        return;
      }

      try {
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ admin_id: adminId, password: password, role: "admin" })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          showAlert(alertBox, result.message || "Invalid Admin ID or password.", "error");
          return;
        }

        const adminData = result.admin || { adminId, name: "Admin", designation: "Administrator" };
        localStorage.setItem(STORE_KEYS.adminSession, adminId);
        sessionStorage.setItem("loggedInAdmin", JSON.stringify(adminData));
        const store = getStore(STORE_KEYS.admins);
        store[adminId] = adminData;
        setStore(STORE_KEYS.admins, store);

        showAlert(alertBox, "Login successful! Redirecting...", "success");
        setTimeout(() => {
          window.location.href = "admin-dashboard.html";
        }, 600);
      } catch (err) {
        console.error("Admin login error:", err);
        showAlert(alertBox, "Unable to connect to the backend server.", "error");
      }
    });
  }

/* ---------------------------------------------------------
   Student Login — authenticated by Node.js backend
   --------------------------------------------------------- */
function handleStudentBackendLogin() {
  const form = document.getElementById("studentLoginForm");
  if (!form) return;

  const alertBox = document.getElementById("loginAlert");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const loginId = document.getElementById("sAdmissionNo").value.trim();
    const password = document.getElementById("sPassword").value;

    if (!loginId || !password) {
      showAlert(alertBox, "Please enter your admission/roll number and password.", "error");
      return;
    }

    try {
      const apiBase =window.location.origin;
      const response = await fetch(`${apiBase}/api/students/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login_id: loginId, password })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        showAlert(alertBox, result.message || "Invalid login details.", "error");
        return;
      }

      localStorage.setItem("hostelERP_studentSession", result.student.admission_no || loginId);

      showAlert(alertBox, "Login successful. Redirecting…", "success");

      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 500);

    } catch (error) {
      console.error("Student backend login error:", error);
      showAlert(alertBox, "Unable to connect to the backend. Make sure node server.js is running.", "error");
    }
  });
}

  /* loadAdminAccountsFromCSV() is no longer called: admin sign-in is
     verified by the backend, and mirroring admin.csv into localStorage
     also exposed the stored password hashes to the browser. */

  handleGatekeeperLogin();

  handleStudentBackendLogin();

  handleStudentRegistration();

  /* Admin self-registration was removed: the portal now uses one shared
     static admin login that the backend verifies, so there is no admin
     registration form to wire up here. */
});
const wardenRegisterForm =
  document.getElementById("wardenRegisterForm");

if (wardenRegisterForm) {

  wardenRegisterForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    const alertBox =
      document.getElementById("registerAlert");

    hideAlert(alertBox);

    // Get values from Warden Registration form
    const employeeId =
      document.getElementById("regEmployeeId").value.trim();

    const fullName =
      document.getElementById("regName").value.trim();

    const department =
      document.getElementById("regDept").value;

    const phone =
      document.getElementById("regPhone").value.trim();

    const address =
      document.getElementById("regAddress").value.trim();

    const email =
      document.getElementById("regEmail").value.trim();

    const password =
      document.getElementById("regPassword").value;

    const confirmPassword =
      document.getElementById("regConfirmPassword").value;

    const shift =
      document.getElementById("regShift").value;

    const fileInput =
      document.getElementById("regIdProof");


    // Password check
    if (password !== confirmPassword) {
      showAlert(
        alertBox,
        "Passwords do not match.",
        "error"
      );
      return;
    }

    if (password.length < 6) {
      showAlert(
        alertBox,
        "Password must be at least 6 characters.",
        "error"
      );
      return;
    }


    // ID proof check
    if (
      !fileInput.files ||
      fileInput.files.length === 0
    ) {
      showAlert(
        alertBox,
        "Please upload your ID proof.",
        "error"
      );
      return;
    }

    if (!validateFileInput(fileInput, alertBox)) {
      return;
    }


    try {

      const response = await fetch(
        "/api/wardens/register",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
          employee_id: employeeId,
          full_name: fullName,
          department: department,
          shift: shift,
          email: email,
          phone_no: phone,
          address: address,
          password: password,
          id_proof: fileInput.files[0].name
})
        }
      );

      const result = await response.json();


      if (!response.ok || !result.success) {

        showAlert(
          alertBox,
          result.message || "Warden registration failed.",
          "error"
        );

        return;
      }


      showAlert(
        alertBox,
        result.message || "Warden registered successfully.",
        "success"
      );

      wardenRegisterForm.reset();


      // Redirect to Warden Login. The wait is longer than the student
      // flow so the "awaiting Admin approval" message can be read.
      setTimeout(() => {
        window.location.href = "warden-login.html";
      }, 3000);


    } catch (error) {

      console.error(
        "Warden registration error:",
        error
      );

      showAlert(
        alertBox,
        "Unable to connect to the server.",
        "error"
      );

    }

  });

}