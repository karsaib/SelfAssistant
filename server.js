// server.js — fájl alapú Task Manager backend + Google Calendar szinkron
// Kanban státuszok: coming / progress / overdue / done
// ÚJ: betöltéskor a COMING → PROGRESS, ha a feladat időintervalluma érinti a mai napot.

import express from "express";
// Alias FS (Promise API)
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

/* ──────────────────────────────────────────────────────────────
   1) Alap beállítások, útvonalak, .env betöltés
   ────────────────────────────────────────────────────────────── */

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const IS_PKG   = typeof process.pkg !== "undefined";
const ROOT_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const DATA_DIR   = process.env.DATA_DIR || ROOT_DIR;
const DATA_FILE  = path.join(DATA_DIR, "tasks.json");
const TOKEN_PATH = path.join(DATA_DIR, "google_token.json");

/* ──────────────────────────────────────────────────────────────
   2) Express app és statikus kiszolgálás
   ────────────────────────────────────────────────────────────── */

const app = express();

// A bejövő JSON törzs kérésenként memóriában pufferelődik és parse-olódik → req.body
app.use(express.json());

// Frontend kiszolgálása
app.use(express.static(path.join(ROOT_DIR, "public")));

/* ──────────────────────────────────────────────────────────────
   3) Általános beállítások (időzóna, naptár, scope-ok)
   ────────────────────────────────────────────────────────────── */

const TIME_ZONE   = "Europe/Budapest";
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const SCOPES      = ["https://www.googleapis.com/auth/calendar.events"];

/* ──────────────────────────────────────────────────────────────
   4) Fájlos adattár
   ────────────────────────────────────────────────────────────── */

async function loadTasks() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, "utf-8")); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
}
async function saveTasks(tasks) {
  const tmp = DATA_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), "utf-8");
  await fs.rename(tmp, DATA_FILE);
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ──────────────────────────────────────────────────────────────
   5) Google OAuth + Calendar
   ────────────────────────────────────────────────────────────── */

function getOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}
async function readSavedToken() { try { return JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8")); } catch { return null; } }
async function saveToken(tokens) { await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8"); }
async function getGoogleAuth() { const c = getOAuthClient(); const t = await readSavedToken(); if (!t) return null; c.setCredentials(t); return c; }
async function getCalendar() { const a = await getGoogleAuth(); if (!a) return null; return google.calendar({ version: "v3", auth: a }); }

app.get("/auth/google", (req, res) => {
  const o = getOAuthClient();
  res.redirect(o.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES }));
});
app.get("/oauth2callback", async (req, res) => {
  if (req.query.error) return res.status(400).send("OAuth error: " + req.query.error);
  try { const o = getOAuthClient(); const { tokens } = await o.getToken(req.query.code); await saveToken(tokens);
    res.send("Google Calendar összekapcsolva! Visszatérhetsz az alkalmazáshoz.");
  } catch (e) { console.error("OAuth hiba:", e?.message); res.status(500).send("OAuth hiba."); }
});

/* ──────────────────────────────────────────────────────────────
   6) Idő / Calendar helper
   ────────────────────────────────────────────────────────────── */

const addOneDay = d => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
const combineDT = (d, t) => `${d}T${(t || "00:00")}:00`;
const isFilled  = (...v) => v.every(x => x !== undefined && x !== null && String(x).trim() !== "");

// Az adott időzónában (Europe/Budapest) „YYYY-MM-DD” formátumú mai nap
function todayYMD(tz = TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date()); // en-CA → YYYY-MM-DD
}

// Megnézzük, hogy egy taszk időintervalluma érinti-e a MAI napot (nap-alapú logika)
function isActiveTodayByDates(t) {
  if (t.done) return false;
  const today = todayYMD();
  const start = t.startDate || t.due || null;
  const end   = t.endDate || start || null;
  if (!start) return false;

  // All-day / csak dátum
  if (t.allDay || (!t.startTime && !t.endTime)) {
    // aktív, ha today ∈ [start, end]
    return today >= start && today <= end;
  }

  // Időzített esemény: nap szinten vizsgálunk (egyszerűsítve)
  const lastDay = t.endDate || t.startDate;
  return today >= t.startDate && today <= lastDay;
}

