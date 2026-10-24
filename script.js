/* =====================================================
   CAMPUSCONNECT
   FIREBASE + MAIN JAVASCRIPT
   ===================================================== */

"use strict";

/* =====================================================
   FIREBASE WEB SDK
   ===================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import { initCampus, campusLoad, campusReset, campusAlerts, campusExport } from "./campus.js";

import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    updateProfile as updateAuthProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    deleteField,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    serverTimestamp,
    terminate,
    clearIndexedDbPersistence,
    waitForPendingWrites
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


const firebaseConfig = {
    apiKey: "AIzaSyD0r6LKcLc07Q1ZQstcCkLTKKqe4uUKZb4",
    authDomain: "campusconnect-26255.firebaseapp.com",
    projectId: "campusconnect-26255",
    storageBucket: "campusconnect-26255.firebasestorage.app",
    messagingSenderId: "102416440802",
    appId: "1:102416440802:web:4ceb6feb2210326cfb2dbb",
    measurementId: "G-KZZKEQJFXB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;

try {
    // Offline-first: Firestore keeps a local copy of your data (IndexedDB), serves it
    // when there is no connection, and syncs queued changes when you reconnect.
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (error) {
    console.warn("Offline persistence unavailable, using memory cache:", error);
    db = getFirestore(app);
}


/* =====================================================
   PREFERENCES (synced to Firestore: users/{uid}/settings/preferences)
   ===================================================== */

const SCENES = ["aurora", "campus", "doodles", "plain"];

const PREF_DEFAULTS = {
    theme: "light",
    scene: "aurora",
    motion: true,
    weeklyGoal: 150,
    gpaScale: "us",
    readNotifications: []
};

function loadCachedPrefs() {

    try {
        const raw = JSON.parse(localStorage.getItem("campusconnect_prefs") || "null");
        if (raw && typeof raw === "object") return raw;
    } catch { /* ignore */ }

    const legacyTheme = localStorage.getItem("campusconnect_theme");

    return legacyTheme ? { theme: legacyTheme } : {};
}

function sanitizePrefs(input) {

    const p = { ...PREF_DEFAULTS, ...input };
    const goal = Math.round(Number(p.weeklyGoal));

    return {
        theme: p.theme === "dark" ? "dark" : "light",
        scene: SCENES.includes(p.scene) ? p.scene : "aurora",
        motion: p.motion !== false,
        weeklyGoal: Number.isFinite(goal) ? Math.min(1200, Math.max(30, goal)) : 150,
        gpaScale: p.gpaScale === "uk" ? "uk" : "us",
        readNotifications: Array.isArray(p.readNotifications)
            ? p.readNotifications.filter(k => typeof k === "string").slice(-200)
            : []
    };
}

let prefs = sanitizePrefs({
    motion: !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    ...loadCachedPrefs()
});

let prefsTimer = null;

function applyPrefs() {

    document.body.classList.toggle("dark", prefs.theme === "dark");
    document.body.classList.toggle("no-motion", !prefs.motion);
    document.body.dataset.scene = prefs.scene;

    document.querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", prefs.theme === "dark" ? "#0b1020" : "#4f46e5");

    updateThemeUI();
    syncSettingsUI();
}

function savePrefs() {

    try {
        localStorage.setItem("campusconnect_prefs", JSON.stringify(prefs));
    } catch { /* storage may be unavailable */ }

    if (!currentUser) return;

    const uid = currentUser.uid;

    clearTimeout(prefsTimer);

    prefsTimer = setTimeout(async () => {
        try {
            await setDoc(
                doc(db, "users", uid, "settings", "preferences"),
                { ...prefs, updatedAt: serverTimestamp() },
                { merge: true }
            );
        } catch (error) {
            console.warn("Preferences cloud save failed:", error);
        }
    }, 500);
}

async function loadPrefs(user) {

    const device = { theme: prefs.theme, scene: prefs.scene, motion: prefs.motion };
    let remote = {};

    try {
        const snapshot = await getDoc(doc(db, "users", user.uid, "settings", "preferences"));
        if (snapshot.exists()) remote = snapshot.data();
    } catch (error) {
        console.warn("Preferences could not be loaded:", error);
    }

    prefs = sanitizePrefs({ ...PREF_DEFAULTS, ...device, ...remote });

    applyPrefs();
    loadReadNotifications();

    if (!Object.keys(remote).length) savePrefs();
}

applyPrefs();


/* =====================================================
   STATE
   ===================================================== */

let currentUser = null;
let currentPage = "dashboard";
let pageHistory = ["dashboard"];
let isNavigatingBack = false;
let dataLoading = false;
let registering = false;
let allowSeeding = false;   // demo data is created only once per account (see loadUserData)
let profileYear = null;

let assignments = [
    {
        id: 1,
        title: "Java Programming Project",
        course: "COSC 223",
        priority: "high",
        date: getDateOffset(1),
        completed: false
    },
    {
        id: 2,
        title: "Network Design Report",
        course: "COSC 326",
        priority: "medium",
        date: getDateOffset(3),
        completed: false
    },
    {
        id: 3,
        title: "Database ER Diagram",
        course: "COSC 212",
        priority: "low",
        date: getDateOffset(7),
        completed: false
    }
];

let courses = [
    {
        code: "COSC 223",
        name: "Object-Oriented Programming",
        credits: 3
    },
    {
        code: "COSC 326",
        name: "Computer Networks",
        credits: 3
    },
    {
        code: "COSC 212",
        name: "Database Systems",
        credits: 3
    },
    {
        code: "COSC 315",
        name: "Software Engineering",
        credits: 3
    }
];

const DEFAULT_ASSIGNMENTS = assignments.map(item => ({ ...item }));
const DEFAULT_COURSES = courses.map(item => ({ ...item }));


/* =====================================================
   DOM READY
   ===================================================== */

document.addEventListener("DOMContentLoaded", () => {

    initializeTheme();
    initializeNavigation();
    initializeMobileMenu();
    initializeModals();
    initializeAssignments();
    initializeCourses();
    initializeProfile();
    initializeNotifications();
    initializeButtons();
    initializeExtras();
    initializeUpgrades();
    initializeDashboardV2();
    initializeV3();

    initCampus({
        db,
        getDisplayName: () => currentUser?.displayName || (currentUser?.email || "Student").split("@")[0],
        cloudLoadList,
        cloudSave,
        cloudDelete,
        newId,
        showToast,
        escapeHTML,
        daysUntil,
        toLocalISODate,
        navigateTo,
        openModal,
        closeModal,
        getUser: () => currentUser,
        getCourses: () => courses,
        getClasses: () => classes,
        getAssignments: () => assignments,
        onChange: () => { try { renderNotifications(); } catch (error) { console.warn(error); } }
    });

    updateDashboardDate();
    updateGreeting();
    updateAssignmentCount();
    updateCourseCount();

    initializeFirebaseAuth();
});


/* =====================================================
   DATE HELPERS
   ===================================================== */

function toLocalISODate(date) {

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
}


function getDateOffset(days) {

    const date = new Date();
    date.setDate(date.getDate() + days);

    return toLocalISODate(date);
}





function updateGreeting() {

    const el = document.getElementById("heroGreetingText");

    if (!el) return;

    const hour = new Date().getHours();

    el.textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}


function formatDate(dateString) {

    const date = new Date(dateString + "T00:00:00");

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    });
}


function getRelativeDate(dateString) {

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(dateString + "T00:00:00");
    target.setHours(0, 0, 0, 0);

    const difference = Math.round(
        (target - today) /
        (1000 * 60 * 60 * 24)
    );

    if (difference < 0) return "Overdue";
    if (difference === 0) return "Today";
    if (difference === 1) return "Tomorrow";
    if (difference <= 7) return `In ${difference} days`;

    return formatDate(dateString);
}


/* =====================================================
   NAVIGATION
   ===================================================== */

function initializeNavigation() {

    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
        backBtn.addEventListener("click", goBack);
    }

    document.querySelectorAll(".nav-item").forEach(item => {

        item.addEventListener("click", () => {
            navigateTo(item.dataset.page);
        });

    });

    document.querySelectorAll("[data-page-target]").forEach(button => {

        button.addEventListener("click", () => {
            navigateTo(button.dataset.pageTarget);
        });

    });
}


function navigateTo(pageName) {

    if (!pageName || pageName === currentPage) return;

    if (!isNavigatingBack) {
        pageHistory.push(pageName);
        if (pageHistory.length > 12) pageHistory.shift();
    }

    currentPage = pageName;

    const titleEl = document.getElementById("pageTitle");
    if (titleEl) titleEl.textContent = PAGE_TITLES[pageName] || capitalize(pageName);

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
    });

    const target = document.getElementById(`${pageName}Page`);

    if (target) {
        target.classList.add("active");
    }

    document.querySelectorAll(".nav-item").forEach(item => {

        item.classList.toggle(
            "active",
            item.dataset.page === pageName
        );

    });

    closeSidebar();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function goBack() {
    if (pageHistory.length <= 1) {
        navigateTo("dashboard");
        return;
    }

    pageHistory.pop();
    const previousPage = pageHistory[pageHistory.length - 1] || "dashboard";
    isNavigatingBack = true;
    navigateTo(previousPage);
    isNavigatingBack = false;
}


/* =====================================================
   MOBILE MENU
   ===================================================== */

function initializeMobileMenu() {

    const menuBtn = document.getElementById("menuBtn");
    const sidebar = document.getElementById("sidebar");

    if (!menuBtn || !sidebar) return;

    menuBtn.addEventListener("click", () => {
        sidebar.classList.toggle("open");
    });

    document.addEventListener("click", event => {

        if (
            window.innerWidth <= 800 &&
            sidebar.classList.contains("open") &&
            !sidebar.contains(event.target) &&
            !menuBtn.contains(event.target)
        ) {
            closeSidebar();
        }

    });
}


function closeSidebar() {

    const sidebar = document.getElementById("sidebar");

    if (sidebar) {
        sidebar.classList.remove("open");
    }
}


/* =====================================================
   THEME
   ===================================================== */

function initializeTheme() {

    applyPrefs();

    document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
}


function toggleTheme() {

    prefs.theme = prefs.theme === "dark" ? "light" : "dark";

    applyPrefs();
    savePrefs();

    showToast(prefs.theme === "dark" ? "Dark mode enabled" : "Light mode enabled", "success");
}


function updateThemeUI() {

    const themeToggle =
        document.getElementById("themeToggle");

    if (!themeToggle) return;

    const icon = themeToggle.querySelector("i");
    const label = themeToggle.querySelector("span");

    const isDark =
        document.body.classList.contains("dark");

    if (icon) {
        icon.className =
            isDark
                ? "fa-solid fa-sun"
                : "fa-solid fa-moon";
    }

    if (label) {
        label.textContent =
            isDark
                ? "Light Mode"
                : "Dark Mode";
    }
}


/* =====================================================
   MODALS
   ===================================================== */

function initializeModals() {

    document.querySelectorAll("[data-close]").forEach(button => {

        button.addEventListener("click", () => {
            closeModal(button.dataset.close);
        });

    });

    document.querySelectorAll(".modal-overlay").forEach(overlay => {

        overlay.addEventListener("click", event => {

            if (event.target === overlay) {
                overlay.classList.remove("active");
            }

        });

    });

    document.addEventListener("keydown", event => {

        if (event.key === "Escape") {

            document
                .querySelectorAll(".modal-overlay.active")
                .forEach(modal => {
                    modal.classList.remove("active");
                });

        }

    });

    const addAssignmentBtn =
        document.getElementById("addAssignmentBtn");

    if (addAssignmentBtn) {
        addAssignmentBtn.addEventListener(
            "click",
            () => openModal("assignmentModal")
        );
    }

    const addCourseBtn =
        document.getElementById("addCourseBtn");

    if (addCourseBtn) {
        addCourseBtn.addEventListener(
            "click",
            () => openModal("courseModal")
        );
    }

    const editProfileBtn =
        document.getElementById("editProfileBtn");

    if (editProfileBtn) {
        editProfileBtn.addEventListener(
            "click",
            () => openModal("profileModal")
        );
    }
}


function openModal(id) {

    const modal = document.getElementById(id);

    if (!modal) return;

    lastFocusedElement = document.activeElement;
    modal.classList.add("active");

    setTimeout(() => {
        modal.querySelector("input:not([type=hidden]), select, textarea")?.focus();
    }, 50);
}


function closeModal(id) {

    const modal = document.getElementById(id);

    if (modal) modal.classList.remove("active");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus();
        lastFocusedElement = null;
    }
}


/* =====================================================
   ASSIGNMENTS
   ===================================================== */

function initializeAssignments() {

    const form =
        document.getElementById("assignmentForm");

    if (form) {
        form.addEventListener(
            "submit",
            handleAssignmentSubmit
        );
    }

    const search =
        document.getElementById("assignmentSearch");

    const filter =
        document.getElementById("assignmentFilter");

    if (search) {
        search.addEventListener(
            "input",
            renderAssignments
        );
    }

    if (filter) {
        filter.addEventListener(
            "change",
            renderAssignments
        );
    }

    const list = document.getElementById("assignmentPageList");

    if (list) {
        list.addEventListener("click", event => {

            const button = event.target.closest("[data-action]");

            if (!button) return;

            if (button.dataset.action === "toggle") toggleAssignment(button.dataset.id);
            if (button.dataset.action === "delete") deleteAssignment(button.dataset.id);
            if (button.dataset.action === "edit") startEditAssignment(button.dataset.id);
        });
    }

    renderAssignments();
}


async function handleAssignmentSubmit(event) {

    event.preventDefault();

    const title = document.getElementById("assignmentTitle")?.value.trim();
    const course = document.getElementById("assignmentCourse")?.value || "";
    const priority = document.getElementById("assignmentPriority")?.value || "medium";
    const date = document.getElementById("assignmentDate")?.value;

    if (!title || !date) {
        showToast("Please complete all required fields.", "error");
        return;
    }

    if (editingAssignmentId !== null) {
        await saveAssignmentEdit({ title: title.slice(0, 120), course, priority, date });
        event.target.reset();
        closeModal("assignmentModal");
        return;
    }

    const assignment = {
        id: Date.now(),
        title: title.slice(0, 120),
        course,
        priority,
        date,
        completed: false
    };

    let reference = null;

    if (currentUser) {
        reference = doc(
            collection(db, "users", currentUser.uid, "assignments")
        );
        assignment.firestoreId = reference.id;
    }

    assignments.push(assignment);

    renderAssignments();
    updateAssignmentCount();

    event.target.reset();
    closeModal("assignmentModal");
    showToast("Assignment added successfully.", "success");

    if (reference) {
        try {
            const { firestoreId, ...data } = assignment;
            await setDoc(reference, { ...data, createdAt: serverTimestamp() });
        } catch (error) {
            console.error("Assignment cloud save failed:", error);
            showToast("Saved on this device only. Cloud save failed.", "error");
        }
    }
}


