"use strict";

/**
 * Project View - Root taskok és subtaskok megjelenítése
 * Tag-ekkel szűrve, linkekkel a Board és Wiki felé
 */

// --- DOM referenciák ---
const projectList = document.getElementById('projectList');
const searchInput = document.getElementById('searchInput');
const tagFilter = document.getElementById('tagFilter');
const newRootBtn = document.getElementById('newRootBtn');
const newRootModal = document.getElementById('newRootModal');
const newRootForm = document.getElementById('newRootForm');
const closeModalBtn = document.getElementById('closeModalBtn');

// --- Állapot ---
let allTasks = [];
let rootTasks = [];
let selectedTags = new Set();
let allTags = [];
let expandedRoots = new Set();
let subtaskInputs = {};
let sprints = [];  // 🔥 SPRINT-ek tárolása

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
    updateSprintDropdowns();
  } catch (err) {
    console.warn('Sprint load failed:', err);
  }
}

function updateSprintDropdowns() {
  // Root sprint dropdown frissítése
  const rootSelect = document.getElementById('rootSprintSelect');
  if (rootSelect) {
    const currentValue = rootSelect.value;
    const activeSprints = sprints.filter(s => 
      s.status === 'upcoming' || s.status === 'active'
    );
    
    rootSelect.innerHTML = '<option value="">— none —</option>';
    for (const s of activeSprints) {
      const opt = document.createElement('option');
      opt.value = s.id;
      const statusIcon = s.status === 'active' ? '🟢' : '🔵';
      opt.textContent = `${statusIcon} ${s.name}`;
      rootSelect.appendChild(opt);
    }
    
    if (currentValue) {
      rootSelect.value = currentValue;
    }
  }
}

function getSprintName(sprintId) {
  if (!sprintId) return null;
  const sprint = sprints.find(s => s.id === sprintId);
  return sprint ? sprint.name : null;
}

// --- Segédfüggvények ---

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

function getStatusClass(status) {
  return `status-${status}`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- API hívások ---

async function loadData() {
  try {
    const resp = await fetch('/api/tasks');
    if (!resp.ok) throw new Error('Failed to load tasks');
    allTasks = await resp.json();
    
    rootTasks = allTasks.filter(t => !t.parentId);
    
    const tagSet = new Set();
    for (const t of allTasks) {
      if (t.tags && Array.isArray(t.tags)) {
        for (const tag of t.tags) {
          if (tag && tag.trim()) {
            tagSet.add(tag.trim());
          }
        }
      }
    }
    allTags = [...tagSet].sort();
    
    const existingRootIds = new Set(rootTasks.map(r => r.id));
    for (const id of [...expandedRoots]) {
      if (!existingRootIds.has(id)) {
        expandedRoots.delete(id);
      }
    }
    
    if (expandedRoots.size === 0 && rootTasks.length > 0) {
      for (const root of rootTasks) {
        expandedRoots.add(root.id);
      }
    }
    
    renderTagFilter();
    renderProjects();
  } catch (err) {
    console.error('Load error:', err);
    projectList.innerHTML = `<div class="loading">❌ Error loading projects: ${err.message}</div>`;
  }
}

async function createRootTask(data) {
  try {
    const resp = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.title,
        tags: data.tags || [],
        notes: data.notes || '',
        status: 'coming',
        type: 'root',
        color: 'yellow',
        allDay: false,
        sprintId: data.sprintId || null  // 🔥 SPRINT ID
      })
    });
    
    if (!resp.ok) throw new Error('Failed to create project');
    await loadData();
    return true;
  } catch (err) {
    console.error('Create root error:', err);
    alert('Error creating project: ' + err.message);
    return false;
  }
}

