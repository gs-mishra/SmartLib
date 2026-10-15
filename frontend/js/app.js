// app.js
// Main application UI logic, router, and event controllers

// --- GLOBAL APP STATE ---
let currentSession = null; // Stores user details after authentication
let currentLoginRole = "admin"; // 'admin' or 'student'
let currentScannerTarget = null; // 'book' or 'member' field target
let currentDeskMode = "issue"; // 'issue' or 'return'
let scannedMember = null; // Resolved member object in sequental desk
let scannedBook = null; // Resolved book object in sequential desk
let holidayCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let cachedHolidays = [];
let appSettings = {
  fineRate: 1.0, // INR per day overdue
  maxBooksLimit: 5,
};

// --- GLOBAL LOADING SPINNER CONTROLS ---
function showLoading(message = "Processing request...") {
  const overlay = document.getElementById("global-loading-overlay");
  const msgEl = document.getElementById("global-loading-message");
  if (overlay) {
    if (msgEl) msgEl.textContent = message;
    overlay.style.display = "flex";
  }
}

function hideLoading() {
  const overlay = document.getElementById("global-loading-overlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}

// Play audio chime for scanner notifications
function playScanChime(isSuccess = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (isSuccess) {
      // Double clean high beep (success tone)
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.setValueAtTime(1200, ctx.currentTime + 0.1);
      gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.1);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.22);
    } else {
      // Lower sawtooth buzz (error tone)
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.warn(
      "Audio Context beep not supported or blocked by browser policies.",
    );
  }
}