function renderAssignments() {

    const container =
        document.getElementById("assignmentPageList");

    if (!container) return;

    const search =
        document
            .getElementById("assignmentSearch")
            ?.value
            .toLowerCase()
            .trim() || "";

    const filter =
        document
            .getElementById("assignmentFilter")
            ?.value || "all";

    const filtered =
        assignments.filter(assignment => {

            const matchesSearch =
                assignment.title
                    .toLowerCase()
                    .includes(search) ||
                assignment.course
                    .toLowerCase()
                    .includes(search);

            let matchesFilter = true;

            if (filter === "pending") {
                matchesFilter =
                    !assignment.completed;
            }

            if (filter === "completed") {
                matchesFilter =
                    assignment.completed;
            }

            if (filter === "high") {
                matchesFilter =
                    assignment.priority === "high";
            }

            return matchesSearch && matchesFilter;
        });

    filtered.sort((a, b) =>
        Number(a.completed) - Number(b.completed) ||
        a.date.localeCompare(b.date)
    );

    if (!filtered.length) {

        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-clipboard-check"></i>
                <h3>No assignments found</h3>
                <p>Try changing your search or filter.</p>
            </div>
        `;

        return;
    }

    container.innerHTML =
        filtered.map(assignment => `

            <div
                class="assignment-row
                ${assignment.completed ? "completed-row" : ""}"
                data-id="${escapeHTML(assignment.id)}"
            >

                <div class="assignment-check">

                    <button
                        class="check-btn
                        ${assignment.completed ? "checked" : ""}"
                        data-action="toggle" data-id="${escapeHTML(assignment.id)}" aria-label="Toggle complete" aria-pressed="${assignment.completed}"
                        style="
                            ${
                                assignment.completed
                                    ? `
                                        background:var(--success);
                                        border-color:var(--success);
                                        color:white;
                                    `
                                    : ""
                            }
                        "
                    >
                        <i class="fa-solid fa-check"></i>
                    </button>

                </div>

                <div class="assignment-main">

                    <strong>
                        ${escapeHTML(assignment.title)}
                    </strong>

                    <span>
                        ${escapeHTML(assignment.course)}
                        • Academic Assignment
                    </span>

                </div>

                <div class="assignment-deadline ${!assignment.completed && daysUntil(assignment.date) < 0 ? 'overdue' : ''}">

                    <span>Due</span>

                    <strong>
                        ${escapeHTML(
                            getRelativeDate(assignment.date)
                        )}
                    </strong>

                </div>

                <span class="priority ${escapeHTML(assignment.priority)}">
                    ${escapeHTML(
                        capitalize(assignment.priority)
                    )}
                </span>

                <button class="row-menu" data-action="edit" data-id="${escapeHTML(assignment.id)}" title="Edit assignment" aria-label="Edit assignment"><i class="fa-solid fa-pen"></i></button>
                <button
                    class="row-menu"
                    data-action="delete" data-id="${escapeHTML(assignment.id)}" title="Delete assignment" aria-label="Delete assignment"
                >
                    <i class="fa-solid fa-trash"></i>
                </button>

            </div>

        `).join("");
}


async function toggleAssignment(id) {

    const assignment = assignments.find(item => String(item.id) === String(id));

    if (!assignment) return;

    assignment.completed = !assignment.completed;

    renderAssignments();
    updateAssignmentCount();

    showToast(
        assignment.completed
            ? "Assignment marked complete."
            : "Assignment marked as pending.",
        "success"
    );

    if (currentUser && assignment.firestoreId) {
        try {
            await updateDoc(
                doc(db, "users", currentUser.uid, "assignments", assignment.firestoreId),
                { completed: assignment.completed, updatedAt: serverTimestamp() }
            );
        } catch (error) {
            console.error("Assignment update failed:", error);
            assignment.completed = !assignment.completed;
            renderAssignments();
            updateAssignmentCount();
            showToast("Cloud update failed. Change reverted.", "error");
        }
    }
}


async function deleteAssignment(id) {

    const index = assignments.findIndex(item => String(item.id) === String(id));

    if (index === -1) return;

    const [assignment] = assignments.splice(index, 1);

    renderAssignments();
    updateAssignmentCount();
    showToast("Assignment deleted.", "success");

    if (currentUser && assignment.firestoreId) {
        try {
            await deleteDoc(
                doc(db, "users", currentUser.uid, "assignments", assignment.firestoreId)
            );
        } catch (error) {
            console.error("Assignment deletion failed:", error);
            assignments.splice(index, 0, assignment);
            renderAssignments();
            updateAssignmentCount();
            showToast("Cloud deletion failed. Assignment restored.", "error");
        }
    }
}


function updateAssignmentCount() {

    const pending = assignments.filter(item => !item.completed).length;

    const badge = document.getElementById("assignmentBadge");
    const stat = document.getElementById("pendingAssignments");

    if (badge) badge.textContent = pending;
    if (stat) stat.textContent = pending;

    renderDashboardAssignments();
    updateDashboardStats();
}


function renderDashboardAssignments() {

    const container = document.getElementById("dashboardAssignments");

    if (!container) return;

    const upcoming = assignments
        .filter(item => !item.completed)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5);

    if (!upcoming.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-clipboard-check"></i>
                <h3>You're all caught up</h3>
                <p>No pending assignments right now.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = upcoming.map(item => {

        const late = daysUntil(item.date) < 0;

        return `
            <div class="mini-item">
                <button type="button" class="mini-check" data-dash-toggle data-id="${escapeHTML(item.id)}" aria-label="Mark ${escapeHTML(item.title)} complete"><i class="fa-solid fa-check"></i></button>
                <div>
                    <strong>${escapeHTML(item.title)}</strong>
                    <span>${escapeHTML(item.course || "General")}</span>
                </div>
                <span class="priority ${escapeHTML(item.priority)}">${escapeHTML(capitalize(item.priority))}</span>
                <em class="${late ? "late" : ""}">${escapeHTML(getRelativeDate(item.date))}</em>
            </div>
        `;
    }).join("");
}


function updateDashboardStats() {

    const total = assignments.length;
    const done = assignments.filter(item => item.completed).length;
    const credits = courses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
    const dueSoon = assignments.filter(a => !a.completed && daysUntil(a.date) <= 7).length;
    const joined = groups.filter(g => g.joined).length;

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    set("statCompleted", done);
    set("statCredits", credits);
    set("statCompletion", total ? `${Math.round((done / total) * 100)}%` : "—");
    set("statDueSoon", dueSoon);
    set("statGroups", joined);
    set("statGroupsSnap", joined);

    renderProgress();
    renderFocus();
    renderNotifications();
    renderDashboardV2();
}


/* =====================================================
   COURSES
   ===================================================== */

function initializeCourses() {

    const form =
        document.getElementById("courseForm");

    if (form) {

        form.addEventListener(
            "submit",
            handleCourseSubmit
        );
    }

    renderCourses();
}


async function handleCourseSubmit(event) {

    event.preventDefault();

    const code = document.getElementById("courseCode")?.value.trim();
    const name = document.getElementById("courseName")?.value.trim();
    const credits = document.getElementById("courseCredits")?.value;

    if (!code || !name) {
        showToast("Please complete the course details.", "error");
        return;
    }

    if (courses.some(c => c.code.toLowerCase() === code.toLowerCase())) {
        showToast(`${code} is already in your course list.`, "error");
        return;
    }

    const course = {
        code: code.slice(0, 20),
        name: name.slice(0, 100),
        credits: Math.min(20, Math.max(0, Number(credits) || 0))
    };

    courses.push(course);

    renderCourses();
    event.target.reset();
    closeModal("courseModal");
    showToast("Course added successfully.", "success");

    if (currentUser) {
        try {
            await setDoc(
                doc(db, "users", currentUser.uid, "courses", safeDocumentId(course.code)),
                { ...course, updatedAt: serverTimestamp() }
            );
        } catch (error) {
            console.error("Course cloud save failed:", error);
            showToast("Saved on this device only. Cloud save failed.", "error");
        }
    }
}


function renderCourses() {

    const grid = document.getElementById("courseGrid");

    if (!grid) return;

    grid.innerHTML = "";

    if (!courses.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i class="fa-solid fa-book-open"></i>
                <h3>No courses yet</h3>
                <p>Use "Add Course" to build your semester plan.</p>
            </div>
        `;
    }

    courses.forEach(course => addCourseCard(course));

    updateCourseCount();
}


function addCourseCard(course) {

    const grid = document.getElementById("courseGrid");

    if (!grid) return;

    const stats = getCourseStats(course.code);
    const card = document.createElement("div");

    card.className = "course-card";
    card.dataset.code = course.code;
    card.innerHTML = `
        <div class="course-card-top purple-bg">
            <span>${escapeHTML(course.code)}</span>
            <button type="button" class="chip-del light" data-action="delete-course" data-code="${escapeHTML(course.code)}" aria-label="Remove ${escapeHTML(course.code)}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="course-card-body">
            <h3>${escapeHTML(course.name)}</h3>
            <p>${stats.total ? `${stats.done} of ${stats.total} assignments done` : "No assignments yet"}</p>
            <div class="course-progress">
                <div><span>Progress</span><strong>${stats.percent}%</strong></div>
                <div class="progress-bar"><span style="width:${stats.percent}%"></span></div>
            </div>
            <div class="course-footer">
                <span><i class="fa-regular fa-clock"></i> ${escapeHTML(course.credits)} Credits</span>
                <span>${stats.pending} pending${Number.isFinite(course.grade) ? ` · ${course.grade}%` : ""}</span>
            </div>
        </div>
    `;

    grid.appendChild(card);
}


function updateCourseCount() {

    const activeCourses = document.getElementById("activeCourses");
    const dashCount = document.getElementById("activeCoursesDash");

    if (activeCourses) activeCourses.textContent = courses.length;
    if (dashCount) dashCount.textContent = courses.length;

    populateCourseSelect();
    renderNotes();
    renderGrades();
    updateDashboardStats();
}


function populateCourseSelect() {

    const select = document.getElementById("assignmentCourse");

    if (!select) return;

    const previous = select.value;

    select.innerHTML = courses.map(course => `
        <option value="${escapeHTML(course.code)}">
            ${escapeHTML(course.code)} · ${escapeHTML(course.name)}
        </option>
    `).join("");

    if (previous && courses.some(c => c.code === previous)) {
        select.value = previous;
    }
}


/* =====================================================
   PROFILE
   ===================================================== */

function initializeProfile() {

    const form =
        document.getElementById("profileForm");

    const savedProfile =
        JSON.parse(
            localStorage.getItem(
                "campusconnect_profile"
            ) || "null"
        );

    if (savedProfile) {
        applyProfile(savedProfile);
    }

    if (form) {

        form.addEventListener(
            "submit",
            handleProfileSubmit
        );
    }
}


