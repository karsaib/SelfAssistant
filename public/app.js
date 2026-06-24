"use strict";

/**
 * TaskManager frontend (COMING / ACTIVE / TRACKING / OVERDUE / DONE)
 *
 * Features:
 * - Loads tasks from /api/tasks
 * - Renders 5 columns as sticky notes
 * - Time tracking display: trackedMs + running tracking
 * - Editable "Working hours" (trackedHours) in the form
 * - Editable "Timesheet" (timeLog) in the form
 * - Color selector (dropdown): yellow, red, blue, green, gray, orange
 *   - default color = yellow (the current yellow card background)
 * - Drag & drop between columns; moving to ACTIVE can auto-assign all-day today
 * - Monthly CSV report preview
 * - Optional Google Calendar embed
 */

// --- Google Calendar embed config (optional) -------------------------------

const EMBED_CAL_ID = "ekbarna@gmail.com";
const EMBED_TZ     = "Europe/Budapest";
const EMBED_USER   = 0;

// --- DOM references --------------------------------------------------------

const form            = document.getElementById("taskForm");
const formTitle       = document.getElementById("formTitle");
const listSection     = document.getElementById("listSection");
const formSection     = document.getElementById("formSection");
const newBtn          = document.getElementById("newBtn");
const cancelBtn       = document.getElementById("cancelBtn");
const reportBtn       = document.getElementById("reportBtn");
const toggleCalBtn    = document.getElementById("toggleCalBtn");
const calendarSection = document.getElementById("calendarSection");
const gcalFrame       = document.getElementById("gcalFrame");

const colComing   = document.getElementById("col-coming");
const colActive   = document.getElementById("col-active");
const colTracking = document.getElementById("col-tracking");


// Form fields via form.elements
const idField           = form ? form.elements["id"] : null;
const titleField        = form ? form.elements["title"] : null;
const tagField          = form ? form.elements["tag"] : null;
const notesField        = form ? form.elements["notes"] : null;
const allDayField       = form ? form.elements["allDay"] : null;
const startDateField    = form ? form.elements["startDate"] : null;
const startTimeField    = form ? form.elements["startTime"] : null;
const endDateField      = form ? form.elements["endDate"] : null;
const endTimeField      = form ? form.elements["endTime"] : null;
const doneField         = form ? form.elements["done"] : null;
const trackedHoursField = form ? form.elements["trackedHours"] : null;
const timeLogField      = form && form.elements["timeLog"] ? form.elements["timeLog"] : null;
const wikiRefField      = form ? form.elements["wikiRef"] : null;
const sprintIdField     = form ? form.elements["sprintId"] : null;

// --- In-memory state -------------------------------------------------------

let tasks = [];
let timerInterval = null;
let dragTaskId = null;
let wikiPages = [];
let sprints = [];

// --- Small helpers ---------------------------------------------------------

async function loadWikiPages() {
  try {
    const resp = await fetch("/api/wiki-pages");
    if (!resp.ok) return;
    const data = await resp.json();
    wikiPages = Array.isArray(data) ? data : [];
    fillWikiDropdown();
  } catch (e) {
    console.warn("Wiki pages load failed:", e);
  }
}

