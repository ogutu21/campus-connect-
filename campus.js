/* =====================================================
   CAMPUS LIFE
   Everyday campus features, all stored in Firestore under users/{uid}/...
   (and therefore cached for offline use):
   attendance, exams, loans, expenses, bills, budget, contacts, links,
   places, shuttle, wellness, events.
   ===================================================== */

import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const SUBS = [
    "attendance", "exams", "loans", "expenses", "bills", "budget",
    "contacts", "links", "places", "shuttle", "wellness", "events", "journal"
];

const TABS = [
    { id: "attendance", label: "Attendance", icon: "fa-clipboard-user" },
    { id: "exams", label: "Exams", icon: "fa-file-pen" },
    { id: "library", label: "Library", icon: "fa-book-bookmark" },
    { id: "budget", label: "Budget", icon: "fa-wallet" },
    { id: "cafeteria", label: "Cafeteria", icon: "fa-utensils" },
    { id: "lostfound", label: "Lost &amp; Found", icon: "fa-magnifying-glass-location" },
    { id: "services", label: "Services", icon: "fa-location-dot" },
    { id: "events", label: "Events", icon: "fa-champagne-glasses" },
    { id: "wellness", label: "Wellness", icon: "fa-heart-pulse" },
    { id: "support", label: "Support", icon: "fa-hand-holding-heart" }
];

const REQUIRED_ATTENDANCE = 75;
const WATER_GOAL = 8;
const MAX_RENEWALS = 3;

const EXPENSE_CATEGORIES = [
    "Food", "Transport", "Books & supplies", "Fees", "Rent & utilities",
    "Data & airtime", "Entertainment", "Health", "Other"
];

const HABITS = [
    { id: "sleep", label: "Slept 7+ hours", icon: "fa-moon" },
    { id: "exercise", label: "Exercised", icon: "fa-person-running" },
    { id: "study", label: "Studied", icon: "fa-book-open" },
    { id: "meals", label: "Ate well", icon: "fa-utensils" },
    { id: "read", label: "Read for fun", icon: "fa-book" }
];

const MOODS = ["😞", "😕", "😐", "🙂", "😄"];

const EVENT_KINDS = ["Club", "Sports", "Career", "Social", "Academic", "Other"];

let ctx = null;
let activeTab = "attendance";
let pendingForm = null;

const data = Object.fromEntries(SUBS.map(sub => [sub, []]));


/* ---------- small helpers ---------- */

const esc = value => ctx.escapeHTML(value ?? "");

const todayISO = () => ctx.toLocalISODate(new Date());

function fmtDate(iso) {

    if (!iso) return "";

    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric"
    });
}


function countdown(iso) {

    const d = ctx.daysUntil(iso);

    if (d < 0) return `${-d} day${d === -1 ? "" : "s"} ago`;
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";

    return `In ${d} days`;
}


function plusDays(iso, days) {

    const date = new Date(iso + "T00:00:00");
    date.setDate(date.getDate() + days);

    return ctx.toLocalISODate(date);
}


function currency() {
    return data.budget[0]?.currency || "$";
}


