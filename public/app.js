"use strict";

// ============================================================
// DOM referenciák
// ============================================================

const form = document.getElementById("taskForm");
const formTitle = document.getElementById("formTitle");
const listSection = document.getElementById("listSection");
const formSection = document.getElementById("formSection");
const newBtn = document.getElementById("newBtn");
const cancelBtn = document.getElementById("cancelBtn");
const reportBtn = document.getElementById("reportBtn");
const toggleCalBtn = document.getElementById("toggleCalBtn");
const calendarSection = document.getElementById("calendarSection");
const gcalFrame = document.getElementById("gcalFrame");

const colComing = document.getElementById("col-coming");
const colActive = document.getElementById("col-active");
const colTracking = document.getElementById("col-tracking");

// Form mezők
const idField = form ? form.elements["id"] : null;
const titleField = form ? form.elements["title"] : null;
const tagField = form ? form.elements["tag"] : null;
const notesField = form ? form.elements["notes"] : null;
const deadlineField = form ? form.elements["deadline"] : null;
const doneField = form ? form.elements["done"] : null;
const trackedHoursField = form ? form.elements["trackedHours"] : null;
const timeLogField = form && form.elements["timeLog"] ? form.elements["timeLog"] : null;
const wikiRefField = form ? form.elements["wikiRef"] : null;
const sprintIdField = form ? form.elements["sprintId"] : null;

// ============================================================
// ÁLLAPOT
// ============================================================

let tasks = [];
let timerInterval = null;
let dragTaskId = null;
let wikiPages = [];
let sprints = [];

// ============================================================
// SEGÉDFÜGGVÉNYEK
// ============================================================

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

function findTask(id) {
  return tasks.find(t => String(t.id) === String(id));
}

function checkDeadlineStatus(deadline) {
  if (!deadline) return { isToday: false, isOverdue: false, status: 'none' };
  const today = todayYMD();
  if (deadline === today) return { isToday: true, isOverdue: false, status: 'today' };
  if (deadline < today) return { isToday: false, isOverdue: true, status: 'overdue' };
  return { isToday: false, isOverdue: false, status: 'upcoming' };
}

function daysUntilDeadline(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(deadline + 'T00:00:00');
  return Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
}

function formatDeadline(deadline) {
  if (!deadline) return '';
  const d = new Date(deadline + 'T00:00:00');
  return d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ============================================================
// WIKI / SPRINT BETÖLTÉS
// ============================================================

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
  wikiRefField.innerHTML = '<option value="">— none —</option>';
  for (const p of wikiPages) {
    const opt = document.createElement("option");
    opt.value = p.slug;
    opt.textContent = `${p.title || p.slug} (${p.slug})`;
    wikiRefField.appendChild(opt);
  }
}

async function loadSprintsForDropdown() {
  try {
    const resp = await fetch('/api/sprints');
    if (!resp.ok) return;
    sprints = await resp.json();
    updateSprintDropdown();
  } catch (err) {
    console.warn('Sprint load failed:', err);
  }
}