// Fetch book details from Open Library API by barcode / ISBN
async function fetchBookDetailsFromOpenLibrary(barcode) {
  const cleanCode = barcode.trim();
  if (!cleanCode) return;

  showToast("Searching Open Library database...", "info");

  try {
    const response = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanCode}&format=json&jscmd=data`,
    );
    const data = await response.json();

    const key = `ISBN:${cleanCode}`;
    if (data[key]) {
      const bookInfo = data[key];

      const titleInput = document.getElementById("book-title");
      const authorInput = document.getElementById("book-author");
      const isbnInput = document.getElementById("book-isbn");

      if (titleInput) titleInput.value = bookInfo.title || "";
      if (authorInput) {
        const authors = bookInfo.authors
          ? bookInfo.authors.map((a) => a.name).join(", ")
          : "Unknown Author";
        authorInput.value = authors;
      }
      if (isbnInput) {
        isbnInput.value = cleanCode;
      }

      playScanChime(true);
      showToast(`Auto-fetched: "${bookInfo.title}"`, "success");
    } else {
      playScanChime(false);
      showToast(
        "Book details not found online. Please input details manually.",
        "warning",
      );
    }
  } catch (err) {
    console.error("Open Library API Fetch Error:", err);
    showToast(
      "Network error trying to auto-fetch details. Please input manually.",
      "warning",
    );
  }
}

// On Page Load
document.addEventListener("DOMContentLoaded", async () => {
  // Database is initialized once by SupabaseLibraryDB's constructor.
  // Do not call init() again here; that can create duplicate GoTrueClient instances.

  // Set system fine policies from local storage if existing
  const savedFineRate = localStorage.getItem("smart_lib_setting_fine_rate");
  if (savedFineRate) {
    appSettings.fineRate = parseFloat(savedFineRate);
  }
  const savedMaxBooks = localStorage.getItem("smart_lib_setting_max_books");
  if (savedMaxBooks) {
    appSettings.maxBooksLimit = parseInt(savedMaxBooks);
  }

  // Load registered libraries in the login dropdown
  await loadLibrariesDropdown();

  // Show status indicators in Settings tab
  updateSystemSettingsIndicator();

  // Set initial login role toggle
  setLoginRole("admin");

  // Check if session exists in local storage
  const savedSession = localStorage.getItem("smart_lib_session");
  if (savedSession) {
    try {
      const session = JSON.parse(savedSession);
      currentSession = session;

      // Fetch live library settings upon restoring session
      const settings = await window.smartLibDB.getSettings(session.libraryId);
      if (settings) {
        appSettings.fineRate = settings.finePerDay;
      }

      if (session.role === "admin") {
        enterAdminDashboard();
      } else {
        enterStudentDashboard();
      }
      showToast(`Welcome back, ${session.name}!`, "success");
    } catch (err) {
      console.error("Failed to restore session:", err);
      localStorage.removeItem("smart_lib_session");
    }
  }
});

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = "info") {
  const container = document.getElementById("toast-root");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  let icon = "info-circle";
  if (type === "success") icon = "circle-check";
  if (type === "danger") icon = "triangle-exclamation";
  if (type === "warning") icon = "circle-exclamation";

  toast.innerHTML = `
    <i class="fa-solid fa-${icon}"></i>
    <div style="flex-grow: 1;">${message}</div>
  `;

  container.appendChild(toast);

  // Automatically remove toast after 3.5 seconds
  setTimeout(() => {
    toast.style.animation = "fadeOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- PORTAL ROUTER ---
function switchView(viewId) {
  document
    .querySelectorAll(".app-view")
    .forEach((v) => v.classList.remove("active"));
  const view = document.getElementById(viewId);
  if (view) {
    view.classList.add("active");
  }
}

function switchPortalTab(tabName) {
  document.getElementById("tab-login").classList.remove("active");
  document.getElementById("tab-register").classList.remove("active");
  document.getElementById("form-login").style.display = "none";
  document.getElementById("form-register").style.display = "none";

  if (tabName === "login") {
    document.getElementById("tab-login").classList.add("active");
    document.getElementById("form-login").style.display = "block";
    loadLibrariesDropdown();
  } else {
    document.getElementById("tab-register").classList.add("active");
    document.getElementById("form-register").style.display = "block";
  }
}

function setLoginRole(role) {
  currentLoginRole = role;
  document.getElementById("toggle-role-admin").classList.remove("active");
  document.getElementById("toggle-role-student").classList.remove("active");

  const usernameLabel = document.getElementById("login-username-label");
  const usernameInput = document.getElementById("login-username");

  if (role === "admin") {
    document.getElementById("toggle-role-admin").classList.add("active");
    usernameLabel.textContent = "Admin Username";
    usernameInput.placeholder = "e.g., admin_main";
  } else {
    document.getElementById("toggle-role-student").classList.add("active");
    usernameLabel.textContent = "Student Username";
    usernameInput.placeholder = "e.g., student123";
  }
}

// --- LIBRARIES FETCH ---
async function loadLibrariesDropdown() {
  const select = document.getElementById("login-library-select");
  if (!select) return;

  select.innerHTML =
    '<option value="" disabled selected>Loading libraries...</option>';

  try {
    const libraries = await window.smartLibDB.getLibraries();

    if (libraries.length === 0) {
      select.innerHTML =
        '<option value="" disabled>No libraries registered. Please register a library first.</option>';
      // Automatically swap to register tab to guide new user
      switchPortalTab("register");
      showToast(
        "Create a library first to initialize admin permissions.",
        "info",
      );
      return;
    }

    select.innerHTML = "";
    libraries.forEach((lib, index) => {
      const option = document.createElement("option");
      option.value = lib.id;
      option.textContent = `${lib.name} (${lib.libraryCode})`;
      if (index === 0) option.selected = true; // Auto select first library
      select.appendChild(option);
    });
  } catch (err) {
    console.error(err);
    select.innerHTML =
      '<option value="" disabled>Error loading libraries</option>';
  }
}

// --- SUBMIT: LIBRARY REGISTRATION ---
async function handleRegisterLibrarySubmit(e) {
  e.preventDefault();
  const name = document.getElementById("register-lib-name").value;
  const code = document.getElementById("register-lib-code").value;
  const user = document.getElementById("register-admin-user").value;
  const pass = document.getElementById("register-admin-password").value;

  if (code.length !== 4 || isNaN(code)) {
    showToast("Library Code must be exactly 4 digits.", "danger");
    return;
  }

  if (user.length < 3 || pass.length < 4) {
    showToast(
      "Credentials must be: Username (min 3 chars), Password (min 4 chars)",
      "danger",
    );
    return;
  }

  try {
    showLoading("Initializing library database profile...");
    const newLib = await window.smartLibDB.registerLibrary(
      name,
      user,
      pass,
      code,
    );
    hideLoading();
    showToast(`Successfully registered library: ${newLib.name}!`, "success");
    e.target.reset();
    switchPortalTab("login");
  } catch (err) {
    hideLoading();
    showToast(err.message, "danger");
  }
}

// --- SUBMIT: LOGIN ---
async function handleLoginSubmit(e) {
  e.preventDefault();
  const libraryId = document.getElementById("login-library-select").value;
  const user = document.getElementById("login-username").value;
  const pass = document.getElementById("login-password").value;

  if (!libraryId) {
    showToast("Please select a library.", "danger");
    return;
  }

  try {
    showLoading("Authenticating credentials...");
    const session = await window.smartLibDB.loginUser(
      libraryId,
      user,
      pass,
      currentLoginRole,
    );
    hideLoading();
    currentSession = session;

    // Save session in local storage for persistence across refreshes
    localStorage.setItem("smart_lib_session", JSON.stringify(session));

    showToast(`Logged in successfully! Welcome, ${session.name}`, "success");
    e.target.reset();

    // Fetch live library settings upon login
    const settings = await window.smartLibDB.getSettings(session.libraryId);
    appSettings.fineRate = settings.finePerDay;

    if (session.role === "admin") {
      enterAdminDashboard();
    } else {
      enterStudentDashboard();
    }
  } catch (err) {
    hideLoading();
    showToast(err.message, "danger");
  }
}

// --- LOGOUT ---
function handleLogout() {
  currentSession = null;
  // Clear the persistent session
  localStorage.removeItem("smart_lib_session");

  switchView("home-view");
  showToast("Logged out successfully.", "info");
  loadLibrariesDropdown();
}

// ==========================================
// ADMIN DASHBOARD MODULES
// ==========================================
function enterAdminDashboard() {
  switchView("admin-view");
  document.getElementById("admin-profile-name").textContent =
    currentSession.name;
  document.getElementById("admin-profile-lib").textContent =
    currentSession.libraryName;

  const libBadge = document.getElementById("admin-active-lib-badge");
  if (libBadge) {
    libBadge.textContent = `ID: ${currentSession.libraryId}`;
  }
  const settingsLibId = document.getElementById("admin-settings-lib-id");
  if (settingsLibId) {
    settingsLibId.textContent = currentSession.libraryId;
  }

  // Set default tab active
  switchDashboardTab("admin-sub-overview");
}

function switchDashboardTab(subviewId, element) {
  closeSidebar();
  // Toggle subviews
  document
    .querySelectorAll("#admin-view .dash-subview")
    .forEach((v) => v.classList.remove("active"));
  const targetView = document.getElementById(subviewId);
  if (targetView) targetView.classList.add("active");

  // Sync active sidebar links
  const sidebarLinks = document.querySelectorAll("#admin-view .sidebar-link");
  sidebarLinks.forEach((l) => l.classList.remove("active"));

  // Sync active bottom nav items
  const bottomNavItems = document.querySelectorAll(
    "#admin-view .bottom-nav-item",
  );
  bottomNavItems.forEach((i) => i.classList.remove("active"));

  let titleText = "Overview";
  if (subviewId === "admin-sub-overview") {
    if (sidebarLinks[0]) sidebarLinks[0].classList.add("active");
    if (bottomNavItems[0]) bottomNavItems[0].classList.add("active");
    titleText = "Librarian Overview";
  } else if (subviewId === "admin-sub-books") {
    if (sidebarLinks[1]) sidebarLinks[1].classList.add("active");
    if (bottomNavItems[1]) bottomNavItems[1].classList.add("active");
    titleText = "Manage Books";
  } else if (subviewId === "admin-sub-members") {
    if (sidebarLinks[2]) sidebarLinks[2].classList.add("active");
    if (bottomNavItems[2]) bottomNavItems[2].classList.add("active");
    titleText = "Manage Members";
  } else if (subviewId === "admin-sub-desk") {
    if (sidebarLinks[3]) sidebarLinks[3].classList.add("active");
    if (bottomNavItems[3]) bottomNavItems[3].classList.add("active");
    titleText = "Issue/Return Desk";
  } else if (subviewId === "admin-sub-holidays") {
    if (sidebarLinks[4]) sidebarLinks[4].classList.add("active");
    titleText = "Holiday Management";
  } else if (subviewId === "admin-sub-shelf-finder") {
    if (sidebarLinks[5]) sidebarLinks[5].classList.add("active");
    if (bottomNavItems[4]) bottomNavItems[4].classList.add("active");
    titleText = "Book's Shelf Finder";
  } else if (subviewId === "admin-sub-settings") {
    if (sidebarLinks[6]) sidebarLinks[6].classList.add("active");
    if (bottomNavItems[4]) bottomNavItems[4].classList.add("active");
    titleText = "Settings";
  }

  document.getElementById("admin-section-title").textContent = titleText;

  if (subviewId === "admin-sub-overview") {
    loadAdminStatsAndRecent();
  } else if (subviewId === "admin-sub-books") {
    loadAdminBooksTable();
  } else if (subviewId === "admin-sub-members") {
    loadAdminMembersTable();
  } else if (subviewId === "admin-sub-desk") {
    loadAdminDesk();
  } else if (subviewId === "admin-sub-holidays") {
    loadHolidayManager();
  } else if (subviewId === "admin-sub-shelf-finder") {
    loadShelfFinderTab();
  } else if (subviewId === "admin-sub-settings") {
    loadSettingsPanel();
  }
}

// VIEW 1: STATS AND RECENT ACTIVITIES
async function loadHolidayManager() {
  if (!currentSession?.libraryId) return;
  try {
    cachedHolidays = await window.smartLibDB.getHolidays(currentSession.libraryId);
    // Seed suggested India/Gujarat holidays once for the current and next calendar year.
    // Sundays are non-working days; Saturdays remain working days.
    let holidaysSeeded = false;
    try { holidaysSeeded = localStorage.getItem(`smart_lib_holidays_seeded_${currentSession.libraryId}`) === "1"; } catch (_) {}
    if (!holidaysSeeded) {
      const existingDates = new Set(cachedHolidays.map(h => h.date));
      const y = new Date().getFullYear();
      const defaults = getSuggestedFestivalHolidays(y).concat(getSuggestedFestivalHolidays(y + 1));
      for (const h of defaults) {
        if (!existingDates.has(h.date)) {
          await window.smartLibDB.saveHoliday(currentSession.libraryId, h.date, h.name);
          existingDates.add(h.date);
        }
      }
      cachedHolidays = await window.smartLibDB.getHolidays(currentSession.libraryId);
      try { localStorage.setItem(`smart_lib_holidays_seeded_${currentSession.libraryId}`, "1"); } catch (_) {}
    }
    renderHolidayCalendar();
    renderHolidayList();
  } catch (error) {
    showToast(`Could not load holidays: ${error.message}`, "error");
  }
}

function getSuggestedFestivalHolidays(year) {
  // Suggested dates for India, with Gujarat-relevant festivals. Verify movable dates locally;
  // administrators can edit or remove every entry from the calendar.
  const calendars = {
    2026: [
      ["2026-10-20", "Dussehra / Vijayadashami (verify locally)"],
      ["2026-10-31", "Sardar Vallabhbhai Patel Jayanti / Rashtriya Ekta Diwas"],
      ["2026-11-08", "Diwali (verify locally)"],
      ["2026-11-09", "Gujarati New Year (Bestu Varas, verify locally)"],
      ["2026-11-10", "Bhai Dooj (verify locally)"],
      ["2026-11-24", "Guru Nanak Jayanti (verify locally)"],
      ["2026-12-25", "Christmas"]
    ],
    2027: [
      ["2027-01-01", "New Year's Day"], ["2027-01-14", "Makar Sankranti / Uttarayan"],
      ["2027-01-26", "Republic Day"], ["2027-03-06", "Maha Shivratri (verify locally)"],
      ["2027-03-10", "Eid al-Fitr (tentative, subject to moon sighting)"],
      ["2027-03-22", "Holi / Dhuleti (verify locally)"], ["2027-04-14", "Dr. Ambedkar Jayanti"],
      ["2027-05-17", "Eid al-Adha (tentative, subject to moon sighting)"],
      ["2027-08-15", "Independence Day"], ["2027-08-17", "Janmashtami (verify locally)"],
      ["2027-09-04", "Ganesh Chaturthi (verify locally)"], ["2027-10-02", "Gandhi Jayanti"],
      ["2027-10-09", "Dussehra / Vijayadashami (verify locally)"],
      ["2027-10-29", "Diwali (verify locally)"], ["2027-10-30", "Gujarati New Year (Bestu Varas, verify locally)"],
      ["2027-12-25", "Christmas"]
    ]
  };
  return (calendars[year] || []).map(([date, name]) => ({ date, name }));
}

function changeHolidayMonth(delta) {
  holidayCalendarMonth = new Date(holidayCalendarMonth.getFullYear(), holidayCalendarMonth.getMonth() + delta, 1);
  renderHolidayCalendar();
}

function renderHolidayCalendar() {
  const root = document.getElementById("holiday-calendar");
  const title = document.getElementById("holiday-calendar-title");
  if (!root || !title) return;
  const year = holidayCalendarMonth.getFullYear(), month = holidayCalendarMonth.getMonth();
  title.textContent = holidayCalendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const holidayMap = new Map(cachedHolidays.map(h => [h.date, h.name]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = weekdays.map(day => `<div class="holiday-weekday">${day}</div>`).join("");
  const firstDay = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) html += '<div class="holiday-day empty"></div>';
  for (let day = 1; day <= count; day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const holiday = holidayMap.get(date);
    const weekend = new Date(year, month, day).getDay() === 0;
    html += `<button type="button" class="holiday-day ${holiday ? "is-holiday" : ""} ${weekend ? "is-weekend" : ""}" ${holiday ? `title="${escapeHolidayText(holiday)}"` : ""} onclick="selectHolidayDate('${date}')"><span>${day}</span>${holiday ? '<i class="fa-solid fa-star"></i>' : ""}</button>`;
  }
  root.innerHTML = html;
}

function escapeHolidayText(value) {
  return String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function selectHolidayDate(date) {
  const input = document.getElementById("holiday-date");
  if (input) input.value = date;
  const holiday = cachedHolidays.find(h => h.date === date);
  const name = document.getElementById("holiday-name");
  if (name && holiday) name.value = holiday.name;
}

function renderHolidayList() {
  const root = document.getElementById("holiday-list");
  if (!root) return;
  if (!cachedHolidays.length) {
    root.innerHTML = '<div class="holiday-empty"><i class="fa-regular fa-calendar-check"></i><p>No holidays added yet.</p></div>';
    return;
  }
  root.innerHTML = cachedHolidays.map(h => `<div class="holiday-list-item"><div class="holiday-list-date"><strong>${new Date(`${h.date}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit" })}</strong><span>${new Date(`${h.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></div><div class="holiday-list-name">${escapeHolidayText(h.name)}</div><button type="button" class="btn btn-danger btn-sm" onclick="handleDeleteHoliday('${h.id}')" aria-label="Delete ${escapeHolidayText(h.name)}"><i class="fa-solid fa-trash"></i><span>Remove</span></button></div>`).join("");
}

async function handleSaveHoliday(event) {
  event.preventDefault();
  try {
    await window.smartLibDB.saveHoliday(currentSession.libraryId, document.getElementById("holiday-date").value, document.getElementById("holiday-name").value);
    showToast("Holiday saved. New due dates will skip this date.", "success");
    await loadHolidayManager();
  } catch (error) { showToast(error.message || "Could not save holiday.", "error"); }
}

async function handleDeleteHoliday(id) {
  if (!confirm("Remove this holiday from the library calendar?")) return;
  try {
    await window.smartLibDB.deleteHoliday(currentSession.libraryId, id);
    showToast("Holiday removed.", "success");
    await loadHolidayManager();
  } catch (error) { showToast(error.message || "Could not remove holiday.", "error"); }
}

async function loadAdminStatsAndRecent() {
  try {
    const libId = currentSession.libraryId;
    const books = await window.smartLibDB.getBooks(libId);
    const members = await window.smartLibDB.getMembers(libId);
    const issues = await window.smartLibDB.getIssues(libId);

    // Stats
    document.getElementById("stat-total-books").textContent = books.length;
    document.getElementById("stat-total-members").textContent = members.length;

    const activeIssues = issues.filter((i) => i.status === "issued");
    document.getElementById("stat-issued-books").textContent =
      activeIssues.length;

    // Calculate total fines
    let totalFines = 0;
    issues.forEach((i) => {
      totalFines += calculateIssueFine(i);
    });
    document.getElementById("stat-active-fines").textContent =
      `₹${totalFines.toFixed(2)}`;

    // Build Recent Activities
    const recentActTable = document.getElementById(
      "table-recent-activities-body",
    );
    recentActTable.innerHTML = "";

    // Sort issues by issueDate desc
    const sortedIssues = [...issues]
      .sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate))
      .slice(0, 5);

    if (sortedIssues.length === 0) {
      recentActTable.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No activity recorded yet.</td></tr>`;
      return;
    }

    sortedIssues.forEach((issue) => {
      const row = document.createElement("tr");
      const date = new Date(issue.issueDate).toLocaleDateString();
      const dueDate = new Date(issue.dueDate).toLocaleDateString();

      const fineVal = calculateIssueFine(issue);
      const isReturned = issue.status === "returned";

      row.innerHTML = `
        <td>${date}</td>
        <td><strong>${issue.bookTitle}</strong></td>
        <td>${issue.memberName}</td>
        <td><span class="badge ${isReturned ? "badge-success" : "badge-info"}">${issue.status}</span></td>
        <td>${dueDate}</td>
        <td>
          <span style="font-weight:600; color: ${fineVal > 0 ? "var(--color-accent)" : "var(--color-secondary)"}">
            ${fineVal > 0 ? `Fine: ₹${fineVal.toFixed(2)}` : "No Fine"}
          </span>
        </td>
      `;
      recentActTable.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    showToast("Error updating overview stats.", "danger");
  }
}

// VIEW 2: BOOK RECORDS (CRUD)
let cachedBooks = [];
async function loadAdminBooksTable() {
  try {
    showLoading("Loading books catalog...");
    cachedBooks = await window.smartLibDB.getBooks(currentSession.libraryId);
    populateBookFilterSelects(cachedBooks);
    renderBooksTable(cachedBooks);
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast("Error loading books catalog.", "danger");
  }
}

function renderBooksTable(books) {
  const tbody = document.getElementById("table-books-body");
  tbody.innerHTML = "";

  if (books.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No books cataloged in this library.</td></tr>`;
    return;
  }

  books.forEach((b) => {
    const tr = document.createElement("tr");
    const isAvail = b.availableCopies > 0;
    const qrDataStr = b.barcode; // Barcode value inside scanned code

    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap: 10px;">
          <div class="book-qr-btn" onclick="openQRCodeModal('${qrDataStr}', 'Book Barcode: ${b.title}')" title="View/Download QR Code">
            <i class="fa-solid fa-qrcode"></i>
          </div>
          <span style="font-size: 11px; font-family: monospace; color: var(--text-muted);">${b.barcode}</span>
        </div>
      </td>
      <td>
        <div style="display: flex; gap: 10px; align-items: center;">
          <div style="width: 32px; height: 42px; background: #e2e8f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
            ${b.coverUrl ? `<img src="${b.coverUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class="fa-solid fa-book" style="font-size: 14px; color: var(--text-muted);"></i>`}
          </div>
          <strong>${b.title}</strong>
        </div>
      </td>
      <td>${b.author}</td>
      <td>
        <div>${b.shelfLocation || "N/A"}</div>
      </td>
      <td><code>${b.isbn}</code></td>
      <td><strong>${b.totalCopies || 1}</strong></td>
      <td><span class="badge ${isAvail ? "badge-success" : "badge-danger"}">${isAvail ? "Available" : "Issued Out"}</span></td>
      <td>
        <div style="display:flex; gap: 8px;">
          <button class="btn btn-secondary btn-icon" onclick="openEditBookModal('${b.id}')" title="Edit Book"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-danger btn-icon" onclick="deleteBookRecord('${b.id}')" title="Delete Book"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterBooksTable() {
  const q = document
    .getElementById("book-search-input")
    .value.toLowerCase()
    .trim();
  const filterAuthor = document.getElementById("book-filter-author").value;

  let filtered = cachedBooks;

  if (q) {
    filtered = filtered.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.barcode.toLowerCase().includes(q),
    );
  }

  if (filterAuthor) {
    filtered = filtered.filter((b) => b.author === filterAuthor);
  }

  renderBooksTable(filtered);
}

function populateBookFilterSelects(books) {
  const authorSelect = document.getElementById("book-filter-author");
  if (!authorSelect) return;

  const selectedAuthor = authorSelect.value;
  const authors = [
    ...new Set(books.map((b) => b.author).filter(Boolean)),
  ].sort();

  authorSelect.innerHTML = '<option value="">All Authors</option>';
  authors.forEach((auth) => {
    const opt = document.createElement("option");
    opt.value = auth;
    opt.textContent = auth;
    if (auth === selectedAuthor) opt.selected = true;
    authorSelect.appendChild(opt);
  });
}

// Edit Book Modal triggers
function openAddBookModal() {
  document.getElementById("modal-book-title").textContent =
    "Add New Book Record";
  document.getElementById("form-book-submit").reset();
  document.getElementById("modal-book-id").value = "";
  document.getElementById("book-copy-count").value = 1;
  document.getElementById("book-shelf-location").value = "";
  openModal("modal-book");
}

function openEditBookModal(bookId) {
  const book = cachedBooks.find((b) => b.id === bookId);
  if (!book) return;

  document.getElementById("modal-book-title").textContent =
    "Update Book Records";
  document.getElementById("modal-book-id").value = book.id;
  document.getElementById("book-barcode").value = book.barcode;
  document.getElementById("book-title").value = book.title;
  document.getElementById("book-author").value = book.author;
  document.getElementById("book-isbn").value = book.isbn;
  document.getElementById("book-copy-count").value = book.totalCopies || 1;
  document.getElementById("book-shelf-location").value =
    book.shelfLocation || "";

  openModal("modal-book");
}

async function handleBookFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("modal-book-id").value;
  const barcode = document.getElementById("book-barcode").value;
  const title = document.getElementById("book-title").value;
  const author = document.getElementById("book-author").value;
  const isbn = document.getElementById("book-isbn").value;
  const totalCopies = document.getElementById("book-copy-count").value;
  const shelfLocation = document.getElementById("book-shelf-location").value;
  const coverFile = document.getElementById("book-cover").files[0];

  const data = { barcode, title, author, isbn, totalCopies, shelfLocation };

  try {
    const libId = currentSession.libraryId;
    if (id) {
      showLoading("Updating book record in catalog...");
      await window.smartLibDB.updateBook(libId, id, data, coverFile);
      hideLoading();
      showToast("Book record updated successfully.", "success");
    } else {
      showLoading("Uploading cover and cataloging new book...");
      await window.smartLibDB.addBook(libId, data, coverFile);
      hideLoading();
      showToast("Book added to catalog database.", "success");
    }
    closeModal("modal-book");
    loadAdminBooksTable();
  } catch (err) {
    hideLoading();
    showToast(err.message, "danger");
  }
}

async function deleteBookRecord(bookId) {
  if (
    !confirm(
      "Are you sure you want to delete this book record? This cannot be undone.",
    )
  )
    return;

  try {
    await window.smartLibDB.deleteBook(currentSession.libraryId, bookId);
    showToast("Book record deleted.", "success");
    loadAdminBooksTable();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

// VIEW 3: MEMBER RECORDS (CRUD)
let cachedMembers = [];
async function loadAdminMembersTable() {
  try {
    showLoading("Loading registered student members...");
    const libId = currentSession.libraryId;
    cachedMembers = await window.smartLibDB.getMembers(libId);
    const issues = await window.smartLibDB.getIssues(libId);

    renderMembersTable(cachedMembers, issues);
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast("Error loading member registrations.", "danger");
  }
}

function renderMembersTable(members, issues = []) {
  const tbody = document.getElementById("table-members-body");
  tbody.innerHTML = "";

  if (members.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No student members registered yet. Only admins can register members.</td></tr>`;
    return;
  }

  members.forEach((m) => {
    const tr = document.createElement("tr");
    const qrDataStr = m.memberIdCustom;

    // Get active checkouts and fines
    const activeIssues = issues.filter(
      (i) => i.memberId === m.id && i.status === "issued",
    );
    let totalFine = 0;
    issues
      .filter((i) => i.memberId === m.id)
      .forEach((i) => {
        totalFine += calculateIssueFine(i);
      });

    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap: 10px;">
          <div class="book-qr-btn" onclick="openQRCodeModal('${qrDataStr}', 'Member Scan ID: ${m.name}')" title="View/Download QR Code">
            <i class="fa-solid fa-qrcode"></i>
          </div>
          <span style="font-size: 11px; font-family: monospace; color: var(--text-muted);">${m.memberIdCustom}</span>
        </div>
      </td>
      <td><strong>${m.name}</strong></td>
      <td><code>${m.username}</code></td>
      <td>
        <div style="font-size:13px;">${m.email}</div>
        <div style="font-size:11px; color: var(--text-secondary); margin-top:2px;"><i class="fa-solid fa-mobile-screen-button" style="font-size:9px; margin-right:4px;"></i>${m.mobile || "N/A"}</div>
      </td>
      <td><span style="font-size:13px; max-width:180px; display:block; word-wrap:break-word;">${m.address || "N/A"}</span></td>
      <td><span class="badge ${activeIssues.length > 0 ? "badge-info" : "badge-success"}">${activeIssues.length} Active</span></td>
      <td>
        <span style="font-weight:600; color: ${totalFine > 0 ? "var(--color-accent)" : "var(--text-muted)"}">
          ₹${totalFine.toFixed(2)}
        </span>
      </td>
      <td>
        <div style="display:flex; gap: 8px;">
          <button class="btn btn-secondary btn-icon" onclick="viewStudentIDCard('${m.id}')" title="View ID Card" style="color: var(--color-secondary);"><i class="fa-solid fa-id-card"></i></button>
          <button class="btn btn-secondary btn-icon" onclick="openEditMemberModal('${m.id}')" title="Edit Student"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-danger btn-icon" onclick="deleteMemberRecord('${m.id}')" title="Remove Student"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterMembersTable() {
  const q = document
    .getElementById("member-search-input")
    .value.toLowerCase()
    .trim();
  if (!q) {
    loadAdminMembersTable();
    return;
  }
  const filtered = cachedMembers.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.memberIdCustom.toLowerCase().includes(q),
  );
  renderMembersTable(filtered);
}

// Edit Member Modals
function openAddMemberModal() {
  document.getElementById("modal-member-title").textContent =
    "Add Student/Member Record";
  document.getElementById("form-member-submit").reset();
  document.getElementById("modal-member-id").value = "";
  document.getElementById("member-username").disabled = false;
  openModal("modal-member");
}

function openEditMemberModal(memberId) {
  const m = cachedMembers.find((mem) => mem.id === memberId);
  if (!m) return;

  document.getElementById("modal-member-title").textContent =
    "Update Student Records";
  document.getElementById("modal-member-id").value = m.id;
  document.getElementById("member-name").value = m.name;
  document.getElementById("member-username").value = m.username;
  document.getElementById("member-username").disabled = true; // Protect username changes
  document.getElementById("member-email").value = m.email;
  document.getElementById("member-mobile").value = m.mobile || "";
  document.getElementById("member-address").value = m.address || "";
  document.getElementById("member-password").value = ""; // Don't show password, input only to change
  document.getElementById("member-password").placeholder =
    "Leave blank to keep current";

  openModal("modal-member");
}

async function handleMemberFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("modal-member-id").value;
  const name = document.getElementById("member-name").value;
  const username = document.getElementById("member-username").value;
  const email = document.getElementById("member-email").value;
  const mobile = document.getElementById("member-mobile").value;
  const address = document.getElementById("member-address").value;
  const password = document.getElementById("member-password").value;

  const data = { name, username, email, mobile, address, password };

  try {
    const libId = currentSession.libraryId;
    if (id) {
      showLoading("Updating student details...");
      await window.smartLibDB.updateMember(libId, id, data);
      hideLoading();
      showToast("Student profile updated.", "success");
      closeModal("modal-member");
      loadAdminMembersTable();
    } else {
      if (!password) {
        showToast("Password is required for registration.", "danger");
        return;
      }
      showLoading("Generating QR Code and registering student member...");
      const newMember = await window.smartLibDB.addMember(libId, data);
      hideLoading();
      showToast(
        "Student registered successfully! They can now log in.",
        "success",
      );
      closeModal("modal-member");
      await loadAdminMembersTable();
      // Auto open newly generated ID card
      viewStudentIDCard(newMember.id);
    }
  } catch (err) {
    hideLoading();
    showToast(err.message, "danger");
  }
}

async function deleteMemberRecord(memberId) {
  try {
    const libId = currentSession.libraryId;

    // Fetch all active issues for this library
    const issues = await window.smartLibDB.getIssues(libId);
    const activeIssues = issues.filter(
      (i) => i.memberId === memberId && i.status === "issued",
    );

    let confirmMsg =
      "Are you sure you want to remove this student? All their checkout history will be permanently deleted.";
    if (activeIssues.length > 0) {
      confirmMsg = `WARNING: This student currently has ${activeIssues.length} book(s) checked out and NOT returned!\n\nDeleting this student will automatically release these books (marking them 'available' in the catalog) and permanently delete this member's profile and entire borrowing history.\n\nAre you sure you want to proceed?`;
    }

    if (!confirm(confirmMsg)) return;

    await window.smartLibDB.deleteMember(libId, memberId);
    showToast("Student registration and related records removed.", "success");
    loadAdminMembersTable();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

// VIEW 4: SEQUENTIAL SCAN WORKPLACE (ISSUE & RETURNS)
let allLibBooksList = [];
let allLibMembersList = [];

async function loadAdminDesk() {
  try {
    const libId = currentSession.libraryId;
    allLibBooksList = await window.smartLibDB.getBooks(libId);
    allLibMembersList = await window.smartLibDB.getMembers(libId);

    // Reset Desk State
    resetDeskWorkflow();

    // Render active checkouts panel
    loadActiveCheckoutsList();

    // Populate simulator tags
    populateScannerSimulators();
  } catch (err) {
    console.error(err);
  }
}

function setDeskMode(mode) {
  currentDeskMode = mode;
  document.getElementById("desk-role-issue").classList.remove("active");
  document.getElementById("desk-role-return").classList.remove("active");

  if (mode === "issue") {
    document.getElementById("desk-role-issue").classList.add("active");
    document.getElementById("desk-loan-period-group").style.display = "block";
    document.getElementById("desk-submit-btn").className = "btn btn-success";
    document.getElementById("desk-submit-btn").innerHTML =
      '<i class="fa-solid fa-circle-check"></i> Complete Book Issue';
  } else {
    document.getElementById("desk-role-return").classList.add("active");
    document.getElementById("desk-loan-period-group").style.display = "none";
    document.getElementById("desk-submit-btn").className = "btn btn-primary";
    document.getElementById("desk-submit-btn").innerHTML =
      '<i class="fa-solid fa-circle-check"></i> Complete Book Return';
  }

  resetDeskWorkflow();
}

async function resolveMember(idInput) {
  if (!idInput || !idInput.trim()) return;
  const cleanId = idInput.trim();

  try {
    const libId = currentSession.libraryId;
    // Query local list first to verify details
    const member = allLibMembersList.find(
      (m) =>
        m.memberIdCustom.toLowerCase() === cleanId.toLowerCase() ||
        m.username.toLowerCase() === cleanId.toLowerCase() ||
        m.id === cleanId,
    );

    if (!member) {
      playScanChime(false);
      showToast("Student not registered in this library catalog.", "danger");
      return;
    }

    scannedMember = member;

    // Fetch active issues and total fines
    const issues = await window.smartLibDB.getIssues(libId);
    const memberIssues = issues.filter(
      (i) => i.memberId === member.id && i.status === "issued",
    );

    let totalFine = 0;
    issues
      .filter((i) => i.memberId === member.id)
      .forEach((i) => {
        totalFine += calculateIssueFine(i);
      });

    // Populate preview card
    document.getElementById("preview-student-name").textContent = member.name;
    document.getElementById("preview-student-id").innerHTML =
      `Custom ID: <code>${member.memberIdCustom}</code><br>Username: <code>${member.username}</code>`;
    document.getElementById("preview-student-issues").textContent =
      `${memberIssues.length} Active`;
    document.getElementById("preview-student-fines").textContent =
      `₹${totalFine.toFixed(2)}`;

    document.getElementById("preview-student-card").style.display = "block";
    document.getElementById("preview-desk-placeholder").style.display = "none";

    // Set field input to custom ID
    document.getElementById("desk-member-input").value = member.memberIdCustom;

    // Update workflow steps indicator
    const badge = document.getElementById("desk-step-member-badge");
    badge.className = "badge badge-success";
    badge.textContent = "Resolved";

    // Unlock step 2
    const step2 = document.getElementById("desk-step-book-container");
    step2.style.opacity = "1";
    step2.style.pointerEvents = "auto";
    const bookBadge = document.getElementById("desk-step-book-badge");
    bookBadge.className = "badge badge-danger";
    bookBadge.textContent = "Awaiting Scan";

    playScanChime(true);
    showToast(`Member resolved: ${member.name}`, "success");

    checkDeskWorkflowComplete();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

async function resolveBook(barcodeInput) {
  if (!barcodeInput || !barcodeInput.trim()) return;
  const cleanCode = barcodeInput.trim();

  try {
    const book = allLibBooksList.find(
      (b) =>
        (b.barcode && b.barcode.toLowerCase() === cleanCode.toLowerCase()) ||
        (b.isbn && b.isbn.toLowerCase() === cleanCode.toLowerCase()) ||
        b.id === cleanCode,
    );

    if (!book) {
      playScanChime(false);
      showToast("Book not found in this catalog catalog.", "danger");
      return;
    }

    scannedBook = book;

    // Populate card preview
    document.getElementById("preview-book-title").textContent = book.title;
    document.getElementById("preview-book-author").textContent =
      `by ${book.author}`;
    document.getElementById("preview-book-barcode").textContent =
      book.barcode || book.isbn;
    document.getElementById("preview-book-available").textContent =
      `${book.availableCopies} / ${book.totalCopies}`;

    const coverContainer = document.getElementById(
      "preview-book-cover-container",
    );
    if (book.coverUrl) {
      coverContainer.innerHTML = `<img src="${book.coverUrl}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      coverContainer.innerHTML = `<i class="fa-solid fa-book" style="color: var(--text-muted);"></i>`;
    }

    document.getElementById("preview-book-card").style.display = "block";
    document.getElementById("preview-desk-placeholder").style.display = "none";

    // Set input box value
    document.getElementById("desk-book-input").value = book.barcode || book.id;

    // Update badge
    const badge = document.getElementById("desk-step-book-badge");
    badge.className = "badge badge-success";
    badge.textContent = "Resolved";

    playScanChime(true);
    showToast(`Book resolved: ${book.title}`, "success");

    checkDeskWorkflowComplete();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

function checkDeskWorkflowComplete() {
  if (scannedMember && scannedBook) {
    document.getElementById("desk-action-container").style.display = "block";
  }
}

async function executeSequentialDeskOperation() {
  if (!scannedMember || !scannedBook) {
    showToast("Transaction parameters incomplete.", "danger");
    return;
  }

  const libId = currentSession.libraryId;

  try {
    if (currentDeskMode === "issue") {
      const days = document.getElementById("desk-days-input").value;
      showLoading("Registering checkout issue transaction...");
      await window.smartLibDB.issueBook(
        libId,
        scannedBook.barcode,
        scannedMember.memberIdCustom,
        days,
      );
      hideLoading();
      playScanChime(true);
      showToast(
        `Book "${scannedBook.title}" successfully checked out!`,
        "success",
      );
    } else {
      // Return mode
      showLoading("Retrieving active checkouts...");
      const issues = await window.smartLibDB.getIssues(libId);
      hideLoading();
      const activeIssue = issues.find(
        (i) =>
          i.memberId === scannedMember.id &&
          i.bookId === scannedBook.id &&
          i.status === "issued",
      );

      if (!activeIssue) {
        throw new Error(
          "No active borrowing record found matching this book and member.",
        );
      }

      const fineVal = calculateIssueFine(activeIssue);
      let collectText = "";
      if (fineVal > 0) {
        collectText = `Collected overdue fine of ₹${fineVal.toFixed(2)}. `;
        if (
          !confirm(
            `An overdue fine of ₹${fineVal.toFixed(2)} is due. Please collect this amount before returning.\n\nConfirm book return?`,
          )
        ) {
          return;
        }
      }

      showLoading("Settling checkout return transaction...");
      await window.smartLibDB.returnBook(
        libId,
        scannedMember.memberIdCustom,
        scannedBook.barcode,
      );
      hideLoading();
      playScanChime(true);
      showToast(
        `Book returned successfully. ${collectText}Status updated.`,
        "success",
      );
    }

    // Refresh desk
    await loadAdminDesk();
  } catch (err) {
    hideLoading();
    playScanChime(false);
    showToast(err.message, "danger");
  }
}

function resetDeskWorkflow() {
  scannedMember = null;
  scannedBook = null;

  document.getElementById("desk-member-input").value = "";
  document.getElementById("desk-book-input").value = "";

  document.getElementById("preview-student-card").style.display = "none";
  document.getElementById("preview-book-card").style.display = "none";
  document.getElementById("preview-desk-placeholder").style.display = "block";

  document.getElementById("desk-action-container").style.display = "none";

  // Step 1 resetting
  document.getElementById("desk-step-member-badge").className =
    "badge badge-danger";
  document.getElementById("desk-step-member-badge").textContent =
    "Awaiting Scan";

  // Step 2 resetting
  const step2 = document.getElementById("desk-step-book-container");
  step2.style.opacity = "0.6";
  step2.style.pointerEvents = "none";
  document.getElementById("desk-step-book-badge").className =
    "badge badge-danger";
  document.getElementById("desk-step-book-badge").textContent = "Locked";
}

// Show Member suggestions on text input
function showDeskMemberSuggestions(val) {
  const container = document.getElementById("desk-member-suggestions");
  if (!val.trim()) {
    container.style.display = "none";
    return;
  }
  const filtered = allLibMembersList
    .filter(
      (m) =>
        m.name.toLowerCase().includes(val.toLowerCase()) ||
        m.username.toLowerCase().includes(val.toLowerCase()) ||
        m.memberIdCustom.toLowerCase().includes(val.toLowerCase()),
    )
    .slice(0, 5);

  if (filtered.length === 0) {
    container.style.display = "none";
    return;
  }

  container.innerHTML = "";
  filtered.forEach((m) => {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.innerHTML = `
      <div class="title">${m.name}</div>
      <div class="subtitle">Username: ${m.username} | ID: ${m.memberIdCustom}</div>
    `;
    div.onclick = () => {
      resolveMember(m.memberIdCustom);
      container.style.display = "none";
    };
    container.appendChild(div);
  });
  container.style.display = "block";
}

// Show Book suggestions
function showDeskBookSuggestions(val) {
  const container = document.getElementById("desk-book-suggestions");
  if (!val.trim()) {
    container.style.display = "none";
    return;
  }
  const filtered = allLibBooksList
    .filter(
      (b) =>
        b.title.toLowerCase().includes(val.toLowerCase()) ||
        (b.author && b.author.toLowerCase().includes(val.toLowerCase())) ||
        (b.barcode && b.barcode.toLowerCase().includes(val.toLowerCase())),
    )
    .slice(0, 5);

  if (filtered.length === 0) {
    container.style.display = "none";
    return;
  }

  container.innerHTML = "";
  filtered.forEach((b) => {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.innerHTML = `
      <div class="title">${b.title}</div>
      <div class="subtitle">Author: ${b.author} | Barcode: ${b.barcode}</div>
    `;
    div.onclick = () => {
      resolveBook(b.barcode);
      container.style.display = "none";
    };
    container.appendChild(div);
  });
  container.style.display = "block";
}

// Hide autocompletes when clicking out
document.addEventListener("click", (e) => {
  const mDiv = document.getElementById("desk-member-suggestions");
  const bDiv = document.getElementById("desk-book-suggestions");
  if (mDiv && !e.target.closest("#desk-member-input"))
    mDiv.style.display = "none";
  if (bDiv && !e.target.closest("#desk-book-input"))
    bDiv.style.display = "none";
});

// Load Active Checkouts
async function loadActiveCheckoutsList() {
  const container = document.getElementById("desk-checkout-list");
  if (!container) return;

  try {
    const libId = currentSession.libraryId;
    const issues = await window.smartLibDB.getIssues(libId);
    const active = issues.filter((i) => i.status === "issued");

    container.innerHTML = "";

    if (active.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 25px 0;">
          <i class="fa-solid fa-calendar-check" style="font-size: 24px; margin-bottom: 8px;"></i>
          <p style="font-size:12px;">No active book checkouts found.</p>
        </div>`;
      return;
    }

    active.forEach((i) => {
      const fineVal = calculateIssueFine(i);
      const isOverdue = fineVal > 0;
      const dueDateStr = new Date(i.dueDate).toLocaleDateString();

      const card = document.createElement("div");
      card.className = "glass-panel";
      card.style.padding = "15px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "6px";
      card.style.borderLeft = isOverdue
        ? "4px solid var(--color-accent)"
        : "4px solid var(--color-info)";

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 8px;">
          <div>
            <h4 style="font-size:14px; margin-bottom:2px; font-weight:600;">${i.bookTitle}</h4>
            <span style="font-size:11px; color: var(--text-secondary);">Student: <strong>${i.memberName}</strong> (${i.memberIdCustom})</span>
          </div>
          <span class="badge ${isOverdue ? "badge-danger" : "badge-info"}">${isOverdue ? "Overdue" : "Active"}</span>
        </div>
        <div style="font-size:11px; color: var(--text-muted); display:flex; justify-content:space-between; margin-top:4px; border-top:1px solid var(--border-color); padding-top:6px;">
          <span>Due: ${dueDateStr}</span>
          <span style="font-weight:600; color: ${isOverdue ? "var(--color-accent)" : "var(--color-secondary)"}">
            ${isOverdue ? `Fine: ₹${fineVal.toFixed(2)}` : "No Fine"}
          </span>
        </div>
        <div style="margin-top:6px; display:flex; gap: 8px;">
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size:11px; border-radius:4px; flex-grow:1; height: 30px;" onclick="quickProcessReturn('${i.memberIdCustom}', '${i.bookBarcode}', ${fineVal})">
            <i class="fa-solid fa-arrow-rotate-left"></i> Return Book
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error(err);
  }
}

async function quickProcessReturn(memberIdCustom, barcode, fineVal) {
  let collectText = "";
  if (fineVal > 0) {
    collectText = `An overdue fine of ₹${fineVal.toFixed(2)} is due. Please collect this amount before returning.\n\n`;
  }
  if (!confirm(`${collectText}Confirm return of book?`)) return;

  try {
    const libId = currentSession.libraryId;
    await window.smartLibDB.returnBook(libId, memberIdCustom, barcode);
    showToast("Book returned and availability updated.", "success");
    await loadAdminDesk();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

// Offline QR Simulator list population
function populateScannerSimulators() {
  const booksContainer = document.getElementById("mock-books-list");
  const membersContainer = document.getElementById("mock-members-list");

  if (booksContainer) {
    booksContainer.innerHTML = "";
    // Only grab books for issue suggestions
    const availBooks = allLibBooksList.slice(0, 5);
    if (availBooks.length === 0) {
      booksContainer.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">No books cataloged</span>`;
    }
    availBooks.forEach((b) => {
      const span = document.createElement("span");
      span.className = "mock-qr-tag";
      span.textContent = b.title.slice(0, 15) + "...";
      span.title = `Barcode: ${b.barcode}`;
      span.onclick = () => {
        simulateQRScan(b.barcode);
      };
      booksContainer.appendChild(span);
    });
  }

  if (membersContainer) {
    membersContainer.innerHTML = "";
    const sliceMembers = allLibMembersList.slice(0, 5);
    if (sliceMembers.length === 0) {
      membersContainer.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">No students registered</span>`;
    }
    sliceMembers.forEach((m) => {
      const span = document.createElement("span");
      span.className = "mock-qr-tag";
      span.textContent = m.name;
      span.title = `Member Custom ID: ${m.memberIdCustom}`;
      span.onclick = () => {
        simulateQRScan(m.memberIdCustom);
      };
      membersContainer.appendChild(span);
    });
  }
}

function simulateQRScan(decodedText) {
  showToast(`Simulated scan result: ${decodedText}`, "info");
  handleQRScanSuccess(decodedText);
}

// VIEW 5: SETTINGS
function loadSettingsPanel() {
  document.getElementById("settings-fine-rate").value =
    appSettings.fineRate.toFixed(2);
  document.getElementById("settings-max-books").value =
    appSettings.maxBooksLimit;
  updateSystemSettingsIndicator();
}

async function updateFineRate(val) {
  const parsed = parseFloat(val);
  if (isNaN(parsed) || parsed < 0) {
    showToast("Invalid fine rate.", "danger");
    return;
  }
  try {
    await window.smartLibDB.updateSettings(
      currentSession.libraryId,
      parsed,
      appSettings.maxBooksLimit,
    );
    appSettings.fineRate = parsed;
    localStorage.setItem("smart_lib_setting_fine_rate", parsed);
    showToast(`Daily fine rate updated to ₹${parsed.toFixed(2)}`, "success");
  } catch (err) {
    showToast("Failed to save setting in database.", "danger");
  }
}

async function updateMaxBooksLimit(val) {
  const parsed = parseInt(val);
  if (isNaN(parsed) || parsed < 1) {
    showToast("Invalid limit.", "danger");
    return;
  }
  try {
    await window.smartLibDB.updateSettings(
      currentSession.libraryId,
      appSettings.fineRate,
      parsed,
    );
    appSettings.maxBooksLimit = parsed;
    localStorage.setItem("smart_lib_setting_max_books", parsed);
    showToast(`Borrowing due-day limit updated to ${parsed} days`, "success");
  } catch (err) {
    showToast("Failed to save setting in database.", "danger");
  }
}

function updateSystemSettingsIndicator() {
  const dbInd = document.getElementById("database-mode-indicator");
  const dbDesc = document.getElementById("database-mode-desc");
  if (!dbInd) return;

  const isSupabase = window.smartLibDB.isSupabase;
  if (isSupabase) {
    dbInd.innerHTML = `<span class="badge badge-success"><i class="fa-solid fa-cloud"></i> Supabase Active</span>`;
    dbDesc.textContent =
      "Your portal is connected directly to Supabase Cloud PostgreSQL. Authentication details and records are saved dynamically online.";
  } else {
    dbInd.innerHTML = `<span class="badge badge-info"><i class="fa-solid fa-hard-drive"></i> LocalStorage Offline</span>`;
    dbDesc.textContent =
      "Running offline. All student credentials, book cataloging, and borrow records are saved securely inside your browser's LocalStorage database.";
  }
}

// ==========================================
// STUDENT/MEMBER DASHBOARD MODULES
// ==========================================
function enterStudentDashboard() {
  switchView("student-view");
  document.getElementById("student-profile-name").textContent =
    currentSession.name;
  document.getElementById("student-profile-lib").textContent =
    currentSession.libraryName;
  document.getElementById("student-active-lib-badge").textContent =
    currentSession.libraryName;

  // Set default tab active
  switchStudentTab("student-sub-profile");
}

function switchStudentTab(subviewId, element) {
  closeSidebar();
  document
    .querySelectorAll("#student-view .dash-subview")
    .forEach((v) => v.classList.remove("active"));
  const targetView = document.getElementById(subviewId);
  if (targetView) targetView.classList.add("active");

  // Sync active sidebar links
  const sidebarLinks = document.querySelectorAll("#student-view .sidebar-link");
  sidebarLinks.forEach((l) => l.classList.remove("active"));

  // Sync active bottom nav items
  const bottomNavItems = document.querySelectorAll(
    "#student-view .bottom-nav-item",
  );
  bottomNavItems.forEach((i) => i.classList.remove("active"));

  let titleText = "Dashboard";
  if (subviewId === "student-sub-profile") {
    if (sidebarLinks[0]) sidebarLinks[0].classList.add("active");
    if (bottomNavItems[0]) bottomNavItems[0].classList.add("active");
    titleText = "Student Profile";
  } else if (subviewId === "student-sub-browse") {
    if (sidebarLinks[1]) sidebarLinks[1].classList.add("active");
    if (bottomNavItems[1]) bottomNavItems[1].classList.add("active");
    titleText = "Browse Books";
  } else if (subviewId === "student-sub-issues") {
    if (sidebarLinks[2]) sidebarLinks[2].classList.add("active");
    if (bottomNavItems[2]) bottomNavItems[2].classList.add("active");
    titleText = "My Checkouts";
  }

  document.getElementById("student-section-title").textContent = titleText;

  if (subviewId === "student-sub-profile") {
    loadStudentProfile();
  } else if (subviewId === "student-sub-browse") {
    loadStudentBrowseCatalog();
  } else if (subviewId === "student-sub-issues") {
    loadStudentBorrowRecords();
  }
}

// STUDENT SUBVIEW 1: PROFILE AND MEMBER SCAN QR
async function loadStudentProfile() {
  try {
    const libId = currentSession.libraryId;
    const memId = currentSession.id;

    // Display fields
    document.getElementById("student-display-name").textContent =
      currentSession.name;
    document.getElementById("student-display-username").innerHTML =
      `<i class="fa-solid fa-user" style="margin-right: 6px;"></i> Username: <code>${currentSession.username}</code>`;

    // Find detailed user email
    const members = await window.smartLibDB.getMembers(libId);
    const profile = members.find((m) => m.id === memId);
    if (profile) {
      document.getElementById("student-display-email").innerHTML =
        `<i class="fa-solid fa-envelope" style="margin-right: 6px;"></i> Email: ${profile.email}`;
      document.getElementById("student-display-mobile").innerHTML =
        `<i class="fa-solid fa-mobile-screen-button" style="margin-right: 6px;"></i> Mobile: ${profile.mobile || "N/A"}`;
      document.getElementById("student-display-address").innerHTML =
        `<i class="fa-solid fa-location-dot" style="margin-right: 6px;"></i> Address: ${profile.address || "N/A"}`;
    }
    document.getElementById("student-display-id").innerHTML =
      `<i class="fa-solid fa-fingerprint" style="margin-right: 6px;"></i> Student Code: <code>${currentSession.memberIdCustom}</code>`;

    // Generate Member QR Code inside profile view
    const qrHolder = document.getElementById("student-profile-qr-holder");
    const qrValue = currentSession.memberIdCustom;
    window.smartLibQR.generate(qrHolder, qrValue, 120, 120);

    // Load Stats Summary
    const issues = await window.smartLibDB.getIssues(libId);
    const myIssues = issues.filter((i) => i.memberId === memId);
    const active = myIssues.filter((i) => i.status === "issued");

    document.getElementById("student-stat-books-count").textContent =
      active.length;

    // Calculate Fines & next due date
    let myFines = 0;
    let nextDueDate = null;

    myIssues.forEach((i) => {
      myFines += calculateIssueFine(i);

      if (i.status === "issued") {
        const dDate = new Date(i.dueDate);
        if (!nextDueDate || dDate < nextDueDate) {
          nextDueDate = dDate;
        }
      }
    });

    document.getElementById("student-stat-fines").textContent =
      `₹${myFines.toFixed(2)}`;
    document.getElementById("student-stat-due-date").textContent = nextDueDate
      ? nextDueDate.toLocaleDateString()
      : "None";
  } catch (err) {
    console.error(err);
  }
}

// STUDENT SUBVIEW 2: BROWSE CATALOG
let studentCachedBooks = [];
async function loadStudentBrowseCatalog() {
  try {
    showLoading("Loading library catalog books...");
    studentCachedBooks = await window.smartLibDB.getBooks(
      currentSession.libraryId,
    );
    populateStudentFilterSelects(studentCachedBooks);
    renderStudentBooksGrid(studentCachedBooks);
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast("Error loading catalog.", "danger");
  }
}

function renderStudentBooksGrid(books) {
  const container = document.getElementById("student-books-catalog");
  container.innerHTML = "";

  if (books.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 50px;">No books available in this library.</div>`;
    return;
  }

  books.forEach((b) => {
    const card = document.createElement("div");
    card.className = "book-card glass-panel";
    const isAvail = b.availableCopies > 0;

    card.innerHTML = `
      <div style="height: 160px; display: flex; align-items: center; justify-content: center; background: var(--bg-secondary); overflow: hidden; border-radius: var(--radius-sm); margin-bottom: 12px; border: 1px solid var(--border-color);">
        ${b.coverUrl ? `<img src="${b.coverUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class="fa-solid fa-book-open" style="font-size: 32px; color: var(--text-muted);"></i>`}
      </div>
      <div class="book-title" style="font-size: 15px; font-weight:700;">${b.title}</div>
      <div class="book-author" style="font-size: 13px; margin-bottom: 10px;">by ${b.author}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom: 12px; display: flex; justify-content: space-between;">
        <span><i class="fa-solid fa-location-dot" style="margin-right:6px;"></i>${b.shelfLocation || "N/A"}</span>
        <span>Copies: <strong>${b.availableCopies} / ${b.totalCopies}</strong></span>
      </div>
      <div class="book-meta" style="padding-top: 10px;">
        <span>Barcode: ${b.barcode}</span>
        <span class="badge ${isAvail ? "badge-success" : "badge-danger"}">${isAvail ? "Available" : "Issued Out"}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function filterStudentBooks() {
  const q = document
    .getElementById("student-book-search")
    .value.toLowerCase()
    .trim();

  let filtered = studentCachedBooks;

  if (q) {
    filtered = filtered.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.barcode.toLowerCase().includes(q),
    );
  }

  renderStudentBooksGrid(filtered);
}

function populateStudentFilterSelects(books) {
  const authorSelect = document.getElementById("student-filter-author");
  if (!authorSelect) return;

  const selectedAuthor = authorSelect.value;
  const authors = [
    ...new Set(books.map((b) => b.author).filter(Boolean)),
  ].sort();

  authorSelect.innerHTML = '<option value="">All Authors</option>';
  authors.forEach((auth) => {
    const opt = document.createElement("option");
    opt.value = auth;
    opt.textContent = auth;
    if (auth === selectedAuthor) opt.selected = true;
    authorSelect.appendChild(opt);
  });
}

// STUDENT SUBVIEW 3: BORROW RECORDS
async function loadStudentBorrowRecords() {
  const tbody = document.getElementById("student-table-issues-body");
  if (!tbody) return;

  try {
    const libId = currentSession.libraryId;
    const memId = currentSession.id;
    const issues = await window.smartLibDB.getIssues(libId);
    const myIssues = issues.filter((i) => i.memberId === memId);

    tbody.innerHTML = "";

    if (myIssues.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">You have not borrowed any books yet.</td></tr>`;
      return;
    }

    // Sort: active issues first, then returned date desc
    const sorted = [...myIssues].sort((a, b) => {
      if (a.status === "issued" && b.status !== "issued") return -1;
      if (a.status !== "issued" && b.status === "issued") return 1;
      return new Date(b.issueDate) - new Date(a.issueDate);
    });

    sorted.forEach((i) => {
      const row = document.createElement("tr");
      const issueDate = new Date(i.issueDate).toLocaleDateString();
      const dueDate = new Date(i.dueDate).toLocaleDateString();
      const returnDate = i.returnDate
        ? new Date(i.returnDate).toLocaleDateString()
        : "Pending Return";

      const fineVal = calculateIssueFine(i);
      const isReturned = i.status === "returned";

      row.innerHTML = `
        <td><strong>${i.bookTitle}</strong></td>
        <td>${issueDate}</td>
        <td>${dueDate}</td>
        <td><span style="color: ${isReturned ? "var(--text-primary)" : "var(--color-warning)"}">${returnDate}</span></td>
        <td>
          <span style="font-weight:600; color: ${fineVal > 0 ? "var(--color-accent)" : "var(--color-secondary)"}">
            ${fineVal > 0 ? `₹${fineVal.toFixed(2)}` : "No Fine"}
          </span>
        </td>
        <td><span class="badge ${isReturned ? "badge-success" : "badge-info"}">${i.status}</span></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast("Error retrieving borrowing logs.", "danger");
  }
}

// ==========================================
// UTILITIES AND MODALS AND QR BINDINGS
// ==========================================

// Global calculations for Fines
function calculateIssueFine(issue) {
  return calculateIssueFineWithRate(issue, appSettings.fineRate);
}

function calculateIssueFineWithRate(issue, rate = 1.0) {
  if (issue.status === "returned") {
    return issue.fineAmount || 0;
  }
  // Calculate current fine
  const now = new Date();
  const due = new Date(issue.dueDate);
  if (now > due) {
    const diffTime = Math.abs(now - due);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays * rate;
  }
  return 0;
}

// Modal open/close helpers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "flex";
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "none";
  }
}

// View QR Code Modal
function openQRCodeModal(dataText, headerTitle) {
  document.getElementById("modal-qr-header-title").textContent = headerTitle;
  document.getElementById("modal-qr-description").textContent =
    `Code text: "${dataText}". Present this code to process checkouts/returns.`;

  const canvas = document.getElementById("modal-qr-canvas");
  window.smartLibQR.generate(canvas, dataText, 200, 200);

  openModal("modal-qr");
}

function downloadModalQRCode() {
  const qrDiv = document.getElementById("modal-qr-canvas");
  const img = qrDiv.querySelector("img");

  if (img) {
    const link = document.createElement("a");
    link.href = img.src;
    link.download = `smartlib_qr_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("QR Code image downloaded.", "success");
  } else {
    // Canvas download option
    const canvas = qrDiv.querySelector("canvas");
    if (canvas) {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `smartlib_qr_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("QR Code image downloaded.", "success");
    } else {
      showToast("Could not download image format.", "danger");
    }
  }
}

// --- ACTIVE SCANNER CONTROLS ---
function openScannerFor(fieldType) {
  currentScannerTarget = fieldType; // 'book' or 'member' or 'add-book-barcode'
  openModal("modal-scanner");

  // Start Scanner
  window.smartLibQR
    .startScanner("scanner-view-camera-source", handleQRScanSuccess, (err) => {
      // Quiet background failure
    })
    .then(() => {
      showToast("Camera feed online.", "info");
    })
    .catch((err) => {
      showToast(
        "Failed to initialize camera. Use simulator links or file upload.",
        "warning",
      );
    });
}

function closeScannerModal() {
  window.smartLibQR.stopScanner();
  closeModal("modal-scanner");
}

// Callback when QR code is scanned successfully
function handleQRScanSuccess(decodedText) {
  closeScannerModal();

  let targetText = decodedText.trim();
  // Strip protocol prefix if scanned (from old system QR values)
  if (targetText.startsWith("smartlib://")) {
    const parts = targetText.replace("smartlib://", "").split("/");
    if (parts.length >= 2) {
      targetText = parts[1];
    }
  }

  showToast(`Scanned Code decoded: ${targetText}`, "success");

  // Determine where to fill the code
  if (currentScannerTarget === "member") {
    resolveMember(targetText);
  } else if (currentScannerTarget === "book") {
    resolveBook(targetText);
  } else if (currentScannerTarget === "add-book-barcode") {
    const barcodeInput = document.getElementById("book-barcode");
    if (barcodeInput) {
      barcodeInput.value = targetText;
      fetchBookDetailsFromOpenLibrary(targetText);
    }
  } else if (currentScannerTarget === "shelf-finder") {
    const shelfInput = document.getElementById("shelf-barcode-input");
    if (shelfInput) {
      shelfInput.value = targetText;
      handleShelfFinderSearch();
    }
  } else {
    // Default fallback to fill whatever was open or alert
    showToast(`Decoded: ${targetText}`, "info");
  }
}

// Upload file QR scanner callback
async function handleImageQRUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast("Decoding QR from uploaded image...", "info");
    await window.smartLibQR.scanFile(
      file,
      (decodedText) => {
        handleQRScanSuccess(decodedText);
        e.target.value = ""; // clear file field
      },
      (err) => {
        showToast("No readable QR Code found in this image.", "danger");
        e.target.value = "";
      },
    );
  } catch (err) {
    showToast(err.message, "danger");
    e.target.value = "";
  }
}

// --- MEMBERSHIP ID CARD GENERATION & DOWNLOADS ---
let activeIDCardMember = null;

function viewStudentIDCard(memberId) {
  const m = cachedMembers.find((mem) => mem.id === memberId);
  if (!m) return;
  displayIDCardModal(m);
}

function viewMyIDCard() {
  if (!currentSession) return;
  displayIDCardModal({
    id: currentSession.id,
    name: currentSession.name,
    username: currentSession.username,
    email: currentSession.email || "N/A",
    mobile: currentSession.mobile || "N/A",
    address: currentSession.address || "N/A",
    memberIdCustom: currentSession.memberIdCustom,
    libraryName: currentSession.libraryName,
    joinDate: currentSession.joinDate,
  });
}

function displayIDCardModal(member) {
  activeIDCardMember = member;

  // Fill text details
  document.getElementById("idcard-lib-name").textContent =
    member.libraryName || currentSession.libraryName || "Smart Library";
  document.getElementById("idcard-student-name").textContent = member.name;
  document.getElementById("idcard-student-id").textContent =
    member.memberIdCustom;
  document.getElementById("idcard-student-username").textContent =
    member.username;
  document.getElementById("idcard-student-mobile").textContent =
    member.mobile || "N/A";
  document.getElementById("idcard-student-email").textContent =
    member.email || "N/A";

  // Generate QR inside the card
  const holder = document.getElementById("idcard-qr-holder");
  const qrValue = member.memberIdCustom;
  window.smartLibQR.generate(holder, qrValue, 75, 75);

  openModal("modal-idcard");
}

async function downloadMemberIDCard() {
  if (!activeIDCardMember) {
    showToast("No active card selected to download.", "danger");
    return;
  }

  const member = activeIDCardMember;
  const libName = (
    member.libraryName ||
    currentSession.libraryName ||
    "Smart Library"
  ).toUpperCase();

  // 1. Create canvas element
  const canvas = document.createElement("canvas");
  canvas.width = 380;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");

  // 2. Draw Card Background (Rounded Rectangle styling)
  ctx.fillStyle = "#1e3a8a"; // Navy base
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
  } else {
    ctx.rect(0, 0, canvas.width, canvas.height);
  }
  ctx.fill();

  // Draw subtle overlay gradient
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.05)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.25)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
  } else {
    ctx.rect(0, 0, canvas.width, canvas.height);
  }
  ctx.fill();

  // Draw border line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
  } else {
    ctx.rect(0, 0, canvas.width, canvas.height);
  }
  ctx.stroke();

  // 3. Draw Header Section
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fillRect(0, 0, canvas.width, 45); // Banner bg

  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(0, 44, canvas.width, 1); // Border bottom

  // Library Title
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px 'Outfit', sans-serif";
  ctx.fillText(libName, 18, 26);

  // Badge Title
  ctx.fillStyle = "#93c5fd";
  ctx.font = "600 9px 'Outfit', sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("MEMBERSHIP PASS", canvas.width - 18, 26);
  ctx.textAlign = "left"; // reset

  // 4. Draw Student Avatar placeholder
  ctx.fillStyle = "#60a5fa";
  ctx.beginPath();
  ctx.arc(40, 100, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1e3a8a";
  ctx.beginPath();
  ctx.arc(40, 95, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(40, 118, 14, Math.PI, 0, false);
  ctx.fill();

  // 5. Draw Student details
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px 'Outfit', sans-serif";
  ctx.fillText(member.name, 80, 85);

  ctx.fillStyle = "#93c5fd";
  ctx.font = "normal 11px monospace";
  ctx.fillText(`ID: ${member.memberIdCustom}`, 80, 104);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "500 11px 'Outfit', sans-serif";
  ctx.fillText(`Username: ${member.username}`, 80, 122);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "normal 10px 'Outfit', sans-serif";
  ctx.fillText(`Phone: ${member.mobile || "N/A"}`, 80, 140);
  ctx.fillText(`Email: ${member.email || "N/A"}`, 80, 155);

  // 6. Draw QR Code representation
  const qrDiv = document.getElementById("idcard-qr-holder");
  const qrImg = qrDiv.querySelector("img") || qrDiv.querySelector("canvas");

  if (qrImg) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(canvas.width - 98, 65, 80, 80, 6);
    } else {
      ctx.rect(canvas.width - 98, 65, 80, 80);
    }
    ctx.fill();
    ctx.drawImage(qrImg, canvas.width - 94, 69, 72, 72);
  }

  // 7. Footer Text
  ctx.fillStyle = "#93c5fd";
  ctx.font = "normal 8px 'Outfit', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "Valid at all library branches. Non-transferable.",
    canvas.width / 2,
    222,
  );

  // 8. Convert to download link
  try {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `smartlib_pass_${member.username}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Library ID Card downloaded successfully!", "success");
  } catch (err) {
    console.error("Canvas export failed:", err);
    showToast("Failed to export ID Card image.", "danger");
  }
}

// ==========================================
// SHELF FINDER MODULE
// ==========================================
async function loadShelfFinderTab() {
  try {
    const libId = currentSession.libraryId;
    allLibBooksList = await window.smartLibDB.getBooks(libId);

    // Clear inputs and results
    document.getElementById("shelf-barcode-input").value = "";
    document.getElementById("shelf-finder-placeholder").style.display = "block";
    document.getElementById("shelf-finder-success-card").style.display = "none";
    document.getElementById("shelf-finder-error-card").style.display = "none";

    // Populate mock/quick selector list
    const mockContainer = document.getElementById("shelf-finder-mock-list");
    if (mockContainer) {
      mockContainer.innerHTML = "";
      const displayBooks = allLibBooksList.slice(0, 8);
      if (displayBooks.length === 0) {
        mockContainer.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">No books cataloged yet</span>`;
      }
      displayBooks.forEach((b) => {
        const span = document.createElement("span");
        span.className = "mock-qr-tag";
        span.textContent =
          b.title.slice(0, 15) + (b.title.length > 15 ? "..." : "");
        span.title = `Barcode: ${b.barcode || b.isbn || b.id}`;
        span.onclick = () => {
          document.getElementById("shelf-barcode-input").value =
            b.barcode || b.isbn || b.id;
          handleShelfFinderSearch();
        };
        mockContainer.appendChild(span);
      });
    }
  } catch (err) {
    console.error(err);
    showToast("Error initializing Shelf Finder.", "danger");
  }
}

function handleShelfFinderSearch(e) {
  if (e) e.preventDefault();
  const inputVal = document.getElementById("shelf-barcode-input").value.trim();
  if (!inputVal) return;

  const book = allLibBooksList.find(
    (b) =>
      (b.barcode && b.barcode.toLowerCase() === inputVal.toLowerCase()) ||
      (b.isbn && b.isbn.toLowerCase() === inputVal.toLowerCase()) ||
      b.id === inputVal,
  );

  document.getElementById("shelf-finder-placeholder").style.display = "none";
  if (book) {
    playScanChime(true);
    showToast(
      `Book found! Shelf location: ${book.shelfLocation || "N/A"}`,
      "success",
    );

    document.getElementById("shelf-result-location").textContent =
      book.shelfLocation || "N/A";
    document.getElementById("shelf-result-title").textContent = book.title;
    document.getElementById("shelf-result-author").textContent =
      `by ${book.author || "Unknown"}`;
    document.getElementById("shelf-result-barcode").textContent =
      book.barcode || "N/A";
    document.getElementById("shelf-result-isbn").textContent =
      book.isbn || "N/A";
    document.getElementById("shelf-result-total-copies").textContent =
      book.totalCopies || 1;
    document.getElementById("shelf-result-available-copies").textContent =
      `${book.availableCopies} / ${book.totalCopies}`;

    const coverContainer = document.getElementById(
      "shelf-result-cover-container",
    );
    if (book.coverUrl) {
      coverContainer.innerHTML = `<img src="${book.coverUrl}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      coverContainer.innerHTML = `<i class="fa-solid fa-book" style="font-size: 24px; color: var(--text-muted);"></i>`;
    }

    document.getElementById("shelf-finder-success-card").style.display =
      "block";
    document.getElementById("shelf-finder-error-card").style.display = "none";
  } else {
    playScanChime(false);
    showToast("Book not found in database.", "danger");

    document.getElementById("shelf-finder-success-card").style.display = "none";
    document.getElementById("shelf-finder-error-card").style.display = "block";
  }
}

function openAddBookModalFromShelfFinder() {
  const barcodeValue = document
    .getElementById("shelf-barcode-input")
    .value.trim();
  openAddBookModal();
  if (barcodeValue) {
    document.getElementById("book-barcode").value = barcodeValue;
    fetchBookDetailsFromOpenLibrary(barcodeValue);
  }
}

// ==========================================
// MOBILE SIDEBAR HANDLERS
// ==========================================
function toggleSidebar() {
  const activeView = document.querySelector(".app-view.active");
  if (!activeView) return;
  const sidebar = activeView.querySelector(".sidebar");
  const backdrop = activeView.querySelector(".sidebar-backdrop");
  if (sidebar && backdrop) {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("active");
  }
}

function closeSidebar() {
  const activeView = document.querySelector(".app-view.active");
  if (!activeView) return;
  const sidebar = activeView.querySelector(".sidebar");
  const backdrop = activeView.querySelector(".sidebar-backdrop");
  if (sidebar && backdrop) {
    sidebar.classList.remove("open");
    backdrop.classList.remove("active");
  }
}