function fillWikiDropdown() {
  if (!wikiRefField) return;
  wikiRefField.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— none —";
  wikiRefField.appendChild(opt0);

  for (const p of wikiPages) {
    const opt = document.createElement("option");
    opt.value = p.slug;
    opt.textContent = `${p.title || p.slug} (${p.slug})`;
    wikiRefField.appendChild(opt);
  }
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function buildEmbedUrl() {
  if (!EMBED_CAL_ID) return "";
  const cal = encodeURIComponent(EMBED_CAL_ID);
  const tz = encodeURIComponent(EMBED_TZ);
  return `https://calendar.google.com/calendar/embed?src=${cal}&ctz=${tz}&showPrint=0&showTabs=1&showTitle=0&showCalendars=1&mode=week&authuser=${EMBED_USER}`;
}

function findTask(id) {
  return tasks.find(t => String(t.id) === String(id));
}

function currentElapsedMs(t) {
  let ms = Number(t.trackedMs || 0);
  if (t.status === "tracking" && t.trackStart) {
    const start = (typeof t.trackStart === "number") ? t.trackStart : Date.parse(t.trackStart);
    if (Number.isFinite(start)) {
      ms += Math.max(0, Date.now() - start);
    }
  }
  return ms;
}

function timerLabel(t) {
  if (t.status !== "tracking") return "00:00:00";
  return formatMs(currentElapsedMs(t));
}

function fmtTimeWindow(t) {
  const S = (d, tm) => (d ? d : "") + (tm ? " " + tm : "");
  if (t.allDay || (!t.startTime && !t.endTime)) {
    const s = t.startDate || t.due || "";
    const e = t.endDate || s || "";
    if (!s) return "";
    if (e && e !== s) return `${s} – ${e} (all-day)`;
    return `${s} (all-day)`;
  }
  if (t.startDate && t.startTime) {
    const s = S(t.startDate, t.startTime);
    const e = S(t.endDate || t.startDate, t.endTime || "");
    return e.trim() ? `${s} → ${e}` : s;
  }
  return "";
}

// ============================================================
// 📅 SPRINT FUNCTIONS
// ============================================================

async function loadSprintsForDropdown() {
  try {
    const resp = await fetch('/api/sprints');
    if (!resp.ok) {
      console.warn('Failed to load sprints:', resp.status);
      return;
    }
    sprints = await resp.json();
    updateSprintDropdown();
  } catch (err) {
    console.warn('Sprint load failed:', err);
  }
}

function updateSprintDropdown() {
  const select = document.getElementById('sprintSelect');
  if (!select) {
    console.warn('Sprint select element not found');
    return;
  }
  
  const activeSprints = sprints.filter(s => 
    s.status === 'upcoming' || s.status === 'active'
  );
  
  const currentValue = select.value;
  
  select.innerHTML = '<option value="">— none —</option>';
  for (const s of activeSprints) {
    const opt = document.createElement('option');
    opt.value = s.id;
    const statusIcon = s.status === 'active' ? '🟢' : '🔵';
    opt.textContent = `${statusIcon} ${s.name}`;
    select.appendChild(opt);
  }
  
  if (currentValue) {
    select.value = currentValue;
  }
}

function getSprintName(sprintId) {
  if (!sprintId) return null;
  const sprint = sprints.find(s => s.id === sprintId);
  return sprint ? sprint.name : null;
}

// --- Rendering the board ---------------------------------------------------

function render() {
  // 🔥 MINDEN RENDERELÉS ELŐTT: Ellenőrizzük és kiegészítjük a task-okat
  for (const t of tasks) {
    const hasChildren = tasks.some(child => child.parentId === t.id);
    
    if (!t.type) {
      if (hasChildren || !t.parentId) {
        t.type = "root";
      } else {
        t.type = "subtask";
      }
    }
    
    if (t.parentId === undefined) {
      t.parentId = null;
    }
  }

  const byStatus = {
    coming:   colComing,
    active:   colActive,
    tracking: colTracking,
    overdue:  colActive
  };

  Object.values(byStatus).forEach(col => { if (col) col.innerHTML = ""; });

  for (const t of tasks) {
    // 🔥 HA DONE, SKIPPELJÜK (ne jelenjen meg a Board-on)
    if (t.status === "done") continue;
    
    const col = byStatus[t.status] || colComing;
    if (!col) continue;

    const card = document.createElement("article");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = t.id;

    const isRoot = t.type === "root";
    const isSubtask = t.type === "subtask";

    if (t.status === "tracking" && t.trackStart) {
      card.classList.add("tracking-running");
    }

    if (isRoot) {
      card.style.cssText += `
        border-left: 5px solid #4a6cf7 !important;
        border-top-left-radius: 4px !important;
        border-bottom-left-radius: 4px !important;
        background: #f8faff !important;
        box-shadow: 0 6px 14px rgba(74,108,247,0.1), 0 2px 6px rgba(0,0,0,0.06) !important;
      `;
      card.classList.add("root-card");
    } else if (isSubtask) {
      card.style.cssText += `
        margin-left: 12px !important;
        border-left: 2px dashed #d1d5db !important;
        background: #fafafa !important;
        opacity: 0.92 !important;
      `;
      card.classList.add("subtask-card");
    }

    const headerDiv = document.createElement("div");
    headerDiv.style.cssText = `
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      margin-bottom: 6px !important;
      flex-wrap: wrap !important;
    `;

    const typeBadge = document.createElement("span");
    typeBadge.className = "type-badge";
    
    if (isRoot) {
      typeBadge.textContent = "📦 Root";
      typeBadge.style.cssText = `
        font-size: 0.6rem !important;
        font-weight: 700 !important;
        color: #1e40af !important;
        background: #dbeafe !important;
        padding: 2px 12px !important;
        border-radius: 12px !important;
        border: 1px solid #93c5fd !important;
        flex-shrink: 0 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
      `;
    } else if (isSubtask) {
      typeBadge.textContent = "↳ Subtask";
      typeBadge.style.cssText = `
        font-size: 0.55rem !important;
        font-weight: 500 !important;
        color: #6b7280 !important;
        background: #f3f4f6 !important;
        padding: 2px 10px !important;
        border-radius: 12px !important;
        border: 1px solid #e5e7eb !important;
        flex-shrink: 0 !important;
      `;
    } else {
      typeBadge.textContent = "📌 Task";
      typeBadge.style.cssText = `
        font-size: 0.55rem !important;
        font-weight: 500 !important;
        color: #4a5568 !important;
        background: #f0f2f5 !important;
        padding: 2px 10px !important;
        border-radius: 12px !important;
        border: 1px solid #e1e4ec !important;
        flex-shrink: 0 !important;
      `;
    }
    headerDiv.appendChild(typeBadge);

    const titleEl = document.createElement("span");
    titleEl.className = "title";
    titleEl.textContent = t.title || "(no title)";

    let titleFontSize = "1rem";
    let titleFontWeight = "600";
    let titleColor = "#1f1f1f";

    if (isRoot) {
      titleFontSize = "1.2rem";
      titleFontWeight = "700";
      titleColor = "#0f172a";
    } else if (isSubtask) {
      titleFontSize = "0.95rem";
      titleFontWeight = "500";
      titleColor = "#4a5568";
    }

    titleEl.style.cssText = `
      font-size: ${titleFontSize} !important;
      font-weight: ${titleFontWeight} !important;
      color: ${titleColor} !important;
      word-break: break-word !important;
      flex: 1 !important;
    `;
    headerDiv.appendChild(titleEl);
    card.appendChild(headerDiv);

    const when = document.createElement("div");
    when.className = "when";
    when.textContent = fmtTimeWindow(t);
    when.style.cssText = `
      font-size: 0.8rem !important;
      color: #4a5568 !important;
      margin-bottom: 4px !important;
    `;
    card.appendChild(when);

    if (t.tag) {
      const tagEl = document.createElement("div");
      tagEl.className = "tag";
      tagEl.textContent = t.tag;
      tagEl.style.cssText = `
        display: inline-block !important;
        margin-top: 4px !important;
        padding: 1px 10px !important;
        border: 1px dashed rgba(0,0,0,0.2) !important;
        border-radius: 12px !important;
        font-size: 0.75rem !important;
        color: #333 !important;
        background: rgba(255,255,255,0.5) !important;
      `;
      card.appendChild(tagEl);
    }

    if (t.notes) {
      const descEl = document.createElement("div");
      descEl.className = "desc";
      descEl.textContent = t.notes;
      descEl.style.cssText = `
        font-size: 0.85rem !important;
        color: #2a2a2a !important;
        margin-top: 4px !important;
        display: -webkit-box !important;
        -webkit-line-clamp: 3 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
      `;
      card.appendChild(descEl);
    }

    if (t.wikiRef) {
      const wiki = document.createElement("div");
      wiki.className = "tag";
      wiki.style.cssText = `
        display: inline-block !important;
        margin-top: 4px !important;
        padding: 1px 10px !important;
        border-radius: 12px !important;
        font-size: 0.75rem !important;
      `;
      const a = document.createElement("a");
      a.href = `/wiki.html#${encodeURIComponent(t.wikiRef)}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.textDecoration = "none";
      a.style.color = "inherit";
      a.textContent = `📘 ${t.wikiRef}`;
      wiki.appendChild(a);
      card.appendChild(wiki);
    }

    // 🔥 SPRINT MEGJELENÍTÉS A KÁRTYÁN
    if (t.sprintId) {
      const sprintId = Number(t.sprintId);
      const sprint = sprints.find(s => Number(s.id) === sprintId);
      
      if (sprint) {
        const sprintEl = document.createElement("div");
        sprintEl.className = "sprint-tag";
        sprintEl.textContent = `📅 ${sprint.name}`;
        sprintEl.style.cssText = `
          display: inline-block !important;
          margin-top: 4px !important;
          padding: 2px 10px !important;
          border-radius: 12px !important;
          font-size: 0.65rem !important;
          background: #f0fdf4 !important;
          border: 1px solid #bbf7d0 !important;
          color: #15803d !important;
        `;
        card.appendChild(sprintEl);
      }
    }

    // Root hivatkozás
    if (t.parentId) {
      const rootTask = tasks.find(task => task.id === t.parentId);
      if (rootTask) {
        const rootRef = document.createElement("div");
        rootRef.className = "root-ref";
        rootRef.style.cssText = `
          display: inline-block !important;
          margin-top: 4px !important;
          padding: 2px 10px !important;
          border-radius: 12px !important;
          font-size: 0.7rem !important;
          background: #f0f7ff !important;
          border: 1px solid #dbeafe !important;
          color: #4a6cf7 !important;
          cursor: pointer !important;
          transition: all 0.2s !important;
        `;
        rootRef.addEventListener('mouseenter', () => {
          rootRef.style.background = '#dbeafe';
        });
        rootRef.addEventListener('mouseleave', () => {
          rootRef.style.background = '#f0f7ff';
        });
        
        const link = document.createElement("a");
        link.href = `#task-${rootTask.id}`;
        link.textContent = `📎 ${rootTask.title}`;
        link.style.cssText = `
          text-decoration: none !important;
          color: #4a6cf7 !important;
        `;
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const rootCard = document.querySelector(`.card[data-id="${rootTask.id}"]`);
          if (rootCard) {
            rootCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            rootCard.style.transition = 'box-shadow 0.3s ease';
            rootCard.style.boxShadow = '0 0 0 3px #4a6cf7, 0 8px 20px rgba(74,108,247,0.3)';
            setTimeout(() => {
              rootCard.style.boxShadow = '';
            }, 3000);
          } else {
            alert(`Root task "${rootTask.title}" is not visible on the board.`);
          }
        });
        
        rootRef.appendChild(link);
        card.appendChild(rootRef);
      }
    }

    // --- Actions (Edit, Done, Delete) ---
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.style.cssText = `
      position: absolute !important;
      top: 6px !important;
      right: 6px !important;
      display: flex !important;
      gap: 4px !important;
    `;

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.type = "button";
    editBtn.textContent = "✏️";
    editBtn.style.cssText = `
      padding: 2px 6px !important;
      border-radius: 4px !important;
      border: 1px solid rgba(0,0,0,0.2) !important;
      background: #ffffffcc !important;
      cursor: pointer !important;
      font-size: 0.7rem !important;
    `;
    editBtn.addEventListener("click", () => openFormForEdit(t.id));
    actions.appendChild(editBtn);

    // ✅ DONE GOMB (csak akkor jelenik meg, ha nincs már done)
    if (t.status !== "done") {
      const doneBtn = document.createElement("button");
      doneBtn.className = "btn";
      doneBtn.type = "button";
      doneBtn.textContent = "✅";
      doneBtn.style.cssText = `
        padding: 2px 6px !important;
        border-radius: 4px !important;
        border: 1px solid #22c55e !important;
        background: #ffffffcc !important;
        cursor: pointer !important;
        font-size: 0.7rem !important;
        color: #22c55e !important;
      `;
      doneBtn.addEventListener("click", async () => {
        await markAsDone(t.id);
      });
      actions.appendChild(doneBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.type = "button";
    delBtn.textContent = "✕";
    delBtn.style.cssText = `
      padding: 2px 6px !important;
      border-radius: 4px !important;
      border: 1px solid #c33 !important;
      background: #ffffffcc !important;
      cursor: pointer !important;
      font-size: 0.7rem !important;
      color: #c33 !important;
    `;
    delBtn.addEventListener("click", () => onDelete(t.id));
    actions.appendChild(delBtn);

    card.appendChild(actions);

    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragend", onDragEnd);

    col.appendChild(card);
  }

  startTimerLoop();
}