const attachTag = (ev, t) => t.tag
  ? ({ ...ev, extendedProperties: { ...(ev.extendedProperties || {}), private: { ...(ev.extendedProperties?.private || {}), tag: String(t.tag) }}})
  : ev;

function buildEventFromTask(t) {
  if (t.allDay || (t.startDate && !t.startTime && !t.endTime)) {
    const s = t.startDate || t.due; if (!s) return fallback(t);
    const e = t.endDate ? addOneDay(t.endDate) : addOneDay(s);
    return attachTag({ summary: t.title, description: t.notes || "", start: { date: s, timeZone: TIME_ZONE }, end: { date: e, timeZone: TIME_ZONE }, transparency: t.done ? "transparent" : "opaque" }, t);
  }
  if (isFilled(t.startDate, t.startTime)) {
    const s = combineDT(t.startDate, t.startTime);
    let e;
    if (isFilled(t.endDate, t.endTime)) e = combineDT(t.endDate, t.endTime);
    else if (t.endDate && !t.endTime)   e = combineDT(t.endDate, "23:59");
    else if (!t.endDate && t.endTime)   e = combineDT(t.startDate, t.endTime);
    else                                e = new Date(new Date(s).getTime() + 60 * 60000).toISOString().slice(0, 19);
    if (new Date(e) <= new Date(s))     e = new Date(new Date(s).getTime() + 30 * 60000).toISOString().slice(0, 19);
    return attachTag({ summary: t.title, description: t.notes || "", start: { dateTime: s, timeZone: TIME_ZONE }, end: { dateTime: e, timeZone: TIME_ZONE }, transparency: t.done ? "transparent" : "opaque" }, t);
  }
  if (t.due) {
    return attachTag({ summary: t.title, description: t.notes || "", start: { date: t.due, timeZone: TIME_ZONE }, end: { date: addOneDay(t.due), timeZone: TIME_ZONE }, transparency: t.done ? "transparent" : "opaque" }, t);
  }
  return fallback(t);
}
function fallback(t) {
  const s = new Date(); const e = new Date(s.getTime() + 30 * 60000);
  return { summary: t.title, description: t.notes || "", start: { dateTime: s.toISOString().slice(0, 19), timeZone: TIME_ZONE }, end: { dateTime: e.toISOString().slice(0, 19), timeZone: TIME_ZONE } };
}

async function ensureCalendarEvent(task) {
  const cal = await getCalendar(); if (!cal) return task;
  const body = buildEventFromTask(task);
  if (task.googleEventId) {
    const { data } = await cal.events.update({ calendarId: CALENDAR_ID, eventId: task.googleEventId, requestBody: body });
    return { ...task, googleEventId: data.id };
  } else {
    const { data } = await cal.events.insert({ calendarId: CALENDAR_ID, requestBody: body });
    return { ...task, googleEventId: data.id };
  }
}
function isInvalidGrant(err) { return (err?.message || String(err)).toLowerCase().includes("invalid_grant"); }
async function safeEnsureCalendarEvent(task) {
  try { return await ensureCalendarEvent(task); }
  catch (e) { if (isInvalidGrant(e)) console.warn("Calendar kihagyva (invalid_grant). Mentés folytatódik."); else console.error("Calendar sync hiba:", e?.message); return task; }
}

/* ──────────────────────────────────────────────────────────────
   7) REST API
   ────────────────────────────────────────────────────────────── */

// 7.1) LIST: betöltéskor COMING → PROGRESS, ha ma aktív
app.get("/api/tasks", async (_req, res) => {
  try {
    const tasks = await loadTasks();

    let changed = false;
    for (const t of tasks) {
      // csak a COMING-okat érinti; DONE/OVERDUE/PROGRESS marad, ahogy van
      if ((t.status === "coming" || t.status === "COMING") && isActiveTodayByDates(t)) {
        t.status = "progress"; // a kérés szerint PROGRESS legyen
        changed = true;
      }
    }
    if (changed) await saveTasks(tasks); // persistáljuk a státuszváltásokat

    res.json(tasks);
  } catch {
    res.status(500).json({ error: "Betöltési hiba." });
  }
});

