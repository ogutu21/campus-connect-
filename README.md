# CampusConnect

CampusConnect is a Firebase-powered student campus dashboard with authentication, student registration, profile management, courses, assignments, schedule, announcements, study groups, academic progress, notifications, and responsive mobile support.

## Included

- `index.html` — main CampusConnect interface
- `style.css` — dashboard styling
- `script.js` — Firebase Authentication, Firestore, dashboard logic, login, registration, profile, courses and assignments
- `manifest.json` — PWA metadata
- `service-worker.js` — offline app-shell caching (network-first, so updates always arrive)
- `icon.svg` — app icon used by the PWA manifest
- `firestore.rules` — Firestore security rules

## Firebase setup

The project is already configured for the CampusConnect Firebase web app supplied during setup.

In Firebase Console, confirm:

1. Authentication → Sign-in method → Email/Password is enabled.
2. Firestore Database has been created.
3. The rules in `firestore.rules` are published to Firestore (they now validate field types and prevent users from changing their own `role`).
4. If using a deployed domain, add that domain under Authentication → Settings → Authorized domains.

## Run locally

Because `script.js` uses ES module imports, do not open `index.html` with `file://` directly.

### VS Code

Install/use Live Server, then right-click `index.html` → **Open with Live Server**.

### Python

From the CampusConnect folder:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`.

## Main flow

Login → Create Student Account → enter student details → Firebase Authentication account → Firestore student profile → CampusConnect dashboard.

## Firestore structure

```text
users/{uid}
users/{uid}/assignments/{assignmentId}
users/{uid}/courses/{courseId}
users/{uid}/classes/{classId}
users/{uid}/groups/{groupId}
users/{uid}/todos/{todoId}
users/{uid}/notes/{noteId}
users/{uid}/focus/{yyyy-mm-dd}
users/{uid}/settings/preferences
announcements/{id}        (read-only for signed-in users)
```

Student profile data includes name, student ID, programme, year of study, email, role, and account status.

## Important

The Firebase web API key in `script.js` is a client-side Firebase configuration value. Security is enforced through Firebase Authentication and Firestore Security Rules; never add Firebase Admin/service-account private keys to this frontend project.

## Features added in the upgrade

- Live schedule (add/delete classes, weekly grid, "next up" on the dashboard)
- Study groups you can create, join, leave and delete (saved per user)
- Notifications generated from your real deadlines and classes, with read state remembered
- Academic progress calculated from assignment completion per course
- Course deletion, focus panel, and safer optimistic updates with rollback

**After updating, republish `firestore.rules`** — the new `classes` and `groups` collections are denied until you do.

## Announcements

Real announcements are read from a top-level `announcements` collection (read-only for signed-in students).
Add documents in the Firebase Console with these fields:

| field | type | example |
| --- | --- | --- |
| `title` | string | Library hours extended |
| `body` | string | Open until midnight during exams. |
| `tag` | string | Library |
| `source` | string | University Library |
| `createdAt` | timestamp | (now) |

If the collection is empty or the rules are not yet published, the built-in announcements are shown instead.

## Dashboard (v2)

- Hero with a live day summary, completion ring and quick-add buttons (Assignment, Class, Start focus)
- Clickable KPI cards: courses, pending tasks, tasks completed, focus time today
- "Up next" list where you can tick assignments off directly
- 7-day workload chart (with a "Late" column for overdue work)
- Progress by course, calculated from assignment completion
- Focus timer (25/5/15 min) with daily focus minutes, day streak and a 150-minute weekly goal
- Month calendar showing deadlines and classes, with a detail view for the selected day
- To-do list for quick notes



## Version 3

**Everything is stored in Firestore** (to-dos, focus log, notes, grades, preferences, read notifications) and syncs across devices.
Firestore's offline cache is enabled, so your data opens and can be edited without a connection; changes sync automatically when you are back online.

**New**
- Notes (per course, searchable) and Grades & GPA (US 4.0 or Kenya/UK-style 70/60/50/40 scale, credit-weighted)
- Settings page: theme, animated background scenes (Aurora, Campus, Study doodles, Plain), motion on/off, weekly focus goal
- Global search / command palette: press `Ctrl K` (or `/`) anywhere
- Install as an app (Install button, banner, and help for iPhone/iPad) and app shortcuts (Assignments, Schedule, Notes, Focus timer)
- Offline: the app shell, Firebase SDK, fonts and icons are cached; an "Offline" pill shows when you lose connection; an "Update available" banner appears when a new version is ready
- Redesigned look: glass panels, animated hero, page transitions, page titles in the top bar

**Updating an existing copy**
1. Replace your project files with these (keep the folder structure, including `icons/`).
2. Publish the new `firestore.rules` in Firebase Console. Until you do, saving to-dos, notes, grades and settings will be denied.
3. Open the app and hard-refresh (Ctrl+Shift+R). If an older version keeps showing, open DevTools > Application > Service Workers > Unregister, then reload.
4. Serve over http (for example `py -m http.server 5500`), not by double-clicking `index.html`.

## Campus Life (everyday campus features)

All data is stored in Firestore under `users/{uid}/...` and works offline.

| Tab | What it does |
| --- | --- |
| Attendance | One-tap present/late/absent for today's classes, attendance % per class, "how many can I still miss" and a warning under 75% |
| Exams | Exam timetable with countdowns, venue and time |
| Library | Borrowed books with due dates, renew (+14 days) and returned |
| Budget | Monthly budget, expenses and income by category, spending breakdown, fees and bills with due dates |
| Services | Emergency/key contacts (tap to call), quick links, campus places (open in Maps), shuttle times with next departure |
| Wellness | Daily mood, water glasses, five habits with streaks, 14-day consistency view |
| Events | Clubs, sports, career fairs and socials with an "I'm going" toggle |

The dashboard has a **Today at a glance** panel combining classes, events, exams, library returns and bills. Exams, library, bills, events and low attendance also appear in Notifications.

**Reminders:** Settings > Reminders turns on browser notifications for classes starting in the next 15 minutes and for upcoming deadlines, exams, library returns and bills. They fire while CampusConnect is open (or the installed app is running). Notifications when the app is fully closed need a server (Firebase Cloud Functions + Cloud Messaging).

New Firestore collections (rules included): attendance, exams, loans, expenses, bills, budget, contacts, links, places, shuttle, wellness, events. **Republish `firestore.rules` after updating.**

## Lost & Found, Cafeteria and Support (Campus Life tabs)

**Lost & Found** is shared between all signed-in students and updates live.
- Post a lost or found item with category, description, place, date, an optional photo (resized to about 480px and stored in the post) and how to reach you. You can post under your name or as "Anonymous student".
- Filter by lost/found/my posts, search, and filter by category.
- **Share** uses your phone's share sheet (WhatsApp, Telegram, etc.) or copies a link that opens the post inside the app (`?page=campus&tab=lostfound&post=ID`).
- Only the author can mark a post as found/returned, reopen it, or delete it. Anyone can **report** a post: it is hidden for the reporter and a document is written to `lfreports` for staff to review in the Firebase Console.

**Cafeteria** shows today's and tomorrow's menu (breakfast, lunch, dinner, a notice, prices), highlights the meal being served now, and updates live. Tap the wallet icon on an item to add it to your budget.
- To let someone publish menus (and announcements), open the Firebase Console > Firestore > create a collection `admins` and add a document whose ID is that person's user ID. The user ID is shown, with a copy button, under "I manage the cafeteria menu" on the Cafeteria tab. After signing in again, that person sees a Publish button.
- Menu items are typed one per line, with an optional price after a dash, e.g. `Chapati & beans - 150`.

**Support** is a mental wellbeing space: a crisis banner with links to findahelpline.com and befrienders.org, a personal support circle (counsellor, friend, family) with pre-written messages you can text in one tap, box breathing, 5-4-3-2-1 grounding, a private journal with daily prompts, and short self-help guides. A gentle nudge appears if your mood check-ins stay low for three days. Journal entries are stored privately under your account.

New Firestore rules: `lostfound`, `lfreports`, `menus`, `admins` (top level) and `journal` (per user). **Republish `firestore.rules` after updating.**