// 🔥 Subtask hozzáadás
async function addSubtask(rootId) {
  const inputId = `subtask-input-${rootId}`;
  const input = document.getElementById(inputId);
  
  if (!input) {
    console.error('Input not found for root:', rootId);
    return;
  }
  
  const title = input.value.trim();
  
  if (!title) {
    return;
  }
  
  try {
    const resp = await fetch(`/api/tasks/${rootId}/subtask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        title: title,
        status: 'coming'
      })
    });
    
    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(error || 'Failed to add subtask');
    }
    
    input.value = '';
    delete subtaskInputs[rootId];
    
    await loadData();
    expandedRoots.add(rootId);
    renderProjects();
    
  } catch (err) {
    console.error('Add subtask error:', err);
    alert('Error adding subtask: ' + err.message);
  }
}

// 🔥 Input eseménykezelők
function handleSubtaskKeydown(event, rootId) {
  if (event.key === 'Enter') {
    event.preventDefault();
    addSubtask(rootId);
  }
}

function handleSubtaskInput(event, rootId) {
  subtaskInputs[rootId] = event.target.value;
}

async function deleteRootWithChildren(rootId) {
  if (!confirm('Delete this project and ALL its subtasks? This cannot be undone!')) return;
  
  try {
    const resp = await fetch(`/api/tasks/${rootId}/recursive`, {
      method: 'DELETE'
    });
    
    if (!resp.ok) throw new Error('Failed to delete project');
    delete subtaskInputs[rootId];
    await loadData();
  } catch (err) {
    console.error('Delete error:', err);
    alert('Error deleting project: ' + err.message);
  }
}

async function updateTaskTags(taskId, tags) {
  try {
    const resp = await fetch(`/api/tasks/${taskId}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    
    if (!resp.ok) throw new Error('Failed to update tags');
    await loadData();
  } catch (err) {
    console.error('Update tags error:', err);
    alert('Error updating tags: ' + err.message);
  }
}

// 🔥 Subtask szerkesztés
async function editSubtask(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;
  
  const newTitle = prompt('Edit subtask title:', task.title);
  if (newTitle === null) return;
  
  if (!newTitle.trim()) {
    alert('Title cannot be empty');
    return;
  }
  
  try {
    const resp = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...task,
        title: newTitle.trim()
      })
    });
    
    if (!resp.ok) throw new Error('Failed to update subtask');
    await loadData();
  } catch (err) {
    console.error('Edit subtask error:', err);
    alert('Error editing subtask: ' + err.message);
  }
}

