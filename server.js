// ============================================================================
// Task Manager Backend
// Implements:
// - Task storage (JSON file)
// - Time tracking with: trackedMs, trackStart, timeLog
// - Status transitions: coming, active, tracking, overdue, done
// - Google Calendar sync (optional)
// ============================================================================

import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { google } from "googleapis";

// Resolve paths depending on whether running from source or from pkg binary
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const IS_PKG   = typeof process.pkg !== "undefined";

// Project root directory (where server.js is located)
const ROOT_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

// Load environment variables
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

// Data folder and JSON file paths
const DATA_DIR   = path.join(ROOT_DIR, "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const TOKEN_FILE = path.join(DATA_DIR, "token.json");

// ============================================================================
// HELPERS: File operations
// ============================================================================

// Ensure /data directory exists
async function ensureDataDir(){
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// Load tasks from JSON file, applying default values when needed
async function loadTasks(){
  await ensureDataDir();
  try{
    const raw = await fs.readFile(TASKS_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];

    // Ensure tracking-related fields exist for older tasks
    const changed = normalizeDefaults(arr);
    if (changed) await saveTasks(arr);

    // Ensure defaults for each task when returning
    return arr.map(ensureTrackFields);

  }catch(e){
    // If file does not exist, return empty list
    if (e.code === "ENOENT") return [];
    console.error("loadTasks error:", e?.message);
    return [];
  }
}

// Save tasks to JSON file
async function saveTasks(tasks){
  await ensureDataDir();
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

// ============================================================================
// HELPERS: Task field normalization
// ============================================================================

// Ensure tracking fields exist on a task
function ensureTrackFields(t) {
  if (t.trackedMs === undefined) t.trackedMs = 0;      // accumulated milliseconds
  if (t.trackStart === undefined) t.trackStart = null; // when tracking started
  if (t.timeLog === undefined) t.timeLog = "";         // log entries: "YYYY-MM-DD HH:MM:SS, ..."
  if (t.timeLog === undefined) t.timeLog = "";
  if (t.color === undefined || t.color === null || t.color === "") {
    t.color = "yellow";         
  }
  return t;
}


// Normalize missing tracking fields in loaded tasks
function normalizeDefaults(list){
  let changed = false;
  for (const t of list){
    if (t.trackedMs === undefined){ t.trackedMs = 0; changed = true; }
    if (t.trackStart === undefined){ t.trackStart = null; changed = true; }
    if (t.timeLog === undefined){ t.timeLog = ""; changed = true; }
	   if (t.color === undefined){ t.color = "yellow"; changed = true; } 
  }
  return changed;
}

// ============================================================================
// HELPERS: Time formatting and parsing
// ============================================================================

// Convert milliseconds → "HH:MM:SS"
function formatDurationHMS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Current date in YYYY-MM-DD
function currentLocalDateYMD() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Parse timeLog entries ("YYYY-MM-DD HH:MM:SS, ...") → total ms
function parseTimeLogMs(str){
  if (!str) return 0;
  let total = 0;

  const entries = String(str).split(",");

  for (const raw of entries){
    const part = raw.trim();
    if (!part) continue;

    // Extract substring after first space → HH:MM:SS
    const idx = part.indexOf(" ");
    if (idx === -1) continue;

    const timePart = part.slice(idx + 1).trim();
    const seg = timePart.split(":").map(x => Number(x));

    if (!Number.isFinite(seg[0])) continue;

    const h = seg[0];
    const m = Number.isFinite(seg[1]) ? seg[1] : 0;
    const s = Number.isFinite(seg[2]) ? seg[2] : 0;

    const ms = ((h * 3600) + (m * 60) + s) * 1000;
    if (ms > 0) total += ms;
  }

  return total;
}

// ============================================================================
// GOOGLE CALENDAR (optional integration)
// ============================================================================

// Load environment variables for Calendar integration
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_CALENDAR_ID
} = process.env;

// Create OAuth2 client
function getOAuthClient(){
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI){
    return null;
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

// Load auth tokens from file
async function loadTokens(){
  try{
    const raw = await fs.readFile(TOKEN_FILE, "utf8");
    return JSON.parse(raw);
  }catch(e){
    return null;
  }
}

// Save auth tokens to file
async function saveTokens(tokens){
  await ensureDataDir();
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf8");
}

// Create a Google Calendar API client
async function getCalendarClient(){
  const oauth2Client = getOAuthClient();
  if (!oauth2Client) return null;

  const tokens = await loadTokens();
  if (!tokens) return null;

  oauth2Client.setCredentials(tokens);
  return google.calendar({ version:"v3", auth: oauth2Client });
}

// Insert or update an event safely
async function safeEnsureCalendarEvent(task){
  try{
    const calendar = await getCalendarClient();
    if (!calendar || !GOOGLE_CALENDAR_ID) return task;

    const base = {
      summary: task.title,
      description: task.notes || "",
    };

    let eventBody;

    // All-day event
    if (task.allDay && task.startDate){
      const start = task.startDate;
      const end   = addOneDay(task.startDate);
      eventBody = {
        ...base,
        start: { date: start },
        end:   { date: end },
      };
    }
    // Timed event
    else if (task.startDate && task.startTime && task.endDate && task.endTime){
      const start = combineDT(task.startDate, task.startTime);
      const end   = combineDT(task.endDate,   task.endTime);
      eventBody = {
        ...base,
        start: { dateTime: start },
        end:   { dateTime: end },
      };
    }
    // Missing info → fallback 30-min event
    else {
      eventBody = fallback(task);
    }

    // Add tag to event extendedProperties
    eventBody = attachTag(eventBody, task);

    // Insert or update event
    if (!task.googleEventId){
      const resp = await calendar.events.insert({
        calendarId: GOOGLE_CALENDAR_ID,
        requestBody: eventBody,
      });
      const event = resp.data;
      if (event && event.id) task.googleEventId = event.id;
    }
    else {
      await calendar.events.update({
        calendarId: GOOGLE_CALENDAR_ID,
        eventId: task.googleEventId,
        requestBody: eventBody,
      });
    }

    return task;

  }catch(e){
    console.error("safeEnsureCalendarEvent error:", e?.message);
    return task;
  }
}

// Delete Calendar event safely
async function safeDeleteCalendarEvent(task){
  try{
    const calendar = await getCalendarClient();
    if (!calendar || !GOOGLE_CALENDAR_ID) return;
    if (!task.googleEventId) return;

    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: task.googleEventId,
    });

  }catch(e){
    console.error("safeDeleteCalendarEvent error:", e?.message);
  }
}

// Small helpers for handling Google Calendar dates
const addOneDay = d => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); };
const combineDT = (d, t) => `${d}T${(t || "00:00")}:00`;
const attachTag = (ev, t) => t.tag
  ? ({ ...ev, extendedProperties: { ...(ev.extendedProperties || {}), private: { ...(ev.extendedProperties?.private || {}), tag: String(t.tag) }}})
  : ev;