function updateSprintDropdown() {
  if (!sprintIdField) return;
  const activeSprints = sprints.filter(s => s.status === 'upcoming' || s.status === 'active');
  sprintIdField.innerHTML = '<option value="">— none —</option>';
  for (const s of activeSprints) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.status === 'active' ? '🟢' : '🔵'} ${s.name}`;
    sprintIdField.appendChild(opt);
  }
}

// ============================================================
// RENDERELÉS
// ============================================================

function render() {
  // Oszlopok kiürítése
  if (colComing) colComing.innerHTML = '';
  if (colActive) colActive.innerHTML = '';
  if (colTracking) colTracking.innerHTML = '';

  const byStatus = {
    coming: colComing,
    active: colActive,
    tracking: colTracking,
    overdue: colActive
  };

  // Taskok rendezése
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === 'tracking' && b.status !== 'tracking') return -1;
    if (b.status === 'tracking' && a.status !== 'tracking') return 1;
    const da = a.deadline || '9999-12-31';
    const db = b.deadline || '9999-12-31';
    return da.localeCompare(db);
  });

  for (const t of sortedTasks) {
    if (t.status === "done") continue;

    const col = byStatus[t.status] || colComing;
    if (!col) continue;

    const card = document.createElement("article");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = t.id;

    // DEADLINE státusz
    const deadlineStatus = checkDeadlineStatus(t.deadline);
    if (deadlineStatus.isToday) {
      card.classList.add('deadline-today');
    } else if (deadlineStatus.isOverdue) {
      card.classList.add('deadline-overdue');
    } else if (deadlineStatus.status === 'upcoming') {
      const days = daysUntilDeadline(t.deadline);
      if (days !== null && days <= 3) {
        card.classList.add('deadline-soon');
      }
    }

    if (t.status === "tracking" && t.trackStart) {
      card.classList.add("tracking-running");
    }

    // TÍPUS BADGE
    const isRoot = !t.parentId;
    const isSubtask = !!t.parentId;

    if (isRoot) {
      card.style.cssText += `
        border-left: 5px solid #4a6cf7 !important;
        background: #f8faff !important;
      `;
    } else if (isSubtask) {
      card.style.cssText += `
        margin-left: 12px !important;
        border-left: 2px dashed #d1d5db !important;
        background: #fafafa !important;
      `;
    }

    // --- CÍM ---
    const headerDiv = document.createElement("div");
    headerDiv.style.cssText = `display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;`;

    const typeBadge = document.createElement("span");
    typeBadge.textContent = isRoot ? "📦 Root" : isSubtask ? "↳ Subtask" : "📌 Task";
    typeBadge.style.cssText = `
      font-size:0.6rem;font-weight:700;
      padding:2px 10px;border-radius:12px;
      background:${isRoot ? '#dbeafe' : isSubtask ? '#f3f4f6' : '#f0f2f5'};
      color:${isRoot ? '#1e40af' : isSubtask ? '#6b7280' : '#4a5568'};
      border:1px solid ${isRoot ? '#93c5fd' : isSubtask ? '#e5e7eb' : '#e1e4ec'};
      flex-shrink:0;
    `;
    headerDiv.appendChild(typeBadge);

    const titleEl = document.createElement("span");
    titleEl.className = "title";
    titleEl.textContent = t.title || "(no title)";
    titleEl.style.cssText = `
      font-size:${isRoot ? '1.2rem' : isSubtask ? '0.95rem' : '1rem'};
      font-weight:${isRoot ? '700' : isSubtask ? '500' : '600'};
      color:${isRoot ? '#0f172a' : isSubtask ? '#4a5568' : '#1f1f1f'};
      word-break:break-word;flex:1;
    `;
    headerDiv.appendChild(titleEl);
    card.appendChild(headerDiv);

    // --- DEADLINE ---
    if (t.deadline) {
      const deadlineDiv = document.createElement("div");
      deadlineDiv.className = "deadline-display";

      const days = daysUntilDeadline(t.deadline);
      let icon = '📅';
      let extraText = '';
      let bgColor = '#f3f4f6';
      let textColor = '#374151';
      let borderColor = '#d1d5db';

      if (deadlineStatus.isToday) {
        icon = '🔴';
        extraText = '⚠️ MA!';
        bgColor = '#fee2e2';
        textColor = '#991b1b';
        borderColor = '#ef4444';
      } else if (deadlineStatus.isOverdue) {
        icon = '⛔';
        extraText = `🚨 LEJÁRT (${Math.abs(days)} napja)`;
        bgColor = '#fecaca';
        textColor = '#7f1d1d';
        borderColor = '#dc2626';
      } else if (days !== null && days <= 3) {
        icon = '⚠️';
        extraText = `${days} nap múlva`;
        bgColor = '#fef3c7';
        textColor = '#92400e';
        borderColor = '#f59e0b';
      } else if (days !== null) {
        extraText = `${days} nap múlva`;
        bgColor = '#e0f2fe';
        textColor = '#0369a1';
        borderColor = '#7dd3fc';
      }

      deadlineDiv.style.cssText = `
        display:flex;align-items:center;gap:8px;padding:6px 12px;
        border-radius:8px;background:${bgColor};border:2px solid ${borderColor};
        color:${textColor};font-weight:600;font-size:0.9rem;
        margin:6px 0 4px 0;flex-wrap:wrap;
      `;
      deadlineDiv.innerHTML = `
        <span>${icon}</span>
        <span>${formatDeadline(t.deadline)}</span>
        ${extraText ? `<span style="font-weight:700;text-transform:uppercase;font-size:0.8rem;">${extraText}</span>` : ''}
      `;
      card.appendChild(deadlineDiv);
    }

    // --- TAG ---
    if (t.tag) {
      const tagEl = document.createElement("div");
      tagEl.className = "tag";
      tagEl.textContent = t.tag;
      tagEl.style.cssText = `
        display:inline-block;margin-top:4px;padding:1px 10px;
        border:1px dashed rgba(0,0,0,0.2);border-radius:12px;
        font-size:0.75rem;color:#333;background:rgba(255,255,255,0.5);
      `;
      card.appendChild(tagEl);
    }

    // --- NOTES ---
    if (t.notes) {
      const descEl = document.createElement("div");
      descEl.className = "desc";
      descEl.textContent = t.notes;
      descEl.style.cssText = `
        font-size:0.85rem;color:#2a2a2a;margin-top:4px;
        display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
      `;
      card.appendChild(descEl);
    }

    // --- WIKI REF ---
    if (t.wikiRef) {
      const wiki = document.createElement("div");
      wiki.style.cssText = `display:inline-block;margin-top:4px;padding:1px 10px;border-radius:12px;font-size:0.75rem;`;
      const a = document.createElement("a");
      a.href = `/wiki.html#${encodeURIComponent(t.wikiRef)}`;
      a.target = "_blank";
      a.textContent = `📘 ${t.wikiRef}`;
      a.style.cssText = `text-decoration:none;color:inherit;`;
      wiki.appendChild(a);
      card.appendChild(wiki);
    }

    // --- SPRINT ---
    if (t.sprintId) {
      const sprint = sprints.find(s => Number(s.id) === Number(t.sprintId));
      if (sprint) {
        const sprintEl = document.createElement("div");
        sprintEl.textContent = `📅 ${sprint.name}`;
        sprintEl.style.cssText = `
          display:inline-block;margin-top:4px;padding:2px 10px;border-radius:12px;
          font-size:0.65rem;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;
        `;
        card.appendChild(sprintEl);
      }
    }

    // 🔥🔥🔥 ROOT REFERENCIA (SZÜLŐ TASK MEGJELENÍTÉSE) 🔥🔥🔥
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

    // --- ACTIONS ---
    const actions = document.createElement("div");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => openFormForEdit(t.id));
    actions.appendChild(editBtn);

    if (t.status !== "done") {
      const doneBtn = document.createElement("button");
      doneBtn.className = "btn";
      doneBtn.textContent = "✅";
      doneBtn.style.cssText = `border-color:#22c55e;color:#22c55e;`;
      doneBtn.addEventListener("click", async () => {
        await markAsDone(t.id);
      });
      actions.appendChild(doneBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => onDelete(t.id));
    actions.appendChild(delBtn);

    card.appendChild(actions);

    // --- DRAG & DROP ---
    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragend", onDragEnd);

    col.appendChild(card);
  }

  startTimerLoop();
}