// 🔥 Root szerkesztés
async function editRoot(rootId) {
  const root = rootTasks.find(r => r.id === rootId);
  if (!root) return;
  
  const newTitle = prompt('Edit project title:', root.title);
  if (newTitle === null) return;
  
  if (!newTitle.trim()) {
    alert('Title cannot be empty');
    return;
  }
  
  try {
    const resp = await fetch(`/api/tasks/${rootId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...root,
        title: newTitle.trim()
      })
    });
    
    if (!resp.ok) throw new Error('Failed to update project');
    await loadData();
  } catch (err) {
    console.error('Edit root error:', err);
    alert('Error editing project: ' + err.message);
  }
}

// --- Renderelés ---

function renderProjects() {
  const search = searchInput.value.toLowerCase().trim();
  
  let filtered = rootTasks.filter(root => {
    const matchSearch = root.title.toLowerCase().includes(search);
    const matchTags = selectedTags.size === 0 || 
      (root.tags && root.tags.some(t => selectedTags.has(t)));
    return matchSearch && matchTags;
  });
  
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (filtered.length === 0) {
    projectList.innerHTML = `
      <div class="loading" style="padding:40px;text-align:center;color:#6b7280;">
        ${search ? '🔍 No projects match your search' : '📭 No projects yet. Click "New Project" to start!'}
      </div>
    `;
    return;
  }
  
  projectList.innerHTML = filtered.map(root => {
    const children = allTasks.filter(t => t.parentId === root.id);
    const isExpanded = expandedRoots.has(root.id);
    const childCount = children.length;
    const inputValue = subtaskInputs[root.id] || '';
    const sprintName = getSprintName(root.sprintId);
    
    return `
      <div class="root-card" data-id="${root.id}">
        <div class="root-header" onclick="toggleRoot(${root.id})">
          <div class="root-header-left">
            <span class="toggle-icon ${isExpanded ? '' : 'collapsed'}">▼</span>
            <span class="root-title">${escapeHtml(root.title)}</span>
            <span class="root-badge">${childCount} subtask${childCount !== 1 ? 's' : ''}</span>
            ${sprintName ? `<span class="sprint-badge">📅 ${escapeHtml(sprintName)}</span>` : ''}
          </div>
          <div class="root-actions" onclick="event.stopPropagation();">
            <button class="btn" onclick="editRootTags(${root.id})" title="Edit tags">🏷️</button>
            <button class="btn" onclick="editRoot(${root.id})" title="Edit project">✏️</button>
            <button class="btn danger" onclick="deleteRootWithChildren(${root.id})" title="Delete project">🗑️</button>
          </div>
        </div>
        
        <div class="root-meta">
          <div class="root-tags">
            ${(root.tags || []).map(tag => 
              `<span class="tag">#${escapeHtml(tag)}</span>`
            ).join('')}
          </div>
          ${root.notes ? `<div class="root-notes">${escapeHtml(root.notes)}</div>` : ''}
        </div>
        
        <div class="subtask-list" style="${isExpanded ? '' : 'display:none'}">
          ${children.map(child => `
            <div class="subtask-item">
              <span class="subtask-status ${getStatusClass(child.status)}"></span>
              <span class="subtask-title">${escapeHtml(child.title)}</span>
              <span class="subtask-tags">
                ${(child.tags || []).map(t => `<span class="mini-tag">#${escapeHtml(t)}</span>`).join('')}
              </span>
              <div class="subtask-links">
                <a href="/index.html#task-${child.id}" target="_blank" class="board-link">📋 Board</a>
                ${child.wikiRef ? `<a href="/wiki.html#${escapeHtml(child.wikiRef)}" target="_blank" class="wiki-link">📚 Wiki</a>` : ''}
                <button class="btn" onclick="editSubtask(${child.id})" title="Edit subtask" style="padding:2px 6px;font-size:0.7rem;">✏️</button>
              </div>
            </div>
          `).join('')}
          
          <div class="add-subtask">
            <input 
              type="text" 
              id="subtask-input-${root.id}"
              placeholder="➕ Add new subtask..." 
              value="${escapeHtml(inputValue)}"
              onkeydown="handleSubtaskKeydown(event, ${root.id})"
              oninput="handleSubtaskInput(event, ${root.id})"
            />
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTagFilter() {
  if (allTags.length === 0) {
    tagFilter.innerHTML = `<span class="filter-label">🏷️ No tags yet</span>`;
    return;
  }
  
  tagFilter.innerHTML = `
    <span class="filter-label">🏷️ Filter by tag:</span>
    ${allTags.map(tag => `
      <span class="tag-option ${selectedTags.has(tag) ? 'active' : ''}" 
            onclick="toggleTag('${escapeHtml(tag)}')">
        #${escapeHtml(tag)}
      </span>
    `).join('')}
    ${selectedTags.size > 0 ? `
      <span class="tag-option" onclick="clearTags()" style="border-color:#ef4444;color:#ef4444;">
        ✕ Clear
      </span>
    ` : ''}
  `;
}

// --- Műveletek ---

function toggleTag(tag) {
  if (selectedTags.has(tag)) {
    selectedTags.delete(tag);
  } else {
    selectedTags.add(tag);
  }
  renderTagFilter();
  renderProjects();
}

function clearTags() {
  selectedTags.clear();
  renderTagFilter();
  renderProjects();
}

function toggleRoot(id) {
  if (expandedRoots.has(id)) {
    expandedRoots.delete(id);
  } else {
    expandedRoots.add(id);
  }
  renderProjects();
}

function editRootTags(rootId) {
  const root = rootTasks.find(r => r.id === rootId);
  if (!root) return;
  
  const currentTags = (root.tags || []).join(', ');
  const newTags = prompt('Edit tags (comma separated):', currentTags);
  if (newTags === null) return;
  
  const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
  updateTaskTags(rootId, tags);
}

// --- Modál kezelés ---

function openModal() {
  newRootModal.style.display = 'flex';
  setTimeout(() => {
    document.getElementById('rootTitle').focus();
  }, 50);
}

function closeModal() {
  newRootModal.style.display = 'none';
  newRootForm.reset();
}

// --- Eseménykezelők ---

searchInput.addEventListener('input', renderProjects);

newRootBtn.addEventListener('click', openModal);

closeModalBtn.addEventListener('click', closeModal);

newRootModal.addEventListener('click', (e) => {
  if (e.target === newRootModal) closeModal();
});

newRootForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const title = document.getElementById('rootTitle').value.trim();
  if (!title) {
    alert('Project name is required');
    return;
  }
  
  const tagsRaw = document.getElementById('rootTags').value;
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const notes = document.getElementById('rootNotes').value.trim();
  const sprintId = document.getElementById('rootSprintSelect').value || null;
  
  const success = await createRootTask({ title, tags, notes, sprintId });
  if (success) {
    closeModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (newRootModal.style.display === 'flex') {
      closeModal();
    }
  }
});

// --- Bootstrap ---
async function init() {
  await loadSprintsForDropdown();
  await loadData();
}

init();