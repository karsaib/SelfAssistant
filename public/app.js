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

const EMBED_CAL_ID = "ekbarna@gmail.com";              // e.g. "your_email@gmail.com" or leave empty
const EMBED_TZ     = "Europe/Budapest";
const EMBED_USER   = 0;               // authuser param (0 or 1 in browser)

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
const colOverdue  = document.getElementById("col-overdue");
const colDone     = document.getElementById("col-done");

// Form fields via form.elements (safer than getElementById where possible)
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
const colorField        = form ? form.elements["color"] : null;

// --- In-memory state -------------------------------------------------------

let tasks = [];
let timerInterval = null;
let dragTaskId = null;

// --- Small helpers ---------------------------------------------------------

function todayYMD(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Format ms -> "HH:MM:SS"
function formatMs(ms){
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Build Google Calendar embed URL
function buildEmbedUrl(){
  if (!EMBED_CAL_ID) return "";
  const cal = encodeURIComponent(EMBED_CAL_ID);
  const tz  = encodeURIComponent(EMBED_TZ);
  return `https://calendar.google.com/calendar/embed?src=${cal}&ctz=${tz}&showPrint=0&showTabs=1&showTitle=0&showCalendars=1&mode=week&authuser=${EMBED_USER}`;
}

// Find a task by id
function findTask(id){
  return tasks.find(t => String(t.id) === String(id));
}

// Current elapsed ms for timer (trackedMs + running tracking)
function currentElapsedMs(t){
  let ms = Number(t.trackedMs || 0);
  if (t.status === "tracking" && t.trackStart){
    const start = Date.parse(t.trackStart);
    if (!Number.isNaN(start)){
      ms += Math.max(0, Date.now() - start);
    }
  }
  return ms;
}

// Timer label used on cards
function timerLabel(t){
  return formatMs(currentElapsedMs(t));
}

// Human-readable time window (the "időablak" on card)
function fmtTimeWindow(t) {
  const S = (d, tm) => (d ? d : "") + (tm ? " " + tm : "");

  // All-day or missing explicit times
  if (t.allDay || (!t.startTime && !t.endTime)) {
    const s = t.startDate || t.due || "";
    const e = t.endDate || s || "";
    if (!s) return "";
    if (e && e !== s) return `${s} – ${e} (all-day)`;
    return `${s} (all-day)`;
  }

  // Timed event
  if (t.startDate && t.startTime) {
    const s = S(t.startDate, t.startTime);
    const e = S(t.endDate || t.startDate, t.endTime || "");
    return e.trim() ? `${s} → ${e}` : s;
  }

  // Nothing useful
  return "";
}

// --- Rendering the board ---------------------------------------------------

function render(){
  const byStatus = {
    coming:   colComing,
    active:   colActive,
    tracking: colTracking,
    overdue:  colOverdue,
    done:     colDone,
  };

  // Clear all columns
  Object.values(byStatus).forEach(col => { if (col) col.innerHTML = ""; });

  // Render each task as a card
  for (const t of tasks){
    const col = byStatus[t.status] || colComing;
    if (!col) continue;

    const card = document.createElement("article");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = t.id;

    // Apply color class based on t.color
    if (t.color && t.color !== "yellow") {
      card.classList.add("color-" + t.color);
    }
    // yellow (or missing) => base .card style from CSS

    // Title
    const titleEl = document.createElement("div");
    titleEl.className = "title";
    titleEl.textContent = t.title || "(no title)";
    card.appendChild(titleEl);

    // Time window
    const when = document.createElement("div");
    when.className = "when";
    when.textContent = fmtTimeWindow(t);
    card.appendChild(when);

    // Tag
    if (t.tag){
      const tagEl = document.createElement("div");
      tagEl.className = "tag";
      tagEl.textContent = t.tag;
      card.appendChild(tagEl);
    }

    // Notes / description
    if (t.notes){
      const descEl = document.createElement("div");
      descEl.className = "desc";
      descEl.textContent = t.notes;
      card.appendChild(descEl);
    }

    // Timer
    const timerEl = document.createElement("div");
    timerEl.className = "timer";
    timerEl.dataset.id = t.id;
    timerEl.textContent = timerLabel(t);
    card.appendChild(timerEl);

    // Actions (Edit, Delete)
    const actions = document.createElement("div");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openFormForEdit(t.id));
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.type = "button";
    delBtn.textContent = "X";
    delBtn.addEventListener("click", () => onDelete(t.id));
    actions.appendChild(delBtn);

    card.appendChild(actions);

    // Drag & drop events for the card
    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragend", onDragEnd);

    col.appendChild(card);
  }

  startTimerLoop();
}

// Periodic timer refresh on cards
function startTimerLoop(){
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

function onDragStart(ev){
  const id = ev.currentTarget.dataset.id;
  dragTaskId = id;
  if (ev.dataTransfer){
    ev.dataTransfer.setData("text/plain", id);
    ev.dataTransfer.setDragImage(ev.currentTarget, 50, 20);
  }
}

function onDragEnd(){
  dragTaskId = null;
}

function setupDropZones(){
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
      const newStatus = (colEl.parentElement && colEl.parentElement.dataset.status) || "coming";
      if (newStatus === t.status) return;

      const patch = { status: newStatus };

      // If moved into ACTIVE and the task has no dates, set today as all-day
      if (newStatus === "active" && !t.startDate && !t.startTime && !t.endDate && !t.endTime){
        const today = todayYMD();
        patch.allDay    = true;
        patch.startDate = today;
        patch.startTime = null;
        patch.endDate   = today;
        patch.endTime   = null;
        patch.due       = null;
      }

      await savePatch(id, patch);
      await loadTasksFromServer();
    });
  });
}

