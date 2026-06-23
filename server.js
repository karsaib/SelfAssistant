//Node.js
//Http,API
import express from "express";
// File, folder path mgmt
import path from "path";
//File handler
import fs from "fs/promises";
//Uri,path normalization
import { fileURLToPath } from "url";
//Environments
import dotenv from "dotenv";
// Fileupload 
import multer from "multer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
//JSON data 
const app = express();
app.use(express.json());
// Doc root settings
const DOC_ROOT = process.env.DOC_ROOT || path.join(__dirname, "public", "DOC");
app.use("/docs", express.static(DOC_ROOT));

//Task storage
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, "public", "data");
const TASKS_FILE = process.env.TASKS_FILE || path.join(DATA_DIR, "tasks.json");

// --- helper: ms -> HH:MM:SS---
function formatHMS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Start log messages of folder settings
console.log("📁 DATA_DIR  =", DATA_DIR);
console.log("📄 TASKS_FILE=", TASKS_FILE);
console.log("📁 DOC_ROOT  =", DOC_ROOT);


// ---- STATIC ----
app.use(express.static(path.join(__dirname, "public")));
app.use("/docs", express.static(DOC_ROOT));   

// API: Doc content manager
app.get("/api/docs-tree", async (req, res) => {
  try {
    // Cleansing of URL
    const rel = (req.query.path || "").replace(/^(\.\.[/\\])+/, "");
    const base = path.join(DOC_ROOT, rel);

    const entries = await fs.readdir(base, { withFileTypes: true });
    // Read path of files
    const items = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
      relPath: rel ? `${rel}/${e.name}` : e.name
    }));

    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// MD formatter, get meta key-value
function parseFrontmatter(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta: { tags: [] }, body: md };

  const block = m[1];
  const meta = {};
  //Skip empty or comment rows
  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx < 0) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim();
    meta[key] = val;
  }

  // Tags -> array
  const tagsRaw = meta.tags || "";
  meta.tags = tagsRaw
    ? tagsRaw.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const body = md.slice(m[0].length);
  return { meta, body };
}

// Meta header builder
function buildFrontmatter(meta) {
  const lines = [];
  lines.push("---");
  if (meta.title) lines.push(`title: ${meta.title}`);
  if (meta.tags && meta.tags.length) lines.push(`tags: ${meta.tags.join(", ")}`);
  if (meta.type) lines.push(`type: ${meta.type}`);
  if (meta.updated) lines.push(`updated: ${meta.updated}`);
  lines.push("---");
  return lines.join("\n") + "\n\n";
}

// API: Wiki
const WIKI_ROOT = path.join(DOC_ROOT, "wiki");
const WIKI_MEDIA_ROOT = path.join(WIKI_ROOT, "media");

// Static route: Wiki
app.use(
  "/wiki-media",
  express.static(WIKI_MEDIA_ROOT)
);

// 
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
    // Create media folder if not existed
      await fs.mkdir(WIKI_MEDIA_ROOT, { recursive: true });
      // Callback Multer with upload dir path
      cb(null, WIKI_MEDIA_ROOT);
    } catch (e) {
      cb(e);
    }
  },
// Create filename
  filename: (req, file, cb) => {
    const safe =
      Date.now() + "-" +
      String(file.originalname || "image.png")
        .replace(/[^\w.-]/g, "_");
    // Callback multer with filename
    cb(null, safe);
  }
});

// Upload file to media
const upload = multer({ storage });

function safeRelPath(p) {
  const cleaned = String(p || "").replace(/^(\.\.[/\\])+/, "");
  if (cleaned.includes("..")) return null;
  return cleaned;
}

