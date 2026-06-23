"use strict";

// --- DOM referenciák ---
const container = document.getElementById('dashboardContainer');

// --- Állapot ---
let tasks = [];
let sprints = [];
let activeSprint = null;

// --- API hívások ---

async function loadData() {
  try {
    // 1. Sprint-ek betöltése
    const sprintResp = await fetch('/api/sprints');
    if (!sprintResp.ok) throw new Error('Failed to load sprints');
    sprints = await sprintResp.json();
    
    // 2. Aktív sprint keresése
    activeSprint = sprints.find(s => s.status === 'active');
    
    // 3. Task-ok betöltése
    const taskResp = await fetch('/api/tasks');
    if (!taskResp.ok) throw new Error('Failed to load tasks');
    tasks = await taskResp.json();
    
    renderDashboard();
  } catch (err) {
    console.error('Load error:', err);
    container.innerHTML = `<div class="error">❌ Error loading data: ${err.message}</div>`;
  }
}

/// --- Renderelés ---

function renderDashboard() {
  if (!activeSprint) {
    container.innerHTML = `
      <div class="no-active-sprint">
        <p>📭 No active sprint</p>
        <p class="muted">Go to <a href="/sprints.html">Sprint Management</a> to activate a sprint.</p>
      </div>
    `;
    return;
  }

// Sprint task-ok szűrése (típusbiztos)
const sprintTasks = tasks.filter(t => {
  const taskSprintId = Number(t.sprintId);
  const activeSprintId = Number(activeSprint.id);
  return taskSprintId === activeSprintId;
});
  const totalTasks = sprintTasks.length;
  
  // 🔥 AKTÍV TASK-OK (tracking és active státusz)
  const trackingTasks = sprintTasks.filter(t => t.status === 'tracking');
  const activeTasks = sprintTasks.filter(t => t.status === 'active');
  const currentTask = trackingTasks.length > 0 ? trackingTasks[0] : (activeTasks.length > 0 ? activeTasks[0] : null);
  
  // Státuszok szerinti bontás
  const statusCounts = {
    coming: 0,
    active: 0,
    tracking: 0,
    done: 0,
    archived: 0
  };
  
  for (const t of sprintTasks) {
    if (statusCounts.hasOwnProperty(t.status)) {
      statusCounts[t.status]++;
    }
  }
  
  const doneCount = statusCounts.done || 0;
  const progressPercent = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  // Root és subtask bontás
  const rootTasks = sprintTasks.filter(t => t.type === 'root' || !t.parentId);
  const subtasks = sprintTasks.filter(t => t.type === 'subtask' || t.parentId);

  // HTML generálás
  container.innerHTML = `
    <!-- Sprint Header -->
    <div class="sprint-header-card">
      <div class="sprint-title">
        <span class="sprint-icon">🚀</span>
        <span class="sprint-name">${escapeHtml(activeSprint.name)}</span>
        <span class="sprint-badge active">🟢 Active</span>
      </div>
      <div class="sprint-meta">
        <span>📅 ${activeSprint.startDate || '?'} → ${activeSprint.endDate || '?'}</span>
        ${activeSprint.goal ? `<span class="sprint-goal">🎯 ${escapeHtml(activeSprint.goal)}</span>` : ''}
      </div>
    </div>

    <!-- 🔥 CURRENT TASK - Aktív task kiemelés -->
    <div class="current-task-card ${currentTask ? '' : 'no-task'}">
      <div class="current-task-header">
        <span class="current-task-icon">⏱️</span>
        <span class="current-task-label">Currently working on</span>
      </div>
      ${currentTask ? `
        <div class="current-task-content">
          <div class="current-task-title">
            <span class="task-status-dot status-${currentTask.status}"></span>
            <span class="task-name">${escapeHtml(currentTask.title)}</span>
            <span class="task-type-badge">${currentTask.type === 'root' ? '📦 Root' : '↳ Subtask'}</span>
          </div>
          <div class="current-task-meta">
            <span class="task-status-label">${getStatusLabel(currentTask.status)}</span>
            ${currentTask.tag ? `<span class="task-tag">#${escapeHtml(currentTask.tag)}</span>` : ''}
            <a href="/index.html#task-${currentTask.id}" target="_blank" class="task-link">📋 Open on Board</a>
          </div>
        </div>
      ` : `
        <div class="current-task-empty">
          <p>📭 No task is currently being worked on</p>
          <p class="muted">Move a task to <strong>ACTIVE</strong> or <strong>TRACKING</strong> status on the Board.</p>
        </div>
      `}
    </div>

    <!-- Statisztikák -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalTasks}</div>
        <div class="stat-label">📋 Total tasks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${doneCount}</div>
        <div class="stat-label">✅ Done</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${progressPercent}%</div>
        <div class="stat-label">📊 Progress</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${rootTasks.length}</div>
        <div class="stat-label">📦 Projects</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${subtasks.length}</div>
        <div class="stat-label">↳ Subtasks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${trackingTasks.length}</div>
        <div class="stat-label">⏱️ In progress</div>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="progress-section">
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${progressPercent}%; background: ${getProgressColor(progressPercent)};"></div>
      </div>
      <div class="progress-labels">
        <span>0%</span>
        <span>${progressPercent}%</span>
        <span>100%</span>
      </div>
    </div>

    <!-- Státusz bontás -->
    <div class="status-breakdown">
      <h3>📊 Status breakdown</h3>
      <div class="status-bars">
        ${renderStatusBar('📋 Backlog', statusCounts.coming, totalTasks, '#94a3b8')}
        ${renderStatusBar('🔄 Active', statusCounts.active, totalTasks, '#f59e0b')}
        ${renderStatusBar('⏱️ Tracking', statusCounts.tracking, totalTasks, '#8b5cf6')}
        ${renderStatusBar('✅ Done', statusCounts.done, totalTasks, '#22c55e')}
        ${renderStatusBar('📦 Archived', statusCounts.archived, totalTasks, '#9ca3af')}
      </div>
    </div>

    <!-- Task lista -->
    <div class="task-list-section">
      <h3>📋 Sprint tasks</h3>
      ${sprintTasks.length === 0 ? '<div class="empty">No tasks assigned to this sprint yet.</div>' : ''}
      <div class="task-list">
        ${sprintTasks.map(t => {
          const isCurrent = currentTask && t.id === currentTask.id;
          return `
            <div class="task-item ${isCurrent ? 'current' : ''}">
              <span class="task-status-dot status-${t.status}"></span>
              <span class="task-title">${escapeHtml(t.title)}</span>
              <span class="task-type">${t.type === 'root' ? '📦' : '↳'}</span>
              <span class="task-status-label">${getStatusLabel(t.status)}</span>
              ${isCurrent ? '<span class="current-badge">▶️ Active</span>' : ''}
              <a href="/index.html#task-${t.id}" target="_blank" class="task-link">📋 Board</a>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// --- Segédfüggvények ---

function renderStatusBar(label, count, total, color) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="status-bar-item">
      <div class="status-bar-label">
        <span>${label}</span>
        <span>${count} (${percent}%)</span>
      </div>
      <div class="status-bar-track">
        <div class="status-bar-fill" style="width: ${percent}%; background: ${color};"></div>
      </div>
    </div>
  `;
}

function getStatusLabel(status) {
  const labels = {
    coming: '📋 Backlog',
    active: '🔄 Active',
    tracking: '⏱️ Tracking',
    done: '✅ Done',
    archived: '📦 Archived'
  };
  return labels[status] || status;
}

function getProgressColor(percent) {
  if (percent < 30) return '#ef4444';
  if (percent < 70) return '#f59e0b';
  return '#22c55e';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Eseménykezelők ---

document.getElementById('refreshBtn')?.addEventListener('click', loadData);

// --- Bootstrap ---
loadData();