// Partial update to backend
async function savePatch(id, patch){
  try{
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok){
      console.error("PATCH /api/tasks failed", await resp.text());
      alert("Error updating task status.");
    }
  }catch(err){
    console.error("PATCH error:", err);
    alert("Network error while updating status.");
  }
}

// --- Form show/hide logic --------------------------------------------------

// Open form for new task
function openFormForNew(){
  if (!form || !formSection || !listSection) return;

  if (form.reset) form.reset();

  if (idField)           idField.value = "";
  if (titleField)        titleField.value = "";
  if (tagField)          tagField.value = "";
  if (notesField)        notesField.value = "";
  if (allDayField)       allDayField.checked = false;
  if (startDateField)    startDateField.value = "";
  if (startTimeField)    startTimeField.value = "";
  if (endDateField)      endDateField.value = "";
  if (endTimeField)      endTimeField.value = "";
  if (doneField)         doneField.checked = false;
  if (trackedHoursField) trackedHoursField.value = "";
  if (timeLogField)      timeLogField.value = "";
  if (colorField)        colorField.value = "yellow";

  formTitle.textContent   = "New Task";
  listSection.hidden      = true;
  formSection.hidden      = false;

  toggleTimeInputs();
}

// Open form for editing an existing task
function openFormForEdit(id){
  const t = findTask(id);
  if (!t || !form || !formSection || !listSection) return;

  if (idField)           idField.value = t.id || "";
  if (titleField)        titleField.value = t.title || "";
  if (tagField)          tagField.value = t.tag || "";
  if (notesField)        notesField.value = t.notes || "";
  if (allDayField)       allDayField.checked = !!t.allDay;
  if (startDateField)    startDateField.value = t.startDate || t.due || "";
  if (startTimeField)    startTimeField.value = t.startTime || "";
  if (endDateField)      endDateField.value = t.endDate || "";
  if (endTimeField)      endTimeField.value = t.endTime || "";
  if (doneField)         doneField.checked = !!t.done;

  // Working hours: same logic as board timer
  if (trackedHoursField){
    const ms = currentElapsedMs(t);
    trackedHoursField.value = ms > 0 ? (ms / 3600000).toFixed(2) : "";
  }

  // timeLog text
  if (timeLogField){
    timeLogField.value = t.timeLog || "";
  }

  // color dropdown
  if (colorField){
    colorField.value = t.color || "yellow";
  }

  formTitle.textContent = "Edit Task";
  listSection.hidden    = true;
  formSection.hidden    = false;

  toggleTimeInputs();
}

// Hide form, show board
function closeForm(){
  if (!formSection || !listSection) return;
  formSection.hidden = true;
  listSection.hidden = false;
}

// Enable/disable time inputs based on allDay checkbox
function toggleTimeInputs(){
  if (!startTimeField || !endTimeField || !allDayField) return;
  const dis = !!allDayField.checked;
  startTimeField.disabled = dis;
  endTimeField.disabled   = dis;
}

// --- Form submit (Create / Update) ----------------------------------------

