"use strict";

// --- DOM referenciák ---
const sprintList = document.getElementById('sprintList');
const newSprintBtn = document.getElementById('newSprintBtn');
const sprintModal = document.getElementById('sprintModal');
const sprintForm = document.getElementById('sprintForm');
const closeSprintModalBtn = document.getElementById('closeSprintModalBtn');

// --- Állapot ---
let sprints = [];
let editingSprintId = null;

// --- API hívások ---

async function loadSprints() {
  try {
    const resp = await fetch('/api/sprints');
    if (!resp.ok) throw new Error('Failed to load sprints');
    sprints = await resp.json();
    renderSprints();
    return sprints;
  } catch (err) {
    console.error('Load sprints error:', err);
    sprintList.innerHTML = `<div class="loading">❌ Error loading sprints: ${err.message}</div>`;
    return [];
  }
}

async function createSprint(data) {
  try {
    const resp = await fetch('/api/sprints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('Failed to create sprint');
    await loadSprints();
    return true;
  } catch (err) {
    console.error('Create sprint error:', err);
    alert('Error creating sprint: ' + err.message);
    return false;
  }
}

async function updateSprint(id, data) {
  try {
    const resp = await fetch(`/api/sprints/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('Failed to update sprint');
    await loadSprints();
    return true;
  } catch (err) {
    console.error('Update sprint error:', err);
    alert('Error updating sprint: ' + err.message);
    return false;
  }
}

async function deleteSprint(id) {
  if (!confirm('Delete this sprint? Tasks assigned to it will remain without sprint.')) return;
  
  try {
    const resp = await fetch(`/api/sprints/${id}`, {
      method: 'DELETE'
    });
    if (!resp.ok) throw new Error('Failed to delete sprint');
    await loadSprints();
  } catch (err) {
    console.error('Delete sprint error:', err);
    alert('Error deleting sprint: ' + err.message);
  }
}

async function activateSprint(id) {
  try {
    const resp = await fetch(`/api/sprints/${id}/activate`, {
      method: 'POST'
    });
    if (!resp.ok) throw new Error('Failed to activate sprint');
    await loadSprints();
  } catch (err) {
    console.error('Activate sprint error:', err);
    alert('Error activating sprint: ' + err.message);
  }
}

// --- Renderelés ---

function renderSprints() {
  if (!sprintList) return;
  
  if (sprints.length === 0) {
    sprintList.innerHTML = `
      <div class="empty-state">
        <p>📭 No sprints yet</p>
        <p class="muted">Create your first sprint to start organizing tasks</p>
      </div>
    `;
    return;
  }
  
  sprintList.innerHTML = sprints.map(sprint => {
    const isActive = sprint.status === 'active';
    const isUpcoming = sprint.status === 'upcoming';
    const isCompleted = sprint.status === 'completed';
    
    let statusBadge = '';
    let statusColor = '';
    
    if (isActive) {
      statusBadge = '🟢 Active';
      statusColor = '#22c55e';
    } else if (isUpcoming) {
      statusBadge = '🔵 Upcoming';
      statusColor = '#3b82f6';
    } else {
      statusBadge = '⚪ Completed';
      statusColor = '#9ca3af';
    }
    
    return `
      <div class="sprint-item ${isActive ? 'active' : ''}">
        <div class="sprint-header">
          <div class="sprint-info">
            <span class="sprint-name">${escapeHtml(sprint.name)}</span>
            <span class="sprint-badge" style="background:${statusColor}20;color:${statusColor}">
              ${statusBadge}
            </span>
          </div>
          <div class="sprint-actions">
            ${!isActive && !isCompleted ? `
              <button onclick="activateSprint(${sprint.id})" class="btn primary">Activate</button>
            ` : ''}
            <button onclick="editSprint(${sprint.id})" class="btn">✏️</button>
            <button onclick="deleteSprint(${sprint.id})" class="btn danger">🗑️</button>
          </div>
        </div>
        <div class="sprint-dates">
          📅 ${sprint.startDate || '?'} → ${sprint.endDate || '?'}
        </div>
        ${sprint.goal ? `<div class="sprint-goal">🎯 ${escapeHtml(sprint.goal)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Modál kezelés ---

function openSprintModal(sprint = null) {
  editingSprintId = sprint?.id || null;
  
  document.getElementById('sprintName').value = sprint?.name || '';
  document.getElementById('sprintStartDate').value = sprint?.startDate || '';
  document.getElementById('sprintEndDate').value = sprint?.endDate || '';
  document.getElementById('sprintGoal').value = sprint?.goal || '';
  document.getElementById('sprintStatus').value = sprint?.status || 'upcoming';
  
  document.getElementById('sprintModalTitle').textContent = sprint ? '✏️ Edit Sprint' : '➕ New Sprint';
  sprintModal.style.display = 'flex';
  setTimeout(() => {
    document.getElementById('sprintName').focus();
  }, 50);
}

function closeSprintModal() {
  sprintModal.style.display = 'none';
  sprintForm.reset();
  editingSprintId = null;
}

// --- Eseménykezelők ---

if (newSprintBtn) {
  newSprintBtn.addEventListener('click', () => openSprintModal());
}

if (closeSprintModalBtn) {
  closeSprintModalBtn.addEventListener('click', closeSprintModal);
}

if (sprintModal) {
  sprintModal.addEventListener('click', (e) => {
    if (e.target === sprintModal) closeSprintModal();
  });
}

if (sprintForm) {
  sprintForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
      name: document.getElementById('sprintName').value.trim(),
      startDate: document.getElementById('sprintStartDate').value,
      endDate: document.getElementById('sprintEndDate').value,
      goal: document.getElementById('sprintGoal').value.trim(),
      status: document.getElementById('sprintStatus').value,
    };
    
    if (!data.name) {
      alert('Sprint name is required');
      return;
    }
    
    let success;
    if (editingSprintId) {
      success = await updateSprint(editingSprintId, data);
    } else {
      success = await createSprint(data);
    }
    
    if (success) {
      closeSprintModal();
    }
  });
}

// --- Bootstrap ---
loadSprints();