// Periodic timer refresh on cards
function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const timers = document.querySelectorAll(".card .timer");
    timers.forEach(el => {
      const t = findTask(el.dataset.id);
      if (!t) return;
      el.textContent = timerLabel(t);
    });
  }, 1000);
}

// --- Drag & Drop between columns -------------------------------------------

function onDragStart(ev) {
  const id = ev.currentTarget.dataset.id;
  dragTaskId = id;
  if (ev.dataTransfer) {
    ev.dataTransfer.setData("text/plain", id);
    ev.dataTransfer.setDragImage(ev.currentTarget, 50, 20);
  }
}

function onDragEnd() {
  dragTaskId = null;
}

function setupDropZones() {
  const cols = document.querySelectorAll(".col-list");
  cols.forEach(col => {
    col.addEventListener("dragover", ev => {
      ev.preventDefault();
    });

    col.addEventListener("drop", async ev => {
      ev.preventDefault();
      const id = dragTaskId || (ev.dataTransfer && ev.dataTransfer.getData("text/plain"));
      if (!id) return;

      const t = findTask(id);
      if (!t) return;

      const colEl = ev.currentTarget;
      const wrap = colEl.closest("[data-status]");
      const newStatus = (wrap && wrap.dataset.status) ? wrap.dataset.status : "coming";

      if (newStatus === t.status) return;

      const patch = { status: newStatus };

      if (newStatus === "coming") {
        patch.allDay = false;
        patch.startDate = null;
        patch.startTime = null;
        patch.endDate = null;
        patch.endTime = null;
        patch.due = null;
      }

      if (newStatus === "active" && !t.startDate && !t.startTime && !t.endDate && !t.endTime) {
        const today = todayYMD();
        patch.allDay = true;
        patch.startDate = today;
        patch.startTime = null;
        patch.endDate = today;
        patch.endTime = null;
        patch.due = null;
      }

      await savePatch(id, patch);
      await loadTasksFromServer();
    });
  });
}