function money(value) {

    return `${currency()}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}


function emptyState(icon, title, text) {

    return `
        <div class="empty-state">
            <i class="fa-solid ${icon}"></i>
            <h3>${esc(title)}</h3>
            <p>${esc(text)}</p>
        </div>
    `;
}


function upsert(sub, item) {

    const list = data[sub];
    const index = list.findIndex(entry => entry.id === item.id);

    if (index >= 0) list[index] = item;
    else list.push(item);

    ctx.cloudSave(sub, item);
    renderAll();
}


function remove(sub, id) {

    data[sub] = data[sub].filter(entry => entry.id !== id);

    ctx.cloudDelete(sub, id);
    renderAll();
}


/* ---------- generic form dialog ---------- */

function fieldHTML(field) {

    const value = field.value ?? "";
    const common = `name="${field.name}" ${field.required ? "required" : ""}`;

    let control;

    if (field.type === "select") {
        control = `<select ${common}>${field.options.map(option => {
            const val = typeof option === "string" ? option : option.value;
            const label = typeof option === "string" ? option : option.label;
            return `<option value="${esc(val)}" ${String(val) === String(value) ? "selected" : ""}>${esc(label)}</option>`;
        }).join("")}</select>`;
    } else if (field.type === "file") {
        control = `<input type="file" ${common} accept="image/*">`;
    } else if (field.type === "textarea") {
        control = `<textarea ${common} rows="3" maxlength="${field.max || 300}">${esc(value)}</textarea>`;
    } else {
        control = `<input type="${field.type || "text"}" ${common} value="${esc(value)}"
            ${field.max ? `maxlength="${field.max}"` : ""}
            ${field.min !== undefined ? `min="${field.min}"` : ""}
            ${field.step ? `step="${field.step}"` : ""}
            ${field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ""}>`;
    }

    return `<label>${esc(field.label)}${control}</label>`;
}


function askForm({ eyebrow = "CAMPUS LIFE", title, fields, submit = "Save" }) {

    return new Promise(resolve => {

        if (pendingForm) pendingForm(null);

        document.getElementById("cfEyebrow").textContent = eyebrow;
        document.getElementById("cfTitle").textContent = title;

        document.getElementById("cfForm").innerHTML = `
            ${fields.map(fieldHTML).join("")}
            <div class="modal-actions">
                <button type="button" class="btn secondary" data-cf-cancel>Cancel</button>
                <button type="submit" class="btn primary">${esc(submit)}</button>
            </div>
        `;

        pendingForm = resolve;
        ctx.openModal("campusFormModal");
    });
}


function initializeFormDialog() {

    const form = document.getElementById("cfForm");
    const modal = document.getElementById("campusFormModal");

    if (!form || !modal) return;

    form.addEventListener("submit", event => {

        event.preventDefault();

        const values = Object.fromEntries(new FormData(form));
        const resolve = pendingForm;

        pendingForm = null;
        ctx.closeModal("campusFormModal");

        if (resolve) resolve(values);
    });

    form.addEventListener("click", event => {
        if (event.target.closest("[data-cf-cancel]")) ctx.closeModal("campusFormModal");
    });

    // Closing with X, Escape or a click outside resolves the pending form as cancelled.
    new MutationObserver(() => {
        if (!modal.classList.contains("active") && pendingForm) {
            const resolve = pendingForm;
            pendingForm = null;
            resolve(null);
        }
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
}


const courseOptions = () => [
    { value: "", label: "No course" },
    ...ctx.getCourses().map(course => ({ value: course.code, label: `${course.code} · ${course.name}` }))
];


/* =====================================================
   ATTENDANCE
   ===================================================== */

function classesToday() {

    const index = (new Date().getDay() + 6) % 7;

    return ctx.getClasses()
        .filter(cls => cls.day === index)
        .sort((a, b) => a.time.localeCompare(b.time));
}


function attendanceStats() {

    const map = {};

    ctx.getClasses().forEach(cls => {
        map[cls.title] = map[cls.title] || { title: cls.title, present: 0, late: 0, absent: 0 };
    });

    data.attendance.forEach(record => {
        const key = record.title || "Class";
        map[key] = map[key] || { title: key, present: 0, late: 0, absent: 0 };
        if (map[key][record.status] !== undefined) map[key][record.status]++;
    });

    return Object.values(map).map(stat => {

        const total = stat.present + stat.late + stat.absent;
        const attended = stat.present + stat.late;
        const percent = total ? Math.round((attended / total) * 100) : null;
        const ratio = REQUIRED_ATTENDANCE / 100;

        return {
            ...stat,
            total,
            attended,
            percent,
            canMiss: total ? Math.max(0, Math.floor(attended / ratio - total)) : null,
            mustAttend: total && percent < REQUIRED_ATTENDANCE
                ? Math.ceil((ratio * total - attended) / (1 - ratio))
                : 0
        };
    });
}


function markAttendance(cls, status, date = todayISO()) {

    const id = `${date}_${cls.id}`;
    const existing = data.attendance.find(record => record.id === id);

    if (existing && existing.status === status) {
        remove("attendance", id);
        return;
    }

    upsert("attendance", { id, date, classId: cls.id, title: cls.title, status });
}


function renderAttendance() {

    const today = classesToday();
    const stats = attendanceStats();
    const recent = [...data.attendance].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

    const statusButtons = (cls, current) => [
        ["present", "fa-check", "Present"],
        ["late", "fa-clock", "Late"],
        ["absent", "fa-xmark", "Absent"]
    ].map(([status, icon, label]) => `
        <button type="button" class="att-btn ${status} ${current === status ? "on" : ""}"
            data-cl="mark" data-class="${esc(cls.id)}" data-status="${status}" aria-pressed="${current === status}">
            <i class="fa-solid ${icon}"></i> ${label}
        </button>
    `).join("");

    return `
        <div class="cl-actions">
            <button type="button" class="btn secondary" data-cl="log-past"><i class="fa-solid fa-calendar-plus"></i> Log a past class</button>
        </div>
        <div class="cl-grid">
            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">TODAY</p><h3>Mark today's classes</h3></div></div>
                ${today.length ? today.map(cls => {
                    const record = data.attendance.find(r => r.id === `${todayISO()}_${cls.id}`);
                    return `
                        <div class="cl-row stack">
                            <div><strong>${esc(cls.title)}</strong><span>${esc(cls.time)}${cls.location ? " · " + esc(cls.location) : ""}</span></div>
                            <div class="att-group">${statusButtons(cls, record?.status)}</div>
                        </div>`;
                }).join("") : emptyState("fa-mug-hot", "No classes today", "Add classes on the Schedule page and they will show up here for quick check-in.")}
            </div>

            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">OVERVIEW</p><h3>Attendance by class</h3></div></div>
                ${stats.length ? stats.map(stat => `
                    <div class="cl-row stack">
                        <div class="cl-top">
                            <strong>${esc(stat.title)}</strong>
                            <b class="${stat.percent !== null && stat.percent < REQUIRED_ATTENDANCE ? "bad" : ""}">${stat.percent === null ? "—" : stat.percent + "%"}</b>
                        </div>
                        <div class="progress-bar"><span style="width:${stat.percent || 0}%"></span></div>
                        <small>${stat.total
                            ? `${stat.attended} of ${stat.total} attended · ${stat.percent < REQUIRED_ATTENDANCE
                                ? `attend the next ${stat.mustAttend} to get back to ${REQUIRED_ATTENDANCE}%`
                                : `you can miss ${stat.canMiss} more and stay above ${REQUIRED_ATTENDANCE}%`}`
                            : "No classes marked yet"}</small>
                    </div>`).join("") : emptyState("fa-clipboard-user", "Nothing tracked yet", "Mark a class as present, late or absent to start tracking.")}
            </div>
        </div>

        <div class="panel">
            <div class="panel-head"><div><p class="eyebrow">HISTORY</p><h3>Recent check-ins</h3></div></div>
            ${recent.length ? recent.map(record => `
                <div class="cl-row">
                    <span class="cl-dot ${esc(record.status)}"></span>
                    <div><strong>${esc(record.title)}</strong><span>${esc(fmtDate(record.date))}</span></div>
                    <span class="cl-badge ${esc(record.status)}">${esc(record.status)}</span>
                    <button type="button" class="icon-btn small" data-cl="del" data-sub="attendance" data-id="${esc(record.id)}" aria-label="Delete check-in"><i class="fa-solid fa-trash"></i></button>
                </div>`).join("") : `<p class="cl-muted">Your check-ins will appear here.</p>`}
        </div>
    `;
}


async function logPastClass() {

    const classes = ctx.getClasses();

    if (!classes.length) {
        ctx.showToast("Add a class on the Schedule page first.", "error");
        return;
    }

    const values = await askForm({
        title: "Log a past class",
        fields: [
            { name: "classId", label: "Class", type: "select", options: classes.map(c => ({ value: c.id, label: c.title })) },
            { name: "date", label: "Date", type: "date", required: true, value: todayISO() },
            { name: "status", label: "Status", type: "select", options: [
                { value: "present", label: "Present" }, { value: "late", label: "Late" }, { value: "absent", label: "Absent" }
            ] }
        ]
    });

    if (!values) return;

    const cls = classes.find(c => c.id === values.classId);

    if (!cls) return;

    const id = `${values.date}_${cls.id}`;

    upsert("attendance", { id, date: values.date, classId: cls.id, title: cls.title, status: values.status });
}


/* =====================================================
   EXAMS
   ===================================================== */

function renderExams() {

    const upcoming = data.exams.filter(e => ctx.daysUntil(e.date) >= 0).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const past = data.exams.filter(e => ctx.daysUntil(e.date) < 0).sort((a, b) => b.date.localeCompare(a.date));

    const card = (exam, isPast) => {

        const days = ctx.daysUntil(exam.date);
        const date = new Date(exam.date + "T00:00:00");

        return `
            <div class="cl-row exam ${isPast ? "past" : ""}">
                <div class="date-block"><b>${date.getDate()}</b><span>${date.toLocaleDateString("en-US", { month: "short" })}</span></div>
                <div>
                    <strong>${esc(exam.title)}</strong>
                    <span>${[exam.course, exam.time, exam.venue].filter(Boolean).map(esc).join(" · ") || "Details not added"}</span>
                </div>
                <span class="cl-badge ${!isPast && days <= 3 ? "absent" : !isPast && days <= 7 ? "late" : "neutral"}">${esc(countdown(exam.date))}</span>
                <button type="button" class="icon-btn small" data-cl="edit-exam" data-id="${esc(exam.id)}" aria-label="Edit exam"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="icon-btn small" data-cl="del" data-sub="exams" data-id="${esc(exam.id)}" aria-label="Delete exam"><i class="fa-solid fa-trash"></i></button>
            </div>`;
    };

    return `
        <div class="cl-actions">
            <button type="button" class="btn primary" data-cl="add-exam"><i class="fa-solid fa-plus"></i> Add exam</button>
        </div>
        <div class="panel">
            <div class="panel-head"><div><p class="eyebrow">COUNTDOWN</p><h3>Upcoming exams</h3></div></div>
            ${upcoming.length ? upcoming.map(e => card(e, false)).join("") : emptyState("fa-champagne-glasses", "No exams scheduled", "Add your exam timetable so you always know what's coming.")}
        </div>
        ${past.length ? `<div class="panel"><div class="panel-head"><div><p class="eyebrow">DONE</p><h3>Past exams</h3></div></div>${past.slice(0, 6).map(e => card(e, true)).join("")}</div>` : ""}
    `;
}


async function editExam(id) {

    const existing = data.exams.find(e => e.id === id);

    const values = await askForm({
        eyebrow: "EXAMS",
        title: existing ? "Edit exam" : "Add exam",
        fields: [
            { name: "title", label: "Exam title", required: true, max: 100, value: existing?.title, placeholder: "e.g. Database Systems CAT 2" },
            { name: "course", label: "Course", type: "select", options: courseOptions(), value: existing?.course },
            { name: "date", label: "Date", type: "date", required: true, value: existing?.date || todayISO() },
            { name: "time", label: "Start time", type: "time", value: existing?.time },
            { name: "venue", label: "Venue / seat", max: 80, value: existing?.venue, placeholder: "e.g. Hall B, seat 24" }
        ]
    });

    if (!values) return;

    upsert("exams", {
        id: existing?.id || ctx.newId("exams"),
        title: values.title.trim().slice(0, 100),
        course: values.course || "",
        date: values.date,
        time: values.time || "",
        venue: (values.venue || "").trim().slice(0, 80)
    });
}


/* =====================================================
   LIBRARY
   ===================================================== */

function renderLibrary() {

    const active = data.loans.filter(l => !l.returned).sort((a, b) => a.due.localeCompare(b.due));
    const returned = data.loans.filter(l => l.returned);

    return `
        <div class="cl-actions">
            <button type="button" class="btn primary" data-cl="add-loan"><i class="fa-solid fa-plus"></i> Add borrowed book</button>
        </div>
        <div class="panel">
            <div class="panel-head"><div><p class="eyebrow">ON LOAN</p><h3>Books I've borrowed</h3></div></div>
            ${active.length ? active.map(loan => {

                const days = ctx.daysUntil(loan.due);

                return `
                    <div class="cl-row">
                        <span class="cl-icon"><i class="fa-solid fa-book"></i></span>
                        <div>
                            <strong>${esc(loan.title)}</strong>
                            <span>${loan.author ? esc(loan.author) + " · " : ""}Due ${esc(fmtDate(loan.due))}${loan.renewed ? ` · renewed ${loan.renewed}×` : ""}</span>
                        </div>
                        <span class="cl-badge ${days < 0 ? "absent" : days <= 2 ? "late" : "neutral"}">${days < 0 ? `${-days}d overdue` : esc(countdown(loan.due))}</span>
                        <button type="button" class="btn secondary compact" data-cl="renew" data-id="${esc(loan.id)}">Renew</button>
                        <button type="button" class="btn secondary compact" data-cl="return" data-id="${esc(loan.id)}">Returned</button>
                        <button type="button" class="icon-btn small" data-cl="del" data-sub="loans" data-id="${esc(loan.id)}" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>`;
            }).join("") : emptyState("fa-book-bookmark", "No books on loan", "Add books you borrow and get reminded before they're due.")}
        </div>
        ${returned.length ? `<div class="panel"><div class="panel-head"><div><p class="eyebrow">HISTORY</p><h3>Returned (${returned.length})</h3></div></div>${returned.slice(0, 5).map(loan => `
            <div class="cl-row past"><span class="cl-icon"><i class="fa-solid fa-check"></i></span><div><strong>${esc(loan.title)}</strong><span>${esc(loan.author || "")}</span></div>
            <button type="button" class="icon-btn small" data-cl="del" data-sub="loans" data-id="${esc(loan.id)}" aria-label="Delete"><i class="fa-solid fa-trash"></i></button></div>`).join("")}</div>` : ""}
    `;
}


async function addLoan() {

    const values = await askForm({
        eyebrow: "LIBRARY",
        title: "Add borrowed book",
        fields: [
            { name: "title", label: "Book title", required: true, max: 120 },
            { name: "author", label: "Author", max: 80 },
            { name: "due", label: "Due date", type: "date", required: true, value: plusDays(todayISO(), 14) }
        ]
    });

    if (!values) return;

    upsert("loans", {
        id: ctx.newId("loans"),
        title: values.title.trim().slice(0, 120),
        author: (values.author || "").trim().slice(0, 80),
        due: values.due,
        returned: false,
        renewed: 0
    });
}


function renewLoan(id) {

    const loan = data.loans.find(l => l.id === id);

    if (!loan) return;

    if ((loan.renewed || 0) >= MAX_RENEWALS) {
        ctx.showToast("Renewal limit reached. Please check with the library.", "error");
        return;
    }

    upsert("loans", { ...loan, due: plusDays(ctx.daysUntil(loan.due) < 0 ? todayISO() : loan.due, 14), renewed: (loan.renewed || 0) + 1 });
    ctx.showToast("Due date extended by 14 days. Remember to renew with the library too.", "success");
}


/* =====================================================
   BUDGET & BILLS
   ===================================================== */

function renderBudget() {

    const budget = data.budget[0];
    const month = todayISO().slice(0, 7);
    const monthTx = data.expenses.filter(e => (e.date || "").startsWith(month));
    const spent = monthTx.filter(e => e.type !== "income").reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const income = monthTx.filter(e => e.type === "income").reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const monthly = Number(budget?.monthly || 0);
    const available = monthly + income - spent;
    const percent = monthly + income > 0 ? Math.min(100, Math.round((spent / (monthly + income)) * 100)) : 0;

    const byCategory = {};
    monthTx.filter(e => e.type !== "income").forEach(e => {
        byCategory[e.category || "Other"] = (byCategory[e.category || "Other"] || 0) + Number(e.amount || 0);
    });

    const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    const bills = data.bills.filter(b => !b.paid).sort((a, b) => a.due.localeCompare(b.due));
    const paid = data.bills.filter(b => b.paid);
    const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

    return `
        <div class="cl-actions">
            <button type="button" class="btn primary" data-cl="add-expense"><i class="fa-solid fa-plus"></i> Add expense</button>
            <button type="button" class="btn secondary" data-cl="add-income"><i class="fa-solid fa-arrow-down"></i> Add income / allowance</button>
            <button type="button" class="btn secondary" data-cl="set-budget"><i class="fa-solid fa-sliders"></i> Monthly budget</button>
        </div>

        <div class="cl-stats">
            <div class="cl-stat"><small>Spent this month</small><strong>${esc(money(spent))}</strong></div>
            <div class="cl-stat"><small>Budget + income</small><strong>${esc(money(monthly + income))}</strong></div>
            <div class="cl-stat ${available < 0 ? "bad" : "good"}"><small>Available</small><strong>${esc(money(available))}</strong></div>
        </div>
        <div class="panel">
            <div class="cl-top"><strong>${monthly ? `${percent}% of your money used` : "Set a monthly budget to track your spending"}</strong><b class="${percent >= 90 ? "bad" : ""}">${monthly ? esc(money(spent)) : ""}</b></div>
            <div class="progress-bar large"><span style="width:${percent}%;${percent >= 90 ? "background:linear-gradient(90deg,#f97316,#dc2626)" : ""}"></span></div>
        </div>

        <div class="cl-grid">
            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">BREAKDOWN</p><h3>Where it went</h3></div></div>
                ${categories.length ? categories.map(([name, amount]) => `
                    <div class="cl-row stack">
                        <div class="cl-top"><strong>${esc(name)}</strong><b>${esc(money(amount))}</b></div>
                        <div class="progress-bar"><span style="width:${spent ? Math.round((amount / spent) * 100) : 0}%"></span></div>
                    </div>`).join("") : `<p class="cl-muted">No spending recorded this month.</p>`}
            </div>

            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">FEES &amp; BILLS</p><h3>Upcoming payments</h3></div><button type="button" class="text-btn" data-cl="add-bill">Add</button></div>
                ${bills.length ? bills.map(bill => {

                    const days = ctx.daysUntil(bill.due);

                    return `
                        <div class="cl-row">
                            <button type="button" class="mini-check" data-cl="pay-bill" data-id="${esc(bill.id)}" aria-label="Mark ${esc(bill.title)} as paid"><i class="fa-solid fa-check"></i></button>
                            <div><strong>${esc(bill.title)}</strong><span>${esc(money(bill.amount))} · due ${esc(fmtDate(bill.due))}</span></div>
                            <span class="cl-badge ${days < 0 ? "absent" : days <= 5 ? "late" : "neutral"}">${days < 0 ? `${-days}d overdue` : esc(countdown(bill.due))}</span>
                            <button type="button" class="icon-btn small" data-cl="del" data-sub="bills" data-id="${esc(bill.id)}" aria-label="Delete bill"><i class="fa-solid fa-trash"></i></button>
                        </div>`;
                }).join("") : `<p class="cl-muted">No unpaid bills. Add tuition, rent or other payments to get reminders.</p>`}
                ${paid.length ? `<p class="cl-muted">${paid.length} paid · <button type="button" class="text-btn" data-cl="clear-paid">Clear paid</button></p>` : ""}
            </div>
        </div>

        <div class="panel">
            <div class="panel-head"><div><p class="eyebrow">THIS MONTH</p><h3>Transactions</h3></div></div>
            ${recent.length ? recent.map(tx => `
                <div class="cl-row">
                    <span class="cl-icon ${tx.type === "income" ? "in" : ""}"><i class="fa-solid ${tx.type === "income" ? "fa-arrow-down" : "fa-arrow-up"}"></i></span>
                    <div><strong>${esc(tx.note || tx.category)}</strong><span>${esc(tx.category)} · ${esc(fmtDate(tx.date))}</span></div>
                    <b class="${tx.type === "income" ? "good" : ""}">${tx.type === "income" ? "+" : "−"}${esc(money(tx.amount))}</b>
                    <button type="button" class="icon-btn small" data-cl="del" data-sub="expenses" data-id="${esc(tx.id)}" aria-label="Delete transaction"><i class="fa-solid fa-trash"></i></button>
                </div>`).join("") : `<p class="cl-muted">Add your first expense to start tracking.</p>`}
        </div>
    `;
}


async function addTransaction(type) {

    const values = await askForm({
        eyebrow: "BUDGET",
        title: type === "income" ? "Add income / allowance" : "Add expense",
        fields: [
            { name: "amount", label: "Amount", type: "number", required: true, min: 0, step: "0.01" },
            { name: "category", label: "Category", type: "select", options: type === "income" ? ["Allowance", "Salary / part-time", "Scholarship", "Gift", "Other"] : EXPENSE_CATEGORIES },
            { name: "date", label: "Date", type: "date", required: true, value: todayISO() },
            { name: "note", label: "Note (optional)", max: 80 }
        ]
    });

    if (!values) return;

    const amount = Number(values.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
        ctx.showToast("Enter an amount greater than zero.", "error");
        return;
    }

    upsert("expenses", {
        id: ctx.newId("expenses"),
        type,
        amount: Math.round(amount * 100) / 100,
        category: values.category,
        date: values.date,
        note: (values.note || "").trim().slice(0, 80)
    });
}


async function setBudget() {

    const current = data.budget[0];

    const values = await askForm({
        eyebrow: "BUDGET",
        title: "Monthly budget",
        fields: [
            { name: "monthly", label: "Money available each month", type: "number", required: true, min: 0, step: "0.01", value: current?.monthly },
            { name: "currency", label: "Currency symbol", max: 4, value: current?.currency || "$", placeholder: "e.g. $ or KSh" }
        ]
    });

    if (!values) return;

    upsert("budget", {
        id: "monthly",
        monthly: Math.max(0, Number(values.monthly) || 0),
        currency: (values.currency || "$").trim().slice(0, 4) || "$"
    });
}


async function addBill() {

    const values = await askForm({
        eyebrow: "BILLS",
        title: "Add fee or bill",
        fields: [
            { name: "title", label: "What is it for?", required: true, max: 80, placeholder: "e.g. Tuition instalment" },
            { name: "amount", label: "Amount", type: "number", required: true, min: 0, step: "0.01" },
            { name: "due", label: "Due date", type: "date", required: true, value: plusDays(todayISO(), 7) }
        ]
    });

    if (!values) return;

    upsert("bills", {
        id: ctx.newId("bills"),
        title: values.title.trim().slice(0, 80),
        amount: Math.max(0, Number(values.amount) || 0),
        due: values.due,
        paid: false
    });
}


/* =====================================================
   SERVICES: CONTACTS, LINKS, PLACES, SHUTTLE
   ===================================================== */

function nextDeparture(times) {

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const list = (times || "").split(/[,\s]+/).filter(t => /^\d{1,2}:\d{2}$/.test(t))
        .map(t => { const [h, m] = t.split(":").map(Number); return { label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minutes: h * 60 + m }; })
        .sort((a, b) => a.minutes - b.minutes);

    if (!list.length) return null;

    const next = list.find(t => t.minutes >= nowMinutes);

    if (next) return { label: next.label, text: next.minutes === nowMinutes ? "now" : `in ${next.minutes - nowMinutes} min` };

    return { label: list[0].label, text: "tomorrow" };
}


function serviceSection({ title, eyebrow, sub, addAction, items, row, suggestions, suggestionAction, emptyText }) {

    return `
        <div class="panel">
            <div class="panel-head"><div><p class="eyebrow">${eyebrow}</p><h3>${title}</h3></div><button type="button" class="text-btn" data-cl="${addAction}">Add</button></div>
            ${items.length ? items.map(row).join("") : `<p class="cl-muted">${emptyText}</p>`}
            ${!items.length && suggestions ? `<div class="chip-row">${suggestions.map(s => `<button type="button" class="chip" data-cl="${suggestionAction}" data-name="${esc(s)}">+ ${esc(s)}</button>`).join("")}</div>` : ""}
        </div>
    `;
}


function renderServices() {

    const delBtn = (sub, id) => `<button type="button" class="icon-btn small" data-cl="del" data-sub="${sub}" data-id="${esc(id)}" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>`;

    return `
        <div class="cl-grid">
            ${serviceSection({
                title: "Emergency &amp; key contacts", eyebrow: "CONTACTS", addAction: "add-contact",
                items: data.contacts.filter(c => c.kind !== "support"),
                emptyText: "Save security, clinic and helpdesk numbers so they work offline.",
                suggestions: ["Campus Security", "Health Clinic", "IT Helpdesk", "Registrar"], suggestionAction: "suggest-contact",
                row: c => `
                    <div class="cl-row">
                        <span class="cl-icon"><i class="fa-solid fa-phone"></i></span>
                        <div><strong>${esc(c.name)}</strong><span>${esc(c.phone || "No number yet")}${c.note ? " · " + esc(c.note) : ""}</span></div>
                        ${c.phone ? `<a class="btn primary compact" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}">Call</a>` : ""}
                        ${delBtn("contacts", c.id)}
                    </div>`
            })}

            ${serviceSection({
                title: "Quick links", eyebrow: "PORTALS", addAction: "add-link",
                items: data.links,
                emptyText: "Keep your student portal, e-learning and library links in one place.",
                suggestions: ["Student portal", "E-learning", "Library catalogue", "Student email"], suggestionAction: "suggest-link",
                row: l => `
                    <div class="cl-row">
                        <span class="cl-icon"><i class="fa-solid fa-link"></i></span>
                        <div><strong>${esc(l.title)}</strong><span>${esc((l.url || "").replace(/^https?:\/\//, "").slice(0, 40))}</span></div>
                        <a class="btn secondary compact" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Open</a>
                        ${delBtn("links", l.id)}
                    </div>`
            })}

            ${serviceSection({
                title: "Campus places", eyebrow: "MAP", addAction: "add-place",
                items: data.places,
                emptyText: "Save lecture halls, labs and offices, then open directions in one tap.",
                suggestions: ["Library", "Cafeteria", "Admin block", "Sports complex"], suggestionAction: "suggest-place",
                row: p => `
                    <div class="cl-row">
                        <span class="cl-icon"><i class="fa-solid fa-location-dot"></i></span>
                        <div><strong>${esc(p.name)}</strong><span>${esc(p.note || "")}</span></div>
                        <a class="btn secondary compact" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + (p.note ? " " + p.note : ""))}" target="_blank" rel="noopener noreferrer">Directions</a>
                        ${delBtn("places", p.id)}
                    </div>`
            })}

            ${serviceSection({
                title: "Shuttle &amp; transport", eyebrow: "TRANSPORT", addAction: "add-shuttle",
                items: data.shuttle,
                emptyText: "Add a route with departure times and see the next one at a glance.",
                row: s => {
                    const next = nextDeparture(s.times);
                    return `
                        <div class="cl-row">
                            <span class="cl-icon"><i class="fa-solid fa-bus"></i></span>
                            <div><strong>${esc(s.name)}</strong><span>${next ? `Next ${esc(next.label)} (${esc(next.text)})` : "No valid times"}</span></div>
                            ${delBtn("shuttle", s.id)}
                        </div>`;
                }
            })}
        </div>
    `;
}


async function addContact(name = "", kind = "") {

    const values = await askForm({
        eyebrow: "SERVICES",
        title: kind === "support" ? "Add to my support circle" : "Add contact",
        fields: [
            { name: "name", label: "Name", required: true, max: 60, value: name },
            { name: "phone", label: "Phone number", type: "tel", max: 30, placeholder: "e.g. +254 700 000000" },
            { name: "note", label: "Note (optional)", max: 80 }
        ]
    });

    if (!values) return;

    upsert("contacts", {
        id: ctx.newId("contacts"),
        name: values.name.trim().slice(0, 60),
        phone: (values.phone || "").trim().slice(0, 30),
        note: (values.note || "").trim().slice(0, 80),
        kind
    });
}


async function addLink(title = "") {

    const values = await askForm({
        eyebrow: "SERVICES",
        title: "Add quick link",
        fields: [
            { name: "title", label: "Title", required: true, max: 60, value: title },
            { name: "url", label: "Web address", type: "text", required: true, max: 300, placeholder: "https://portal.youruniversity.edu" }
        ]
    });

    if (!values) return;

    let url = values.url.trim();

    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    try {
        new URL(url);
    } catch {
        ctx.showToast("That web address doesn't look right.", "error");
        return;
    }

    upsert("links", { id: ctx.newId("links"), title: values.title.trim().slice(0, 60), url: url.slice(0, 300) });
}


async function addPlace(name = "") {

    const values = await askForm({
        eyebrow: "SERVICES",
        title: "Add campus place",
        fields: [
            { name: "name", label: "Place name", required: true, max: 80, value: name },
            { name: "note", label: "Campus / area (helps the map)", max: 80, placeholder: "e.g. Main Campus, Nairobi" }
        ]
    });

    if (!values) return;

    upsert("places", { id: ctx.newId("places"), name: values.name.trim().slice(0, 80), note: (values.note || "").trim().slice(0, 80) });
}


async function addShuttle() {

    const values = await askForm({
        eyebrow: "SERVICES",
        title: "Add shuttle route",
        fields: [
            { name: "name", label: "Route name", required: true, max: 60, placeholder: "e.g. Hostels → Main gate" },
            { name: "times", label: "Departure times", required: true, max: 200, placeholder: "07:30, 08:15, 12:00, 17:30" }
        ]
    });

    if (!values) return;

    if (!nextDeparture(values.times)) {
        ctx.showToast("Enter times like 07:30, 12:00, 17:30.", "error");
        return;
    }

    upsert("shuttle", { id: ctx.newId("shuttle"), name: values.name.trim().slice(0, 60), times: values.times.trim().slice(0, 200) });
}


/* =====================================================
   WELLNESS
   ===================================================== */

function wellnessFor(date) {
    return data.wellness.find(w => w.id === date) || { id: date, done: [], mood: 0, water: 0 };
}


function saveWellness(entry) {

    upsert("wellness", {
        id: entry.id,
        done: [...new Set(entry.done)].slice(0, 10),
        mood: Math.min(5, Math.max(0, Number(entry.mood) || 0)),
        water: Math.min(30, Math.max(0, Number(entry.water) || 0))
    });
}


function habitStreak(habitId) {

    let streak = 0;
    let date = todayISO();

    if (!wellnessFor(date).done.includes(habitId)) date = plusDays(date, -1);

    while (wellnessFor(date).done.includes(habitId) && streak < 365) {
        streak++;
        date = plusDays(date, -1);
    }

    return streak;
}


function renderWellness() {

    const today = wellnessFor(todayISO());
    const water = today.water;
    const days = Array.from({ length: 14 }, (_, i) => plusDays(todayISO(), i - 13));

    return `
        <div class="cl-grid">
            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">TODAY</p><h3>Daily check-in</h3></div></div>
                <p class="setting-label">How are you feeling?</p>
                <div class="mood-row">${MOODS.map((emoji, i) => `
                    <button type="button" class="mood ${today.mood === i + 1 ? "on" : ""}" data-cl="mood" data-val="${i + 1}" aria-label="Mood ${i + 1} of 5" aria-pressed="${today.mood === i + 1}">${emoji}</button>`).join("")}
                </div>

                <p class="setting-label">Water · ${water} of ${WATER_GOAL} glasses</p>
                <div class="water-row">
                    <button type="button" class="icon-btn small" data-cl="water-dec" aria-label="Remove a glass"><i class="fa-solid fa-minus"></i></button>
                    <div class="glasses">${Array.from({ length: WATER_GOAL }, (_, i) => `<i class="fa-solid fa-glass-water ${i < water ? "on" : ""}"></i>`).join("")}</div>
                    <button type="button" class="icon-btn small" data-cl="water-inc" aria-label="Add a glass"><i class="fa-solid fa-plus"></i></button>
                </div>

                <p class="setting-label">Habits</p>
                ${HABITS.map(habit => {
                    const done = today.done.includes(habit.id);
                    const streak = habitStreak(habit.id);
                    return `
                        <div class="cl-row">
                            <button type="button" class="mini-check ${done ? "checked" : ""}" data-cl="habit" data-id="${habit.id}" aria-pressed="${done}" aria-label="${esc(habit.label)}"><i class="fa-solid fa-check"></i></button>
                            <div><strong>${esc(habit.label)}</strong></div>
                            <span class="cl-badge ${streak ? "present" : "neutral"}">${streak ? `🔥 ${streak} day${streak === 1 ? "" : "s"}` : "No streak"}</span>
                        </div>`;
                }).join("")}
            </div>

            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">LAST 14 DAYS</p><h3>Consistency</h3></div></div>
                <div class="heat">${days.map(date => {
                    const entry = wellnessFor(date);
                    const score = (entry.done.length + (entry.water >= WATER_GOAL ? 1 : 0)) / (HABITS.length + 1);
                    return `<span class="heat-cell" style="--a:${(0.12 + score * 0.88).toFixed(2)}" title="${esc(fmtDate(date))}: ${entry.done.length}/${HABITS.length} habits, ${entry.water} glasses"></span>`;
                }).join("")}</div>
                <p class="cl-muted">Darker squares mean more habits completed and water goal reached.</p>
                <div class="panel-head" style="margin-top:18px"><div><p class="eyebrow">MOOD</p><h3>This week</h3></div></div>
                <div class="mood-week">${Array.from({ length: 7 }, (_, i) => {
                    const date = plusDays(todayISO(), i - 6);
                    const entry = wellnessFor(date);
                    return `<div><span>${MOODS[entry.mood - 1] || "·"}</span><small>${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}</small></div>`;
                }).join("")}</div>
            </div>
        </div>
    `;
}


/* =====================================================
   EVENTS
   ===================================================== */

function renderEvents() {

    const upcoming = data.events.filter(e => ctx.daysUntil(e.date) >= 0).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const past = data.events.filter(e => ctx.daysUntil(e.date) < 0);

    return `
        <div class="cl-actions">
            <button type="button" class="btn primary" data-cl="add-event"><i class="fa-solid fa-plus"></i> Add event</button>
        </div>
        <div class="panel">
            <div class="panel-head"><div><p class="eyebrow">WHAT'S ON</p><h3>Events I'm tracking</h3></div></div>
            ${upcoming.length ? upcoming.map(event => {

                const date = new Date(event.date + "T00:00:00");

                return `
                    <div class="cl-row exam">
                        <div class="date-block"><b>${date.getDate()}</b><span>${date.toLocaleDateString("en-US", { month: "short" })}</span></div>
                        <div>
                            <strong>${esc(event.title)}</strong>
                            <span>${[event.kind, event.time, event.place].filter(Boolean).map(esc).join(" · ")} · ${esc(countdown(event.date))}</span>
                        </div>
                        <button type="button" class="btn ${event.going ? "primary" : "secondary"} compact" data-cl="rsvp" data-id="${esc(event.id)}" aria-pressed="${Boolean(event.going)}">
                            <i class="fa-solid ${event.going ? "fa-check" : "fa-plus"}"></i> ${event.going ? "Going" : "I'm going"}
                        </button>
                        <button type="button" class="icon-btn small" data-cl="del" data-sub="events" data-id="${esc(event.id)}" aria-label="Delete event"><i class="fa-solid fa-trash"></i></button>
                    </div>`;
            }).join("") : emptyState("fa-champagne-glasses", "No upcoming events", "Add club meetings, sports fixtures, career fairs and socials so you never miss them.")}
        </div>
        ${past.length ? `<p class="cl-muted">${past.length} past event${past.length === 1 ? "" : "s"} · <button type="button" class="text-btn" data-cl="clear-past-events">Clear past events</button></p>` : ""}
    `;
}


async function addEvent() {

    const values = await askForm({
        eyebrow: "EVENTS",
        title: "Add campus event",
        fields: [
            { name: "title", label: "Event", required: true, max: 100, placeholder: "e.g. Career fair" },
            { name: "kind", label: "Type", type: "select", options: EVENT_KINDS },
            { name: "date", label: "Date", type: "date", required: true, value: todayISO() },
            { name: "time", label: "Time", type: "time" },
            { name: "place", label: "Place", max: 80 }
        ]
    });

    if (!values) return;

    upsert("events", {
        id: ctx.newId("events"),
        title: values.title.trim().slice(0, 100),
        kind: values.kind,
        date: values.date,
        time: values.time || "",
        place: (values.place || "").trim().slice(0, 80),
        going: true
    });
}


/* =====================================================
   TODAY AT A GLANCE + ALERTS
   ===================================================== */

function agendaItems() {

    const today = todayISO();
    const items = [];

    classesToday().forEach(cls => {
        const [h, m] = cls.time.split(":").map(Number);
        items.push({ rank: h * 60 + m, icon: "fa-chalkboard-user", color: "purple", title: cls.title, sub: `${cls.time}${cls.location ? " · " + cls.location : ""}`, tab: "attendance", badge: "Class" });
    });

    data.events.filter(e => e.date === today).forEach(e => {
        const [h, m] = (e.time || "12:00").split(":").map(Number);
        items.push({ rank: h * 60 + m, icon: "fa-champagne-glasses", color: "blue", title: e.title, sub: [e.time, e.place].filter(Boolean).join(" · ") || e.kind, tab: "events", badge: e.going ? "Going" : "Event" });
    });

    data.exams.forEach(exam => {
        const days = ctx.daysUntil(exam.date);
        if (days < 0 || days > 7) return;
        const [h, m] = (exam.time || "08:00").split(":").map(Number);
        items.push({ rank: days === 0 ? h * 60 + m : 1500 + days * 10, icon: "fa-file-pen", color: "orange", title: `Exam: ${exam.title}`, sub: [countdown(exam.date), exam.time, exam.venue].filter(Boolean).join(" · "), tab: "exams", badge: days === 0 ? "Today" : `${days}d` });
    });

    data.loans.filter(l => !l.returned).forEach(loan => {
        const days = ctx.daysUntil(loan.due);
        if (days > 3) return;
        items.push({ rank: 1000 + days, icon: "fa-book-bookmark", color: "green", title: `Return: ${loan.title}`, sub: days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : countdown(loan.due), tab: "library", badge: days < 0 ? "Overdue" : "Library" });
    });

    data.bills.filter(b => !b.paid).forEach(bill => {
        const days = ctx.daysUntil(bill.due);
        if (days > 7) return;
        items.push({ rank: 1100 + days, icon: "fa-wallet", color: "orange", title: `Pay: ${bill.title}`, sub: `${money(bill.amount)} · ${days < 0 ? `${-days}d overdue` : countdown(bill.due)}`, tab: "budget", badge: days < 0 ? "Overdue" : "Bill" });
    });

    const menu = menus[today];

    if (menu && new Date().getHours() < 20) {
        const preview = [...(menu.meals?.lunch || []), ...(menu.meals?.dinner || [])].slice(0, 2).map(item => item.name).join(", ");
        items.push({ rank: 750, icon: "fa-utensils", color: "green", title: "Today's cafeteria menu is up", sub: preview || "See what's being served", tab: "cafeteria", badge: "Menu" });
    }

    return items.sort((a, b) => a.rank - b.rank);
}


function renderAgenda() {

    const box = document.getElementById("todayAgenda");

    if (!box) return;

    const items = agendaItems().slice(0, 6);
    const entry = wellnessFor(todayISO());

    box.innerHTML = `
        ${items.length ? items.map(item => `
            <button type="button" class="agenda-row" data-agenda-tab="${item.tab}">
                <span class="agenda-icon ${item.color}"><i class="fa-solid ${item.icon}"></i></span>
                <span class="agenda-text"><strong>${esc(item.title)}</strong><small>${esc(item.sub)}</small></span>
                <span class="cl-badge neutral">${esc(item.badge)}</span>
            </button>`).join("") : emptyState("fa-sun", "Nothing on today", "No classes, events or deadlines coming up. Enjoy the free time.")}
        <div class="agenda-foot">
            <span><i class="fa-solid fa-glass-water"></i> ${entry.water} / ${WATER_GOAL} glasses</span>
            <button type="button" class="chip" data-agenda-water>+ Glass of water</button>
            <button type="button" class="chip" data-agenda-tab="wellness">Daily check-in</button>
        </div>
    `;
}


export function campusAlerts() {

    if (!ctx) return [];

    const alerts = [];

    data.exams.forEach(exam => {
        const days = ctx.daysUntil(exam.date);
        if (days < 0 || days > 3) return;
        alerts.push({ key: `exam-${exam.id}-${exam.date}`, days, icon: "fa-file-pen", color: "orange", title: "Exam coming up", text: `${exam.title} is ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}${exam.venue ? ` at ${exam.venue}` : ""}.` });
    });

    data.loans.filter(l => !l.returned).forEach(loan => {
        const days = ctx.daysUntil(loan.due);
        if (days > 2) return;
        alerts.push({ key: `loan-${loan.id}-${loan.due}`, days, icon: "fa-book-bookmark", color: "green", title: days < 0 ? "Library book overdue" : "Library book due soon", text: `"${loan.title}" is ${days < 0 ? `overdue by ${-days} day${days === -1 ? "" : "s"}` : days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`}.` });
    });

    data.bills.filter(b => !b.paid).forEach(bill => {
        const days = ctx.daysUntil(bill.due);
        if (days > 5) return;
        alerts.push({ key: `bill-${bill.id}-${bill.due}`, days, icon: "fa-wallet", color: "orange", title: days < 0 ? "Payment overdue" : "Payment due soon", text: `${bill.title} (${money(bill.amount)}) is ${days < 0 ? `overdue by ${-days} day${days === -1 ? "" : "s"}` : days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`}.` });
    });

    data.events.filter(e => e.going).forEach(event => {
        const days = ctx.daysUntil(event.date);
        if (days < 0 || days > 1) return;
        alerts.push({ key: `event-${event.id}-${event.date}`, days, icon: "fa-champagne-glasses", color: "blue", title: "Event you're going to", text: `${event.title} is ${days === 0 ? "today" : "tomorrow"}${event.time ? ` at ${event.time}` : ""}.` });
    });

    attendanceStats().filter(s => s.total >= 3 && s.percent < REQUIRED_ATTENDANCE).forEach(stat => {
        alerts.push({ key: `att-${stat.title}-${stat.total}`, days: 0, icon: "fa-triangle-exclamation", color: "orange", title: "Attendance warning", text: `${stat.title} attendance is ${stat.percent}%. Attend the next ${stat.mustAttend} class${stat.mustAttend === 1 ? "" : "es"} to get back above ${REQUIRED_ATTENDANCE}%.` });
    });

    return alerts;
}


/* =====================================================
   REMINDERS (browser notifications while the app is open)
   ===================================================== */

const REMINDER_KEY = "campusconnect_reminders";
const REMINDED_KEY = "campusconnect_reminded";

function remindersOn() {

    return "Notification" in window
        && Notification.permission === "granted"
        && localStorage.getItem(REMINDER_KEY) === "on";
}


function updateReminderUI() {

    const status = document.getElementById("remindersStatus");
    const button = document.getElementById("remindersBtn");

    if (!status || !button) return;

    if (!("Notification" in window)) {
        status.textContent = "This browser doesn't support notifications.";
        button.classList.add("hidden");
        return;
    }

    if (Notification.permission === "denied") {
        status.textContent = "Notifications are blocked. Allow them for this site in your browser settings.";
        button.classList.add("hidden");
        return;
    }

    const on = remindersOn();

    status.textContent = on
        ? "Reminders are on. You'll be notified about classes starting soon and upcoming deadlines, exams, library returns and bills while CampusConnect is open."
        : "Get a nudge before classes start and when deadlines, exams, library returns or bills are close. Works while CampusConnect is open (or installed and running).";

    button.classList.remove("hidden");
    button.innerHTML = on
        ? `<i class="fa-solid fa-bell-slash"></i> Turn off reminders`
        : `<i class="fa-solid fa-bell"></i> Enable reminders`;
}


async function toggleReminders() {

    if (!("Notification" in window)) return;

    if (remindersOn()) {
        localStorage.setItem(REMINDER_KEY, "off");
        updateReminderUI();
        ctx.showToast("Reminders turned off.", "success");
        return;
    }

    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();

    if (permission === "granted") {
        localStorage.setItem(REMINDER_KEY, "on");
        ctx.showToast("Reminders are on.", "success");
        notify("CampusConnect reminders are on", "You'll get alerts for classes and deadlines.", "welcome");
        checkReminders();
    } else {
        ctx.showToast("Notification permission was not granted.", "error");
    }

    updateReminderUI();
}


async function notify(title, body, tag) {

    const options = { body, tag, icon: "icons/icon-192.png", badge: "icons/favicon-32.png" };

    try {
        const registration = await navigator.serviceWorker?.getRegistration();

        if (registration?.showNotification) {
            await registration.showNotification(title, options);
            return;
        }

        new Notification(title, options);
    } catch (error) {
        console.warn("Notification failed:", error);
    }
}


function checkReminders() {

    if (!ctx || !remindersOn()) return;

    const today = todayISO();
    let reminded = {};

    try {
        reminded = JSON.parse(localStorage.getItem(REMINDED_KEY) || "{}");
    } catch {
        reminded = {};
    }

    Object.keys(reminded).forEach(key => {
        if (reminded[key] !== today) delete reminded[key];
    });

    const fire = (key, title, body) => {
        if (reminded[key]) return;
        reminded[key] = today;
        notify(title, body, key);
    };

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    classesToday().forEach(cls => {
        const [h, m] = cls.time.split(":").map(Number);
        const diff = h * 60 + m - nowMinutes;
        if (diff >= 0 && diff <= 15) fire(`class-${cls.id}`, "Class starting soon", `${cls.title} starts ${diff === 0 ? "now" : `in ${diff} min`}${cls.location ? ` · ${cls.location}` : ""}.`);
    });

    campusAlerts().forEach(alert => fire(alert.key, alert.title, alert.text));

    ctx.getAssignments().filter(a => !a.completed).forEach(a => {
        const days = ctx.daysUntil(a.date);
        if (days >= 0 && days <= 1) fire(`due-${a.id}-${a.date}`, "Assignment due " + (days === 0 ? "today" : "tomorrow"), a.title);
    });

    try {
        localStorage.setItem(REMINDED_KEY, JSON.stringify(reminded));
    } catch {
        /* storage full or unavailable */
    }
}


/* =====================================================
   LOST & FOUND (shared between students, live)
   ===================================================== */

const LF_CATEGORIES = [
    "Phone / electronics", "ID / documents", "Keys", "Wallet / cards", "Bags",
    "Clothing", "Books / stationery", "Water bottle / lunch box", "Other"
];

const LF_REPORT_REASONS = ["Spam", "Inappropriate", "Not campus-related", "Shows private information", "Other"];

const REPORTED_KEY = "campusconnect_lf_reported";

let lfPosts = [];
let lfFilter = "all";
let lfSearch = "";
let lfCategory = "";
let lfShowResolved = false;
let lfError = false;
let lfLoaded = false;
let deepPost = null;

const live = { unsubs: [], menuUnsubs: [], menuDate: null };


function reportedSet() {

    try {
        return new Set(JSON.parse(localStorage.getItem(REPORTED_KEY) || "[]"));
    } catch {
        return new Set();
    }
}


function rememberReported(id) {

    const set = reportedSet();
    set.add(id);

    try {
        localStorage.setItem(REPORTED_KEY, JSON.stringify([...set].slice(-200)));
    } catch {
        /* ignore */
    }
}


function timeAgo(timestamp) {

    const date = timestamp?.toDate ? timestamp.toDate() : null;

    if (!date) return "Just now";

    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

    const days = Math.floor(hours / 24);

    return days < 14 ? `${days} day${days === 1 ? "" : "s"} ago` : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


function safePhoto(photo) {
    // Strict check: only base64 characters after the prefix, so a stored value can never
    // close the src="..." attribute and inject markup or event handlers.
    return typeof photo === "string"
        && photo.length <= 200000
        && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)
        ? photo : "";
}


function contactLink(contact) {

    const text = String(contact || "").trim();

    if (!text) return "";

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return `<a href="mailto:${esc(text)}">${esc(text)}</a>`;
    }

    const digits = text.replace(/[^\d+]/g, "");

    if (digits.replace(/\D/g, "").length >= 7) {
        return `<a href="tel:${esc(digits)}">${esc(text)}</a>`;
    }

    return esc(text);
}


function lfMatches(post) {

    const me = ctx.getUser()?.uid;

    if (lfFilter === "lost" && post.type !== "lost") return false;
    if (lfFilter === "found" && post.type !== "found") return false;
    if (lfFilter === "mine" && post.uid !== me) return false;
    if (lfCategory && post.category !== lfCategory) return false;

    if (lfSearch) {
        const haystack = `${post.title} ${post.description} ${post.place} ${post.category}`.toLowerCase();
        if (!haystack.includes(lfSearch.toLowerCase())) return false;
    }

    return true;
}


function lfCard(post) {

    const me = ctx.getUser()?.uid;
    const mine = post.uid === me;
    const resolved = post.status === "resolved";
    const photo = safePhoto(post.photo);
    const icon = post.type === "lost" ? "fa-magnifying-glass" : "fa-hand-holding-hand";

    return `
        <article class="lf-card ${esc(post.type)} ${resolved ? "resolved" : ""}" data-post="${esc(post.id)}">
            ${photo
                ? `<img class="lf-photo" src="${photo}" alt="Photo of ${esc(post.title)}" loading="lazy">`
                : `<div class="lf-photo ph"><i class="fa-solid ${icon}"></i></div>`}
            <div class="lf-main">
                <div class="lf-top">
                    <span class="cl-badge ${post.type === "lost" ? "absent" : "present"}">${post.type === "lost" ? "Lost" : "Found"}</span>
                    ${resolved ? `<span class="cl-badge neutral">Resolved</span>` : ""}
                    <small>${esc(timeAgo(post.createdAt))}${mine ? " · your post" : ""}</small>
                </div>
                <h4>${esc(post.title)}</h4>
                ${post.description ? `<p>${esc(post.description)}</p>` : ""}
                <div class="lf-meta">
                    <span><i class="fa-solid fa-location-dot"></i> ${esc(post.place)}</span>
                    <span><i class="fa-regular fa-calendar"></i> ${esc(fmtDate(post.date))}</span>
                    <span><i class="fa-solid fa-tag"></i> ${esc(post.category)}</span>
                </div>
                <div class="lf-contact"><i class="fa-solid fa-user"></i> ${esc(post.posterName || "Student")}${post.contact ? ` · ${contactLink(post.contact)}` : ""}</div>
                <div class="lf-actions">
                    <button type="button" class="btn secondary compact" data-cl="lf-share" data-id="${esc(post.id)}"><i class="fa-solid fa-share-nodes"></i> Share</button>
                    ${mine ? `
                        <button type="button" class="btn secondary compact" data-cl="lf-resolve" data-id="${esc(post.id)}"><i class="fa-solid fa-circle-check"></i> ${resolved ? "Reopen" : post.type === "lost" ? "Mark as found" : "Mark as returned"}</button>
                        <button type="button" class="btn secondary compact danger-text" data-cl="lf-delete" data-id="${esc(post.id)}"><i class="fa-solid fa-trash"></i> Delete</button>`
                    : `<button type="button" class="btn secondary compact" data-cl="lf-report" data-id="${esc(post.id)}"><i class="fa-solid fa-flag"></i> Report</button>`}
                </div>
            </div>
        </article>
    `;
}


function lfListHTML() {

    const reported = reportedSet();
    const visible = lfPosts.filter(post => !reported.has(post.id) && lfMatches(post));
    const open = visible.filter(post => post.status !== "resolved");
    const resolved = visible.filter(post => post.status === "resolved");

    if (lfError) {
        return emptyState("fa-cloud-bolt", "Couldn't load shared posts", "Check your connection. If this keeps happening, the latest Firestore rules may not be published yet.");
    }

    if (!lfLoaded) {
        return `<p class="cl-muted">Loading posts…</p>`;
    }

    return `
        ${open.length ? `<div class="lf-grid">${open.map(lfCard).join("")}</div>`
            : emptyState("fa-magnifying-glass-location", "Nothing here yet", lfFilter === "mine" ? "You haven't posted anything. Lost something or found something? Post it so others can help." : "No matching posts. Be the first to post a lost or found item.")}
        ${resolved.length ? `
            <p class="cl-muted"><button type="button" class="text-btn" data-cl="lf-toggle-resolved">${lfShowResolved ? "Hide" : "Show"} ${resolved.length} resolved</button></p>
            ${lfShowResolved ? `<div class="lf-grid">${resolved.map(lfCard).join("")}</div>` : ""}` : ""}
    `;
}


function renderLostFound() {

    const lost = lfPosts.filter(p => p.type === "lost" && p.status !== "resolved").length;
    const found = lfPosts.filter(p => p.type === "found" && p.status !== "resolved").length;

    return `
        <div class="cl-actions">
            <button type="button" class="btn primary" data-cl="lf-post-lost"><i class="fa-solid fa-magnifying-glass"></i> I lost something</button>
            <button type="button" class="btn secondary" data-cl="lf-post-found"><i class="fa-solid fa-hand-holding-hand"></i> I found something</button>
        </div>

        <div class="safety-note"><i class="fa-solid fa-shield-halved"></i>
            <span><strong>Stay safe:</strong> meet in busy campus spots or hand found items to security or the admin office. Ask the owner to describe something only they would know, and avoid posting ID numbers or your home address.</span>
        </div>

        <div class="panel">
            <div class="lf-filters">
                <div class="seg">
                    ${[["all", `All`], ["lost", `Lost (${lost})`], ["found", `Found (${found})`], ["mine", "My posts"]].map(([value, label]) =>
                        `<button type="button" class="${lfFilter === value ? "active" : ""}" data-cl="lf-filter" data-val="${value}">${label}</button>`).join("")}
                </div>
                <input id="lfSearch" type="search" placeholder="Search items, places…" value="${esc(lfSearch)}" aria-label="Search lost and found">
                <select id="lfCategory" aria-label="Filter by category">
                    <option value="">All categories</option>
                    ${LF_CATEGORIES.map(c => `<option ${c === lfCategory ? "selected" : ""}>${esc(c)}</option>`).join("")}
                </select>
            </div>
            <div id="lfList">${lfListHTML()}</div>
        </div>
    `;
}


function resizeImage(file, max = 480) {

    return new Promise((resolve, reject) => {

        const image = new Image();
        const url = URL.createObjectURL(file);

        image.onload = () => {
            URL.revokeObjectURL(url);

            const scale = Math.min(1, max / Math.max(image.width, image.height));
            const canvas = document.createElement("canvas");

            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

            let quality = 0.72;
            let output = canvas.toDataURL("image/jpeg", quality);

            while (output.length > 140000 && quality > 0.3) {
                quality -= 0.1;
                output = canvas.toDataURL("image/jpeg", quality);
            }

            resolve(output);
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read that image."));
        };

        image.src = url;
    });
}


async function postLostFound(type) {

    const user = ctx.getUser();

    if (!user) {
        ctx.showToast("Sign in to post.", "error");
        return;
    }

    const values = await askForm({
        eyebrow: "LOST & FOUND",
        title: type === "lost" ? "Post a lost item" : "Post a found item",
        submit: "Post",
        fields: [
            { name: "title", label: type === "lost" ? "What did you lose?" : "What did you find?", required: true, max: 80, placeholder: "e.g. Black Casio calculator" },
            { name: "category", label: "Category", type: "select", options: LF_CATEGORIES },
            { name: "description", label: "Description (colour, brand, marks)", type: "textarea", max: 500, required: true },
            { name: "place", label: type === "lost" ? "Where did you last see it?" : "Where did you find it?", required: true, max: 80 },
            { name: "date", label: "Date", type: "date", required: true, value: todayISO() },
            { name: "photo", label: "Photo (optional)", type: "file" },
            { name: "contact", label: "How should people reach you?", required: true, max: 100, value: user.email || "", placeholder: "Email or phone number" },
            { name: "showName", label: "Show my name", type: "select", options: [{ value: "yes", label: "Yes, show my name" }, { value: "no", label: "No, post as Anonymous student" }] }
        ]
    });

    if (!values) return;

    let photo = "";
    const file = values.photo;

    if (file && file.size > 0) {

        if (!String(file.type).startsWith("image/") || file.size > 15 * 1024 * 1024) {
            ctx.showToast("Please choose an image under 15 MB.", "error");
            return;
        }

        try {
            photo = await resizeImage(file);
        } catch (error) {
            ctx.showToast(error.message, "error");
            return;
        }
    }

    const reference = doc(collection(ctx.db, "lostfound"));

    const post = {
        type,
        title: values.title.trim().slice(0, 80),
        category: values.category,
        description: values.description.trim().slice(0, 500),
        place: values.place.trim().slice(0, 80),
        date: values.date,
        contact: values.contact.trim().slice(0, 100),
        posterName: values.showName === "no" ? "Anonymous student" : String(ctx.getDisplayName()).slice(0, 40),
        status: "open",
        uid: user.uid,
        createdAt: serverTimestamp()
    };

    if (photo) post.photo = photo;

    try {
        await setDoc(reference, post);
        lfFilter = "all";
        ctx.showToast(type === "lost" ? "Posted. We hope it turns up soon." : "Posted. Thanks for helping a fellow student.", "success");
    } catch (error) {
        console.error("Lost & found post failed:", error);
        ctx.showToast("Could not post. Check your connection and that the latest rules are published.", "error");
    }
}


async function lfToggleResolved(id) {

    const post = lfPosts.find(p => p.id === id);

    if (!post || post.uid !== ctx.getUser()?.uid) return;

    try {
        await setDoc(doc(ctx.db, "lostfound", id), { status: post.status === "resolved" ? "open" : "resolved" }, { merge: true });
    } catch (error) {
        console.error(error);
        ctx.showToast("Could not update the post.", "error");
    }
}


async function lfDelete(id) {

    const post = lfPosts.find(p => p.id === id);

    if (!post || post.uid !== ctx.getUser()?.uid) return;

    if (!window.confirm("Delete this post for everyone?")) return;

    try {
        await deleteDoc(doc(ctx.db, "lostfound", id));
        ctx.showToast("Post deleted.", "success");
    } catch (error) {
        console.error(error);
        ctx.showToast("Could not delete the post.", "error");
    }
}


async function lfReport(id) {

    const user = ctx.getUser();

    if (!user) return;

    const values = await askForm({
        eyebrow: "LOST & FOUND",
        title: "Report this post",
        submit: "Report",
        fields: [{ name: "reason", label: "What's wrong with it?", type: "select", options: LF_REPORT_REASONS }]
    });

    if (!values) return;

    try {
        await setDoc(doc(ctx.db, "lfreports", `${id}_${user.uid}`), {
            postId: id, uid: user.uid, reason: values.reason, createdAt: serverTimestamp()
        });
    } catch (error) {
        console.warn("Report could not be sent:", error);
    }

    rememberReported(id);
    refreshLostFound();
    ctx.showToast("Thanks. The post is hidden for you and flagged for review.", "success");
}


async function shareText({ title, text, url }) {

    try {
        if (navigator.share) {
            await navigator.share({ title, text, url });
            return;
        }
    } catch (error) {
        if (error?.name === "AbortError") return;
    }

    try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        ctx.showToast("Link copied. Paste it into WhatsApp, Telegram or a group chat.", "success");
    } catch {
        ctx.showToast(`Copy this link: ${url}`, "success");
    }
}


function lfShare(id) {

    const post = lfPosts.find(p => p.id === id);

    if (!post) return;

    const url = `${location.origin}${location.pathname}?page=campus&tab=lostfound&post=${encodeURIComponent(id)}`;

    shareText({
        title: `${post.type === "lost" ? "LOST" : "FOUND"}: ${post.title}`,
        text: `${post.type === "lost" ? "LOST" : "FOUND"}: ${post.title} (${post.place}, ${fmtDate(post.date)}). Do you know anything? Details on CampusConnect:`,
        url
    });
}


function refreshLostFound() {

    if (activeTab !== "lostfound") return;

    const list = document.getElementById("lfList");

    if (list) list.innerHTML = lfListHTML();
    else renderAll();
}


function flashDeepLinkPost() {

    if (!deepPost || activeTab !== "lostfound") return;

    const card = [...document.querySelectorAll(".lf-card")].find(el => el.dataset.post === deepPost);

    if (!card) return;

    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 2500);
    deepPost = null;
}


/* =====================================================
   CAFETERIA (published by staff, updates live)
   ===================================================== */

const MEALS = [
    { id: "breakfast", label: "Breakfast", icon: "fa-mug-saucer" },
    { id: "lunch", label: "Lunch", icon: "fa-bowl-food" },
    { id: "dinner", label: "Dinner", icon: "fa-utensils" }
];

let menus = {};
let menuDay = "today";
let isAdmin = false;
let menuLoaded = false;


function mealNow() {

    const hours = new Date().getHours() + new Date().getMinutes() / 60;

    return hours < 10.5 ? "breakfast" : hours < 15.5 ? "lunch" : "dinner";
}


function menuDate() {
    return menuDay === "today" ? todayISO() : plusDays(todayISO(), 1);
}


function menuMoney(menu, value) {

    return `${menu?.currency || currency()}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}


function parseMenuLines(text) {

    return String(text || "")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 40)
        .map(line => {
            const match = line.match(/^(.*\S)\s+[-–|]\s*(?:[A-Za-z$€£]{0,4}\s*)?(\d+(?:[.,]\d+)?)\s*$/);
            if (match) return { name: match[1].slice(0, 80), price: Number(match[2].replace(",", ".")) };
            return { name: line.slice(0, 80) };
        });
}


function menuLinesText(items) {

    return (items || []).map(item => item.price !== undefined && item.price !== null ? `${item.name} - ${item.price}` : item.name).join("\n");
}


function renderCafeteria() {

    const date = menuDate();
    const menu = menus[date];
    const isToday = menuDay === "today";
    const now = mealNow();
    const updated = menu?.updatedAt?.toDate ? menu.updatedAt.toDate().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    const uid = ctx.getUser()?.uid || "";

    return `
        <div class="cl-actions">
            <div class="seg">
                <button type="button" class="${isToday ? "active" : ""}" data-cl="menu-day" data-val="today">Today</button>
                <button type="button" class="${!isToday ? "active" : ""}" data-cl="menu-day" data-val="tomorrow">Tomorrow</button>
            </div>
            ${isAdmin ? `<button type="button" class="btn primary" data-cl="menu-edit"><i class="fa-solid fa-pen-to-square"></i> ${menu ? "Edit" : "Publish"} ${isToday ? "today's" : "tomorrow's"} menu</button>` : ""}
        </div>

        ${menu ? `
            <div class="live-line"><span class="live-dot"></span> Live menu for ${esc(fmtDate(date))}${updated ? ` · updated ${esc(updated)}` : ""}</div>
            ${menu.note ? `<div class="safety-note info"><i class="fa-solid fa-circle-info"></i><span>${esc(menu.note)}</span></div>` : ""}
            <div class="menu-grid">
                ${MEALS.map(meal => {

                    const items = (menu.meals?.[meal.id] || []);

                    return `
                        <div class="panel menu-card ${isToday && meal.id === now ? "now" : ""}">
                            <div class="panel-head"><div><p class="eyebrow">${meal.label.toUpperCase()}</p><h3><i class="fa-solid ${meal.icon}"></i> ${meal.label}</h3></div>${isToday && meal.id === now ? `<span class="cl-badge present">Now serving</span>` : ""}</div>
                            ${items.length ? items.map(item => `
                                <div class="cl-row">
                                    <div><strong>${esc(item.name)}</strong></div>
                                    ${item.price !== undefined && item.price !== null ? `<b>${esc(menuMoney(menu, item.price))}</b>
                                    <button type="button" class="icon-btn small" data-cl="menu-spend" data-name="${esc(item.name)}" data-price="${esc(item.price)}" aria-label="Add ${esc(item.name)} to my budget" title="Add to my budget"><i class="fa-solid fa-wallet"></i></button>` : ""}
                                </div>`).join("") : `<p class="cl-muted">Nothing listed.</p>`}
                        </div>`;
                }).join("")}
            </div>
        ` : (menuLoaded ? emptyState("fa-utensils", isToday ? "Today's menu hasn't been posted yet" : "Tomorrow's menu isn't up yet", "Cafeteria staff publish the menu here and it updates live. Check back soon.") : `<p class="cl-muted">Loading menu…</p>`)}

        <details class="panel admin-help">
            <summary>I manage the cafeteria menu</summary>
            <p>Only approved staff can publish menus. To approve an account, open the Firebase Console, go to <strong>Firestore Database</strong>, create a collection named <strong>admins</strong>, and add a document whose ID is that person's user ID:</p>
            <div class="uid-row"><code>${esc(uid)}</code><button type="button" class="btn secondary compact" data-cl="copy-uid"><i class="fa-regular fa-copy"></i> Copy my ID</button></div>
            <p class="cl-muted">After that, sign in again and the Publish button appears.</p>
        </details>
    `;
}


async function editMenu() {

    if (!isAdmin) return;

    const date = menuDate();
    const existing = menus[date];

    const values = await askForm({
        eyebrow: "CAFETERIA",
        title: `${menuDay === "today" ? "Today's" : "Tomorrow's"} menu`,
        submit: "Publish",
        fields: [
            { name: "breakfast", label: "Breakfast (one item per line, optional price after a dash)", type: "textarea", max: 800, value: menuLinesText(existing?.meals?.breakfast) },
            { name: "lunch", label: "Lunch", type: "textarea", max: 800, value: menuLinesText(existing?.meals?.lunch) },
            { name: "dinner", label: "Dinner", type: "textarea", max: 800, value: menuLinesText(existing?.meals?.dinner) },
            { name: "note", label: "Notice (optional)", max: 200, value: existing?.note, placeholder: "e.g. Vegetarian option available at Block C" },
            { name: "currency", label: "Currency symbol", max: 4, value: existing?.currency || currency() }
        ]
    });

    if (!values) return;

    try {
        await setDoc(doc(ctx.db, "menus", date), {
            date,
            meals: {
                breakfast: parseMenuLines(values.breakfast),
                lunch: parseMenuLines(values.lunch),
                dinner: parseMenuLines(values.dinner)
            },
            note: (values.note || "").trim().slice(0, 200),
            currency: (values.currency || "").trim().slice(0, 4),
            updatedBy: String(ctx.getDisplayName()).slice(0, 40),
            updatedAt: serverTimestamp()
        });
        ctx.showToast("Menu published. Students see it instantly.", "success");
    } catch (error) {
        console.error("Menu publish failed:", error);
        ctx.showToast("Could not publish. Make sure this account is approved and the latest rules are published.", "error");
    }
}


function subscribeMenus() {

    live.menuUnsubs.forEach(unsub => unsub());
    live.menuUnsubs = [];
    menus = {};
    menuLoaded = false;
    live.menuDate = todayISO();

    [live.menuDate, plusDays(live.menuDate, 1)].forEach(date => {
        try {
            live.menuUnsubs.push(onSnapshot(
                doc(ctx.db, "menus", date),
                snapshot => {
                    if (snapshot.exists()) menus[date] = snapshot.data({ serverTimestamps: "estimate" });
                    else delete menus[date];

                    menuLoaded = true;

                    if (activeTab === "cafeteria") renderAll();
                    else renderAgenda();
                },
                error => {
                    console.warn("Menu listener error:", error?.code || error);
                    menuLoaded = true;
                    if (activeTab === "cafeteria") renderAll();
                }
            ));
        } catch (error) {
            console.warn("Could not listen for menus:", error);
        }
    });
}


/* =====================================================
   SUPPORT: MENTAL WELLBEING
   ===================================================== */

const SUPPORT_TEMPLATES = [
    "Hey, I'm having a really rough day and could use someone to talk to. Are you free?",
    "I've been feeling overwhelmed lately. Can we chat or meet up soon?",
    "Could you check in on me later today? I'd really appreciate it.",
    "Hi, I'd like to book a time to talk with someone. Could you tell me how?"
];

const JOURNAL_PROMPTS = [
    "What is one thing that went okay today, however small?",
    "What is weighing on your mind right now? Write it out without judging it.",
    "Who or what made you feel supported this week?",
    "What would you say to a friend who felt the way you do today?",
    "What is one small thing you can do today to look after yourself?",
    "What are you proud of yourself for lately?",
    "What do you need more of, and less of, right now?",
    "Describe a place where you feel calm. What do you notice there?"
];

const SUPPORT_TIPS = [
    { title: "Exam stress", points: ["Break revision into 25-minute blocks with short breaks (the focus timer on your dashboard helps).", "Sleep protects memory. A full night usually beats a last all-nighter.", "Write the worst-case outcome and one concrete next step. Worries shrink when they have a plan.", "Talk to your lecturer or a counsellor early if you feel you're falling behind."] },
    { title: "Can't sleep", points: ["Keep a steady wake-up time, even after a bad night.", "Put screens away 30 minutes before bed and note down tomorrow's worries on paper.", "Try the breathing exercise above, slowly, for a few minutes.", "If poor sleep lasts weeks, speak to a health professional."] },
    { title: "Feeling lonely or homesick", points: ["Say yes to one small thing this week: a club meeting, a study group, a meal with someone.", "Schedule regular calls with people from home.", "Many students feel this, especially early on. It usually eases with small, repeated connections."] },
    { title: "Burnout and overload", points: ["List everything on your plate, then mark what is urgent, what can wait and what you can drop or ask for help with.", "Protect one block of real rest each day.", "Ask for extensions or support before the deadline, not after."] },
    { title: "Supporting a friend", points: ["Ask directly and kindly how they are, then listen without trying to fix everything.", "Encourage them to speak to a counsellor or someone they trust, and offer to go along.", "If you think someone may be in danger, contact campus security or local emergency services right away."] }
];

let supportTemplate = 0;
let breathing = false;
let breathTimer = null;


function stopBreathing() {

    breathing = false;
    clearTimeout(breathTimer);

    const circle = document.getElementById("breathCircle");
    const text = document.getElementById("breathText");
    const button = document.getElementById("breathBtn");

    if (circle) circle.style.transform = "scale(1)";
    if (text) text.textContent = "Ready when you are";
    if (button) button.textContent = "Start";
}


function startBreathing() {

    const phases = [["Breathe in…", 1.45], ["Hold", 1.45], ["Breathe out…", 1], ["Hold", 1]];
    let index = 0;

    breathing = true;

    const button = document.getElementById("breathBtn");
    if (button) button.textContent = "Stop";

    const step = () => {

        const circle = document.getElementById("breathCircle");
        const text = document.getElementById("breathText");

        if (!breathing || !circle || !text) {
            stopBreathing();
            return;
        }

        const [label, scale] = phases[index % phases.length];

        circle.style.transform = `scale(${scale})`;
        text.textContent = label;
        index++;
        breathTimer = setTimeout(step, 4000);
    };

    step();
}


function lowMoodNudge() {

    const recent = data.wellness.filter(w => w.mood > 0).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 3);

    return recent.length === 3 && recent.every(w => w.mood <= 2);
}


function renderSupport() {

    const circle = data.contacts.filter(c => c.kind === "support");
    const prompt = JOURNAL_PROMPTS[Math.floor(Date.now() / 86400000) % JOURNAL_PROMPTS.length];
    const entries = [...data.journal].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 5);
    const message = SUPPORT_TEMPLATES[supportTemplate];

    return `
        <div class="support-hero">
            <h3>You don't have to carry everything alone</h3>
            <p>Reaching out is a strong thing to do. Use this space to check in with yourself, calm down, or contact someone you trust.</p>
            <div class="crisis">
                <strong><i class="fa-solid fa-triangle-exclamation"></i> If you or someone else is in immediate danger, call your local emergency number now.</strong>
                <p>If you're thinking about suicide or self-harm, please contact a crisis line right away. These sites list free, confidential helplines by country.</p>
                <div class="chip-row">
                    <a class="btn primary compact" href="https://findahelpline.com" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-phone-volume"></i> Find a helpline</a>
                    <a class="btn secondary compact" href="https://www.befrienders.org" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-heart"></i> Befrienders Worldwide</a>
                </div>
            </div>
        </div>

        ${lowMoodNudge() ? `<div class="safety-note info"><i class="fa-solid fa-hand-holding-heart"></i><span>Your mood check-ins have been low for a few days. That's worth taking seriously. Consider talking to someone in your support circle below or a campus counsellor.</span></div>` : ""}

        <div class="cl-grid">
            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">REACH OUT</p><h3>My support circle</h3></div><button type="button" class="text-btn" data-cl="add-support">Add</button></div>
                <p class="setting-label">Choose a message</p>
                <div class="template-list">${SUPPORT_TEMPLATES.map((t, i) => `
                    <button type="button" class="template ${i === supportTemplate ? "on" : ""}" data-cl="support-template" data-val="${i}">${esc(t)}</button>`).join("")}
                </div>
                ${circle.length ? circle.map(c => `
                    <div class="cl-row">
                        <span class="cl-icon"><i class="fa-solid fa-heart"></i></span>
                        <div><strong>${esc(c.name)}</strong><span>${esc(c.phone || "No number yet")}${c.note ? " · " + esc(c.note) : ""}</span></div>
                        ${c.phone ? `<a class="btn secondary compact" href="sms:${esc(String(c.phone).replace(/[^\d+]/g, ""))}?&body=${encodeURIComponent(message)}">Text</a>
                        <a class="btn primary compact" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}">Call</a>` : ""}
                        <button type="button" class="icon-btn small" data-cl="del" data-sub="contacts" data-id="${esc(c.id)}" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
                    </div>`).join("") : `<p class="cl-muted">Add a counsellor, trusted friend or family member so help is one tap away, even offline.</p>
                    <div class="chip-row">${["Campus counsellor", "Trusted friend", "Family member", "Health clinic"].map(s => `<button type="button" class="chip" data-cl="suggest-support" data-name="${esc(s)}">+ ${esc(s)}</button>`).join("")}</div>`}
                <div class="chip-row"><button type="button" class="btn secondary compact" data-cl="support-share"><i class="fa-solid fa-share-nodes"></i> Send this message via another app</button></div>
            </div>

            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">CALM DOWN</p><h3>Box breathing</h3></div></div>
                <div class="breath-wrap">
                    <div class="breath-circle" id="breathCircle"></div>
                    <p id="breathText" class="breath-text" aria-live="polite">Ready when you are</p>
                </div>
                <p class="cl-muted center">Breathe in for 4, hold for 4, out for 4, hold for 4. Repeat a few times.</p>
                <div class="cl-actions center"><button type="button" class="btn primary" id="breathBtn" data-cl="breath-toggle">Start</button></div>

                <div class="panel-head" style="margin-top:22px"><div><p class="eyebrow">GROUNDING</p><h3>5-4-3-2-1</h3></div></div>
                <ol class="ground-list">
                    <li><strong>5</strong> things you can see</li>
                    <li><strong>4</strong> things you can touch</li>
                    <li><strong>3</strong> things you can hear</li>
                    <li><strong>2</strong> things you can smell</li>
                    <li><strong>1</strong> thing you can taste</li>
                </ol>
            </div>
        </div>

        <div class="cl-grid">
            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">PRIVATE JOURNAL</p><h3>Today's reflection</h3></div></div>
                <p class="journal-prompt">${esc(prompt)}</p>
                <textarea id="journalText" class="journal-input" rows="4" maxlength="2000" placeholder="Write freely. Only you can see this." aria-label="Journal entry"></textarea>
                <div class="cl-actions"><button type="button" class="btn primary" data-cl="journal-save" data-prompt="${esc(prompt)}"><i class="fa-solid fa-floppy-disk"></i> Save entry</button></div>
                ${entries.length ? entries.map(entry => `
                    <div class="cl-row stack journal-entry">
                        <div class="cl-top"><small>${esc(fmtDate(entry.date))}</small><button type="button" class="icon-btn small" data-cl="del" data-sub="journal" data-id="${esc(entry.id)}" aria-label="Delete entry"><i class="fa-solid fa-trash"></i></button></div>
                        <p class="journal-text">${esc(entry.text)}</p>
                    </div>`).join("") : ""}
            </div>

            <div class="panel">
                <div class="panel-head"><div><p class="eyebrow">SELF-HELP</p><h3>Quick guides</h3></div></div>
                ${SUPPORT_TIPS.map(tip => `
                    <details class="tip">
                        <summary>${esc(tip.title)}</summary>
                        <ul>${tip.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
                    </details>`).join("")}
                <p class="cl-muted">This space offers self-help and ways to reach people. It isn't a substitute for professional care.</p>
            </div>
        </div>
    `;
}


function supportShare() {

    shareText({
        title: "Checking in",
        text: SUPPORT_TEMPLATES[supportTemplate],
        url: ""
    });
}


/* =====================================================
   LIVE SUBSCRIPTIONS
   ===================================================== */

function stopLive() {

    live.unsubs.forEach(unsub => unsub());
    live.menuUnsubs.forEach(unsub => unsub());
    live.unsubs = [];
    live.menuUnsubs = [];
    live.menuDate = null;

    lfPosts = [];
    lfLoaded = false;
    lfError = false;
    menus = {};
    menuLoaded = false;
    isAdmin = false;
}


function startLive(user) {

    stopLive();

    try {
        live.unsubs.push(onSnapshot(
            query(collection(ctx.db, "lostfound"), orderBy("createdAt", "desc"), limit(100)),
            snapshot => {
                lfPosts = snapshot.docs.map(item => ({ ...item.data({ serverTimestamps: "estimate" }), id: item.id }));
                lfLoaded = true;
                lfError = false;
                refreshLostFound();
                flashDeepLinkPost();
            },
            error => {
                console.warn("Lost & found listener error:", error?.code || error);
                lfLoaded = true;
                lfError = true;
                refreshLostFound();
            }
        ));
    } catch (error) {
        console.warn("Could not listen for lost & found:", error);
        lfLoaded = true;
        lfError = true;
    }

    subscribeMenus();

    getDoc(doc(ctx.db, "admins", user.uid))
        .then(snapshot => {
            isAdmin = snapshot.exists();
            if (activeTab === "cafeteria") renderAll();
        })
        .catch(() => { isAdmin = false; });
}


/* =====================================================
   RENDERING & WIRING
   ===================================================== */

const RENDERERS = {
    attendance: renderAttendance,
    exams: renderExams,
    library: renderLibrary,
    budget: renderBudget,
    cafeteria: renderCafeteria,
    lostfound: renderLostFound,
    services: renderServices,
    wellness: renderWellness,
    events: renderEvents,
    support: renderSupport
};


function renderTabs() {

    const bar = document.getElementById("clTabs");

    if (!bar) return;

    bar.innerHTML = TABS.map(tab => `
        <button type="button" class="cl-tab ${tab.id === activeTab ? "active" : ""}" data-cl-tab="${tab.id}" role="tab" aria-selected="${tab.id === activeTab}">
            <i class="fa-solid ${tab.icon}"></i><span>${tab.label}</span>
        </button>`).join("");
}


function renderAll() {

    if (!ctx) return;

    renderTabs();

    const body = document.getElementById("clBody");

    if (body) body.innerHTML = RENDERERS[activeTab]();

    if (breathing) {
        if (activeTab === "support") startBreathing();
        else stopBreathing();
    }

    renderAgenda();

    ctx.onChange?.();
}


function setTab(tab) {

    if (!RENDERERS[tab]) return;

    if (tab !== activeTab) stopBreathing();

    activeTab = tab;

    try {
        sessionStorage.setItem("campusconnect_cl_tab", tab);
    } catch {
        /* ignore */
    }

    renderAll();
}


export function openCampusTab(tab) {

    setTab(tab);
    ctx.navigateTo("campus");
}


function handleAction(button) {

    const { cl: action, id, sub } = button.dataset;
    const classes = ctx.getClasses();

    switch (action) {
        case "mark": {
            const cls = classes.find(c => c.id === button.dataset.class);
            if (cls) markAttendance(cls, button.dataset.status);
            break;
        }
        case "log-past": logPastClass(); break;
        case "del": remove(sub, id); break;
        case "add-exam": editExam(); break;
        case "edit-exam": editExam(id); break;
        case "add-loan": addLoan(); break;
        case "renew": renewLoan(id); break;
        case "return": {
            const loan = data.loans.find(l => l.id === id);
            if (loan) upsert("loans", { ...loan, returned: true });
            break;
        }
        case "add-expense": addTransaction("expense"); break;
        case "add-income": addTransaction("income"); break;
        case "set-budget": setBudget(); break;
        case "add-bill": addBill(); break;
        case "pay-bill": {
            const bill = data.bills.find(b => b.id === id);
            if (bill) upsert("bills", { ...bill, paid: true });
            break;
        }
        case "clear-paid":
            data.bills.filter(b => b.paid).forEach(b => remove("bills", b.id));
            break;
        case "add-contact": addContact(); break;
        case "suggest-contact": addContact(button.dataset.name); break;
        case "add-link": addLink(); break;
        case "suggest-link": addLink(button.dataset.name); break;
        case "add-place": addPlace(); break;
        case "suggest-place": addPlace(button.dataset.name); break;
        case "add-shuttle": addShuttle(); break;
        case "mood": {
            const entry = wellnessFor(todayISO());
            saveWellness({ ...entry, mood: entry.mood === Number(button.dataset.val) ? 0 : Number(button.dataset.val) });
            break;
        }
        case "water-inc": { const entry = wellnessFor(todayISO()); saveWellness({ ...entry, water: entry.water + 1 }); break; }
        case "water-dec": { const entry = wellnessFor(todayISO()); saveWellness({ ...entry, water: entry.water - 1 }); break; }
        case "habit": {
            const entry = wellnessFor(todayISO());
            const done = entry.done.includes(id) ? entry.done.filter(h => h !== id) : [...entry.done, id];
            saveWellness({ ...entry, done });
            break;
        }
        case "add-event": addEvent(); break;
        case "rsvp": {
            const event = data.events.find(e => e.id === id);
            if (event) upsert("events", { ...event, going: !event.going });
            break;
        }
        case "clear-past-events":
            data.events.filter(e => ctx.daysUntil(e.date) < 0).forEach(e => remove("events", e.id));
            break;
        case "lf-post-lost": postLostFound("lost"); break;
        case "lf-post-found": postLostFound("found"); break;
        case "lf-filter": lfFilter = button.dataset.val; renderAll(); break;
        case "lf-toggle-resolved": lfShowResolved = !lfShowResolved; refreshLostFound(); break;
        case "lf-resolve": lfToggleResolved(id); break;
        case "lf-delete": lfDelete(id); break;
        case "lf-report": lfReport(id); break;
        case "lf-share": lfShare(id); break;
        case "menu-day": menuDay = button.dataset.val; renderAll(); break;
        case "menu-edit": editMenu(); break;
        case "menu-spend": {
            const amount = Number(button.dataset.price);
            if (Number.isFinite(amount) && amount > 0) {
                upsert("expenses", { id: ctx.newId("expenses"), type: "expense", amount, category: "Food", date: todayISO(), note: button.dataset.name.slice(0, 80) });
                ctx.showToast(`${button.dataset.name} added to your budget.`, "success");
            }
            break;
        }
        case "copy-uid":
            navigator.clipboard?.writeText(ctx.getUser()?.uid || "").then(
                () => ctx.showToast("User ID copied.", "success"),
                () => ctx.showToast("Could not copy. Select the ID and copy it manually.", "error")
            );
            break;
        case "add-support": addContact("", "support"); break;
        case "suggest-support": addContact(button.dataset.name, "support"); break;
        case "support-template": supportTemplate = Number(button.dataset.val) || 0; renderAll(); break;
        case "support-share": supportShare(); break;
        case "breath-toggle": if (breathing) stopBreathing(); else startBreathing(); break;
        case "journal-save": {
            const box = document.getElementById("journalText");
            const text = (box?.value || "").trim().slice(0, 2000);
            if (!text) { ctx.showToast("Write a few words first.", "error"); break; }
            upsert("journal", { id: ctx.newId("journal"), date: todayISO(), prompt: String(button.dataset.prompt || "").slice(0, 200), text });
            ctx.showToast("Saved privately to your account.", "success");
            break;
        }
        default: break;
    }
}


export function initCampus(context) {

    ctx = context;

    try {
        activeTab = sessionStorage.getItem("campusconnect_cl_tab") || "attendance";
    } catch {
        activeTab = "attendance";
    }

    const params = new URLSearchParams(location.search);

    if (RENDERERS[params.get("tab")]) activeTab = params.get("tab");

    deepPost = params.get("post");

    if (!RENDERERS[activeTab]) activeTab = "attendance";

    initializeFormDialog();

    document.getElementById("campusPage")?.addEventListener("click", event => {

        const tab = event.target.closest("[data-cl-tab]");

        if (tab) {
            setTab(tab.dataset.clTab);
            return;
        }

        const button = event.target.closest("[data-cl]");

        if (button) handleAction(button);
    });

    const page = document.getElementById("campusPage");

    page?.addEventListener("input", event => {
        if (event.target.id === "lfSearch") {
            lfSearch = event.target.value;
            refreshLostFound();
        }
    });

    page?.addEventListener("change", event => {
        if (event.target.id === "lfCategory") {
            lfCategory = event.target.value;
            refreshLostFound();
        }
    });

    setInterval(() => {
        if (ctx.getUser() && live.menuDate && live.menuDate !== todayISO()) subscribeMenus();
    }, 60000);

    document.getElementById("todayAgenda")?.addEventListener("click", event => {

        if (event.target.closest("[data-agenda-water]")) {
            const entry = wellnessFor(todayISO());
            saveWellness({ ...entry, water: entry.water + 1 });
            return;
        }

        const row = event.target.closest("[data-agenda-tab]");

        if (row) openCampusTab(row.dataset.agendaTab);
    });

    document.getElementById("remindersBtn")?.addEventListener("click", toggleReminders);

    updateReminderUI();
    setInterval(checkReminders, 60000);
    setTimeout(checkReminders, 4000);

    renderAll();
}


export async function campusLoad(user) {

    await Promise.all(SUBS.map(async sub => {
        try {
            data[sub] = await ctx.cloudLoadList(user, sub, []);
        } catch (error) {
            console.warn(`Could not load ${sub}:`, error);
            data[sub] = [];
        }
    }));

    startLive(user);
    renderAll();
    checkReminders();
}


export function campusReset() {

    SUBS.forEach(sub => { data[sub] = []; });

    stopBreathing();
    stopLive();

    if (ctx) renderAll();
}
