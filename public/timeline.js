"use strict";

// --- DOM referenciák ---
const container = document.getElementById('timelineContainer');
const refreshBtn = document.getElementById('refreshBtn');
const showOverdueOnly = document.getElementById('showOverdueOnly');
const showCompleted = document.getElementById('showCompleted');

// --- Állapot ---
let tasks = [];
let rootTasks = [];

// --- API hívások ---

async function loadData() {
  try {
    const resp = await fetch('/api/tasks');
    if (!resp.ok) throw new Error('Failed to load tasks');
    tasks = await resp.json();
    rootTasks = tasks.filter(t => !t.parentId);
    renderTimeline();
  } catch (err) {
    console.error('Load error:', err);
    container.innerHTML = `<div class="error">❌ Error loading data: ${err.message}</div>`;
  }
}

// --- Segédfüggvények ---

function isOverdue(task) {
  if (!task.endDate) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  const today = new Date();
  const endDate = new Date(task.endDate);
  return endDate < today;
}

function getStatusColor(status) {
  const colors = {
    coming: '#94a3b8',
    active: '#f59e0b',
    tracking: '#8b5cf6',
    done: '#22c55e',
    archived: '#9ca3af'
  };
  return colors[status] || '#94a3b8';
}

function getPriorityColor(priority) {
  const colors = {
    'P0': '#ef4444',
    'P1': '#f97316',
    'P2': '#eab308',
    'P3': '#22c55e'
  };
  return colors[priority] || '#94a3b8';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
}

// --- Renderelés ---

function renderTimeline() {
  const showOverdue = showOverdueOnly?.checked || false;
  const showCompletedTasks = showCompleted?.checked || false;

  // Szűrés
  let filteredRoots = rootTasks;
  
  // Gyűjtsük össze az összes task-ot (root + subtask)
  let allTasks = [];
  for (const root of rootTasks) {
    const children = tasks.filter(t => t.parentId === root.id);
    allTasks.push({ ...root, isRoot: true });
    for (const child of children) {
      allTasks.push({ ...child, isRoot: false, parentTitle: root.title });
    }
  }

  // Overdue szűrés
  if (showOverdue) {
    allTasks = allTasks.filter(t => isOverdue(t));
  }

  // Completed szűrés (kikapcsolva)
  if (!showCompletedTasks) {
    allTasks = allTasks.filter(t => t.status !== 'done' && t.status !== 'archived');
  }

  // Rendezés startDate szerint
  allTasks.sort((a, b) => {
    const dateA = new Date(a.startDate || a.createdAt);
    const dateB = new Date(b.startDate || b.createdAt);
    return dateA - dateB;
  });

  // Dátumtartomány meghatározása
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 30);

  // Hónapok generálása
  const months = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    months.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  // HTML generálás
  if (allTasks.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <p>📭 No tasks with dates</p>
        <p class="muted">Add start/end dates to your tasks to see them on the timeline.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="timeline-controls">
      <div class="date-range">
        <span>📅 ${formatDate(startDate)} → ${formatDate(endDate)}</span>
      </div>
    </div>
    <div class="timeline-grid">
      <div class="timeline-header">
        <div class="task-name-header">Task</div>
        <div class="timeline-dates">
          ${months.map(d => `
            <div class="timeline-date ${d.toDateString() === today.toDateString() ? 'today' : ''}">
              ${d.getDate()}
              <span class="month-label">${d.toLocaleDateString('hu-HU', { month: 'short' })}</span>
            </div>
          `).join('')}
        </div>
      </div>
  `;

  for (const task of allTasks) {
    const taskStart = new Date(task.startDate || task.createdAt);
    const taskEnd = new Date(task.endDate || task.startDate || task.createdAt);
    const isOverdueTask = isOverdue(task);
    const priority = task.priority || 'P3';
    const priorityColor = getPriorityColor(priority);
    
    // Pozíció számítása
    const startOffset = Math.max(0, (taskStart - startDate) / (24 * 60 * 60 * 1000));
    const duration = Math.max(1, (taskEnd - taskStart) / (24 * 60 * 60 * 1000));
    const totalDays = (endDate - startDate) / (24 * 60 * 60 * 1000);
    const leftPercent = (startOffset / totalDays) * 100;
    const widthPercent = (duration / totalDays) * 100;

    const statusColor = getStatusColor(task.status);
    const isRoot = task.isRoot;

    html += `
      <div class="timeline-row ${isRoot ? 'root-row' : 'subtask-row'} ${isOverdueTask ? 'overdue' : ''}">
        <div class="task-info">
          <div class="task-title" style="${isRoot ? 'font-weight:700;' : 'padding-left:20px;'}">
            ${isRoot ? '📦' : '↳'} ${escapeHtml(task.title)}
            ${isOverdueTask ? '<span class="overdue-badge">⏰ Overdue!</span>' : ''}
            ${priority !== 'P3' ? `<span class="priority-badge" style="background:${priorityColor};color:white;">${priority}</span>` : ''}
          </div>
          <div class="task-meta">
            <span class="task-status" style="color:${statusColor};">● ${task.status}</span>
            ${task.parentTitle ? `<span class="task-parent">→ ${escapeHtml(task.parentTitle)}</span>` : ''}
            <span class="task-date">📅 ${formatDate(task.startDate)} → ${formatDate(task.endDate)}</span>
          </div>
        </div>
        <div class="timeline-bar-container">
          <div class="timeline-bar" style="
            left: ${Math.min(100, Math.max(0, leftPercent))}%;
            width: ${Math.min(100, Math.max(1, widthPercent))}%;
            background: ${isOverdueTask ? '#ef4444' : (isRoot ? '#4a6cf7' : statusColor)};
            ${isRoot ? 'height:20px;' : 'height:12px;'}
          ">
            <span class="bar-label">${task.title}</span>
          </div>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
}

// --- Eseménykezelők ---

refreshBtn?.addEventListener('click', loadData);
showOverdueOnly?.addEventListener('change', renderTimeline);
showCompleted?.addEventListener('change', renderTimeline);

// --- Bootstrap ---
loadData();