async function savePatch(id, patch) {
  try {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      console.error("PATCH /api/tasks failed", await resp.text());
      alert("Error updating task status.");
    }
  } catch (err) {
    console.error("PATCH error:", err);
    alert("Network error while updating status.");
  }
}

// --- Form show/hide logic --------------------------------------------------

function openFormForNew() {
  if (!form || !formSection || !listSection) return;

  if (form.reset) form.reset();

  if (idField) idField.value = "";
  if (titleField) titleField.value = "";
  if (tagField) tagField.value = "";
  if (notesField) notesField.value = "";
  if (allDayField) allDayField.checked = false;
  if (startDateField) startDateField.value = "";
  if (startTimeField) startTimeField.value = "";
  if (endDateField) endDateField.value = "";
  if (endTimeField) endTimeField.value = "";
  if (doneField) doneField.checked = false;
  if (trackedHoursField) trackedHoursField.value = "";
  if (timeLogField) timeLogField.value = "";
  if (wikiRefField) wikiRefField.value = "";
  if (sprintIdField) sprintIdField.value = "";

  formTitle.textContent = "New Task";
  listSection.hidden = true;
  formSection.hidden = false;
  toggleTimeInputs();
}

function openFormForEdit(id) {
  const t = findTask(id);
  if (!t || !form || !formSection || !listSection) return;

  if (idField) idField.value = t.id || "";
  if (titleField) titleField.value = t.title || "";
  if (tagField) tagField.value = t.tag || "";
  if (notesField) notesField.value = t.notes || "";
  if (allDayField) allDayField.checked = !!t.allDay;
  if (startDateField) startDateField.value = t.startDate || t.due || "";
  if (startTimeField) startTimeField.value = t.startTime || "";
  if (endDateField) endDateField.value = t.endDate || "";
  if (endTimeField) endTimeField.value = t.endTime || "";
  if (doneField) doneField.checked = !!t.done;
  if (wikiRefField) wikiRefField.value = t.wikiRef || "";
  if (sprintIdField) sprintIdField.value = t.sprintId || "";

  if (trackedHoursField) {
    const msTotal = Number(t.trackedMsTotal ?? t.trackedMs ?? 0);
    trackedHoursField.value = msTotal > 0 ? (msTotal / 3600000).toFixed(2) : "";
  }

  if (timeLogField) {
    timeLogField.value = t.timeLog || "";
  }

  formTitle.textContent = "Edit Task";
  listSection.hidden = true;
  formSection.hidden = false;
  toggleTimeInputs();
}