// Default fallback event
function fallback(t) {
  const s = new Date();
  const e = new Date(s.getTime() + 30 * 60000);
  return {
    summary: t.title,
    description: t.notes || "",
    start: { dateTime: s.toISOString() },
    end:   { dateTime: e.toISOString() },
  };
}

// ============================================================================
// EXPRESS SERVER SETUP
// ============================================================================

const app = express();
app.use(express.json());

// Serve frontend (index.html and app.js)
app.use(express.static(path.join(ROOT_DIR, "public")));

// ============================================================================
// GOOGLE AUTH ROUTES
// ============================================================================

// Start OAuth login flow
app.get("/auth/google", (req, res) => {
  const oAuth2Client = getOAuthClient();
  if (!oAuth2Client){ return res.status(500).send("Missing Google OAuth config"); }

  const scopes = ["https://www.googleapis.com/auth/calendar"];

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });

  res.redirect(url);
});

// OAuth callback: save tokens
app.get("/oauth2callback", async (req, res) => {
  const oAuth2Client = getOAuthClient();
  if (!oAuth2Client){ return res.status(500).send("OAuth client missing"); }

  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code parameter");

  try{
    const { tokens } = await oAuth2Client.getToken(code);
    await saveTokens(tokens);
    res.send("Google Calendar connected.");

  } catch (e) {
    console.error("OAuth error:", e?.message);
    res.status(500).send("OAuth error.");
  }
});

// ============================================================================
// TASK API ENDPOINTS
// ============================================================================

