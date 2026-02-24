## New features (roadmap ideas)

### 🧠 Integrated Wiki (Markdown) inside the app
Add a built-in Wiki module for lightweight documentation and notes.

**Goals**
- Create/edit/delete Markdown pages from the UI
- Live Markdown preview (GFM)
- Store pages as files under `/docs/wiki/*.md` (or JSON)
- List pages with metadata (title, tags, updated timestamp)
- Open raw `.md` in a new tab

**Endpoints (example)**
- `GET /api/wiki-pages` → list pages + metadata
- `GET /api/wiki/:slug` → load page content
- `PUT /api/wiki/:slug` → save page content
- `DELETE /api/wiki/:slug` → delete page

**Nice-to-have**
- Search across wiki pages (title + content)
- Wiki links `[[some-page]]`
- Export / import (zip)

---

### ⚡ Active column on the Kanban board
Add a dedicated **ACTIVE** column to highlight what is currently being worked on.

**Proposed statuses**
- `coming`
- `active`  ← NEW
- `progress`
- `overdue`
- `done`

**Rules**
- Allow manual drag/drop into ACTIVE
- Optional server rule: auto-move `progress → active` when "today is inside range" and task has a flag like `autoActivate=true`

**Why**
- Separates “in progress (not started today)” from “actively being worked on now”
- Reduces noise in PROGRESS

---

### 🔢 Counters / badges (board-level metrics)
Add counters at the top of each column and a small summary bar.

**Examples**
- Column counters: `COMING (12)`, `ACTIVE (3)`, `PROGRESS (8)`, `OVERDUE (2)`, `DONE (40)`
- Summary: `Total: 65 | Due today: 4 | Overdue: 2 | Active: 3`

**Optional**
- “Done today” counter
- “This week” counter (Mon–Sun)

---

### ⏱️ Activity log (audit trail)
Track important actions for transparency.

**Log events**
- created / edited / deleted
- status change (drag/drop)
- calendar sync success/failure
- auto-move (coming → progress, progress → active)

**Storage**
- `activity.json` (append-only)
- Show last 50 events in UI

---

### 🏷️ Tag system upgrade (from free-text to structured tags)
Replace free-text tags with structured, multi-tag support.

**Features**
- Multiple tags per task: `tags: ["Work","Banking","Urgent"]`
- Tag filter chips (click to filter board)
- Tag suggestions / autocomplete
- Persist tag list (optional)

---

### 🔎 Search + filter panel
Add a lightweight search row.

**Search**
- title + notes
- tag
- date ranges (today / this week / custom)
- status multi-select

---

### ⏳ Auto-save draft (edit form)
Prevent losing form edits.

**Behavior**
- save as draft in `localStorage`
- “Restore draft?” prompt when reopening form

---

### 🗓️ Calendar sync diagnostics panel
Make calendar sync status visible and debuggable.

**Show**
- OAuth status (connected / expired / missing)
- last sync timestamp per task
- last error message
- button: “Re-auth Google”

---

### 📦 Export / Import
Make the app portable.

- Export tasks to `tasks_export.json`
- Import tasks (merge by id)
- Export selected tasks (filtered subset)

---

### ✅ Quality-of-life UI improvements
- Keyboard shortcuts: `N` new task, `Ctrl+S` save in editor
- Sticky column headers
- Confirm dialog shows task title + id
- Toast notifications for save/sync events

---

### 🌐 i18n language switch
Add language toggle EN/HU.

**Scope**
- UI strings in JSON dictionary
- store preference in `localStorage`

---

## Board / backlog structure suggestion (GitHub Projects)

### Columns
- Backlog
- Ready
- COMING
- ACTIVE   ← NEW
- PROGRESS
- OVERDUE
- DONE

### Labels
- `area:kanban`
- `area:calendar`
- `area:wiki`
- `area:storage`
- `type:feature`
- `type:bug`
- `type:chore`
- `prio:P0` `prio:P1` `prio:P2`