function closeForm() {
  if (!formSection || !listSection) return;
  formSection.hidden = true;
  listSection.hidden = false;
}

function toggleTimeInputs() {
  if (!startTimeField || !endTimeField || !allDayField) return;
  const dis = !!allDayField.checked;
  startTimeField.disabled = dis;
  endTimeField.disabled = dis;
}

// --- Form submit (Create / Update) ----------------------------------------

async function onSubmit(ev) {
  ev.preventDefault();
  if (!form || !titleField) return;

  if (!titleField.value.trim()) {
    alert("Title is required.");
    return;
  }

  const allDay = !!(allDayField && allDayField.checked);

  let trackedMs = 0;
  if (trackedHoursField && trackedHoursField.value) {
    const h = Number(trackedHoursField.value);
    if (Number.isFinite(h) && h > 0) {
      trackedMs = h * 3600000;
    }
  }

  const idValue = idField ? idField.value : "";
  const hasId = !!idValue;

  let sprintId = sprintIdField ? sprintIdField.value : null;
  if (sprintId === "" || sprintId === "null") sprintId = null;

  const payload = {
    title: titleField.value,
    tag: tagField ? (tagField.value || "").trim() : "",
    notes: notesField ? notesField.value : "",
    done: !!(doneField && doneField.checked),
    allDay,
    startDate: startDateField ? (startDateField.value || null) : null,
    startTime: allDay ? null : (startTimeField ? (startTimeField.value || null) : null),
    endDate: endDateField ? (endDateField.value || null) : null,
    endTime: allDay ? null : (endTimeField ? (endTimeField.value || null) : null),
    trackedMs,
    trackStart: null,
    timeLog: timeLogField ? (timeLogField.value || "").trim() : "",
    wikiRef: wikiRefField ? (wikiRefField.value || "").trim() : "",
    sprintId: sprintId,
    status: hasId ? undefined : "coming",
  };

  try {
    if (hasId) {
      const resp = await fetch(`/api/tasks/${encodeURIComponent(idValue)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("PUT /api/tasks failed", resp.status, errText);
        alert("Error saving task (PUT).");
        return;
      }
    } else {
      const resp = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("POST /api/tasks failed", resp.status, errText);
        alert("Error creating new task (POST).");
        return;
      }
    }

    await loadTasksFromServer();
    closeForm();
  } catch (err) {
    console.error("Save error:", err);
    alert("Unexpected error while saving task.");
  }
}

// --- Mark task as done ---
async function markAsDone(id) {
  if (!confirm('Mark this task as done? It will disappear from the board.')) return;
  
  try {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    
    if (!resp.ok) {
      console.error("PATCH /api/tasks failed", await resp.text());
      alert("Error marking task as done.");
      return;
    }
    
    await loadTasksFromServer();
  } catch (err) {
    console.error("Done error:", err);
    alert("Unexpected error while marking task as done.");
  }
}

async function onDelete(id) {
  if (!confirm("Are you sure you want to delete this task?")) return;
  try {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      console.error("DELETE /api/tasks failed", await resp.text());
      alert("Error deleting task.");
      return;
    }
    await loadTasksFromServer();
  } catch (err) {
    console.error("Delete error:", err);
    alert("Unexpected error while deleting task.");
  }
}

// --- Load tasks from backend ----------------------------------------------

async function loadTasksFromServer() {
  try {
    const resp = await fetch("/api/tasks");
    if (!resp.ok) {
      console.error("GET /api/tasks failed", await resp.text());
      return;
    }
    const data = await resp.json();
    if (!Array.isArray(data)) {
      console.error("Unexpected /api/tasks response:", data);
      return;
    }

    const today = todayYMD();

    for (const t of data) {
      const start = t.startDate || t.due || null;
      const end = t.endDate || start;

      if (!start) continue;

      if (t.status !== "tracking" && today >= start && today <= end) {
        if (t.status === "coming") {
          t.status = "active";
        }
      } else if (t.status !== "tracking" && today < start) {
        if (t.status === "active") {
          t.status = "coming";
        }
      }
    }

    tasks = data;
    render();
  } catch (err) {
    console.error("GET /api/tasks error:", err);
    alert("Error loading tasks.");
  }
}

// --- Monthly report (CSV) --------------------------------------------------

async function showMonthlyReport() {
  const csvModal = document.getElementById("csvModal");
  const csvContent = document.getElementById("csvContent");

  try {
    const resp = await fetch("/api/reports/monthly");
    if (!resp.ok) {
      console.error("GET /api/reports/monthly failed", await resp.text());
      alert("Error fetching monthly report.");
      return;
    }
    const text = await resp.text();

    if (!csvModal || !csvContent) {
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "monthly_report.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    csvContent.textContent = text;
    csvModal.style.display = "flex";
  } catch (err) {
    console.error("Report error:", err);
    alert("Error creating report.");
  }
}

// --- Calendar toggle -------------------------------------------------------

function onToggleCalendar() {
  if (!calendarSection) return;
  if (calendarSection.hidden) {
    calendarSection.hidden = false;
    if (gcalFrame && !gcalFrame.src) {
      const url = buildEmbedUrl();
      if (!url) {
        alert("Set EMBED_CAL_ID in app.js if you want Calendar integration.");
      } else {
        gcalFrame.src = url;
      }
    }
  } else {
    calendarSection.hidden = true;
  }
}

// --- Event wiring ----------------------------------------------------------

if (newBtn) {
  newBtn.addEventListener("click", () => openFormForNew());
}
if (cancelBtn) {
  cancelBtn.addEventListener("click", () => closeForm());
}
if (form) {
  form.addEventListener("submit", onSubmit);
}
if (reportBtn) {
  reportBtn.addEventListener("click", () => showMonthlyReport());
}
if (toggleCalBtn) {
  toggleCalBtn.addEventListener("click", () => onToggleCalendar());
}
if (allDayField) {
  allDayField.addEventListener("change", () => toggleTimeInputs());
}

// --- Bootstrap -------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  setupDropZones();
  loadWikiPages();
  loadSprintsForDropdown();
  loadTasksFromServer();
  toggleTimeInputs();
});