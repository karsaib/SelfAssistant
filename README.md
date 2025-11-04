TaskManager Kanban

A small HTML + Node.js + Express based task manager that:

stores tasks in a local JSON file (no database needed),

shows them on a kanban board,

supports drag & drop between status columns,

can sync tasks to Google Calendar (create/update/delete events),

and can embed your Google Calendar in the UI.

Designed to start simple (file storage) and grow iteratively (Google API, calendar, packaging).

Features

✅ 4-column kanban board:

COMING – future / not yet active tasks

PROGRESS – tasks that are currently active (server can auto-move COMING → PROGRESS when the date range matches today)

OVERDUE – tasks where the end date/time is already in the past

DONE – completed tasks

✅ Drag & drop between columns → sends a PUT /api/tasks/:id with just {status: ...}

this does not trigger Google Calendar sync → so Calendar errors won’t break your kanban

✅ New / Edit / Delete task form

✅ Date + time support (start date/time, end date/time, all-day, due date)

✅ Free-text tag field → shown on the sticky note

✅ File-based storage (tasks.json) → good for quick hosting / local testing

✅ Google OAuth2 connect (/auth/google) → stores token in google_token.json

✅ Google Calendar sync (insert / update / delete) – best effort, won’t kill the app if token expires

✅ Calendar ID is configurable via .env

✅ Google Calendar embed in the UI (iframe)

✅ Works on Linux and Windows (plain node server.js)

Architecture overview
Browser (index.html + app.js)
   |
   |  REST (JSON)
   v
Node.js + Express (server.js)
   |
   +-- tasks.json     (file storage)
   |
   +-- google_token.json  (OAuth token from Google)
   |
   +-- Google Calendar API (insert/update/delete events)


Frontend: pure HTML/JS, no framework required.

Backend: single server.js

serves static files from public/

exposes REST endpoints under /api/tasks

handles Google OAuth under /auth/google and /oauth2callback

does the kanban auto-status update on load

Status logic

The app uses 4 main statuses:

coming

progress

overdue

done

On the server side we do an extra step:

When you load tasks (GET /api/tasks), the server checks every task:

if it is currently in coming and today is inside its date range → it is auto-upgraded to progress and the file is saved.

done stays done

overdue stays overdue

progress stays progress

This way you don’t have to manually drag “today’s” tasks – the backend does it.

Endpoints
GET /api/tasks

Returns all tasks from tasks.json.
Side effect: if a task is coming but today is in its interval → it is updated to progress and saved.

POST /api/tasks

Create a new task.

Sample body:

{
  "title": "Call client",
  "notes": "Discuss contract",
  "tag": "Work",
  "allDay": false,
  "startDate": "2025-11-02",
  "startTime": "10:00",
  "endDate": "2025-11-02",
  "endTime": "11:00",
  "status": "coming"
}


Creates it in file

Tries to create a Google Calendar event (if auth is set up)

Returns the created task

PUT /api/tasks/:id

Update an existing task.
Important rule:

if you update content/time fields (title, notes, tag, done, startDate, startTime, endDate, endTime, due, allDay) → we do sync to Google Calendar (safely)

if you update only status (e.g. drag & drop) → we do NOT call Calendar → this makes drag & drop safe even if your Google token is expired

DELETE /api/tasks/:id

Delete task from file and (best-effort) from calendar.

Google Calendar integration

You set up OAuth client in Google Cloud Console.

You put Client ID, Secret, Redirect URI into .env.

You visit http://localhost:3000/auth/google.

You grant the Calendar permission.

The server saves your tokens into google_token.json.

From this point, creating/updating/deleting tasks can create/update/delete Google Calendar events in the calendar defined by GOOGLE_CALENDAR_ID (default: primary).

If the token later becomes invalid (invalid_grant):
the server catches it and continues → tasks are still saved to file.

Requirements

Node.js ≥ 18

npm (for installing deps like express and googleapis)

A Google Cloud project (if you want Calendar sync)

A writable directory for tasks.json and google_token.json

Installation
git clone https://github.com/your-user/taskmanager-kanban.git
cd taskmanager-kanban

# install dependencies
npm install

Configuration

Create a .env file in the project root:

PORT=3000

# from Google Cloud Console → OAuth 2.0 Client ID
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET

# must match the redirect URI in Google Console
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback

# which calendar to write to
GOOGLE_CALENDAR_ID=primary

# optional: where to store tasks.json and google_token.json
DATA_DIR=./


Important: the redirect URI in Google Console must match exactly:

http://localhost:3000/oauth2callback

Running
npm start
# or
node server.js


Then open:

App UI: http://localhost:3000/

Google auth: http://localhost:3000/auth/google

Project structure
.
├── public/
│   ├── index.html     ← Kanban UI + form + calendar embed
│   └── app.js         ← drag&drop, REST calls, auto-render
├── server.js          ← Express backend (file + Google)
├── tasks.json         ← created at runtime
├── google_token.json  ← created after auth
├── .env
└── package.json

File storage

Tasks are stored in JSON:

[
  {
    "id": "mabq6tfr...",
    "title": "Task 1",
    "notes": "Some notes",
    "tag": "Work",
    "allDay": false,
    "startDate": "2025-11-02",
    "startTime": "09:00",
    "endDate": "2025-11-02",
    "endTime": "10:00",
    "status": "progress",
    "googleEventId": "abcdefghijk"
  }
]


You can back up / edit this file manually if needed.

Auto-status rules (server-side)

On every GET /api/tasks the server:

Loads tasks.json

For every task:

if status is coming

and today is within its date range

→ change to progress

If any task changed → rewrite tasks.json

Return the list to the client

This ensures the board always reflects “what’s relevant today”.

Error handling

Google invalid_grant → logged as warning, but task is still saved.

Missing .env values → app still runs, but Calendar won’t.

File missing (tasks.json) → created on first save.

Packaging / hosting

You can run it on any server that has Node.js.

If you want to ship it where there is no npm, you can:

build a binary with pkg (Linux/Win) (adjust code for pkg paths – already partly done via IS_PKG)

or just copy the folder + node_modules

Security note

This example is not meant as production-ready auth.

The Google tokens are stored on disk in plain JSON.

Put the app behind auth or on a private network if you expose it.

Possible next steps

Add user accounts / sessions

Add search/filter by tag

Add column order persistence (per task)

Add WebSocket broadcast for multi-user

Add i18n (English/Hungarian switch)

License

MIT (or whatever you want — edit this section).
