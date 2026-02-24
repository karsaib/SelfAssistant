import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.json());
const DOC_ROOT = process.env.DOC_ROOT || path.join(__dirname, "public", "DOC");
app.use("/docs", express.static(DOC_ROOT));


const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, "public", "data");
const TASKS_FILE = process.env.TASKS_FILE || path.join(DATA_DIR, "tasks.json");

// --- helper: ms -> HH:MM:SS (Timesheet formátumhoz) ---
function formatHMS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}


console.log("📁 DATA_DIR  =", DATA_DIR);
console.log("📄 TASKS_FILE=", TASKS_FILE);
console.log("📁 DOC_ROOT  =", DOC_ROOT);


// ---- STATIC ----
app.use(express.static(path.join(__dirname, "public")));
app.use("/docs", express.static(DOC_ROOT));   // fájlok!

// ---- DOC TREE API (docs.html ezt hívja) ----
app.get("/api/docs-tree", async (req, res) => {
  try {
    const rel = (req.query.path || "").replace(/^(\.\.[/\\])+/, "");
    const base = path.join(DOC_ROOT, rel);

    const entries = await fs.readdir(base, { withFileTypes: true });
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


function parseFrontmatter(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta: { tags: [] }, body: md };

  const block = m[1];
  const meta = {};
  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx < 0) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim();
    meta[key] = val;
  }

  // tags -> array
  const tagsRaw = meta.tags || "";
  meta.tags = tagsRaw
    ? tagsRaw.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const body = md.slice(m[0].length);
  return { meta, body };
}

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

// ---- WIKI API -------------------------------------------------------------
const WIKI_ROOT = path.join(DOC_ROOT, "wiki");

function safeRelPath(p) {
  // tiltjuk a ../-t és az abszolút utakat
  const cleaned = String(p || "").replace(/^(\.\.[/\\])+/, "");
  if (cleaned.includes("..")) return null;
  return cleaned;
}

app.get("/api/wiki-pages", async (req, res) => {
  try {
    await fs.mkdir(WIKI_ROOT, { recursive: true });

    const entries = await fs.readdir(WIKI_ROOT, { withFileTypes: true });
    const pages = [];

    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;

      const slug = e.name.replace(/\.md$/i, "");
      const filePath = path.join(WIKI_ROOT, e.name);

      const full = await fs.readFile(filePath, "utf-8");
      const { meta } = parseFrontmatter(full);

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

    pages.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug));
    res.json(pages);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


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

app.put("/api/wiki/:slug", async (req, res) => {
  try {
    await fs.mkdir(WIKI_ROOT, { recursive: true });

    const slug = safeRelPath(req.params.slug);
    if (!slug) return res.status(400).json({ error: "Invalid slug" });

    const incoming = String(req.body?.md ?? "");
    const { meta, body } = parseFrontmatter(incoming);

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

// ---- TASK API (rövidítve) ----
app.get("/api/tasks", async (req, res) => {
  try {
    const raw = await fs.readFile(TASKS_FILE, "utf-8");
    res.json(JSON.parse(raw || "[]"));
  } catch {
    res.json([]);
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const newTask = req.body || {};

    // beolvasás
    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    // új ID
    const maxId = tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
    const id = maxId + 1;

    // alapok (nehogy hiány miatt elhasaljon a frontend)
    const task = {
      id,
      title: String(newTask.title || "New task"),
      status: String(newTask.status || "coming").toLowerCase(),
      createdAt: new Date().toISOString(),
      ...newTask,
      id // biztosan felülírjuk, hogy numerikus legyen
    };

    tasks.push(task);

    // mentés
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

    res.status(201).json(task);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


// ---- START ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Task Manager running at http://localhost:" + PORT)
);

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

    const updated = {
      ...tasks[idx],
      ...patch,
      id: tasks[idx].id // ID-t nem engedjük változni
    };

    if (updated.status) {
      updated.status = String(updated.status).toLowerCase();
    }

    tasks[idx] = updated;

    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const reqId = String(req.params.id);
    const patch = req.body || {};
	console.log("[PATCH BODY]", req.params.id, patch);

// Ha a kliens mozgatni akar, de nem küld status-t, dobjunk 400-at:
if (patch.status == null) {
  return res.status(400).json({ error: "Missing status in PATCH body" });
}


    // 1) tasks beolvasás
    let tasks = [];
    try {
      const raw = await fs.readFile(TASKS_FILE, "utf-8");
      tasks = JSON.parse(raw || "[]");
      if (!Array.isArray(tasks)) tasks = [];
    } catch {
      tasks = [];
    }

    // 2) task megkeresés
    const idx = tasks.findIndex(t => String(t.id) === reqId);
    if (idx < 0) return res.status(404).json({ error: "Task not found" });

    const prev = tasks[idx];

    // 3) státusz normalizálás + kanonizálás
    //    (itt állítsd be a kanonikus oszlop státuszokat, amiket a UI használ)
    const ALLOWED = new Set(["backlog", "coming", "tracking", "done", "active"]); // ha kell még, bővítsd

    let prevStatus = String(prev.status || "").toLowerCase().trim();
  

    const updated = { ...prev, ...patch, id: prev.id };

    if (updated.status != null) {
      updated.status = String(updated.status).toLowerCase().trim();



      // ha ismeretlen státuszt küld a kliens, inkább 400-at adjunk (ne csessze szét az adatot)
      if (!ALLOWED.has(updated.status)) {
        return res.status(400).json({ error: `Invalid status: ${updated.status}` });
      }
    }

    const nextStatus = String(updated.status || prevStatus).toLowerCase().trim();

const isTracking = (s) => s === "tracking";
const now = Date.now();

// START: ha NEM trackingből megy trackingbe -> mindig új session
if (!isTracking(prevStatus) && isTracking(nextStatus)) {
  updated.trackStart = new Date(now).toISOString(); // ✅ string, frontend szereti
  updated.trackedMs = 0;                            // ✅ session 0-ról
}

// HA már tracking, de nincs start (beragadt állapot) -> indítsd el
if (isTracking(nextStatus) && !prev.trackStart) {
  updated.trackStart = new Date(now).toISOString();
  updated.trackedMs = 0;
}





// STOP: ha trackingből kikerül
// STOP: ha trackingből kikerül
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







    // 5) mentés
    tasks[idx] = updated;
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");

 
    return res.json(updated);

  } catch (e) {
    console.error("[PATCH ERROR]", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});





app.get("/favicon.ico", (req, res) => res.status(204).end());