// API: Wiki pages
app.get("/api/wiki-pages", async (req, res) => {
  try {
    await fs.mkdir(WIKI_ROOT, { recursive: true });
    //Read MD folder
    const entries = await fs.readdir(WIKI_ROOT, { withFileTypes: true });
    const pages = [];
    //List MD files
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;

      const slug = e.name.replace(/\.md$/i, "");
      const filePath = path.join(WIKI_ROOT, e.name);

      const full = await fs.readFile(filePath, "utf-8");
      const { meta } = parseFrontmatter(full);
      // Create data object from md information
      pages.push({
        file: e.name,
        slug,
        title: meta.title || slug,
        tags: meta.tags || [],
        type: meta.type || "",
        updated: meta.updated || "",
        url: `/docs/wiki/${encodeURIComponent(e.name)}`
      });
    }
    // Sort by Title
    pages.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug));
    res.json(pages);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// API:Get Slug
//Slug is a user-friendly url
app.get("/api/wiki/:slug", async (req, res) => {
  try {
    await fs.mkdir(WIKI_ROOT, { recursive: true });

    const slug = safeRelPath(req.params.slug);
    if (!slug) return res.status(400).json({ error: "Invalid slug" });

    const filePath = path.join(WIKI_ROOT, `${slug}.md`);
    const md = await fs.readFile(filePath, "utf-8");

    res.json({ slug, md });
  } catch (e) {
    if (String(e?.code) === "ENOENT") return res.status(404).json({ error: "Not found" });
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// API:Put Slug
app.put("/api/wiki/:slug", async (req, res) => {
  try {
    await fs.mkdir(WIKI_ROOT, { recursive: true });

    const slug = safeRelPath(req.params.slug);
    if (!slug) return res.status(400).json({ error: "Invalid slug" });

    const incoming = String(req.body?.md ?? "");
    const { meta, body } = parseFrontmatter(incoming);
    // Create date without time
    const today = new Date().toISOString().slice(0, 10);

    const nextMeta = {
      title: meta.title || slug,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      type: meta.type || "",
      updated: today
    };

    const out = buildFrontmatter(nextMeta) + body.replace(/^\s+/, "");

    const filePath = path.join(WIKI_ROOT, `${slug}.md`);
    await fs.writeFile(filePath, out, "utf-8");

    res.json({
      ok: true,
      slug,
      url: `/docs/wiki/${encodeURIComponent(slug)}.md`,
      meta: nextMeta
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// API: delete slug
app.delete("/api/wiki/:slug", async (req, res) => {
  try {
    const slug = safeRelPath(req.params.slug);
    if (!slug) return res.status(400).json({ error: "Invalid slug" });

    const filePath = path.join(WIKI_ROOT, `${slug}.md`);
    await fs.unlink(filePath);

    res.status(204).end();
  } catch (e) {
    if (String(e?.code) === "ENOENT") return res.status(404).json({ error: "Not found" });
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// API: Upload media file
app.post(
  "/api/wiki-media",
  upload.single("file"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded"
        });
      }

      res.json({
        ok: true,
        url: "/wiki-media/" + req.file.filename,
        file: req.file.filename
      });

    } catch (e) {
      res.status(500).json({
        error: String(e?.message || e)
      });
    }
  }
);

// API: get task from MD file
app.get("/api/tasks", async (req, res) => {
  try {
    const raw = await fs.readFile(TASKS_FILE, "utf-8");
    res.json(JSON.parse(raw || "[]"));
  } catch {
    res.json([]);
  }
});

/// API: Create task
app.post("/api/tasks", async (req, res) => {
  try {
    const newTask = req.body || {};

    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    const maxId = tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
    const id = maxId + 1;

    // 🔥 Új task: alapértelmezett mezők + sprintId támogatás
    const task = {
      id,
      title: String(newTask.title || "New task"),
      status: String(newTask.status || "coming").toLowerCase(),
      type: newTask.type || "root",
      parentId: newTask.parentId || null,
      sprintId: newTask.sprintId || null,  // 🔥 SPRINT ID TÁMOGATÁS
      tags: newTask.tags || [],
      notes: newTask.notes || "",
      color: newTask.color || "yellow",
      wikiRef: newTask.wikiRef || "",
      createdAt: new Date().toISOString(),
      allDay: newTask.allDay || false,
      startDate: newTask.startDate || null,
      startTime: newTask.startTime || null,
      endDate: newTask.endDate || null,
      endTime: newTask.endTime || null,
      done: newTask.done || false,
      trackedMs: 0,
      trackStart: null,
      trackedMsTotal: 0,
      timeLog: "",
    };

    tasks.push(task);
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

    res.status(201).json(task);
  } catch (e) {
    console.error("Task creation error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});


// ---- START ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Task Manager running at http://localhost:" + PORT)
);

// API:Delete task
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const reqId = String(req.params.id);

    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    const before = tasks.length;
    tasks = tasks.filter(t => String(t.id) !== reqId);

    if (tasks.length === before) {
      return res.status(404).json({ error: "Task not found" });
    }

    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// API: Update task (PUT)
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const patch = req.body || {};

    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    const idx = tasks.findIndex(t => String(t.id) === reqId);
    if (idx < 0) return res.status(404).json({ error: "Task not found" });

    // 🔥 Frissítés: sprintId-t is kezeljük
    const updated = {
      ...tasks[idx],
      ...patch,
      id: tasks[idx].id,
      // Ha sprintId üres string, akkor null-ra állítjuk
      sprintId: patch.sprintId || null,
    };

    if (updated.status) {
      updated.status = String(updated.status).toLowerCase();
    }

    tasks[idx] = updated;
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

    res.json(updated);
  } catch (e) {
    console.error("PUT error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// API: Update task (PATCH)
app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const patch = req.body || {};
	


if (patch.status == null) {
  return res.status(400).json({ error: "Missing status in PATCH body" });
}


    // Read task
    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    // Find task by ID
    const idx = tasks.findIndex(t => String(t.id) === reqId);
    if (idx < 0) return res.status(404).json({ error: "Task not found" });

    const prev = tasks[idx];


    const ALLOWED = new Set(["backlog", "coming", "tracking", "done", "active"]); // ha kell még, bővítsd

    let prevStatus = String(prev.status || "").toLowerCase().trim();
  

    const updated = { ...prev, ...patch, id: prev.id };

    if (updated.status != null) {
      updated.status = String(updated.status).toLowerCase().trim();



      // Uknown status handling
      if (!ALLOWED.has(updated.status)) {
        return res.status(400).json({ error: `Invalid status: ${updated.status}` });
      }
    }

    const nextStatus = String(updated.status || prevStatus).toLowerCase().trim();

const isTracking = (s) => s === "tracking";
const now = Date.now();

// START: if not tracking->tracking status it is NEW session
if (!isTracking(prevStatus) && isTracking(nextStatus)) {
  updated.trackStart = new Date(now).toISOString(); // ✅ string, frontend szereti
  updated.trackedMs = 0;                            // ✅ session 0-ról
}

// In tracking phase not started, force start
if (isTracking(nextStatus) && !prev.trackStart) {
  updated.trackStart = new Date(now).toISOString();
  updated.trackedMs = 0;
}





// STOP counter if moving from tracking to non-tracking status
if (isTracking(prevStatus) && !isTracking(nextStatus)) {
  const startRaw = prev.trackStart;
  const start = (typeof startRaw === "number")
    ? startRaw
    : Date.parse(startRaw);

  if (Number.isFinite(start) && start > 0) {
    const deltaMs = Math.max(0, now - start);

    const stamp = new Date(now).toISOString().slice(0, 19).replace("T", " ");
    const entry = `${stamp} +${formatHMS(deltaMs)}`;

    const prevLog = String(prev.timeLog || "").trim();
    updated.timeLog = prevLog ? (prevLog + ", " + entry) : entry;

    updated.trackedMsTotal = Number(prev.trackedMsTotal ?? 0) + deltaMs;

    updated.trackedMs = 0;
    updated.trackStart = null;

    console.log("[STOP OK]", reqId, { entry });
  } else {
    updated.trackStart = null;
    updated.trackedMs = 0;
  }
}







    // Saving task
    tasks[idx] = updated;
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

 
    return res.json(updated);

  } catch (e) {
    console.error("[PATCH ERROR]", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});




// Theres is no favicon
app.get("/favicon.ico", (req, res) => res.status(204).end());


const ARCHIVE_DIR =
  path.join(DATA_DIR, "archive");

  //Close task,moving archive
app.post("/api/tasks/:id/close", async (req, res) => {
  try {

    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    const reqId = String(req.params.id);

    let tasks = [];

    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");

      if (!Array.isArray(tasks)) {
        tasks = [];
      }

    } catch {
      tasks = [];
    }

    const idx =
      tasks.findIndex(t => String(t.id) === reqId);

    if (idx < 0) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    const task = tasks[idx];

    task.closedAt =
      new Date().toISOString();

    task.status = "archived";

    const fileName =
      `${task.id}_${Date.now()}.json`;

    const archivePath =
      path.join(ARCHIVE_DIR, fileName);

    await fs.writeFile(
      archivePath,
      JSON.stringify(task, null, 2),
      "utf-8"
    );

    tasks.splice(idx, 1);

    await fs.writeFile(
      TASKS_FILE,
      JSON.stringify(tasks, null, 2),
      "utf-8"
    );

    res.json({
      ok: true,
      archived: fileName
    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: String(e?.message || e)
    });
  }
});

// GET /api/tasks/roots
// → Visszaadja az összes root taskot (parentId = null)

app.get("/api/tasks/roots", async (req, res) => {
  try {
    const tasks = await loadTasks();
    const roots = tasks.filter(t => !t.parentId);
    res.json(roots);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tasks/:id/children
// → Visszaadja egy task összes gyerekét

app.get("/api/tasks/:id/children", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    const tasks = await loadTasks();
    const children = tasks.filter(t => t.parentId === parentId);
    res.json(children);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- POST /api/tasks/:id/subtask - Új subtask létrehozása ---
app.post("/api/tasks/:id/subtask", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    
    // 🔥 Betöltjük a taskokat a fájlból
    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }
    
    // Ellenőrizzük, hogy a szülő task létezik-e
    const parent = tasks.find(t => t.id === parentId);
    if (!parent) {
      return res.status(404).json({ error: "Parent task not found" });
    }

    // Új ID generálása
    const maxId = tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
    const id = maxId + 1;

    const newTask = {
      id: id,
      title: String(req.body.title || "New subtask"),
      type: "subtask",
      parentId: parentId,
      tags: req.body.tags || [],
      status: String(req.body.status || "coming").toLowerCase(),
      notes: req.body.notes || "",
      color: req.body.color || "yellow",
      wikiRef: req.body.wikiRef || "",
      createdAt: new Date().toISOString(),
      allDay: req.body.allDay || false,
      startDate: req.body.startDate || null,
      startTime: req.body.startTime || null,
      endDate: req.body.endDate || null,
      endTime: req.body.endTime || null,
      done: req.body.done || false,
      trackedMs: 0,
      trackStart: null,
      trackedMsTotal: 0,
      timeLog: "",
    };

    tasks.push(newTask);
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
    
    res.status(201).json(newTask);
  } catch (e) {
    console.error("Subtask creation error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// PATCH /api/tasks/:id/link
// → Task összekapcsolása (pl. subtask → root)

app.patch("/api/tasks/:id/link", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { parentId, tags } = req.body;
    
    const tasks = await loadTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    
    if (parentId !== undefined) task.parentId = parentId;
    if (tags) task.tags = tags;
    
    await saveTasks(tasks);
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PATCH /api/tasks/:id/tags - Task tag-ek frissítése ---
app.patch("/api/tasks/:id/tags", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { tags } = req.body;
    
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: "tags must be an array" });
    }

    // 🔥 Betöltjük a taskokat
    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    task.tags = tags.filter(t => t && t.trim()).map(t => t.trim());
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
    
    res.json(task);
  } catch (e) {
    console.error("Update tags error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ============================================================
// 📊 PROJECT VIEW API - Root taskok és subtaskok kezelése
// ============================================================

// --- Segédfüggvények a taskok betöltéséhez/mentéséhez ---
async function loadTasksFromFile() {
  try {
    const raw = await fs.readFile(TASKS_FILE, "utf-8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveTasksToFile(tasks) {
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

function getNextId(tasks) {
  const maxId = tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
  return maxId + 1;
}

// --- GET /api/tasks/roots - Root taskok lekérése ---
app.get("/api/tasks/roots", async (req, res) => {
  try {
    const tasks = await loadTasksFromFile();
    // Root taskok: nincs parentId-jük (vagy null/undefined)
    const roots = tasks.filter(t => !t.parentId);
    res.json(roots);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- GET /api/tasks/:id/children - Subtaskok lekérése ---
app.get("/api/tasks/:id/children", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    const tasks = await loadTasksFromFile();
    const children = tasks.filter(t => t.parentId === parentId);
    res.json(children);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- POST /api/tasks/:id/subtask - Új subtask létrehozása ---
app.post("/api/tasks/:id/subtask", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    const tasks = await loadTasksFromFile();
    
    // Ellenőrizzük, hogy a szülő task létezik-e
    const parent = tasks.find(t => t.id === parentId);
    if (!parent) {
      return res.status(404).json({ error: "Parent task not found" });
    }

    const newTask = {
      id: getNextId(tasks),
      title: String(req.body.title || "New subtask"),
      type: "subtask",
      parentId: parentId,
      tags: req.body.tags || [],
      status: String(req.body.status || "coming").toLowerCase(),
      notes: req.body.notes || "",
      color: req.body.color || "yellow",
      wikiRef: req.body.wikiRef || "",
      createdAt: new Date().toISOString(),
      // Opcionális mezők
      allDay: req.body.allDay || false,
      startDate: req.body.startDate || null,
      startTime: req.body.startTime || null,
      endDate: req.body.endDate || null,
      endTime: req.body.endTime || null,
      done: req.body.done || false,
      trackedMs: 0,
      trackStart: null,
      trackedMsTotal: 0,
      timeLog: "",
    };

    tasks.push(newTask);
    await saveTasksToFile(tasks);
    res.status(201).json(newTask);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- PATCH /api/tasks/:id/parent - Task áthelyezése másik szülő alá ---
app.patch("/api/tasks/:id/parent", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { parentId } = req.body;
    
    const tasks = await loadTasksFromFile();
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Ha parentId = null, akkor root task lesz
    // Ha parentId van, ellenőrizzük, hogy létezik-e
    if (parentId !== null && parentId !== undefined) {
      const parent = tasks.find(t => t.id === parentId);
      if (!parent) {
        return res.status(404).json({ error: "Parent task not found" });
      }
      // Nem lehet saját maga a szülő
      if (parentId === taskId) {
        return res.status(400).json({ error: "Task cannot be its own parent" });
      }
      task.type = "subtask";
    } else {
      task.type = "root";
    }

    task.parentId = parentId || null;
    await saveTasksToFile(tasks);
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- GET /api/tags - Összes használt tag lekérése ---
app.get("/api/tags", async (req, res) => {
  try {
    const tasks = await loadTasksFromFile();
    const tagSet = new Set();
    for (const t of tasks) {
      if (t.tags && Array.isArray(t.tags)) {
        for (const tag of t.tags) {
          if (tag && tag.trim()) {
            tagSet.add(tag.trim());
          }
        }
      }
    }
    res.json([...tagSet].sort());
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- PATCH /api/tasks/:id/tags - Task tag-ek frissítése ---
app.patch("/api/tasks/:id/tags", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { tags } = req.body;
    
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: "tags must be an array" });
    }

    const tasks = await loadTasksFromFile();
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    task.tags = tags.filter(t => t && t.trim()).map(t => t.trim());
    await saveTasksToFile(tasks);
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/// --- DELETE /api/tasks/:id/recursive - Task és összes gyerekének törlése ---
app.delete("/api/tasks/:id/recursive", async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    
    // 🔥 Betöltjük a taskokat
    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }
    
    // Rekurzívan összegyűjtjük az összes gyereket
    function getAllChildIds(parentId) {
      const children = tasks.filter(t => t.parentId === parentId);
      let ids = children.map(c => c.id);
      for (const child of children) {
        ids = ids.concat(getAllChildIds(child.id));
      }
      return ids;
    }

    const childIds = getAllChildIds(taskId);
    const idsToDelete = [taskId, ...childIds];
    
    tasks = tasks.filter(t => !idsToDelete.includes(t.id));
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
    
    res.status(204).end();
  } catch (e) {
    console.error("Delete recursive error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- GET /api/tasks/roots/with-children - Root taskok + subtaskok egyben ---
app.get("/api/tasks/roots/with-children", async (req, res) => {
  try {
    const tasks = await loadTasksFromFile();
    
    // Root taskok
    const roots = tasks.filter(t => !t.parentId);
    
    // Minden root-hoz hozzáadjuk a gyerekeket
    const result = roots.map(root => ({
      ...root,
      children: tasks.filter(t => t.parentId === root.id)
    }));
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// A DATA_DIR mappában létrehozzuk a sprints.json fájlt
const SPRINTS_FILE = process.env.SPRINTS_FILE || path.join(DATA_DIR, "sprints.json");

// --- Segédfüggvények sprintekhez ---
async function loadSprints() {
  try {
    const raw = await fs.readFile(SPRINTS_FILE, "utf-8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveSprints(sprints) {
  await fs.writeFile(SPRINTS_FILE, JSON.stringify(sprints, null, 2), "utf-8");
}

function getNextSprintId(sprints) {
  const maxId = sprints.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
  return maxId + 1;
}

// ============================================================
// 📅 SPRINT API
// ============================================================

// --- GET /api/sprints - Összes sprint lekérése ---
app.get("/api/sprints", async (req, res) => {
  try {
    const sprints = await loadSprints();
    res.json(sprints);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- GET /api/sprints/active - Aktív sprint lekérése ---
app.get("/api/sprints/active", async (req, res) => {
  try {
    const sprints = await loadSprints();
    const active = sprints.find(s => s.status === "active");
    res.json(active || null);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- POST /api/sprints - Új sprint létrehozása ---
app.post("/api/sprints", async (req, res) => {
  try {
    const sprints = await loadSprints();
    const newSprint = {
      id: getNextSprintId(sprints),
      name: String(req.body.name || "New Sprint"),
      startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
      endDate: req.body.endDate || "",
      status: String(req.body.status || "upcoming"), // upcoming | active | completed
      goal: req.body.goal || "",
      createdAt: new Date().toISOString(),
    };
    
    sprints.push(newSprint);
    await saveSprints(sprints);
    res.status(201).json(newSprint);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- PUT /api/sprints/:id - Sprint frissítése ---
app.put("/api/sprints/:id", async (req, res) => {
  try {
    const sprintId = Number(req.params.id);
    const sprints = await loadSprints();
    const idx = sprints.findIndex(s => s.id === sprintId);
    
    if (idx < 0) {
      return res.status(404).json({ error: "Sprint not found" });
    }
    
    const updated = {
      ...sprints[idx],
      ...req.body,
      id: sprintId
    };
    
    sprints[idx] = updated;
    await saveSprints(sprints);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- DELETE /api/sprints/:id - Sprint törlése ---
app.delete("/api/sprints/:id", async (req, res) => {
  try {
    const sprintId = Number(req.params.id);
    const sprints = await loadSprints();
    const filtered = sprints.filter(s => s.id !== sprintId);
    
    if (filtered.length === sprints.length) {
      return res.status(404).json({ error: "Sprint not found" });
    }
    
    await saveSprints(filtered);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- POST /api/sprints/:id/activate - Sprint aktiválása ---
app.post("/api/sprints/:id/activate", async (req, res) => {
  try {
    const sprintId = Number(req.params.id);
    let sprints = await loadSprints();
    
    // Minden sprintet inaktívvá teszünk
    sprints = sprints.map(s => ({
      ...s,
      status: s.id === sprintId ? "active" : "upcoming"
    }));
    
    await saveSprints(sprints);
    res.json({ ok: true, activeSprintId: sprintId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});