// Generate random ID
function genId(){
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// GET all tasks
app.get("/api/tasks", async (req, res) => {
  try{
    const tasks = await loadTasks();
    res.json(tasks);
  }catch(e){
    console.error("GET /api/tasks error:", e?.message);
    res.status(500).json({ error: "Load error." });
  }
});

// POST create task
app.post("/api/tasks", async (req, res) => {
  try {

    const {
      title = "", notes = "", tag = "", done = false,
      allDay = false, startDate = null, startTime = null,
      endDate = null, endTime = null, due = null, status = "coming",
      trackedMs, trackStart, timeLog = "",
      color = "yellow"
    } = req.body || {};

    if (!title.trim()) {
      return res.status(400).json({ error: "Title required" });
    }

    const tasks = await loadTasks();

    // sanitize color
    const safeColor =
      typeof color === "string" && color.trim() !== ""
        ? color.trim()
        : "yellow";

    // build task object
    let task = ensureTrackFields({
      id: genId(),
      title: title.trim(),
      notes,
      tag,
      done: !!done,
      allDay: !!allDay,
      startDate,
      startTime,
      endDate,
      endTime,
      due,
      status,
      trackedMs,
      trackStart,
      timeLog,
      color: safeColor,
      googleEventId: null,
    });

    // sync to Google Calendar (if enabled)
    task = await safeEnsureCalendarEvent(task);

    // save in file
    tasks.push(task);
    await saveTasks(tasks);

    return res.status(201).json(task);

  } catch (e) {
    console.error("POST /api/tasks error:", e?.message);
    return res.status(500).json({ error: "Creation error." });
  }
});


// PUT update full task
// Handles timeLog updates when leaving tracking
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { id }  = req.params;
    const payload = req.body || {};

    const tasks = await loadTasks();
    const idx   = tasks.findIndex(t => String(t.id) === String(id));


    if (idx === -1) return res.status(404).json({ error: "Not found" });

    const old = ensureTrackFields({ ...tasks[idx] });
    let merged = ensureTrackFields({ ...old, ...payload });

    // Detect transition: leaving "tracking"
    const leavingTracking = (old.status === "tracking") && (merged.status !== "tracking");

    if (leavingTracking && old.trackStart) {
      const startMs = new Date(old.trackStart).getTime();

      if (!Number.isNaN(startMs)) {
        const delta = Math.max(0, Date.now() - startMs);

        if (delta > 0) {
          // Create log entry like "2025-11-17 02:14:22"
          const dateStr = currentLocalDateYMD();
          const durStr  = formatDurationHMS(delta);
          const entry   = `${dateStr} ${durStr}`;

          const prevLog = (merged.timeLog ?? old.timeLog ?? "").toString().trim();
          merged.timeLog = prevLog ? `${prevLog}, ${entry}` : entry;
        }
      }

      // Reset counter
      merged.trackedMs  = 0;
      merged.trackStart = null;
    }

    // Detect transition: entering "tracking"
    const enteringTracking = (old.status !== "tracking") && (merged.status === "tracking");
    if (enteringTracking && !old.trackStart && !merged.trackStart) {
      merged.trackStart = new Date().toISOString();
    }

    // Normalize values
    merged.trackedMs = Number(merged.trackedMs || 0);
    if (merged.trackStart !== null) merged.trackStart = String(merged.trackStart);
    merged.timeLog = merged.timeLog == null ? "" : String(merged.timeLog);

    // If content changed → update Calendar
    const calFields = ["title","notes","done","allDay","startDate","startTime","endDate","endTime","due","tag"];
    let needCalUpdate = false;
    for (const k of calFields){
      if (merged[k] !== old[k]) { needCalUpdate = true; break; }
    }
    if (needCalUpdate){
      merged = await safeEnsureCalendarEvent(merged);
    }

    tasks[idx] = merged;
    await saveTasks(tasks);

    res.json(merged);

  } catch (e) {
    console.error("PUT /api/tasks error:", e?.message);
    res.status(500).json({ error: "Update error." });
  }
});