async function onSubmit(ev){
  ev.preventDefault();
  if (!form || !titleField) return;

  if (!titleField.value.trim()){
    alert("Title is required.");
    return;
  }

   const allDay = !!(allDayField && allDayField.checked);

  // Convert trackedHours => trackedMs
  let trackedMs = 0;
  if (trackedHoursField && trackedHoursField.value){
    const h = Number(trackedHoursField.value);
    if (Number.isFinite(h) && h > 0){
      trackedMs = h * 3600000;
    }
  }

  const idValue = idField ? idField.value : "";
  const hasId   = !!idValue;

  const payload = {
    title:   titleField.value,
    tag:     tagField ? (tagField.value || "").trim() : "",
    notes:   notesField ? notesField.value : "",
    done:    !!(doneField && doneField.checked),
    allDay,
    startDate: startDateField ? (startDateField.value || null) : null,
    startTime: allDay ? null : (startTimeField ? (startTimeField.value || null) : null),
    endDate:   endDateField ? (endDateField.value || null) : null,
    endTime:   allDay ? null : (endTimeField ? (endTimeField.value || null) : null),
    trackedMs,
    trackStart: null,
    timeLog: timeLogField ? (timeLogField.value || "").trim() : "",
    color:   colorField ? (colorField.value || "yellow") : "yellow",
    status:  hasId ? undefined : "coming",
  };

  try{
    if (hasId){
      // Update existing task
      const resp = await fetch(`/api/tasks/${encodeURIComponent(idValue)}`, {
        method: "PUT",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok){
        const errText = await resp.text();
        console.error("PUT /api/tasks failed", resp.status, errText);
        alert("Error saving task (PUT).");
        return;
      }
    } else {
      // Create new task
      const resp = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok){
        const errText = await resp.text();
        console.error("POST /api/tasks failed", resp.status, errText);
        alert("Error creating new task (POST).");
        return;
      }
    }

    await loadTasksFromServer();
    closeForm();

  }catch(err){
    console.error("Save error:", err);
    alert("Unexpected error while saving task.");
  }
}

// --- Delete task -----------------------------------------------------------

async function onDelete(id){
  if (!confirm("Are you sure you want to delete this task?")) return;
  try{
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!resp.ok){
      console.error("DELETE /api/tasks failed", await resp.text());
      alert("Error deleting task.");
      return;
    }
    await loadTasksFromServer();
  }catch(err){
    console.error("Delete error:", err);
    alert("Unexpected error while deleting task.");
  }
}

// --- Load tasks from backend ----------------------------------------------

// --- Load tasks from backend ----------------------------------------------

async function loadTasksFromServer(){
  try{
    const resp = await fetch("/api/tasks");
    if (!resp.ok){
      console.error("GET /api/tasks failed", await resp.text());
      return;
    }
    const data = await resp.json();
    if (!Array.isArray(data)){
      console.error("Unexpected /api/tasks response:", data);
      return;
    }

    // 🔁 Automatikus státusz igazítás dátumtartomány alapján
    const today = todayYMD();

    for (const t of data) {
      const start = t.startDate || t.due || null;
      const end   = t.endDate || start;

      if (!start) continue; // nincs dátum → nem nyúlunk hozzá

      if (today >= start && today <= end) {
        // ma a tartományban van → ha még COMING, tegyük ACTIVE-ba
        if (t.status === "coming") {
          t.status = "active";
        }
      } else if (today < start) {
        // ma a kezdés előtt van → ha ACTIVE, tegyük vissza COMING-ba
        if (t.status === "active") {
          t.status = "coming";
        }
      }
      // (OVERDUE logikát most direkt nem piszkáljuk)
    }

    tasks = data;
    render();
  }catch(err){
    console.error("GET /api/tasks error:", err);
    alert("Error loading tasks.");
  }
}


// --- Monthly report (CSV) --------------------------------------------------

async function showMonthlyReport(){
  const csvModal   = document.getElementById("csvModal");
  const csvContent = document.getElementById("csvContent");

  try{
    const resp = await fetch("/api/reports/monthly");
    if (!resp.ok){
      console.error("GET /api/reports/monthly failed", await resp.text());
      alert("Error fetching monthly report.");
      return;
    }
    const text = await resp.text();

    // If no modal, trigger direct download
    if (!csvModal || !csvContent){
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "monthly_report.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    // Show preview in modal
    csvContent.textContent = text;
    csvModal.style.display = "flex";

  }catch(err){
    console.error("Report error:", err);
    alert("Error creating report.");
  }
}

// --- Calendar toggle -------------------------------------------------------

function onToggleCalendar(){
  if (!calendarSection) return;
  if (calendarSection.hidden){
    calendarSection.hidden = false;
    if (gcalFrame && !gcalFrame.src){
      const url = buildEmbedUrl();
      if (!url){
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

if (newBtn){
  newBtn.addEventListener("click", () => openFormForNew());
}
if (cancelBtn){
  cancelBtn.addEventListener("click", () => closeForm());
}
if (form){
  form.addEventListener("submit", onSubmit);
}
if (reportBtn){
  reportBtn.addEventListener("click", () => showMonthlyReport());
}
if (toggleCalBtn){
  toggleCalBtn.addEventListener("click", () => onToggleCalendar());
}
if (allDayField){
  allDayField.addEventListener("change", () => toggleTimeInputs());
}

// --- Bootstrap -------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  setupDropZones();
  loadTasksFromServer();
  toggleTimeInputs();
});