// ============================================================
// DRAG & DROP
// ============================================================

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
    col.addEventListener("dragover", ev => ev.preventDefault());

    col.addEventListener("drop", async ev => {
      ev.preventDefault();
      const id = dragTaskId || (ev.dataTransfer && ev.dataTransfer.getData("text/plain"));
      if (!id) return;

      const t = findTask(id);
      if (!t) return;

      const wrap = col.closest("[data-status]");
      const newStatus = (wrap && wrap.dataset.status) ? wrap.dataset.status : "coming";
      if (newStatus === t.status) return;

      await savePatch(id, { status: newStatus });
      await loadTasksFromServer();
    });
  });
}

// ============================================================
// PATCH HELPER
// ============================================================

async function savePatch(id, patch) {
  try {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      console.error("PATCH failed", await resp.text());
      alert("Error updating task status.");
    }
  } catch (err) {
    console.error("PATCH error:", err);
  }
}

// ============================================================
// FORM KEZELÉS
// ============================================================

function openFormForNew() {
  if (!form || !formSection || !listSection) return;
  form.reset();
  if (idField) idField.value = "";
  if (deadlineField) deadlineField.value = "";
  if (doneField) doneField.checked = false;
  if (trackedHoursField) trackedHoursField.value = "";
  if (timeLogField) timeLogField.value = "";
  formTitle.textContent = "📝 New Task";
  listSection.hidden = true;
  formSection.hidden = false;
}