// PATCH partial update (same as PUT but selective)
app.patch("/api/tasks/:id", async (req, res) => {
  try{
    const { id }  = req.params;
    const payload = req.body || {};

    const tasks = await loadTasks();
    const idx   = tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });

    const old = ensureTrackFields({ ...tasks[idx] });
    let merged = ensureTrackFields({ ...old, ...payload });

    // Same "leaving tracking" logic
    const leavingTracking = (old.status === "tracking") && (merged.status !== "tracking");
    if (leavingTracking && old.trackStart) {
      const startMs = new Date(old.trackStart).getTime();
      if (!Number.isNaN(startMs)) {
        const delta = Math.max(0, Date.now() - startMs);

        if (delta > 0) {
          const dateStr = currentLocalDateYMD();
          const durStr  = formatDurationHMS(delta);
          const entry   = `${dateStr} ${durStr}`;

          const prevLog = (merged.timeLog ?? old.timeLog ?? "").toString().trim();
          merged.timeLog = prevLog ? `${prevLog}, ${entry}` : entry;
        }
      }
	  // -- leaving TRACKING column --
const leavingTracking = (old.status === "tracking") && (merged.status !== "tracking");

      // DO NOT reset trackedMs — instead add the elapsed cycle
	// --- leaving TRACKING: log time, then RESET counter ---
if (leavingTracking && old.trackStart) {
  const startMs = new Date(old.trackStart).getTime();
  if (!Number.isNaN(startMs)) {
    const delta = Math.max(0, Date.now() - startMs);

    if (delta > 0) {
      const dateStr = currentLocalDateYMD();
      const durStr  = formatDurationHMS(delta);
      const entry   = `${dateStr} ${durStr}`;

      const prevLog = (merged.timeLog ?? old.timeLog ?? "").toString().trim();
      merged.timeLog = prevLog ? `${prevLog}, ${entry}` : entry;
    }
  }

  // <<< ITT NULLÁZZUK A TRACKELT IDŐT >>>
  merged.trackedMs  = 0;
  merged.trackStart = null;
}


    }

    // Same "enter tracking" logic
    const enteringTracking = (old.status !== "tracking") && (merged.status === "tracking");
    if (enteringTracking && !old.trackStart && !merged.trackStart) {
      merged.trackStart = new Date().toISOString();
    }

    merged.trackedMs = Number(merged.trackedMs || 0);
    if (merged.trackStart !== null) merged.trackStart = String(merged.trackStart);
    merged.timeLog = merged.timeLog == null ? "" : String(merged.timeLog);

    // Calendar update check
    const calFields = ["title","notes","done","allDay","startDate","startTime","endDate","endTime","due","tag"];
    let needCalUpdate = false;
    for (const k of calFields){
      if (merged[k] !== old[k]) { needCalUpdate = true; break; }
    }
    if (needCalUpdate){
      merged = await safeEnsureCalendarEvent(merged);
    }

    tasks[idx] = merged;
    await saveTasks(tasks);

    res.json(merged);

  }catch(e){
    console.error("PATCH /api/tasks error:", e?.message);
    res.status(500).json({ error: "PATCH error." });
  }
});

// DELETE a task
app.delete("/api/tasks/:id", async (req, res) => {
  try{
    const { id } = req.params;

    const tasks = await loadTasks();
    const idx   = tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });

    const [removed] = tasks.splice(idx, 1);

    await saveTasks(tasks);
    await safeDeleteCalendarEvent(removed);

    res.json({ ok: true });

  }catch(e){
    console.error("DELETE /api/tasks error:", e?.message);
    res.status(500).json({ error: "Delete error." });
  }
});

// ============================================================================
// SIMPLE MONTHLY REPORT
// ============================================================================

// Produces a CSV "Title;Hours" from total logged time
// --- SIMPLE MONTHLY REPORT --------------------------------------------------

// Produces a CSV "Title;Hours;TimeLog" from total logged time.
// Hours = timeLog (parsed to ms) + trackedMs + any currently running tracking.
app.get("/api/reports/monthly", async (req, res) => {
  try{
    const tasks = await loadTasks();
    const now = Date.now();

    const rows = [];
    let totalMs = 0;

    for (const t of tasks){
      // parse timeLog into milliseconds
      const logMs   = parseTimeLogMs(t.timeLog || "");
      const trackMs = Number(t.trackedMs || 0);

      // if task is currently in tracking status, include runtime until now
      const extra = (t.status === "tracking" && t.trackStart)
        ? Math.max(0, now - new Date(t.trackStart).getTime())
        : 0;

      const ms = logMs + trackMs + extra;

      if (ms > 0){
        rows.push({
          title:   String(t.title || ""),
          hours:   ms / 3600000,
          timeLog: (t.timeLog || "").replace(/;/g, ","), // avoid breaking CSV separator
        });
        totalMs += ms;
      }
    }

    // sort by hours descending
    rows.sort((a,b) => b.hours - a.hours);

    const sep = ";"; // Excel-friendly separator in EU locales

    // Header / note line
    let csv = "Note: This report is not time-sliced; values represent total measured time.\n";

    // CSV header
    csv += ["Title","Hours","TimeLog"].join(sep) + "\n";

    // CSV rows
    for (const r of rows){
      csv += [
        r.title,
        r.hours.toFixed(2),
        r.timeLog
      ].join(sep) + "\n";
    }

    // Total line (no timeLog)
    csv += ["Total", (totalMs / 3600000).toFixed(2), ""].join(sep) + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);

  }catch(e){
    console.error("GET /api/reports/monthly error:", e?.message);
    res.status(500).json({ error: "Report error." });
  }
});


// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Task Manager running at: http://localhost:" + PORT);
});