// 7.2) CREATE
app.post("/api/tasks", async (req, res) => {
  try {
    const {
      title = "", notes = "", tag = "", done = false,
      allDay = false, startDate = null, startTime = null, endDate = null, endTime = null,
      due = null,
      status = "coming" // alapból COMING
    } = req.body || {};

    if (!title.trim()) return res.status(400).json({ error: "Title required" });

    const tasks = await loadTasks();

    let task = {
      id: genId(),
      title: title.trim(),
      notes, tag, done: !!done,
      allDay: !!allDay, startDate, startTime, endDate, endTime,
      due,
      status,
      googleEventId: null
    };

    task = await safeEnsureCalendarEvent(task);
    tasks.push(task);
    await saveTasks(tasks);
    res.status(201).json(task);
  } catch (e) {
    console.error("POST /api/tasks hiba:", e?.message);
    res.status(500).json({ error: "Létrehozási hiba." });
  }
});

// 7.3) UPDATE
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { id }  = req.params;
    const payload = req.body || {};

    const tasks = await loadTasks();
    const idx   = tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });

    const updated = {
      ...tasks[idx],
      ...(payload.title      !== undefined ? { title: String(payload.title).trim() } : {}),
      ...(payload.notes      !== undefined ? { notes: String(payload.notes) } : {}),
      ...(payload.tag        !== undefined ? { tag:   String(payload.tag) }   : {}),
      ...(payload.done       !== undefined ? { done:  !!payload.done }        : {}),
      ...(payload.allDay     !== undefined ? { allDay:!!payload.allDay }      : {}),
      ...(payload.startDate  !== undefined ? { startDate: payload.startDate || null } : {}),
      ...(payload.startTime  !== undefined ? { startTime: payload.startTime || null } : {}),
      ...(payload.endDate    !== undefined ? { endDate:   payload.endDate   || null } : {}),
      ...(payload.endTime    !== undefined ? { endTime:   payload.endTime   || null } : {}),
      ...(payload.due        !== undefined ? { due:       payload.due       || null } : {}),
      ...(payload.status     !== undefined ? { status:    payload.status }           : {}),
    };

    // Csak tartalmi/idő mezőknél szinkronizáljuk a Calendar-t (status → nem)
    const calFields = ["title","notes","done","allDay","startDate","startTime","endDate","endTime","due","tag"];
    const needCalSync = calFields.some(k => payload[k] !== undefined);

    const result = needCalSync ? await safeEnsureCalendarEvent(updated) : updated;

    tasks[idx] = result;
    await saveTasks(tasks);

    res.json(result);
  } catch (e) {
    console.error("PUT /api/tasks/:id hiba:", e?.message);
    res.status(500).json({ error: "Frissítési hiba." });
  }
});

// 7.4) DELETE
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const tasks = await loadTasks();
    const idx   = tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });

    const [removed] = tasks.splice(idx, 1);

    try {
      const cal = await getCalendar();
      if (cal && removed.googleEventId) {
        await cal.events.delete({ calendarId: CALENDAR_ID, eventId: removed.googleEventId });
      }
    } catch (e) {
      console.warn("Calendar törlés sikertelen:", e?.message);
    }

    await saveTasks(tasks);
    res.json(removed);
  } catch (e) {
    console.error("DELETE /api/tasks/:id hiba:", e?.message);
    res.status(500).json({ error: "Törlési hiba." });
  }
});

// (opcionális) naptárak listája
app.get("/api/debug/calendars", async (_req, res) => {
  try {
    const cal = await getCalendar();
    if (!cal) return res.status(401).json({ error: "Nincs Google-auth (előbb /auth/google)" });
    const { data } = await cal.calendarList.list();
    const out = (data.items || []).map(c => ({ summary: c.summary, id: c.id, primary: !!c.primary }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Nem sikerült lekérdezni a naptárakat." });
  }
});

/* ──────────────────────────────────────────────────────────────
   8) Start
   ────────────────────────────────────────────────────────────── */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TaskManager:   http://localhost:${PORT}`);
  console.log(`Google auth:   http://localhost:${PORT}/auth/google`);
  console.log(`Data dir:      ${DATA_DIR}`);
  console.log(`Calendar ID:   ${CALENDAR_ID}`);
});