async function handleProfileSubmit(event) {

    event.preventDefault();

    const name =
        document
            .getElementById("profileNameInput")
            ?.value
            .trim();

    const programme =
        document
            .getElementById("profileProgramme")
            ?.value
            .trim();

    const studentId =
        document
            .getElementById("profileStudentId")
            ?.value
            .trim();

    if (!name) {

        showToast(
            "Please enter your name.",
            "error"
        );

        return;
    }

    const profile = {
        name,
        programme,
        studentId
    };

    localStorage.setItem(
        "campusconnect_profile",
        JSON.stringify(profile)
    );

    applyProfile({ ...profile, yearOfStudy: profileYear });

    if (currentUser) {

        try {

            await setDoc(
                doc(db, "users", currentUser.uid),
                {
                    ...profile,
                    email: currentUser.email || "",
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            );

            if (
                currentUser.displayName !== name
            ) {

                await updateAuthProfile(
                    currentUser,
                    { displayName: name }
                );
            }

        } catch (error) {

            console.error(
                "Profile cloud save failed:",
                error
            );

            showToast(
                "Profile saved, but cloud save failed.",
                "error"
            );
        }
    }

    closeModal("profileModal");

    showToast(
        "Profile updated successfully.",
        "success"
    );
}


function applyProfile(profile) {

    const name =
        profile.name || "Student";

    const initials =
        getInitials(name);

    const elements = {

        sidebarUserName:
            document.getElementById(
                "sidebarUserName"
            ),

        profileName:
            document.getElementById(
                "profileName"
            ),

        detailName:
            document.getElementById(
                "detailName"
            ),

        dashboardUserName:
            document.getElementById(
                "dashboardUserName"
            ),

        sidebarUserCourse:
            document.getElementById(
                "sidebarUserCourse"
            ),

        sidebarAvatar:
            document.getElementById(
                "sidebarAvatar"
            ),

        headerAvatar:
            document.getElementById(
                "headerAvatar"
            ),

        profileAvatar:
            document.getElementById(
                "profileAvatar"
            )
    };

    if (elements.sidebarUserName) {
        elements.sidebarUserName.textContent = name;
    }

    if (elements.profileName) {
        elements.profileName.textContent = name;
    }

    if (elements.detailName) {
        elements.detailName.textContent = name;
    }

    if (elements.dashboardUserName) {
        elements.dashboardUserName.textContent =
            name.split(" ")[0];
    }

    if (elements.sidebarUserCourse) {
        elements.sidebarUserCourse.textContent =
            profile.programme ||
            "Computer Science";
    }

    if (elements.sidebarAvatar) {
        elements.sidebarAvatar.textContent =
            initials;
    }

    if (elements.headerAvatar) {
        elements.headerAvatar.textContent =
            initials;
    }

    if (elements.profileAvatar) {
        elements.profileAvatar.textContent =
            initials;
    }

    const input =
        document.getElementById(
            "profileNameInput"
        );

    if (input) {
        input.value = name;
    }

    const programmeInput =
        document.getElementById(
            "profileProgramme"
        );

    if (programmeInput) {
        programmeInput.value =
            profile.programme ||
            "BSc Computer Science";
    }

    const studentIdInput =
        document.getElementById(
            "profileStudentId"
        );

    if (studentIdInput) {
        studentIdInput.value =
            profile.studentId || "";
    }

    if ("yearOfStudy" in profile) profileYear = profile.yearOfStudy || null;

    // Profile page details (these were previously hardcoded in the HTML).
    const detailProgramme = document.getElementById("profileDetailProgramme");
    const detailStudentId = document.getElementById("profileDetailStudentId");
    const detailYear = document.getElementById("profileDetailYear");

    if (detailProgramme) detailProgramme.textContent = profile.programme || "Not set";
    if (detailStudentId) detailStudentId.textContent = profile.studentId || "Not set";
    if (detailYear) detailYear.textContent = profileYear ? `Year ${profileYear}` : "Not set";
}


function getInitials(name) {

    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join("");
}


/* =====================================================
   NOTIFICATIONS
   ===================================================== */

function initializeNotifications() {

    document.getElementById("markAllRead")?.addEventListener("click", () => {
        buildNotifications().forEach(n => readNotifications.add(n.key));
        saveReadNotifications();
        renderNotifications();
        showToast("All notifications marked as read.", "success");
    });

    document.getElementById("notificationBtn")?.addEventListener("click", () => navigateTo("notifications"));
    document.getElementById("mobileNotificationBtn")?.addEventListener("click", () => navigateTo("notifications"));
}


/* =====================================================
   OTHER BUTTONS
   ===================================================== */

function initializeButtons() {

    [
        document.getElementById("logoutBtn"),
        document.getElementById("settingsLogoutBtn")
    ]
        .filter(Boolean)
        .forEach(button => button.addEventListener("click", handleLogout));
}


async function handleLogout() {

    const confirmed =
        confirm(
            "Are you sure you want to log out?"
        );

    if (!confirmed) return;

    try {

        // Give queued changes a few seconds to sync; warn before discarding anything.
        let synced = true;

        try {
            synced = await Promise.race([
                waitForPendingWrites(db).then(() => true),
                new Promise(resolve => setTimeout(() => resolve(false), 4000))
            ]);
        } catch {
            synced = false;
        }

        if (!synced && !confirm("Some changes haven't synced yet (you may be offline). Logging out will discard them. Log out anyway?")) {
            return;
        }

        await signOut(auth);

        // Wipe the local offline copy of this account's data so the next person on a shared
        // computer cannot read it, then reload to start from a clean state.
        try {
            await terminate(db);
            await clearIndexedDbPersistence(db);
        } catch (cacheError) {
            console.warn("Could not clear the local data cache:", cacheError);
        }

        location.reload();

    } catch (error) {

        console.error(
            "Logout failed:",
            error
        );

        showToast(
            "Logout failed. Please try again.",
            "error"
        );
    }
}


/* =====================================================
   DASHBOARD
   ===================================================== */

function updateDashboardDate() {

    const element =
        document.getElementById("todayDate");

    if (!element) return;

    const today = new Date();

    element.textContent =
        today.toLocaleDateString(
            "en-US",
            {
                weekday: "long",
                month: "long",
                day: "numeric"
            }
        );
}


function initializeUser() {

    const savedProfile =
        JSON.parse(
            localStorage.getItem(
                "campusconnect_profile"
            ) || "null"
        );

    if (savedProfile) {

        applyProfile(savedProfile);
        return;
    }

    applyProfile({
        name: "Student",
        programme: "BSc Computer Science",
        studentId: "CC2026"
    });
}


/* =====================================================
   FIREBASE AUTHENTICATION
   ===================================================== */

function initializeFirebaseAuth() {

    createAuthenticationUI();

    onAuthStateChanged(
        auth,
        async user => {

            currentUser = user || null;

            if (!user) {

                resetSessionState();
                updateFirebaseStatus(null);
                showAuthenticationGate();
                return;
            }

            hideAuthenticationGate();
            updateFirebaseStatus(user);

            // During sign-up the registration handler writes the profile first, then loads data,
            // so the auto-created default profile can never overwrite the student's details.
            if (registering) return;

            await loadUserData(user);
        }
    );
}


function resetSessionState() {

    assignments = DEFAULT_ASSIGNMENTS.map(item => ({ ...item }));
    courses = DEFAULT_COURSES.map(item => ({ ...item }));
    classes = [];
    groups = [];
    readNotifications = new Set();
    todos = [];
    notes = [];
    focusLog = {};
    campusReset();
    prefs = sanitizePrefs({ theme: prefs.theme, scene: prefs.scene, motion: prefs.motion });
    dataLoading = false;
    pageHistory = ["dashboard"];

    localStorage.removeItem("campusconnect_profile");

    applyProfile({
        name: "Student",
        programme: "BSc Computer Science",
        studentId: ""
    });

    renderAssignments();
    renderCourses();
    renderSchedule();
    renderGroups();
    renderNotes();
    renderGrades();
    updateAssignmentCount();
    navigateTo("dashboard");
}


async function loadUserData(user) {

    if (dataLoading) return;

    dataLoading = true;

    try {

        const profileRef =
            doc(
                db,
                "users",
                user.uid
            );

        const profileSnapshot =
            await getDoc(profileRef);

        let profile;

        if (profileSnapshot.exists()) {

            const data =
                profileSnapshot.data();

            profile = {

                name:
                    data.name ||
                    user.displayName ||
                    user.email?.split("@")[0] ||
                    "Student",

                programme:
                    data.programme ||
                    "BSc Computer Science",

                studentId:
                    data.studentId ||
                    "",

                yearOfStudy:
                    Number(data.yearOfStudy) || null
            };

            // Demo courses, classes and groups are seeded only until the account is flagged.
            allowSeeding = data.seeded !== true;

        } else {

            allowSeeding = true;

            profile = {

                name:
                    user.displayName ||
                    user.email?.split("@")[0] ||
                    "Student",

                programme:
                    "BSc Computer Science",

                studentId:
                    ""
            };

            await setDoc(
                profileRef,
                {
                    ...profile,
                    email: user.email || "",
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            );
        }

        localStorage.setItem(
            "campusconnect_profile",
            JSON.stringify(profile)
        );

        applyProfile(profile);

        await loadPrefs(user);
        await loadAssignments(user);
        await loadCourses(user);
        classes = await cloudLoadList(user, "classes", DEFAULT_CLASSES);
        groups = await cloudLoadList(user, "groups", DEFAULT_GROUPS);

        // Newer collections load independently so one failure never blocks the app.
        todos = await safeLoad(async () =>
            (await cloudLoadList(user, "todos", [])).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), []);
        notes = await safeLoad(() => cloudLoadList(user, "notes", []), []);
        focusLog = await safeLoad(() => loadFocusLog(user), {});
        await safeLoad(() => campusLoad(user), null);

        // Mark the account as seeded so deleted demo items never come back on the next sign-in.
        if (allowSeeding) {
            allowSeeding = false;
            await safeLoad(() => setDoc(profileRef, { seeded: true }, { merge: true }), null);
        }

        renderNotes();
        renderGrades();
        loadAnnouncements();

        renderAssignments();
        renderCourses();
        renderSchedule();
        renderGroups();
        updateAssignmentCount();
        updateCourseCount();

    } catch (error) {

        console.error(
            "Firebase data loading failed:",
            error
        );

        showToast(
            "Firebase connected, but some cloud data could not be loaded.",
            "error"
        );

    } finally {

        dataLoading = false;
    }
}


async function loadAssignments(user) {

    const assignmentsRef =
        collection(
            db,
            "users",
            user.uid,
            "assignments"
        );

    let snapshot;

    try {

        snapshot =
            await getDocs(
                query(
                    assignmentsRef,
                    orderBy("date", "asc")
                )
            );

    } catch (error) {

        console.warn(
            "Ordered assignment query failed; loading without ordering.",
            error
        );

        snapshot =
            await getDocs(assignmentsRef);
    }

    if (snapshot.empty && !allowSeeding) {

        assignments = [];

        return;
    }

    if (snapshot.empty) {

        assignments =
            DEFAULT_ASSIGNMENTS.map(
                item => ({ ...item })
            );

        for (const assignment of assignments) {

            const reference =
                await addDoc(
                    assignmentsRef,
                    {
                        ...assignment,
                        createdAt:
                            serverTimestamp()
                    }
                );

            assignment.firestoreId =
                reference.id;
        }

        return;
    }

    assignments =
        snapshot.docs.map(item => {

            const data =
                item.data();

            return {

                id:
                    data.id ?? item.id,

                firestoreId:
                    item.id,

                title:
                    data.title ||
                    "Untitled Assignment",

                course:
                    data.course ||
                    "",

                priority:
                    data.priority ||
                    "medium",

                date:
                    data.date ||
                    getDateOffset(7),

                completed:
                    Boolean(data.completed)
            };
        });
}


async function loadCourses(user) {

    const coursesRef =
        collection(
            db,
            "users",
            user.uid,
            "courses"
        );

    const snapshot =
        await getDocs(coursesRef);

    if (snapshot.empty && !allowSeeding) {

        courses = [];

        return;
    }

    if (snapshot.empty) {

        courses =
            DEFAULT_COURSES.map(
                item => ({ ...item })
            );

        for (const course of courses) {

            await setDoc(
                doc(
                    db,
                    "users",
                    user.uid,
                    "courses",
                    safeDocumentId(course.code)
                ),
                {
                    ...course,
                    createdAt:
                        serverTimestamp()
                }
            );
        }

        return;
    }

    courses =
        snapshot.docs.map(item => {

            const data =
                item.data();

            return {

                code:
                    data.code ||
                    item.id,

                name:
                    data.name ||
                    "Course",

                credits:
                    Number(data.credits) || 0,

                grade:
                    Number.isFinite(data.grade) ? data.grade : null
            };
        });
}


/* =====================================================
   FIREBASE AUTH UI
   ===================================================== */

function createAuthenticationUI() {

    if (document.getElementById("firebaseAuthGate")) return;

    const gate = document.createElement("div");
    gate.id = "firebaseAuthGate";

    gate.innerHTML = `
        <div class="auth-page">
            <div class="auth-brand-panel">
                <div class="auth-brand">
                    <div class="auth-brand-mark"><i class="fa-solid fa-graduation-cap"></i></div>
                    <div>
                        <strong>CampusConnect</strong>
                        <span>Student Hub</span>
                    </div>
                </div>

                <div class="auth-brand-content">
                    <span class="auth-kicker">YOUR CAMPUS. YOUR FUTURE.</span>
                    <h1>Everything you need for a smarter student life.</h1>
                    <p>Manage courses, assignments, schedules, study groups and academic progress from one secure workspace.</p>

                    <div class="auth-benefits">
                        <div><i class="fa-solid fa-cloud"></i><span>Secure cloud-synced data</span></div>
                        <div><i class="fa-solid fa-list-check"></i><span>Stay on top of assignments</span></div>
                        <div><i class="fa-solid fa-chart-line"></i><span>Track your academic progress</span></div>
                    </div>
                </div>

                <div class="auth-brand-footer">© 2026 CampusConnect · Built for students</div>
            </div>

            <div class="auth-form-panel">
                <div class="auth-mobile-brand">
                    <div class="auth-brand-mark"><i class="fa-solid fa-graduation-cap"></i></div>
                    <strong>CampusConnect</strong>
                </div>

                <div class="firebase-auth-card">
                    <div class="auth-welcome">
                        <span class="auth-small-label" id="firebaseAuthModeLabel">WELCOME BACK</span>
                        <h2 id="firebaseAuthTitle">Sign in to CampusConnect</h2>
                        <p id="firebaseAuthSubtitle">Enter your account details to continue to your student workspace.</p>
                    </div>

                    <form id="firebaseAuthForm">
                        <div class="firebase-auth-field">
                            <label for="firebaseAuthEmail">Email address</label>
                            <div class="auth-input-wrap">
                                <i class="fa-regular fa-envelope"></i>
                                <input id="firebaseAuthEmail" type="email" autocomplete="email" placeholder="you@example.com" required>
                            </div>
                        </div>

                        <div class="firebase-auth-field">
                            <div class="auth-label-row">
                                <label for="firebaseAuthPassword">Password</label>
                                <button type="button" id="firebaseForgotPassword" class="firebase-auth-link">Forgot password?</button>
                            </div>
                            <div class="auth-input-wrap">
                                <i class="fa-solid fa-lock"></i>
                                <input id="firebaseAuthPassword" type="password" autocomplete="current-password" placeholder="Enter your password" minlength="6" required>
                                <button type="button" id="firebasePasswordToggle" class="password-toggle" aria-label="Show password"><i class="fa-regular fa-eye"></i></button>
                            </div>
                        </div>

                        <button type="submit" id="firebaseAuthSubmit" class="firebase-auth-submit">
                            <span>Sign In</span><i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </form>

                    <div class="firebase-auth-divider"><span>NEW TO CAMPUSCONNECT?</span></div>

                    <button type="button" id="firebaseCreateAccount" class="firebase-auth-secondary">
                        Create Student Account
                    </button>

                    <p id="firebaseAuthMessage" class="firebase-auth-message" aria-live="polite"></p>
                </div>
            </div>
        </div>

        <div class="student-registration-modal" id="studentRegistrationModal" role="dialog" aria-modal="true" aria-labelledby="studentRegistrationTitle">
            <div class="student-registration-backdrop" data-registration-close></div>
            <div class="student-registration-card">
                <div class="registration-head">
                    <div>
                        <span class="auth-small-label">STUDENT REGISTRATION</span>
                        <h2 id="studentRegistrationTitle">Create your CampusConnect account</h2>
                        <p>Enter your student details once. They will be securely stored with your cloud profile.</p>
                    </div>
                    <button type="button" id="studentRegistrationClose" class="registration-close" aria-label="Close registration"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <form id="studentRegistrationForm" class="registration-form">
                    <div class="registration-grid">
                        <div class="firebase-auth-field registration-full">
                            <label for="studentRegName">Full name *</label>
                            <div class="auth-input-wrap"><i class="fa-regular fa-user"></i><input id="studentRegName" type="text" autocomplete="name" placeholder="Your full name" required></div>
                        </div>

                        <div class="firebase-auth-field">
                            <label for="studentRegStudentId">Student ID *</label>
                            <div class="auth-input-wrap"><i class="fa-solid fa-id-card"></i><input id="studentRegStudentId" type="text" placeholder="e.g. CS/2026/001" required></div>
                        </div>

                        <div class="firebase-auth-field">
                            <label for="studentRegYear">Year of study *</label>
                            <div class="auth-input-wrap"><i class="fa-solid fa-layer-group"></i><select id="studentRegYear" required><option value="">Select year</option><option value="1">Year 1</option><option value="2">Year 2</option><option value="3">Year 3</option><option value="4">Year 4</option><option value="5">Year 5</option><option value="6">Year 6</option></select></div>
                        </div>

                        <div class="firebase-auth-field registration-full">
                            <label for="studentRegProgramme">Programme *</label>
                            <div class="auth-input-wrap"><i class="fa-solid fa-book-open"></i><input id="studentRegProgramme" type="text" placeholder="e.g. BSc Computer Science" value="BSc Computer Science" required></div>
                        </div>

                        <div class="firebase-auth-field registration-full">
                            <label for="studentRegEmail">Email address *</label>
                            <div class="auth-input-wrap"><i class="fa-regular fa-envelope"></i><input id="studentRegEmail" type="email" autocomplete="email" placeholder="you@example.com" required></div>
                        </div>

                        <div class="firebase-auth-field registration-full">
                            <label for="studentRegPassword">Password *</label>
                            <div class="auth-input-wrap"><i class="fa-solid fa-lock"></i><input id="studentRegPassword" type="password" autocomplete="new-password" placeholder="At least 6 characters" minlength="6" required><button type="button" id="studentRegPasswordToggle" class="password-toggle" aria-label="Show password"><i class="fa-regular fa-eye"></i></button></div>
                            <small class="registration-help">Use at least 6 characters. Never share your password.</small>
                        </div>
                    </div>

                    <p id="studentRegistrationMessage" class="registration-message" aria-live="polite"></p>

                    <div class="registration-actions">
                        <button type="button" id="studentRegistrationCancel" class="btn secondary">Cancel</button>
                        <button type="submit" id="studentRegistrationSubmit" class="firebase-auth-submit"><span>Create Student Account</span><i class="fa-solid fa-arrow-right"></i></button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(gate);

    const style = document.createElement("style");
    style.textContent = `
        #firebaseAuthGate {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: none;
            background: #f5f7fb;
            overflow-y: auto;
        }
        #firebaseAuthGate.active { display: block; }
        .auth-page { min-height: 100%; min-height: 100vh; display: grid; grid-template-columns: minmax(360px, .92fr) minmax(460px, 1.08fr); }
        .auth-brand-panel { position: relative; display: flex; flex-direction: column; padding: 48px clamp(32px, 5vw, 78px); color: #fff; background: radial-gradient(circle at 85% 15%, rgba(129,140,248,.45), transparent 32%), radial-gradient(circle at 15% 85%, rgba(56,189,248,.18), transparent 30%), linear-gradient(145deg,#111827 0%,#1e1b4b 55%,#312e81 100%); overflow: hidden; }
        .auth-brand-panel::after { content: ""; position: absolute; width: 420px; height: 420px; border: 1px solid rgba(255,255,255,.09); border-radius: 50%; right: -180px; bottom: -160px; box-shadow: 0 0 0 70px rgba(255,255,255,.025),0 0 0 140px rgba(255,255,255,.018); }
        .auth-brand, .auth-mobile-brand { display: flex; align-items: center; gap: 12px; }
        .auth-brand strong { display: block; font-size: 20px; letter-spacing: -.4px; }
        .auth-brand span { display: block; margin-top: 2px; color: rgba(255,255,255,.62); font-size: 12px; }
        .auth-brand-mark { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 12px 30px rgba(99,102,241,.3); }
        .auth-brand-content { position: relative; z-index: 1; max-width: 560px; margin: auto 0; }
        .auth-kicker, .auth-small-label { font-size: 11px; font-weight: 800; letter-spacing: 1.5px; }
        .auth-kicker { color: #a5b4fc; }
        .auth-brand-content h1 { max-width: 560px; margin: 16px 0; font-size: clamp(36px,4.3vw,58px); line-height: 1.04; letter-spacing: -2.5px; }
        .auth-brand-content > p { max-width: 500px; margin: 0; color: rgba(255,255,255,.7); font-size: 16px; line-height: 1.7; }
        .auth-benefits { display: grid; gap: 14px; margin-top: 34px; }
        .auth-benefits div { display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,.86); font-size: 14px; }
        .auth-benefits i { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #c7d2fe; background: rgba(255,255,255,.08); }
        .auth-brand-footer { position: relative; z-index: 1; color: rgba(255,255,255,.45); font-size: 12px; }
        .auth-form-panel { display: flex; align-items: center; justify-content: center; padding: 40px; background: #f8fafc; }
        .auth-mobile-brand { display: none; }
        .firebase-auth-card { width: min(440px,100%); padding: 12px; color: #111827; }
        .auth-welcome { margin-bottom: 30px; }
        .auth-small-label { color: #6366f1; }
        .firebase-auth-card h2 { margin: 8px 0 10px; font-size: 34px; line-height: 1.12; letter-spacing: -1.2px; color: #111827; }
        .firebase-auth-card .auth-welcome p { margin: 0; color: #64748b; line-height: 1.6; font-size: 14px; }
        .firebase-auth-field { margin-bottom: 20px; }
        .firebase-auth-field label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 700; color: #334155; }
        .auth-label-row { display: flex; justify-content: space-between; align-items: center; }
        .auth-input-wrap { position: relative; }
        .auth-input-wrap > i { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: #94a3b8; pointer-events: none; }
        .firebase-auth-field input { width: 100%; height: 50px; box-sizing: border-box; padding: 0 46px 0 43px; border: 1px solid #dbe2ea; border-radius: 13px; outline: none; background: #fff; color: #0f172a; font: inherit; transition: .2s ease; }
        .firebase-auth-field input:focus { border-color: #6366f1; box-shadow: 0 0 0 4px rgba(99,102,241,.10); }
        .firebase-auth-link { border: 0; padding: 0; background: transparent; color: #6366f1; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
        .password-toggle { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border: 0; border-radius: 8px; background: transparent; color: #94a3b8; cursor: pointer; }
        .password-toggle:hover { background: #f1f5f9; color: #475569; }
        .firebase-auth-submit, .firebase-auth-secondary { width: 100%; min-height: 50px; border-radius: 13px; padding: 13px 16px; font: inherit; font-weight: 800; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; }
        .firebase-auth-submit { display: flex; justify-content: center; align-items: center; gap: 10px; border: 0; color: #fff; background: linear-gradient(135deg,#4f46e5,#7c3aed); box-shadow: 0 12px 24px rgba(79,70,229,.2); }
        .firebase-auth-submit:hover { transform: translateY(-1px); box-shadow: 0 15px 28px rgba(79,70,229,.26); }
        .firebase-auth-submit:disabled { opacity: .65; cursor: wait; transform: none; }
        .firebase-auth-secondary { border: 1px solid #dbe2ea; color: #334155; background: #fff; }
        .firebase-auth-secondary:hover { border-color: #a5b4fc; background: #f8f7ff; }
        .firebase-auth-divider { display: flex; align-items: center; gap: 12px; margin: 25px 0 15px; color: #94a3b8; font-size: 9px; font-weight: 800; letter-spacing: 1.3px; }
        .firebase-auth-divider::before, .firebase-auth-divider::after { content: ""; flex: 1; height: 1px; background: #e2e8f0; }
        .firebase-auth-message { min-height: 20px; margin: 15px 0 0 !important; font-size: 13px; line-height: 1.45; text-align: center; }
        .firebase-auth-message.error { color: #dc2626; }
        .firebase-auth-message.success { color: #16a34a; }
        .student-registration-modal { position: fixed; inset: 0; z-index: 100001; display: none; align-items: center; justify-content: center; padding: 22px; overflow-y: auto; }
        .student-registration-modal.active { display: flex; }
        .student-registration-backdrop { position: absolute; inset: 0; background: rgba(15,23,42,.66); backdrop-filter: blur(8px); }
        .student-registration-card { position: relative; width: min(720px,100%); max-height: calc(100vh - 44px); overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 24px; padding: 28px; background: #fff; box-shadow: 0 30px 90px rgba(15,23,42,.28); }
        .registration-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
        .registration-head h2 { margin: 7px 0 8px; color: #111827; font-size: 27px; line-height: 1.15; letter-spacing: -.8px; }
        .registration-head p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.55; }
        .registration-close { width: 38px; height: 38px; flex: 0 0 auto; border: 1px solid #e2e8f0; border-radius: 11px; background: #f8fafc; color: #64748b; cursor: pointer; }
        .registration-close:hover { background: #f1f5f9; color: #0f172a; }
        .registration-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
        .registration-full { grid-column: 1 / -1; }
        .registration-form .firebase-auth-field { margin-bottom: 16px; }
        .registration-form select { width: 100%; height: 50px; box-sizing: border-box; padding: 0 40px 0 43px; border: 1px solid #dbe2ea; border-radius: 13px; outline: none; background: #fff; color: #0f172a; font: inherit; appearance: none; }
        .registration-form select:focus { border-color: #6366f1; box-shadow: 0 0 0 4px rgba(99,102,241,.10); }
        .registration-help { display: block; margin-top: 6px; color: #94a3b8; font-size: 11px; }
        .registration-message { min-height: 20px; margin: 2px 0 14px; text-align: center; color: #64748b; font-size: 13px; }
        .registration-message.error { color: #dc2626; }
        .registration-message.success { color: #16a34a; }
        .registration-actions { display: flex; justify-content: flex-end; gap: 10px; }
        .registration-actions .firebase-auth-submit { width: auto; min-width: 220px; }
        body.dark .student-registration-card { background: #111827; border-color: #334155; }
        body.dark .registration-head h2 { color: #f8fafc; }
        body.dark .registration-head p, body.dark .registration-help { color: #94a3b8; }
        body.dark .registration-close { background: #1f2937; border-color: #334155; color: #cbd5e1; }
        body.dark .registration-form select { background: #0f172a; border-color: #334155; color: #f8fafc; }
        body.dark .registration-close:hover { background: #334155; }
        body.dark #firebaseAuthGate { background: #0f172a; }
        body.dark .auth-form-panel { background: #0f172a; }
        body.dark .firebase-auth-card h2 { color: #f8fafc; }
        body.dark .firebase-auth-card .auth-welcome p { color: #94a3b8; }
        body.dark .firebase-auth-field label { color: #cbd5e1; }
        body.dark .firebase-auth-field input { background: #111827; border-color: #334155; color: #f8fafc; }
        body.dark .firebase-auth-secondary { background: #111827; border-color: #334155; color: #e2e8f0; }
        body.dark .firebase-auth-divider::before, body.dark .firebase-auth-divider::after { background: #334155; }
        @media (max-width: 850px) {
            .auth-page { display: block; }
            .auth-brand-panel { display: none; }
            .auth-form-panel { min-height: 100vh; padding: 28px 20px; display: flex; flex-direction: column; justify-content: center; }
            .auth-mobile-brand { display: flex; margin-bottom: 28px; font-size: 18px; color: #111827; }
            body.dark .auth-mobile-brand { color: #f8fafc; }
            .auth-mobile-brand .auth-brand-mark { width: 40px; height: 40px; border-radius: 12px; }
            .firebase-auth-card { padding: 0; }
            .firebase-auth-card h2 { font-size: 30px; }
        }
        @media (max-width: 480px) {
            .auth-form-panel { padding: 24px 16px; }
            .firebase-auth-card h2 { font-size: 27px; }
        }
    `;
    document.head.appendChild(style);

    document.getElementById("firebaseAuthForm").addEventListener("submit", handleFirebaseSignIn);
    document.getElementById("firebaseCreateAccount").addEventListener("click", openStudentRegistration);
    document.getElementById("firebaseForgotPassword").addEventListener("click", handleFirebasePasswordReset);

    const registrationClose = document.getElementById("studentRegistrationClose");
    const registrationCancel = document.getElementById("studentRegistrationCancel");
    const registrationForm = document.getElementById("studentRegistrationForm");

    registrationClose?.addEventListener("click", closeStudentRegistration);
    registrationCancel?.addEventListener("click", closeStudentRegistration);
    document.querySelector("[data-registration-close]")?.addEventListener("click", closeStudentRegistration);
    registrationForm?.addEventListener("submit", handleStudentRegistration);

    document.getElementById("studentRegPasswordToggle")?.addEventListener("click", () => {
        const input = document.getElementById("studentRegPassword");
        const icon = document.querySelector("#studentRegPasswordToggle i");
        const visible = input.type === "text";
        input.type = visible ? "password" : "text";
        if (icon) icon.className = visible ? "fa-regular fa-eye" : "fa-regular fa-eye-slash";
    });

    const passwordToggle = document.getElementById("firebasePasswordToggle");
    passwordToggle.addEventListener("click", () => {
        const input = document.getElementById("firebaseAuthPassword");
        const icon = passwordToggle.querySelector("i");
        const visible = input.type === "text";
        input.type = visible ? "password" : "text";
        icon.className = visible ? "fa-regular fa-eye" : "fa-regular fa-eye-slash";
        passwordToggle.setAttribute("aria-label", visible ? "Show password" : "Hide password");
    });
}


function showAuthenticationGate() {

    const gate =
        document.getElementById(
            "firebaseAuthGate"
        );

    if (gate) {
        gate.classList.add("active");
    }
}


function hideAuthenticationGate() {

    const gate =
        document.getElementById(
            "firebaseAuthGate"
        );

    if (gate) {
        gate.classList.remove("active");
    }
}


function updateFirebaseStatus(user) {

    document
        .querySelectorAll("[data-user-email]")
        .forEach(element => {

            element.textContent =
                user?.email || "";

        });

    const status =
        document.getElementById(
            "firebaseStatus"
        );

    if (status) {

        status.textContent =
            user
                ? "Cloud account connected"
                : "Not signed in";

        status.classList.toggle(
            "connected",
            Boolean(user)
        );
    }
}


function setFirebaseAuthMessage(
    message,
    type = ""
) {

    const element =
        document.getElementById(
            "firebaseAuthMessage"
        );

    if (!element) return;

    element.textContent = message;

    element.className =
        `firebase-auth-message ${type}`;
}


async function handleFirebaseSignIn(event) {

    event.preventDefault();

    const email =
        document
            .getElementById(
                "firebaseAuthEmail"
            )
            .value
            .trim();

    const password =
        document
            .getElementById(
                "firebaseAuthPassword"
            )
            .value;

    if (!email || !password) {

        setFirebaseAuthMessage(
            "Enter your email and password.",
            "error"
        );

        return;
    }

    try {

        setFirebaseAuthMessage(
            "Signing in..."
        );

        await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

    } catch (error) {

        console.error(
            "Firebase sign-in failed:",
            error
        );

        setFirebaseAuthMessage(
            friendlyAuthError(error),
            "error"
        );
    }
}


function openStudentRegistration() {

    const modal = document.getElementById("studentRegistrationModal");
    const authEmail = document.getElementById("firebaseAuthEmail")?.value.trim();
    const authPassword = document.getElementById("firebaseAuthPassword")?.value || "";

    if (!modal) return;

    const emailInput = document.getElementById("studentRegEmail");
    const passwordInput = document.getElementById("studentRegPassword");

    if (emailInput && authEmail) emailInput.value = authEmail;
    if (passwordInput && authPassword) passwordInput.value = authPassword;

    modal.classList.add("active");
    document.getElementById("studentRegName")?.focus();
}

function closeStudentRegistration() {

    const modal = document.getElementById("studentRegistrationModal");
    if (modal) modal.classList.remove("active");

    const message = document.getElementById("studentRegistrationMessage");
    if (message) {
        message.textContent = "";
        message.className = "registration-message";
    }
}

function setRegistrationMessage(message, type = "") {

    const element = document.getElementById("studentRegistrationMessage");
    if (!element) return;

    element.textContent = message;
    element.className = `registration-message ${type}`;
}

async function handleStudentRegistration(event) {

    event.preventDefault();

    const name = document.getElementById("studentRegName")?.value.trim();
    const studentId = document.getElementById("studentRegStudentId")?.value.trim();
    const programme = document.getElementById("studentRegProgramme")?.value.trim();
    const year = document.getElementById("studentRegYear")?.value;
    const email = document.getElementById("studentRegEmail")?.value.trim();
    const password = document.getElementById("studentRegPassword")?.value || "";

    if (!name || !studentId || !programme || !year || !email || !password) {
        setRegistrationMessage("Please complete all required fields.", "error");
        return;
    }

    if (password.length < 6) {
        setRegistrationMessage("Your password must contain at least 6 characters.", "error");
        return;
    }

    const submitButton = document.getElementById("studentRegistrationSubmit");

    try {
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account...';
        }

        setRegistrationMessage("Creating your secure student account...");

        registering = true;

        const result = await createUserWithEmailAndPassword(auth, email, password);

        await updateAuthProfile(result.user, {
            displayName: name
        });

        await setDoc(
            doc(db, "users", result.user.uid),
            {
                name,
                studentId,
                programme,
                yearOfStudy: Number(year),
                email,
                role: "student",
                accountStatus: "active",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

        registering = false;
        await loadUserData(result.user);

        setRegistrationMessage("Account created successfully. Welcome to CampusConnect!", "success");

        setTimeout(() => {
            closeStudentRegistration();
        }, 900);

    } catch (error) {
        console.error("Student registration failed:", error);
        setRegistrationMessage(friendlyAuthError(error), "error");

        // If the account was created but a later step failed, still load the signed-in user's data.
        if (registering && auth.currentUser) {
            registering = false;
            loadUserData(auth.currentUser);
        }
    } finally {
        registering = false;
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<span>Create Student Account</span><i class="fa-solid fa-arrow-right"></i>';
        }
    }
}


async function handleFirebasePasswordReset() {

    const email =
        document
            .getElementById(
                "firebaseAuthEmail"
            )
            .value
            .trim();

    if (!email) {

        setFirebaseAuthMessage(
            "Enter your email address first.",
            "error"
        );

        return;
    }

    try {

        await sendPasswordResetEmail(
            auth,
            email
        );

        setFirebaseAuthMessage(
            "Password reset email sent.",
            "success"
        );

    } catch (error) {

        console.error(
            "Password reset failed:",
            error
        );

        setFirebaseAuthMessage(
            friendlyAuthError(error),
            "error"
        );
    }
}


function friendlyAuthError(error) {

    const messages = {

        "auth/invalid-email":
            "Please enter a valid email address.",

        "auth/missing-password":
            "Please enter your password.",

        "auth/invalid-credential":
            "The email or password is incorrect.",

        "auth/email-already-in-use":
            "An account already exists with this email.",

        "auth/weak-password":
            "Use a stronger password with at least 6 characters.",

        "auth/user-not-found":
            "No account was found with this email.",

        "auth/too-many-requests":
            "Too many attempts. Please wait and try again.",

        "auth/network-request-failed":
            "Network error. Check your internet connection.",

        "auth/operation-not-allowed":
            "Email/password authentication is not enabled in Firebase."
    };

    return (
        messages[error?.code] ||
        "Authentication failed. Please try again."
    );
}


/* =====================================================
   TOAST
   ===================================================== */

function showToast(
    message,
    type = "success"
) {

    const container =
        document.getElementById(
            "toastContainer"
        );

    if (!container) return;

    const toast =
        document.createElement("div");

    toast.className =
        `toast ${type}`;

    const icon =
        type === "error"
            ? "fa-circle-exclamation"
            : "fa-circle-check";

    toast.innerHTML = `

        <i class="fa-solid ${icon}"></i>

        <span>
            ${escapeHTML(message)}
        </span>
    `;

    container.appendChild(toast);

    setTimeout(() => {

        toast.style.opacity = "0";
        toast.style.transform =
            "translateX(20px)";

        setTimeout(() => {
            toast.remove();
        }, 250);

    }, 3000);
}


/* =====================================================
   HELPERS
   ===================================================== */

function capitalize(value) {

    if (!value) return "";

    return value.charAt(0).toUpperCase() +
        value.slice(1);
}


function escapeHTML(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function escapeJS(value) {

    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}


function safeDocumentId(value) {

    return String(value)
        .trim()
        .replace(/\//g, "_")
        .replace(/\s+/g, "_");
}


/* =====================================================
   GLOBAL FUNCTIONS
   Existing HTML uses inline onclick handlers.
   ===================================================== */

window.toggleAssignment =
    toggleAssignment;

window.deleteAssignment =
    deleteAssignment;

window.navigateTo =
    navigateTo;

window.showToast =
    showToast;

window.handleLogout =
    handleLogout;

/* =====================================================
   PWA SERVICE WORKER
   ===================================================== */



/* =====================================================
   UPGRADE: SCHEDULE, STUDY GROUPS, NOTIFICATIONS,
   PROGRESS, FOCUS
   ===================================================== */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI"];
const CHIP_COLORS = ["purple", "blue", "green", "orange"];

const DEFAULT_CLASSES = [
    { day: 0, time: "09:00", title: "OOP · COSC 223", location: "Lab 2" },
    { day: 0, time: "14:00", title: "Database Lab", location: "Room C04" },
    { day: 1, time: "11:00", title: "Networks · COSC 326", location: "Room B12" },
    { day: 2, time: "10:00", title: "Software Engineering", location: "Room A01" },
    { day: 3, time: "09:00", title: "Database Systems · COSC 212", location: "Room C04" },
    { day: 3, time: "13:00", title: "OOP Tutorial", location: "Lab 2" },
    { day: 4, time: "11:00", title: "Networks Lab", location: "Lab 1" }
];

const DEFAULT_GROUPS = [
    { name: "Java Masters", course: "COSC 223", members: 18, icon: "fa-code", color: "purple", activity: "Active today", joined: false, custom: false },
    { name: "Network Ninjas", course: "COSC 326", members: 12, icon: "fa-network-wired", color: "blue", activity: "Active yesterday", joined: false, custom: false },
    { name: "Database Crew", course: "COSC 212", members: 9, icon: "fa-database", color: "green", activity: "Active today", joined: false, custom: false },
    { name: "Exam Prep Hub", course: "General", members: 27, icon: "fa-graduation-cap", color: "orange", activity: "Active now", joined: false, custom: false }
];

let classes = [];
let groups = [];
let readNotifications = new Set();
let lastFocusedElement = null;


/* ---------- shared helpers ---------- */

function daysUntil(dateString) {

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(dateString + "T00:00:00");

    return Math.round((target - today) / 86400000);
}


function colorFor(text) {

    let hash = 0;

    for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;

    return CHIP_COLORS[hash % CHIP_COLORS.length];
}


function getCourseStats(code) {

    const items = assignments.filter(a => a.course === code);
    const done = items.filter(a => a.completed).length;

    return {
        total: items.length,
        done,
        pending: items.length - done,
        percent: items.length ? Math.round((done / items.length) * 100) : 0
    };
}


/* ---------- cloud list helpers ---------- */

async function cloudLoadList(user, sub, defaults) {

    const ref = collection(db, "users", user.uid, sub);
    const snapshot = await getDocs(ref);

    if (snapshot.empty) {

        const items = (allowSeeding ? defaults : []).map(item => ({ ...item, id: doc(ref).id }));

        await Promise.all(items.map(item => {
            const { id, ...data } = item;
            return setDoc(doc(ref, id), { ...data, createdAt: serverTimestamp() });
        }));

        return items;
    }

    return snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
}


async function cloudSave(sub, item) {

    if (!currentUser) return;

    try {
        const { id, ...data } = item;
        await setDoc(
            doc(db, "users", currentUser.uid, sub, id),
            { ...data, updatedAt: serverTimestamp() }
        );
    } catch (error) {
        console.error(`Cloud save failed (${sub}):`, error);
        showToast("Saved on this device only. Cloud save failed.", "error");
    }
}


async function cloudDelete(sub, id) {

    if (!currentUser) return;

    try {
        await deleteDoc(doc(db, "users", currentUser.uid, sub, id));
    } catch (error) {
        console.error(`Cloud delete failed (${sub}):`, error);
        showToast("Cloud deletion failed.", "error");
    }
}


function newId(sub) {

    return currentUser
        ? doc(collection(db, "users", currentUser.uid, sub)).id
        : String(Date.now());
}


/* ---------- wiring ---------- */

function initializeExtras() {

    document.getElementById("addClassBtn")?.addEventListener("click", () => openModal("classModal"));

    document.getElementById("createGroupBtn")?.addEventListener("click", () => {
        populateGroupCourseSelect();
        openModal("groupModal");
    });

    document.getElementById("classForm")?.addEventListener("submit", handleClassSubmit);
    document.getElementById("groupForm")?.addEventListener("submit", handleGroupSubmit);

    document.getElementById("weekGrid")?.addEventListener("click", event => {
        const button = event.target.closest("[data-action='delete-class']");
        if (button) deleteClass(button.dataset.id);
    });

    document.getElementById("groupGrid")?.addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        if (button.dataset.action === "join") toggleGroup(button.dataset.id);
        if (button.dataset.action === "delete-group") deleteGroup(button.dataset.id);
    });

    document.getElementById("courseGrid")?.addEventListener("click", event => {
        const button = event.target.closest("[data-action='delete-course']");
        if (button) deleteCourse(button.dataset.code);
    });

    document.getElementById("notificationList")?.addEventListener("click", event => {
        const card = event.target.closest("[data-key]");
        if (!card) return;
        readNotifications.add(card.dataset.key);
        saveReadNotifications();
        renderNotifications();
        navigateTo("assignments");
    });

    renderSchedule();
    renderGroups();
    renderNotifications();
}


/* ---------- schedule ---------- */

function renderSchedule() {

    const grid = document.getElementById("weekGrid");

    if (grid) {

        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));

        grid.innerHTML = DAY_SHORT.map((label, index) => {

            const day = new Date(monday);
            day.setDate(monday.getDate() + index);

            const isToday = day.toDateString() === now.toDateString();

            const chips = classes
                .filter(c => c.day === index)
                .sort((a, b) => a.time.localeCompare(b.time))
                .map(c => `
                    <div class="class-chip ${colorFor(c.title)}">
                        <button type="button" class="chip-del" data-action="delete-class" data-id="${escapeHTML(c.id)}" aria-label="Remove ${escapeHTML(c.title)}"><i class="fa-solid fa-xmark"></i></button>
                        <b>${escapeHTML(c.time)}</b> ${escapeHTML(c.title)}
                        ${c.location ? `<br><small>${escapeHTML(c.location)}</small>` : ""}
                    </div>
                `).join("") || `<p class="day-empty">Free day</p>`;

            return `
                <div class="day-card ${isToday ? "today" : ""}">
                    <span>${label}</span>
                    <strong>${String(day.getDate()).padStart(2, "0")}</strong>
                    ${chips}
                </div>
            `;
        }).join("");
    }

    renderDashboardSchedule();
}


function nextOccurrence(cls, now = new Date()) {

    const [hours, minutes] = cls.time.split(":").map(Number);
    const jsDay = (cls.day + 1) % 7;
    const date = new Date(now);

    date.setHours(hours, minutes, 0, 0);
    date.setDate(now.getDate() + ((jsDay - now.getDay() + 7) % 7));

    if (date < now) date.setDate(date.getDate() + 7);

    return date;
}


function renderDashboardSchedule() {

    const container = document.getElementById("dashboardSchedule");

    if (!container) return;

    const now = new Date();

    const upcoming = classes
        .map(c => ({ ...c, when: nextOccurrence(c, now) }))
        .sort((a, b) => a.when - b.when)
        .slice(0, 3);

    if (!upcoming.length) {
        container.innerHTML = `<p class="day-empty">No classes yet. Add one from the Schedule page.</p>`;
        return;
    }

    container.innerHTML = upcoming.map(c => {

        const diff = daysUntil(toLocalISODate(c.when));
        const label = diff === 0
            ? "Today"
            : diff === 1
                ? "Tomorrow"
                : c.when.toLocaleDateString("en-US", { weekday: "short" });

        return `
            <div class="schedule-row">
                <span class="time">${escapeHTML(c.time)}</span>
                <div><strong>${escapeHTML(c.title)}</strong><span>${escapeHTML(c.location || "Location TBA")}</span></div>
                <em>${label}</em>
            </div>
        `;
    }).join("");

    renderDashboardV2();
}


async function handleClassSubmit(event) {

    event.preventDefault();

    const title = document.getElementById("classTitle").value.trim();
    const day = Number(document.getElementById("classDay").value);
    const time = document.getElementById("classTime").value;
    const location = document.getElementById("classLocation").value.trim();

    if (!title || !time) {
        showToast("Please enter a title and start time.", "error");
        return;
    }

    const item = { id: newId("classes"), day, time, title: title.slice(0, 80), location: location.slice(0, 60) };

    classes.push(item);
    renderSchedule();

    event.target.reset();
    document.getElementById("classTime").value = "09:00";
    closeModal("classModal");
    showToast(`Class added on ${DAY_NAMES[day]}.`, "success");

    await cloudSave("classes", item);
}


async function deleteClass(id) {

    const index = classes.findIndex(c => c.id === id);

    if (index === -1) return;

    const [removed] = classes.splice(index, 1);

    renderSchedule();
    showToast("Class removed.", "success");

    await cloudDelete("classes", removed.id);
}


/* ---------- study groups ---------- */

function renderGroups() {

    const grid = document.getElementById("groupGrid");

    if (!grid) return;

    if (!groups.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i class="fa-solid fa-users"></i>
                <h3>No study groups yet</h3>
                <p>Create one to study with your classmates.</p>
            </div>
        `;
        updateDashboardStats();
        return;
    }

    grid.innerHTML = groups.map(g => `
        <article class="group-card">
            <div class="group-avatar ${escapeHTML(g.color || "purple")}-bg"><i class="fa-solid ${escapeHTML(g.icon || "fa-users")}"></i></div>
            <div>
                <span class="tag">${escapeHTML(g.course || "General")}</span>
                <h3>${escapeHTML(g.name)}</h3>
                <p>${escapeHTML(g.members)} member${Number(g.members) === 1 ? "" : "s"} · ${escapeHTML(g.activity || "Active")}</p>
            </div>
            <div class="group-actions">
                <button type="button" class="btn ${g.joined ? "primary" : "secondary"}" data-action="join" data-id="${escapeHTML(g.id)}" aria-pressed="${Boolean(g.joined)}">${g.joined ? "Joined" : "Join Group"}</button>
                ${g.custom ? `<button type="button" class="text-btn danger-text" data-action="delete-group" data-id="${escapeHTML(g.id)}">Delete</button>` : ""}
            </div>
        </article>
    `).join("");

    updateDashboardStats();
}


function populateGroupCourseSelect() {

    const select = document.getElementById("groupCourse");

    if (!select) return;

    select.innerHTML = [`<option value="General">General</option>`]
        .concat(courses.map(c => `<option value="${escapeHTML(c.code)}">${escapeHTML(c.code)} · ${escapeHTML(c.name)}</option>`))
        .join("");
}


async function handleGroupSubmit(event) {

    event.preventDefault();

    const name = document.getElementById("groupName").value.trim();
    const course = document.getElementById("groupCourse").value || "General";

    if (!name) {
        showToast("Please give your group a name.", "error");
        return;
    }

    const item = {
        id: newId("groups"),
        name: name.slice(0, 60),
        course,
        members: 1,
        icon: "fa-users",
        color: colorFor(name),
        activity: "Just created",
        joined: true,
        custom: true
    };

    groups.unshift(item);
    renderGroups();

    event.target.reset();
    closeModal("groupModal");
    showToast("Study group created.", "success");

    await cloudSave("groups", item);
}


async function toggleGroup(id) {

    const group = groups.find(g => g.id === id);

    if (!group) return;

    group.joined = !group.joined;
    group.members = Math.max(group.custom ? 1 : 0, Number(group.members) + (group.joined ? 1 : -1));

    renderGroups();
    showToast(group.joined ? "You joined the study group!" : "You left the study group.", "success");

    await cloudSave("groups", group);
}


async function deleteGroup(id) {

    const index = groups.findIndex(g => g.id === id);

    if (index === -1) return;

    if (!confirm("Delete this study group?")) return;

    const [removed] = groups.splice(index, 1);

    renderGroups();
    showToast("Study group deleted.", "success");

    await cloudDelete("groups", removed.id);
}


/* ---------- courses ---------- */

async function deleteCourse(code) {

    const index = courses.findIndex(c => c.code === code);

    if (index === -1) return;

    if (!confirm(`Remove ${code} from your courses? Its assignments will stay in your list.`)) return;

    const [removed] = courses.splice(index, 1);

    renderCourses();
    showToast(`${removed.code} removed.`, "success");

    if (currentUser) {
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, "courses", safeDocumentId(removed.code)));
        } catch (error) {
            console.error("Course deletion failed:", error);
            courses.splice(index, 0, removed);
            renderCourses();
            showToast("Cloud deletion failed. Course restored.", "error");
        }
    }
}


/* ---------- notifications ---------- */

function readKey() {

    return `campusconnect_read_${currentUser?.uid || "guest"}`;
}


function loadReadNotifications() {

    readNotifications = new Set(prefs.readNotifications || []);
}


function saveReadNotifications() {

    // keep the document small: only remember the latest 200 keys
    prefs.readNotifications = [...readNotifications].slice(-200);
    savePrefs();
}


function buildNotifications() {

    const list = [];

    assignments
        .filter(a => !a.completed)
        .forEach(a => {

            const days = daysUntil(a.date);

            if (days > 3) return;

            const overdue = days < 0;

            list.push({
                key: `due-${a.id}-${a.date}`,
                days,
                icon: overdue ? "fa-triangle-exclamation" : "fa-list-check",
                color: overdue ? "orange" : "purple",
                title: overdue ? "Assignment overdue" : "Assignment deadline approaching",
                text: `${a.title}${a.course ? ` (${a.course})` : ""} is ${overdue ? `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}` : days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`}.`
            });
        });

    return list.concat(campusAlerts()).sort((a, b) => a.days - b.days);
}


function renderNotifications() {

    const container = document.getElementById("notificationList");
    const notifications = buildNotifications();
    const unread = notifications.filter(n => !readNotifications.has(n.key)).length;

    const badge = document.getElementById("notificationBadge");
    const dot = document.getElementById("notificationDot");

    if (badge) badge.textContent = unread;
    if (dot) dot.style.display = unread ? "" : "none";

    if (!container) return;

    if (!notifications.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-bell-slash"></i>
                <h3>You're all caught up</h3>
                <p>Reminders appear here when an assignment is due within 3 days.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = notifications.map(n => `
        <article class="notification-card ${readNotifications.has(n.key) ? "" : "unread"}" data-key="${escapeHTML(n.key)}" tabindex="0" role="button">
            <div class="notification-icon ${n.color}"><i class="fa-solid ${n.icon}"></i></div>
            <div><h3>${escapeHTML(n.title)}</h3><p>${escapeHTML(n.text)}</p><small>${n.days < 0 ? "Action needed" : "Reminder"}</small></div>
        </article>
    `).join("");
}


/* ---------- progress + focus ---------- */

function renderProgress() {

    const total = assignments.length;
    const done = assignments.filter(a => a.completed).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    set("progressOverall", `${percent}%`);

    const bar = document.getElementById("progressOverallBar");
    if (bar) bar.style.width = `${percent}%`;

    const ring = document.getElementById("progressRing");
    if (ring) ring.style.setProperty("--pct", `${percent}%`);

    if (!total) {
        set("progressHeadline", "Getting started");
        set("progressMessage", "Add assignments to your courses and your progress will be tracked here automatically.");
    } else if (percent >= 80) {
        set("progressHeadline", "Excellent work");
        set("progressMessage", `You have completed ${done} of ${total} assignments. Keep the momentum going.`);
    } else if (percent >= 40) {
        set("progressHeadline", "Good momentum");
        set("progressMessage", `${done} of ${total} assignments are complete. Keep your deadlines visible to stay on track.`);
    } else {
        set("progressHeadline", "Time to get moving");
        set("progressMessage", `${done} of ${total} assignments are complete. Start with the one due soonest.`);
    }

    const grid = document.getElementById("progressCourseGrid");

    if (!grid) return;

    if (!courses.length) {
        grid.innerHTML = `<p class="day-empty">Add a course to see per-course progress.</p>`;
        return;
    }

    grid.innerHTML = courses.map(c => {

        const stats = getCourseStats(c.code);

        return `
            <div class="progress-course">
                <div><strong>${escapeHTML(c.code)}</strong><span>${escapeHTML(c.name)}</span></div>
                <b>${stats.percent}%</b>
                <div class="progress-bar"><span style="width:${stats.percent}%"></span></div>
            </div>
        `;
    }).join("");
}


function renderFocus() {

    const text = document.getElementById("focusText");
    const bar = document.getElementById("focusBar");
    const label = document.getElementById("focusLabel");

    if (!text) return;

    const total = assignments.length;
    const done = assignments.filter(a => a.completed).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    const next = assignments
        .filter(a => !a.completed)
        .sort((a, b) => a.date.localeCompare(b.date))[0];

    text.textContent = next
        ? `Spend 45 minutes today on "${next.title}"${next.course ? ` (${next.course})` : ""}, due ${getRelativeDate(next.date).toLowerCase()}.`
        : total
            ? "Everything is done. Use today to review your notes or get ahead."
            : "Add an assignment to get a personalised study focus.";

    if (bar) bar.style.width = `${percent}%`;
    if (label) label.textContent = `${percent}% of your tasks complete`;
}


/* =====================================================
   UPGRADES: EDIT ASSIGNMENTS, ANNOUNCEMENTS, EXPORTS, A11Y
   ===================================================== */

let editingAssignmentId = null;

function setAssignmentModalMode(editing) {

    const modal = document.getElementById("assignmentModal");

    if (!modal) return;

    const heading = modal.querySelector("h3");
    const eyebrow = modal.querySelector(".eyebrow");
    const submit = modal.querySelector("button[type=submit]");

    if (heading) heading.textContent = editing ? "Edit Assignment" : "Add Assignment";
    if (eyebrow) eyebrow.textContent = editing ? "UPDATE TASK" : "NEW TASK";
    if (submit) submit.textContent = editing ? "Save Changes" : "Save Assignment";
}


function startEditAssignment(id) {

    const assignment = assignments.find(item => String(item.id) === String(id));

    if (!assignment) return;

    editingAssignmentId = assignment.id;
    setAssignmentModalMode(true);

    populateCourseSelect();

    const select = document.getElementById("assignmentCourse");

    if (select && assignment.course && !courses.some(c => c.code === assignment.course)) {
        select.insertAdjacentHTML(
            "afterbegin",
            `<option value="${escapeHTML(assignment.course)}">${escapeHTML(assignment.course)}</option>`
        );
    }

    document.getElementById("assignmentTitle").value = assignment.title;
    if (select) select.value = assignment.course;
    document.getElementById("assignmentPriority").value = assignment.priority;
    document.getElementById("assignmentDate").value = assignment.date;

    openModal("assignmentModal");
}


async function saveAssignmentEdit(changes) {

    const assignment = assignments.find(item => String(item.id) === String(editingAssignmentId));

    editingAssignmentId = null;
    setAssignmentModalMode(false);

    if (!assignment) return;

    const previous = { ...assignment };

    Object.assign(assignment, changes);

    renderAssignments();
    updateAssignmentCount();
    showToast("Assignment updated.", "success");

    if (currentUser && assignment.firestoreId) {
        try {
            await updateDoc(
                doc(db, "users", currentUser.uid, "assignments", assignment.firestoreId),
                { ...changes, updatedAt: serverTimestamp() }
            );
        } catch (error) {
            console.error("Assignment edit failed:", error);
            Object.assign(assignment, previous);
            renderAssignments();
            updateAssignmentCount();
            showToast("Cloud update failed. Changes reverted.", "error");
        }
    }
}


/* ---------- announcements (read-only, published from the Firebase console) ---------- */

async function loadAnnouncements() {

    try {
        const snapshot = await getDocs(
            query(collection(db, "announcements"), orderBy("createdAt", "desc"))
        );

        if (snapshot.empty) return;

        const items = snapshot.docs.slice(0, 20).map(item => item.data());

        renderAnnouncements(items);

    } catch (error) {
        // Collection missing or rules not yet published: keep the built-in announcements.
        console.info("Using built-in announcements:", error?.code || error);
    }
}


function announcementAge(createdAt) {

    const date = createdAt?.toDate ? createdAt.toDate() : null;

    if (!date) return "Recently";

    const days = Math.floor((Date.now() - date.getTime()) / 86400000);

    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 14) return `${days} days ago`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


function renderAnnouncements(items) {

    const list = document.querySelector("#announcementsPage .announcement-list");

    if (list) {
        const icons = ["", "blue", "green"];

        list.innerHTML = items.map((item, index) => `
            <article class="announcement-card ${index === 0 ? "featured" : ""}">
                <div class="announcement-icon ${icons[index % icons.length]}"><i class="fa-solid fa-bullhorn"></i></div>
                <div>
                    <span class="tag">${escapeHTML(item.tag || "Campus")}</span>
                    <h3>${escapeHTML(item.title || "Announcement")}</h3>
                    <p>${escapeHTML(item.body || "")}</p>
                    <small>${escapeHTML(announcementAge(item.createdAt))} · ${escapeHTML(item.source || "Campus Office")}</small>
                </div>
            </article>
        `).join("");
    }

    const strip = document.querySelector(".announcement-strip");
    const latest = items[0];

    if (strip && latest) {
        const title = strip.querySelector("h3");
        const body = strip.querySelector("p:not(.eyebrow)");
        if (title) title.textContent = latest.title || "Announcement";
        if (body) body.textContent = latest.body || "";
    }
}


/* ---------- exports ---------- */

function downloadFile(filename, content, type) {

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function exportMyData() {

    const profile = JSON.parse(localStorage.getItem("campusconnect_profile") || "{}");

    const payload = {
        exportedAt: new Date().toISOString(),
        profile,
        courses,
        assignments: assignments.map(({ firestoreId, ...rest }) => rest),
        classes: classes.map(({ id, ...rest }) => rest),
        groups: groups.map(({ id, ...rest }) => rest),
        notes: notes.map(({ id, ...rest }) => rest),
        todos: todos.map(({ id, ...rest }) => rest),
        focusMinutesByDay: focusLog,
        campusLife: campusExport()
    };

    downloadFile(
        `campusconnect-data-${toLocalISODate(new Date())}.json`,
        JSON.stringify(payload, null, 2),
        "application/json"
    );

    showToast("Your data has been exported.", "success");
}


function icsEscape(text) {

    return String(text)
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}


function exportCalendar() {

    if (!classes.length && !assignments.length) {
        showToast("Nothing to export yet. Add a class or assignment first.", "error");
        return;
    }

    const pad = n => String(n).padStart(2, "0");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const weekdays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CampusConnect//EN", "CALSCALE:GREGORIAN"];

    classes.forEach(cls => {

        const start = nextOccurrence(cls);
        const end = new Date(start.getTime() + 60 * 60 * 1000);

        const fmt = d =>
            `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

        lines.push(
            "BEGIN:VEVENT",
            `UID:class-${cls.id}@campusconnect`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${fmt(start)}`,
            `DTEND:${fmt(end)}`,
            `RRULE:FREQ=WEEKLY;BYDAY=${weekdays[cls.day] || "MO"}`,
            `SUMMARY:${icsEscape(cls.title)}`,
            cls.location ? `LOCATION:${icsEscape(cls.location)}` : "",
            "END:VEVENT"
        );
    });

    assignments.filter(a => !a.completed).forEach(a => {

        const day = a.date.replace(/-/g, "");
        const next = new Date(a.date + "T00:00:00");
        next.setDate(next.getDate() + 1);
        const nextDay = `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;

        lines.push(
            "BEGIN:VEVENT",
            `UID:assignment-${a.id}@campusconnect`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${day}`,
            `DTEND;VALUE=DATE:${nextDay}`,
            `SUMMARY:${icsEscape("Due: " + a.title + (a.course ? " (" + a.course + ")" : ""))}`,
            "END:VEVENT"
        );
    });

    lines.push("END:VCALENDAR");

    downloadFile("campusconnect-calendar.ics", lines.filter(Boolean).join("\r\n"), "text/calendar");

    showToast("Calendar file downloaded.", "success");
}


/* ---------- accessibility & wiring ---------- */

function initializeUpgrades() {

    const toasts = document.getElementById("toastContainer");

    if (toasts) {
        toasts.setAttribute("role", "status");
        toasts.setAttribute("aria-live", "polite");
    }

    document.getElementById("addAssignmentBtn")?.addEventListener("click", () => {
        editingAssignmentId = null;
        setAssignmentModalMode(false);
        document.getElementById("assignmentForm")?.reset();
    });

    // Closing the edit dialog without saving must leave "add" mode intact.
    document.getElementById("assignmentModal")?.addEventListener("click", event => {
        if (event.target.closest("[data-close]") || event.target.id === "assignmentModal") {
            editingAssignmentId = null;
            setAssignmentModalMode(false);
        }
    });

    document.getElementById("exportDataBtn")?.addEventListener("click", exportMyData);
    document.getElementById("exportCalendarBtn")?.addEventListener("click", exportCalendar);

    // Keep keyboard focus inside the open dialog.
    document.addEventListener("keydown", event => {

        if (event.key !== "Tab") return;

        const modal = document.querySelector(".modal-overlay.active");

        if (!modal) return;

        const focusable = [...modal.querySelectorAll("button, input, select, textarea, a[href]")]
            .filter(el => !el.disabled && el.offsetParent !== null);

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}


/* =====================================================
   DASHBOARD V2: HERO, WORKLOAD, CALENDAR, FOCUS TIMER, TO-DO
   ===================================================== */

const TIMER_MODES = {
    focus: { label: "Focus", minutes: 25 },
    short: { label: "Break", minutes: 5 },
    long: { label: "Long break", minutes: 15 }
};

const timer = { mode: "focus", remaining: 25 * 60, running: false, endAt: 0, handle: null };

let calCursor = (() => { const d = new Date(); d.setDate(1); return d; })();
let calSelected = toLocalISODate(new Date());

let todos = [];
let todosOwner = null;


function dashUid() {
    return currentUser?.uid || "guest";
}


function plural(n, word) {
    return `${n} ${n === 1 ? word : word.endsWith("s") ? word + "es" : word + "s"}`;
}


function formatMinutes(total) {

    const m = Math.round(total);

    if (m < 60) return `${m}m`;

    const h = Math.floor(m / 60);
    const rest = m % 60;

    return rest ? `${h}h ${rest}m` : `${h}h`;
}


function renderDashboardV2() {

    if (!document.getElementById("heroSummary")) return;

    renderHeroSummary();
    renderWorkloadChart();
    renderCourseProgressList();
    renderMiniCalendar();
    renderTodos();
    renderFocusStats();
}


/* ---------- hero + KPI details ---------- */

function renderHeroSummary() {

    const todayIndex = (new Date().getDay() + 6) % 7;
    const classesToday = classes.filter(c => c.day === todayIndex).length;
    const pending = assignments.filter(a => !a.completed);
    const overdue = pending.filter(a => daysUntil(a.date) < 0).length;
    const dueWeek = pending.filter(a => { const d = daysUntil(a.date); return d >= 0 && d <= 7; }).length;
    const total = assignments.length;
    const done = total - pending.length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const credits = courses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);

    const parts = [
        classesToday ? plural(classesToday, "class") + " today" : "No classes today",
        dueWeek ? `${dueWeek} due this week` : "nothing due this week"
    ];

    if (overdue) parts.push(`${overdue} overdue`);

    const summary = document.getElementById("heroSummary");
    if (summary) summary.textContent = parts.join(" · ") + ".";

    const ring = document.getElementById("heroRing");
    if (ring) ring.style.setProperty("--p", percent);

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    set("heroRingValue", `${percent}%`);
    set("kpiCoursesSub", `${credits} credit${credits === 1 ? "" : "s"}`);
    set("kpiPendingSub", overdue ? `${overdue} overdue` : dueWeek ? `${dueWeek} due this week` : "Nothing urgent");
    set("kpiDoneSub", total ? `${done} of ${total} tasks` : "No tasks yet");
}


/* ---------- workload chart ---------- */

function renderWorkloadChart() {

    const chart = document.getElementById("workloadChart");

    if (!chart) return;

    const pending = assignments.filter(a => !a.completed);
    const columns = [{ label: "Late", count: pending.filter(a => daysUntil(a.date) < 0).length, cls: "late" }];

    for (let i = 0; i < 7; i++) {
        const iso = getDateOffset(i);
        const date = new Date(iso + "T00:00:00");

        columns.push({
            label: i === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short" }),
            count: pending.filter(a => a.date === iso).length,
            cls: i === 0 ? "today" : ""
        });
    }

    const max = Math.max(1, ...columns.map(c => c.count));

    chart.innerHTML = columns.map(c => `
        <div class="wl-col ${c.cls}" title="${escapeHTML(c.label)}: ${plural(c.count, "task")}">
            <span class="wl-count">${c.count || ""}</span>
            <div class="wl-bar ${c.count ? "" : "zero"}" style="height:${c.count ? Math.max(14, (c.count / max) * 100) : 4}px"></div>
            <span class="wl-label">${escapeHTML(c.label)}</span>
        </div>
    `).join("");
}


/* ---------- course progress ---------- */

function renderCourseProgressList() {

    const list = document.getElementById("courseProgressList");

    if (!list) return;

    if (!courses.length) {
        list.innerHTML = `<p class="cal-empty">Add a course to start tracking progress.</p>`;
        return;
    }

    list.innerHTML = courses.map(course => {

        const stats = getCourseStats(course.code);

        return `
            <div class="cp-row">
                <div class="cp-top">
                    <div><strong>${escapeHTML(course.code)}</strong> <span>${escapeHTML(course.name)}</span></div>
                    <b>${stats.total ? `${stats.percent}%` : "—"}</b>
                </div>
                <div class="progress-bar"><span style="width:${stats.percent}%"></span></div>
                <span class="cp-sub" style="font-size:10px;color:var(--muted)">${stats.total ? `${stats.done} of ${stats.total} tasks done` : "No tasks yet"}</span>
            </div>
        `;
    }).join("");
}


/* ---------- mini calendar ---------- */

function renderMiniCalendar() {

    const grid = document.getElementById("miniCalendar");

    if (!grid) return;

    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const todayIso = toLocalISODate(new Date());
    const dueDates = new Set(assignments.filter(a => !a.completed).map(a => a.date));
    const classDays = new Set(classes.map(c => c.day));

    const title = document.getElementById("calTitle");
    if (title) title.textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    let html = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(d => `<span class="cal-dow">${d}</span>`).join("");

    for (let i = 0; i < 42; i++) {

        const date = new Date(year, month, 1 - offset + i);
        const iso = toLocalISODate(date);
        const weekdayIndex = (date.getDay() + 6) % 7;
        const hasDue = dueDates.has(iso);
        const hasClass = classDays.has(weekdayIndex);
        const label = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

        html += `
            <button type="button" class="cal-day ${date.getMonth() !== month ? "other" : ""} ${iso === todayIso ? "today" : ""} ${iso === calSelected ? "selected" : ""}"
                data-date="${iso}" aria-label="${escapeHTML(label)}${hasDue ? ", deadline" : ""}${hasClass ? ", class" : ""}">
                ${date.getDate()}
                ${(hasDue || hasClass) ? `<span class="dots">${hasDue ? '<i class="cal-dot due"></i>' : ""}${hasClass ? '<i class="cal-dot class"></i>' : ""}</span>` : ""}
            </button>
        `;
    }

    grid.innerHTML = html;

    renderCalendarDetail();
}


function renderCalendarDetail() {

    const box = document.getElementById("calDetail");

    if (!box) return;

    const date = new Date(calSelected + "T00:00:00");
    const weekdayIndex = (date.getDay() + 6) % 7;
    const due = assignments.filter(a => a.date === calSelected);
    const dayClasses = classes
        .filter(c => c.day === weekdayIndex)
        .sort((a, b) => a.time.localeCompare(b.time));

    const heading = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    if (!due.length && !dayClasses.length) {
        box.innerHTML = `<h4>${escapeHTML(heading)}</h4><p class="cal-empty">Nothing scheduled.</p>`;
        return;
    }

    box.innerHTML = `
        <h4>${escapeHTML(heading)}</h4>
        ${dayClasses.map(c => `<div class="cal-item"><i class="cal-dot class"></i><span>${escapeHTML(c.title)}</span><small>${escapeHTML(c.time)}</small></div>`).join("")}
        ${due.map(a => `<div class="cal-item"><i class="cal-dot due"></i><span style="${a.completed ? "text-decoration:line-through;opacity:.6" : ""}">${escapeHTML(a.title)}</span><small>${escapeHTML(a.course || "Due")}</small></div>`).join("")}
    `;
}


function moveCalendar(action) {

    if (action === "today") {
        const now = new Date();
        calCursor = new Date(now.getFullYear(), now.getMonth(), 1);
        calSelected = toLocalISODate(now);
    } else {
        calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + (action === "next" ? 1 : -1), 1);
    }

    renderMiniCalendar();
}


/* ---------- to-do list (stored on this device, per account) ---------- */

function ensureTodos() {
    /* to-dos are loaded from Firestore right after sign-in */
}


function saveTodos() {
    /* kept for compatibility: each change is saved individually */
}


function renderTodos() {

    const list = document.getElementById("todoList");

    if (!list) return;

    ensureTodos();

    list.innerHTML = todos.map(todo => `
        <li class="todo-item ${todo.done ? "done" : ""}">
            <button type="button" class="todo-check" data-todo="toggle" data-id="${escapeHTML(todo.id)}" aria-label="Toggle ${escapeHTML(todo.text)}"><i class="fa-solid fa-check"></i></button>
            <span>${escapeHTML(todo.text)}</span>
            <button type="button" class="todo-del" data-todo="delete" data-id="${escapeHTML(todo.id)}" aria-label="Delete ${escapeHTML(todo.text)}"><i class="fa-solid fa-xmark"></i></button>
        </li>
    `).join("");

    const left = todos.filter(t => !t.done).length;
    const count = document.getElementById("todoCount");

    if (count) {
        count.textContent = todos.length
            ? `${left} of ${todos.length} left`
            : "Nothing here yet. Jot down anything you don't want to forget.";
    }
}


function addTodo(text) {

    ensureTodos();

    const clean = text.trim().slice(0, 120);

    if (!clean) return;

    if (todos.length >= 50) {
        showToast("Your to-do list is full. Clear some finished items first.", "error");
        return;
    }

    const item = { id: newId("todos"), text: clean, done: false, createdAt: Date.now() };

    todos.unshift(item);

    renderTodos();
    cloudSave("todos", item);
}


/* ---------- focus timer ---------- */

function focusLogKey() {
    return "focus";
}


function readFocusLog() {
    return focusLog;
}


function addFocusMinutes(minutes) {

    const today = toLocalISODate(new Date());

    focusLog[today] = (Number(focusLog[today]) || 0) + minutes;

    cloudSave("focus", { id: today, date: today, minutes: focusLog[today] });
}


function renderFocusStats() {

    const log = readFocusLog();
    const minutesOn = offset => Number(log[getDateOffset(offset)]) || 0;

    const today = minutesOn(0);
    let week = 0;

    for (let i = 0; i > -7; i--) week += minutesOn(i);

    let streak = 0;
    let cursor = today > 0 ? 0 : -1;

    while (minutesOn(cursor) > 0 && streak < 365) {
        streak++;
        cursor--;
    }

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    set("focusToday", formatMinutes(today));
    set("focusWeek", formatMinutes(week));
    set("focusStreak", streak);
    set("kpiFocus", formatMinutes(today));
    set("kpiFocusSub", streak ? `${plural(streak, "day")} streak` : "Start a session");
    set("focusGoalLabel", `${Math.round(week)} / ${prefs.weeklyGoal} min weekly goal`);

    const bar = document.getElementById("focusGoalBar");
    if (bar) bar.style.width = `${Math.min(100, (week / prefs.weeklyGoal) * 100)}%`;
}


function renderTimer() {

    const total = TIMER_MODES[timer.mode].minutes * 60;
    const mm = String(Math.floor(timer.remaining / 60)).padStart(2, "0");
    const ss = String(timer.remaining % 60).padStart(2, "0");

    const display = document.getElementById("timerDisplay");
    if (display) display.textContent = `${mm}:${ss}`;

    const bar = document.getElementById("timerBar");
    if (bar) bar.style.width = `${((total - timer.remaining) / total) * 100}%`;

    const toggle = document.getElementById("timerToggle");

    if (toggle) {
        toggle.querySelector("i").className = timer.running ? "fa-solid fa-pause" : "fa-solid fa-play";
        toggle.querySelector("span").textContent = timer.running ? "Pause" : timer.remaining < total ? "Resume" : "Start";
    }

    document.querySelectorAll("[data-timer-mode]").forEach(button => {
        button.classList.toggle("active", button.dataset.timerMode === timer.mode);
    });

    document.title = timer.running ? `${mm}:${ss} · ${TIMER_MODES[timer.mode].label}` : "CampusConnect";
}


function stopTimerLoop() {

    clearInterval(timer.handle);
    timer.handle = null;
    timer.running = false;
}


function setTimerMode(mode) {

    if (!TIMER_MODES[mode]) return;

    stopTimerLoop();
    timer.mode = mode;
    timer.remaining = TIMER_MODES[mode].minutes * 60;
    renderTimer();
}


function toggleTimer() {

    if (timer.running) {
        stopTimerLoop();
        renderTimer();
        return;
    }

    timer.running = true;
    timer.endAt = Date.now() + timer.remaining * 1000;

    timer.handle = setInterval(() => {

        timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
        renderTimer();

        if (timer.remaining <= 0) completeTimer();

    }, 250);

    renderTimer();
}


function completeTimer() {

    const finishedMode = timer.mode;

    stopTimerLoop();
    playChime();

    if (finishedMode === "focus") {
        addFocusMinutes(TIMER_MODES.focus.minutes);
        showToast("Focus session complete. Nice work! Take a short break.", "success");
        setTimerMode("short");
    } else {
        showToast("Break over. Ready for another focus session?", "success");
        setTimerMode("focus");
    }

    renderFocusStats();
}


function playChime() {

    try {
        const Context = window.AudioContext || window.webkitAudioContext;

        if (!Context) return;

        const ctx = new Context();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;

        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);

        osc.start();
        osc.stop(ctx.currentTime + 0.65);

        setTimeout(() => ctx.close(), 900);
    } catch {
        /* audio is optional */
    }
}


/* ---------- wiring ---------- */

function initializeDashboardV2() {

    const page = document.getElementById("dashboardPage");

    if (!page) return;

    page.addEventListener("click", event => {

        const action = event.target.closest("[data-dash-action]")?.dataset.dashAction;

        if (action === "add-assignment") document.getElementById("addAssignmentBtn")?.click();
        if (action === "add-class") document.getElementById("addClassBtn")?.click();

        if (action === "focus") {
            document.getElementById("focusTimerPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
            if (!timer.running && timer.mode === "focus") toggleTimer();
        }

        const check = event.target.closest("[data-dash-toggle]");
        if (check) toggleAssignment(check.dataset.id);

        const calButton = event.target.closest("[data-cal]");
        if (calButton) moveCalendar(calButton.dataset.cal);

        const day = event.target.closest(".cal-day");

        if (day) {
            calSelected = day.dataset.date;

            const picked = new Date(calSelected + "T00:00:00");

            if (picked.getMonth() !== calCursor.getMonth()) {
                calCursor = new Date(picked.getFullYear(), picked.getMonth(), 1);
            }

            renderMiniCalendar();
        }

        const todoButton = event.target.closest("[data-todo]");

        if (todoButton) {
            const item = todos.find(t => t.id === todoButton.dataset.id);

            if (item && todoButton.dataset.todo === "toggle") {
                item.done = !item.done;
                cloudSave("todos", item);
            }

            if (item && todoButton.dataset.todo === "delete") {
                todos = todos.filter(t => t.id !== item.id);
                cloudDelete("todos", item.id);
            }

            renderTodos();
        }

        const mode = event.target.closest("[data-timer-mode]");
        if (mode) setTimerMode(mode.dataset.timerMode);
    });

    document.getElementById("todoForm")?.addEventListener("submit", event => {
        event.preventDefault();
        const input = document.getElementById("todoInput");
        addTodo(input.value);
        input.value = "";
        input.focus();
    });

    document.getElementById("todoClear")?.addEventListener("click", () => {
        const finished = todos.filter(t => t.done);

        todos = todos.filter(t => !t.done);
        finished.forEach(t => cloudDelete("todos", t.id));

        renderTodos();
    });

    document.getElementById("timerToggle")?.addEventListener("click", toggleTimer);

    document.getElementById("timerReset")?.addEventListener("click", () => setTimerMode(timer.mode));

    renderTimer();
    renderDashboardV2();
}


/* =====================================================
   V3: NOTES, GRADES & GPA, SETTINGS, SEARCH, INSTALL, OFFLINE
   ===================================================== */

const PAGE_TITLES = {
    dashboard: "Dashboard",
    courses: "Courses",
    assignments: "Assignments",
    schedule: "Schedule",
    campus: "Campus Life",
    announcements: "Announcements",
    groups: "Study Groups",
    progress: "Academic Progress",
    notifications: "Notifications",
    notes: "Notes",
    grades: "Grades & GPA",
    settings: "Settings",
    profile: "Profile"
};

let notes = [];
let focusLog = {};
let editingNoteId = null;


async function safeLoad(loader, fallback) {

    try {
        return await loader();
    } catch (error) {
        console.warn("Optional data could not be loaded:", error?.code || error);
        return fallback;
    }
}


async function loadFocusLog(user) {

    const snapshot = await getDocs(collection(db, "users", user.uid, "focus"));
    const log = {};

    snapshot.docs.forEach(item => {

        if (!/^\d{4}-\d{2}-\d{2}$/.test(item.id)) return;

        if (daysUntil(item.id) < -120) {
            deleteDoc(doc(db, "users", user.uid, "focus", item.id)).catch(() => {});
            return;
        }

        log[item.id] = Number(item.data().minutes) || 0;
    });

    return log;
}


function fillCourseOptions(selectId, { all = false, allLabel = "All courses", general = false } = {}) {

    const select = document.getElementById(selectId);

    if (!select) return;

    const previous = select.value;
    const options = [];

    if (all) options.push(`<option value="">${escapeHTML(allLabel)}</option>`);
    if (general) options.push(`<option value="">General</option>`);

    courses.forEach(course => {
        options.push(`<option value="${escapeHTML(course.code)}">${escapeHTML(course.code)} · ${escapeHTML(course.name)}</option>`);
    });

    select.innerHTML = options.join("");

    if ([...select.options].some(o => o.value === previous)) select.value = previous;
}


function flashElement(selector) {

    setTimeout(() => {

        const el = document.querySelector(selector);

        if (!el) return;

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 1800);

    }, 120);
}


/* ---------- notes ---------- */

function renderNotes() {

    const grid = document.getElementById("noteGrid");

    if (!grid) return;

    fillCourseOptions("noteCourseFilter", { all: true });
    fillCourseOptions("noteCourse", { general: true });

    const search = (document.getElementById("noteSearch")?.value || "").toLowerCase().trim();
    const course = document.getElementById("noteCourseFilter")?.value || "";

    const visible = notes
        .filter(n => (!course || n.course === course) &&
            (!search || `${n.title} ${n.body} ${n.course}`.toLowerCase().includes(search)))
        .sort((a, b) => (b.modified || 0) - (a.modified || 0));

    if (!visible.length) {
        grid.innerHTML = `
            <div class="empty-state wide">
                <i class="fa-solid fa-note-sticky"></i>
                <h3>${notes.length ? "No notes match your search" : "No notes yet"}</h3>
                <p>${notes.length ? "Try a different search or course." : "Capture lecture points, ideas or reminders. They sync to your account and work offline."}</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = visible.map(note => `
        <article class="note-card ${colorFor(note.course || note.title)}" data-id="${escapeHTML(note.id)}">
            <div class="note-top">
                <span class="tag">${escapeHTML(note.course || "General")}</span>
                <div class="note-actions">
                    <button type="button" class="chip-del" data-note="edit" data-id="${escapeHTML(note.id)}" aria-label="Edit note"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="chip-del" data-note="delete" data-id="${escapeHTML(note.id)}" aria-label="Delete note"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <h3>${escapeHTML(note.title)}</h3>
            <p>${escapeHTML(note.body)}</p>
            <small>${escapeHTML(new Date(note.modified || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</small>
        </article>
    `).join("");
}


function openNoteModal(note = null) {

    editingNoteId = note ? note.id : null;

    fillCourseOptions("noteCourse", { general: true });

    const modal = document.getElementById("noteModal");

    modal.querySelector("h3").textContent = note ? "Edit Note" : "New Note";
    modal.querySelector(".eyebrow").textContent = note ? "UPDATE NOTE" : "CAPTURE";

    document.getElementById("noteTitle").value = note?.title || "";
    document.getElementById("noteCourse").value = note?.course || "";
    document.getElementById("noteBody").value = note?.body || "";

    openModal("noteModal");
}


async function handleNoteSubmit(event) {

    event.preventDefault();

    const title = document.getElementById("noteTitle").value.trim().slice(0, 80);
    const course = document.getElementById("noteCourse").value || "";
    const body = document.getElementById("noteBody").value.trim().slice(0, 2000);

    if (!title) {
        showToast("Please give your note a title.", "error");
        return;
    }

    let item = notes.find(n => n.id === editingNoteId);

    if (item) {
        Object.assign(item, { title, course, body, modified: Date.now() });
    } else {
        item = { id: newId("notes"), title, course, body, created: Date.now(), modified: Date.now() };
        notes.push(item);
    }

    editingNoteId = null;

    renderNotes();
    closeModal("noteModal");
    showToast("Note saved.", "success");

    await cloudSave("notes", item);
}


async function deleteNote(id) {

    const note = notes.find(n => n.id === id);

    if (!note || !confirm(`Delete "${note.title}"?`)) return;

    notes = notes.filter(n => n.id !== id);

    renderNotes();
    showToast("Note deleted.", "success");

    await cloudDelete("notes", id);
}


/* ---------- grades & GPA ---------- */

const GPA_SCALES = {
    us: [[90, "A", 4], [80, "B", 3], [70, "C", 2], [60, "D", 1], [0, "F", 0]],
    uk: [[70, "A", 4], [60, "B", 3], [50, "C", 2], [40, "D", 1], [0, "E", 0]]
};


function gradeInfo(percent) {

    const band = GPA_SCALES[prefs.gpaScale].find(([min]) => percent >= min) || GPA_SCALES.us[4];

    return { letter: band[1], points: band[2] };
}


function renderGrades() {

    const list = document.getElementById("gradeList");

    if (!list) return;

    const scale = document.getElementById("gradeScale");
    if (scale) scale.value = prefs.gpaScale;

    // Rebuild the rows only when the course list changes, so typing a grade and
    // pressing Tab never loses keyboard focus.
    const signature = courses.map(c => `${c.code}|${c.name}|${c.credits}`).join(";");

    if (list.dataset.sig !== signature) {

        list.dataset.sig = signature;

        list.innerHTML = courses.length
            ? courses.map(course => `
                <div class="grade-row" data-code="${escapeHTML(course.code)}">
                    <div class="grade-course"><strong>${escapeHTML(course.code)}</strong><span>${escapeHTML(course.name)} · ${escapeHTML(course.credits)} credits</span></div>
                    <label class="grade-input"><span class="sr-only">Grade for ${escapeHTML(course.code)}</span>
                        <input type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" data-grade="${escapeHTML(course.code)}"><b>%</b>
                    </label>
                    <div class="grade-badge empty" data-badge>—</div>
                </div>
            `).join("")
            : `<div class="empty-state wide"><i class="fa-solid fa-graduation-cap"></i><h3>No courses yet</h3><p>Add a course first, then record your grades here.</p></div>`;
    }

    courses.forEach(course => {

        const row = [...list.querySelectorAll(".grade-row")].find(r => r.dataset.code === course.code);

        if (!row) return;

        const input = row.querySelector("input");
        const badge = row.querySelector("[data-badge]");
        const graded = Number.isFinite(course.grade);

        if (input && document.activeElement !== input) input.value = graded ? course.grade : "";

        if (badge) {
            const info = graded ? gradeInfo(course.grade) : null;
            badge.classList.toggle("empty", !graded);
            badge.innerHTML = graded ? `${info.letter}<small>${info.points.toFixed(1)}</small>` : "—";
        }
    });

    const gradedCourses = courses.filter(c => Number.isFinite(c.grade) && c.credits > 0);
    const credits = gradedCourses.reduce((sum, c) => sum + c.credits, 0);
    const points = gradedCourses.reduce((sum, c) => sum + gradeInfo(c.grade).points * c.credits, 0);
    const average = credits
        ? gradedCourses.reduce((sum, c) => sum + c.grade * c.credits, 0) / credits
        : null;

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    set("gpaValue", credits ? (points / credits).toFixed(2) : "—");
    set("avgValue", average !== null ? `${average.toFixed(1)}%` : "—");
    set("gradedCredits", credits);
}


async function saveGrade(code, rawValue) {

    const course = courses.find(c => c.code === code);

    if (!course) return;

    const text = String(rawValue).trim();
    const value = text === "" ? null : Number(text);

    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
        showToast("Enter a grade between 0 and 100.", "error");
        renderGrades();
        return;
    }

    course.grade = value;

    renderGrades();
    renderCourses();

    if (!currentUser) return;

    try {
        await setDoc(
            doc(db, "users", currentUser.uid, "courses", safeDocumentId(code)),
            { grade: value === null ? deleteField() : value, updatedAt: serverTimestamp() },
            { merge: true }
        );
    } catch (error) {
        console.error("Grade cloud save failed:", error);
        showToast("Saved on this device only. Cloud save failed.", "error");
    }
}


/* ---------- settings ---------- */

function syncSettingsUI() {

    document.querySelectorAll("[data-theme-opt]").forEach(b =>
        b.classList.toggle("active", b.dataset.themeOpt === prefs.theme));

    document.querySelectorAll("[data-scene-opt]").forEach(b => {
        b.classList.toggle("active", b.dataset.sceneOpt === prefs.scene);
        b.setAttribute("aria-pressed", b.dataset.sceneOpt === prefs.scene);
    });

    const motion = document.getElementById("motionToggle");
    if (motion) motion.checked = prefs.motion;

    const goal = document.getElementById("weeklyGoalInput");
    if (goal && document.activeElement !== goal) goal.value = prefs.weeklyGoal;
}


function initializeSettings() {

    document.getElementById("settingsPage")?.addEventListener("click", event => {

        const theme = event.target.closest("[data-theme-opt]");
        const scene = event.target.closest("[data-scene-opt]");

        if (theme && theme.dataset.themeOpt !== prefs.theme) {
            prefs.theme = theme.dataset.themeOpt;
            applyPrefs();
            savePrefs();
        }

        if (scene) {
            prefs.scene = scene.dataset.sceneOpt;
            applyPrefs();
            savePrefs();
        }
    });

    document.getElementById("motionToggle")?.addEventListener("change", event => {
        prefs.motion = event.target.checked;
        applyPrefs();
        savePrefs();
    });

    document.getElementById("weeklyGoalInput")?.addEventListener("change", event => {
        const value = Math.round(Number(event.target.value));

        if (!Number.isFinite(value) || value < 30 || value > 1200) {
            showToast("Choose a weekly goal between 30 and 1200 minutes.", "error");
            event.target.value = prefs.weeklyGoal;
            return;
        }

        prefs.weeklyGoal = value;
        savePrefs();
        renderFocusStats();
        showToast("Weekly focus goal updated.", "success");
    });

    document.getElementById("gradeScale")?.addEventListener("change", event => {
        prefs.gpaScale = event.target.value === "uk" ? "uk" : "us";
        savePrefs();
        renderGrades();
    });

    document.getElementById("refreshAppBtn")?.addEventListener("click", async () => {

        try {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
            const registration = await navigator.serviceWorker?.getRegistration();
            await registration?.unregister();
        } catch (error) {
            console.warn("Could not clear app cache:", error);
        }

        location.reload();
    });
}


async function updateOfflineStatus() {

    const el = document.getElementById("offlineStatus");

    if (!el) return;

    let ready = false;

    try {
        ready = "caches" in window && (await caches.keys()).some(key => key.endsWith("-shell"));
    } catch { /* ignore */ }

    el.textContent = ready
        ? "Offline ready. The app and your synced data open without a connection."
        : "Offline files are still being prepared. Keep the app open for a moment while online.";
}


/* ---------- global search (Ctrl/Cmd + K) ---------- */

let searchResults = [];
let searchActive = 0;

function buildSearchResults(query) {

    const q = query.toLowerCase().trim();
    const out = [];
    const match = (...parts) => !q || parts.join(" ").toLowerCase().includes(q);

    Object.entries(PAGE_TITLES).forEach(([page, label]) => {
        if (match(label, "go to open")) {
            out.push({ icon: "fa-arrow-right", title: `Go to ${label}`, sub: "Page", page });
        }
    });

    if (!q) return out.slice(0, 12);

    assignments.filter(a => match(a.title, a.course)).slice(0, 5).forEach(a => out.push({
        icon: "fa-list-check", title: a.title, sub: `Assignment · ${a.course || "General"} · ${getRelativeDate(a.date)}`,
        page: "assignments", flash: `.assignment-row[data-id="${CSS.escape(String(a.id))}"]`
    }));

    courses.filter(c => match(c.code, c.name)).slice(0, 4).forEach(c => out.push({
        icon: "fa-book", title: `${c.code} · ${c.name}`, sub: "Course", page: "courses",
        flash: `.course-card[data-code="${CSS.escape(c.code)}"]`
    }));

    notes.filter(n => match(n.title, n.body, n.course)).slice(0, 4).forEach(n => out.push({
        icon: "fa-note-sticky", title: n.title, sub: `Note · ${n.course || "General"}`, page: "notes",
        flash: `.note-card[data-id="${CSS.escape(n.id)}"]`
    }));

    classes.filter(c => match(c.title, c.location)).slice(0, 3).forEach(c => out.push({
        icon: "fa-calendar-days", title: c.title, sub: `Class · ${DAY_NAMES[c.day] || ""} ${c.time}`, page: "schedule"
    }));

    todos.filter(t => match(t.text)).slice(0, 3).forEach(t => out.push({
        icon: "fa-square-check", title: t.text, sub: "To-do", page: "dashboard"
    }));

    groups.filter(g => match(g.name, g.course)).slice(0, 3).forEach(g => out.push({
        icon: "fa-users", title: g.name, sub: `Study group · ${g.course}`, page: "groups"
    }));

    return out.slice(0, 14);
}


function renderSearchResults() {

    const box = document.getElementById("searchResults");

    if (!box) return;

    const query = document.getElementById("searchInput").value;

    searchResults = buildSearchResults(query);
    searchActive = Math.min(searchActive, Math.max(0, searchResults.length - 1));

    if (!searchResults.length) {
        box.innerHTML = `<p class="cmdk-empty">No results for “${escapeHTML(query)}”.</p>`;
        return;
    }

    box.innerHTML = searchResults.map((item, i) => `
        <button type="button" class="cmdk-item ${i === searchActive ? "active" : ""}" role="option" data-i="${i}" aria-selected="${i === searchActive}">
            <i class="fa-solid ${item.icon}"></i>
            <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.sub)}</small></span>
        </button>
    `).join("");

    box.querySelector(".cmdk-item.active")?.scrollIntoView({ block: "nearest" });
}


function openSearch() {

    document.getElementById("searchInput").value = "";
    searchActive = 0;
    renderSearchResults();
    openModal("searchOverlay");
}


function runSearchResult(item) {

    if (!item) return;

    closeModal("searchOverlay");
    navigateTo(item.page);

    if (item.flash) flashElement(item.flash);
}


function initializeSearch() {

    document.getElementById("searchBtn")?.addEventListener("click", openSearch);

    const input = document.getElementById("searchInput");

    input?.addEventListener("input", () => { searchActive = 0; renderSearchResults(); });

    input?.addEventListener("keydown", event => {

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            searchActive = (searchActive + step + searchResults.length) % Math.max(1, searchResults.length);
            renderSearchResults();
        }

        if (event.key === "Enter") {
            event.preventDefault();
            runSearchResult(searchResults[searchActive]);
        }
    });

    document.getElementById("searchResults")?.addEventListener("click", event => {
        const button = event.target.closest("[data-i]");
        if (button) runSearchResult(searchResults[Number(button.dataset.i)]);
    });

    document.addEventListener("keydown", event => {

        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
        const overlayOpen = document.getElementById("searchOverlay")?.classList.contains("active");

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            overlayOpen ? closeModal("searchOverlay") : openSearch();
        } else if (event.key === "/" && !typing && !document.querySelector(".modal-overlay.active")) {
            event.preventDefault();
            openSearch();
        }
    });
}


/* ---------- install (PWA) ---------- */

let deferredInstall = null;

function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event;
    updateInstallUI();
});

window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    updateInstallUI();
    showToast("CampusConnect is installed. Open it from your home screen or apps list.", "success");
});

function installDismissed() {

    const until = Number(localStorage.getItem("campusconnect_install_dismissed") || 0);

    return until > Date.now();
}

function updateInstallUI() {

    const installed = isStandalone();
    const canInstall = !installed && (Boolean(deferredInstall) || isIOS());

    document.getElementById("installBtn")?.classList.toggle("hidden", !canInstall);
    document.getElementById("installBanner")?.classList.toggle("hidden", !canInstall || installDismissed());

    const status = document.getElementById("installStatus");
    const button = document.getElementById("settingsInstallBtn");

    if (status) {
        status.textContent = installed
            ? "Installed. You're running CampusConnect as an app."
            : canInstall
                ? "Install CampusConnect for a full-screen app that opens instantly and works offline."
                : "Use your browser menu (Install app / Add to Home Screen) to install CampusConnect.";
    }

    if (button) button.classList.toggle("hidden", !canInstall);
}

async function promptInstall() {

    if (deferredInstall) {
        deferredInstall.prompt();
        await deferredInstall.userChoice.catch(() => {});
        deferredInstall = null;
        updateInstallUI();
        return;
    }

    openModal("installHelpModal");
}


/* ---------- offline indicator + service worker ---------- */

function updateNetworkStatus(announce = false) {

    const offline = !navigator.onLine;

    document.body.classList.toggle("is-offline", offline);
    document.getElementById("netStatus")?.classList.toggle("hidden", !offline);

    if (announce) {
        showToast(
            offline
                ? "You're offline. Changes are saved on this device and will sync when you reconnect."
                : "Back online. Syncing your changes…",
            offline ? "error" : "success"
        );
    }
}


function showUpdateBanner(worker) {

    const banner = document.getElementById("updateBanner");

    if (!banner) return;

    banner.classList.remove("hidden");

    banner.querySelector("[data-update]").onclick = () => worker.postMessage({ type: "SKIP_WAITING" });
}


function initializeServiceWorker() {

    if (!("serviceWorker" in navigator)) return;

    const hadController = Boolean(navigator.serviceWorker.controller);

    window.addEventListener("load", async () => {

        try {
            const registration = await navigator.serviceWorker.register("service-worker.js");

            if (registration.waiting && hadController) showUpdateBanner(registration.waiting);

            registration.addEventListener("updatefound", () => {

                const worker = registration.installing;

                worker?.addEventListener("statechange", () => {
                    if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner(worker);
                });
            });

            let reloading = false;

            navigator.serviceWorker.addEventListener("controllerchange", () => {
                if (reloading || !hadController) return;
                reloading = true;
                location.reload();
            });

            setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);

            // Ask the worker to keep the Firebase SDK, fonts and icons this page loaded.
            const ready = await navigator.serviceWorker.ready;

            const urls = performance.getEntriesByType("resource")
                .map(entry => entry.name)
                .filter(url => /gstatic\.com|fonts\.googleapis\.com|cdnjs\.cloudflare\.com/.test(url));

            ready.active?.postMessage({ type: "CACHE_URLS", urls });

            updateOfflineStatus();

        } catch (error) {
            console.warn("Service worker registration failed:", error);
        }
    });
}


/* ---------- animated background ---------- */

function buildBackground() {

    const doodles = document.getElementById("doodleLayer");

    if (doodles && !doodles.children.length) {

        const icons = ["fa-graduation-cap", "fa-book-open", "fa-pencil", "fa-flask", "fa-calculator",
            "fa-lightbulb", "fa-atom", "fa-laptop-code", "fa-microscope", "fa-compass-drafting",
            "fa-brain", "fa-music"];

        // deterministic layout so the scene looks the same on every load
        let seed = 7;
        const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

        for (let i = 0; i < 22; i++) {
            const el = document.createElement("i");
            el.className = `fa-solid ${icons[i % icons.length]} doodle`;
            el.style.setProperty("--x", `${Math.round(rand() * 100)}%`);
            el.style.setProperty("--s", `${Math.round(22 + rand() * 38)}px`);
            el.style.setProperty("--d", `${Math.round(26 + rand() * 30)}s`);
            el.style.setProperty("--delay", `${-Math.round(rand() * 50)}s`);
            el.style.setProperty("--r", `${Math.round(-30 + rand() * 60)}deg`);
            doodles.appendChild(el);
        }
    }

    const stars = document.getElementById("starLayer");

    if (stars && !stars.children.length) {

        let seed = 11;
        const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

        for (let i = 0; i < 46; i++) {
            const el = document.createElement("span");
            el.style.left = `${Math.round(rand() * 100)}%`;
            el.style.top = `${Math.round(rand() * 55)}%`;
            el.style.setProperty("--t", `${(2 + rand() * 4).toFixed(1)}s`);
            el.style.setProperty("--delay", `${(-rand() * 5).toFixed(1)}s`);
            stars.appendChild(el);
        }
    }
}


/* ---------- wiring ---------- */

function initializeV3() {

    buildBackground();
    initializeSettings();
    initializeSearch();
    initializeServiceWorker();

    document.getElementById("addNoteBtn")?.addEventListener("click", () => openNoteModal());
    document.getElementById("noteForm")?.addEventListener("submit", handleNoteSubmit);
    document.getElementById("noteSearch")?.addEventListener("input", renderNotes);
    document.getElementById("noteCourseFilter")?.addEventListener("change", renderNotes);

    document.getElementById("noteGrid")?.addEventListener("click", event => {

        const button = event.target.closest("[data-note]");

        if (!button) return;

        if (button.dataset.note === "edit") openNoteModal(notes.find(n => n.id === button.dataset.id));
        if (button.dataset.note === "delete") deleteNote(button.dataset.id);
    });

    document.getElementById("gradeList")?.addEventListener("change", event => {
        const input = event.target.closest("[data-grade]");
        if (input) saveGrade(input.dataset.grade, input.value);
    });

    ["installBtn", "settingsInstallBtn", "installNowBtn"].forEach(id =>
        document.getElementById(id)?.addEventListener("click", promptInstall));

    document.getElementById("installLaterBtn")?.addEventListener("click", () => {
        try {
            localStorage.setItem("campusconnect_install_dismissed", String(Date.now() + 7 * 86400000));
        } catch { /* ignore */ }
        updateInstallUI();
    });

    window.addEventListener("online", () => updateNetworkStatus(true));
    window.addEventListener("offline", () => updateNetworkStatus(true));

    updateNetworkStatus();
    updateInstallUI();
    updateOfflineStatus();

    // App shortcuts and deep links: index.html?page=notes
    const requested = new URLSearchParams(location.search).get("page");

    if (requested && PAGE_TITLES[requested]) navigateTo(requested);

    if (new URLSearchParams(location.search).get("focus") === "1") {
        setTimeout(() => document.querySelector('[data-dash-action="focus"]')?.click(), 700);
    }

    renderNotes();
    renderGrades();
}