function openFormForEdit(id) {
  const t = findTask(id);
  if (!t) return;
  if (idField) idField.value = t.id || "";
  if (titleField) titleField.value = t.title || "";
  if (tagField) tagField.value = t.tag || "";
  if (notesField) notesField.value = t.notes || "";
  if (deadlineField) deadlineField.value = t.deadline || "";
  if (doneField) doneField.checked = !!t.done;
  if (wikiRefField) wikiRefField.value = t.wikiRef || "";
  if (sprintIdField) sprintIdField.value = t.sprintId || "";
  if (trackedHoursField) {
    const msTotal = Number(t.trackedMsTotal ?? t.trackedMs ?? 0);
    trackedHoursField.value = msTotal > 0 ? (msTotal / 3600000).toFixed(2) : "";
  }
  if (timeLogField) timeLogField.value = t.timeLog || "";
  formTitle.textContent = "✏️ Edit Task";
  listSection.hidden = true;
  formSection.hidden = false;
}

function closeForm() {
  if (!formSection || !listSection) return;
  formSection.hidden = true;
  listSection.hidden = false;
}

// ============================================================
// FORM SUBMIT
// ============================================================

async function onSubmit(ev) {
  ev.preventDefault();
  if (!titleField || !titleField.value.trim()) {
    alert("Title is required.");
    return;
  }

  const idValue = idField ? idField.value : "";
  const hasId = !!idValue;

  let sprintId = sprintIdField ? sprintIdField.value : null;
  if (sprintId === "" || sprintId === "null") sprintId = null;

  const payload = {
    title: titleField.value.trim(),
    tag: tagField ? tagField.value.trim() : "",
    notes: notesField ? notesField.value : "",
    done: !!(doneField && doneField.checked),
    deadline: deadlineField ? deadlineField.value || null : null,
    wikiRef: wikiRefField ? wikiRefField.value.trim() : "",
    sprintId: sprintId,
    status: hasId ? undefined : "coming",
  };

  // trackedHours és timeLog csak edit esetén
  if (hasId) {
    if (trackedHoursField && trackedHoursField.value) {
      const h = Number(trackedHoursField.value);
      if (Number.isFinite(h) && h > 0) {
        payload.trackedMs = h * 3600000;
      }
    }
    if (timeLogField) {
      payload.timeLog = timeLogField.value.trim();
    }
  }

  try {
    const url = hasId ? `/api/tasks/${encodeURIComponent(idValue)}` : "/api/tasks";
    const method = hasId ? "PUT" : "POST";

    const resp = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`${method} failed`, resp.status, errText);
      alert(`Error saving task: ${resp.status}`);
      return;
    }

    await loadTasksFromServer();
    closeForm();
  } catch (err) {
    console.error("Save error:", err);
    alert("Unexpected error while saving task.");
  }
}

// ============================================================
// TASK MŰVELETEK
// ============================================================

async function markAsDone(id) {
  if (!confirm('Mark this task as done?')) return;
  try {
    await savePatch(id, { status: "done" });
    await loadTasksFromServer();
  } catch (err) {
    console.error("Done error:", err);
  }
}

async function onDelete(id) {
  if (!confirm("Delete this task?")) return;
  try {
    const resp = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!resp.ok) {
      console.error("DELETE failed", await resp.text());
      alert("Error deleting task.");
      return;
    }
    await loadTasksFromServer();
  } catch (err) {
    console.error("Delete error:", err);
  }
}

// ============================================================
// TASKOK BETÖLTÉSE
// ============================================================

async function loadTasksFromServer() {
  try {
    const resp = await fetch("/api/tasks");
    if (!resp.ok) {
      console.error("GET /api/tasks failed", await resp.text());
      return;
    }
    const data = await resp.json();
    if (!Array.isArray(data)) {
      console.error("Unexpected response:", data);
      return;
    }
    tasks = data;
    render();
  } catch (err) {
    console.error("Load tasks error:", err);
  }
}

// ============================================================
// TIMER
// ============================================================

function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    // Timer frissítés a kártyákon
  }, 1000);
}

// ============================================================
// ESEMÉNYEK
// ============================================================

if (newBtn) newBtn.addEventListener("click", openFormForNew);
if (cancelBtn) cancelBtn.addEventListener("click", closeForm);
if (form) form.addEventListener("submit", onSubmit);
if (reportBtn) {
  reportBtn.addEventListener("click", () => {
    alert("Report function - implement later");
  });
}
if (toggleCalBtn) {
  toggleCalBtn.addEventListener("click", () => {
    if (calendarSection) {
      calendarSection.hidden = !calendarSection.hidden;
    }
  });
}

// ============================================================
// INDÍTÁS
// ============================================================

window.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 TaskManager starting...");
  setupDropZones();
  loadWikiPages();
  loadSprintsForDropdown();
  loadTasksFromServer();
  console.log("✅ TaskManager ready");
});