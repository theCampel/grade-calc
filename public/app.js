// ============================================
// State Management
// ============================================
const STORAGE_KEY = 'gradelab_data';

let state = {
  users: [],
  activeUserId: null,
  currentView: 'grades',
  targetGrade: 60,
  parsedModules: []
};

function getActiveUser() {
  return state.users.find(u => u.id === state.activeUserId);
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    state.users = parsed.users || [];
    state.activeUserId = parsed.activeUserId;
  }

  // Create default user if none exist
  if (state.users.length === 0) {
    const defaultUser = createUser('My Grades');
    state.users.push(defaultUser);
    state.activeUserId = defaultUser.id;
  }

  if (!state.activeUserId && state.users.length > 0) {
    state.activeUserId = state.users[0].id;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    users: state.users,
    activeUserId: state.activeUserId
  }));
}

function createUser(name) {
  return {
    id: Date.now().toString(),
    name: name,
    year3: [],
    year4: []
  };
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  loadState();

  // Try to load from server for the default user
  await loadFromServer();

  renderUsers();
  renderModules('year3');
  renderModules('year4');
  calculateGrades();
  setupUpload();
  setupKeyboardNav();
  calculateWhatIf();
});

// Load data from server (for backwards compatibility)
async function loadFromServer() {
  try {
    const res = await fetch('/api/grades');
    const data = await res.json();

    // If server has data and default user is empty, populate it
    const defaultUser = state.users.find(u => u.name === 'My Grades');
    if (defaultUser && (data.year3?.length > 0 || data.year4?.length > 0)) {
      if (defaultUser.year3.length === 0 && defaultUser.year4.length === 0) {
        defaultUser.year3 = data.year3 || [];
        defaultUser.year4 = data.year4 || [];
        saveState();
      }
    }
  } catch (err) {
    console.log('Could not load from server:', err);
  }
}

// ============================================
// View Management
// ============================================
function switchView(view) {
  state.currentView = view;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Update views
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `${view}-view`);
  });

  // Trigger view-specific updates
  if (view === 'compare') {
    renderCompareView();
  } else if (view === 'predict') {
    calculateWhatIf();
  }
}

// ============================================
// User Management
// ============================================
function renderUsers() {
  const container = document.getElementById('usersList');
  container.innerHTML = state.users.map(user => `
    <div class="user-item ${user.id === state.activeUserId ? 'active' : ''}"
         onclick="selectUser('${user.id}')" tabindex="0"
         onkeydown="if(event.key==='Enter')selectUser('${user.id}')">
      <div class="user-avatar">${user.name.charAt(0).toUpperCase()}</div>
      <span class="user-name">${user.name}</span>
      ${state.users.length > 1 ? `
        <button class="user-delete" onclick="event.stopPropagation();deleteUser('${user.id}')"
                title="Delete profile">×</button>
      ` : ''}
    </div>
  `).join('');
}

function selectUser(userId) {
  state.activeUserId = userId;
  saveState();
  renderUsers();
  renderModules('year3');
  renderModules('year4');
  calculateGrades();
  if (state.currentView === 'predict') {
    calculateWhatIf();
  }
}

function addUser() {
  const name = prompt('Profile name:');
  if (name && name.trim()) {
    const user = createUser(name.trim());
    state.users.push(user);
    state.activeUserId = user.id;
    saveState();
    renderUsers();
    renderModules('year3');
    renderModules('year4');
    calculateGrades();
  }
}

function deleteUser(userId) {
  if (state.users.length <= 1) return;
  if (!confirm('Delete this profile?')) return;

  state.users = state.users.filter(u => u.id !== userId);
  if (state.activeUserId === userId) {
    state.activeUserId = state.users[0].id;
  }
  saveState();
  renderUsers();
  renderModules('year3');
  renderModules('year4');
  calculateGrades();
}

// ============================================
// Module Management
// ============================================
let expandedModules = new Set();

function getEffectiveMark(mod) {
  if (mod.mark !== null && mod.mark !== undefined) {
    return mod.mark;
  }
  if (mod.components && mod.components.length > 0) {
    return calculateMarkFromComponents(mod.components);
  }
  return null;
}

function calculateMarkFromComponents(components) {
  if (!components || components.length === 0) return null;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const comp of components) {
    if (comp.mark !== null && comp.mark !== undefined && comp.weight) {
      weightedSum += comp.mark * comp.weight;
      totalWeight += comp.weight;
    }
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

function renderModules(year) {
  const user = getActiveUser();
  if (!user) return;

  const container = document.getElementById(`${year}-modules`);
  const modules = user[year] || [];

  container.innerHTML = modules.map((mod, idx) => {
    const key = `${year}-${idx}`;
    const hasComponents = mod.components && mod.components.length > 0;
    const isExpanded = expandedModules.has(key);
    const effectiveMark = getEffectiveMark(mod);
    const isCalculated = mod.mark === null && effectiveMark !== null;

    let componentsHtml = '';
    if (hasComponents && isExpanded) {
      componentsHtml = `
        <div class="components-container">
          ${mod.components.map((comp, compIdx) => `
            <div class="component-row">
              <input type="text" value="${comp.name || ''}" placeholder="Component"
                     onchange="updateComponent('${year}', ${idx}, ${compIdx}, 'name', this.value)" tabindex="0">
              <input type="number" value="${comp.weight || ''}" placeholder="%" min="0" max="100"
                     onchange="updateComponent('${year}', ${idx}, ${compIdx}, 'weight', parseFloat(this.value) || 0)" tabindex="0">
              <span class="weight-symbol">%</span>
              <input type="number" value="${comp.mark !== null ? comp.mark : ''}" placeholder="--" min="0" max="100"
                     onchange="updateComponent('${year}', ${idx}, ${compIdx}, 'mark', this.value === '' ? null : parseFloat(this.value))" tabindex="0">
              <button class="delete-btn small" onclick="deleteComponent('${year}', ${idx}, ${compIdx})" tabindex="0">×</button>
            </div>
          `).join('')}
          <button class="add-component-btn" onclick="addComponent('${year}', ${idx})" tabindex="0">+ Add Component</button>
        </div>
      `;
    }

    return `
      <div class="module-wrapper">
        <div class="module-row ${!mod.confirmed ? 'predicted' : ''}" data-index="${idx}">
          <div class="module-expand">
            <button class="expand-btn ${isExpanded ? 'expanded' : ''} ${hasComponents ? 'has-items' : ''}"
                    onclick="toggleExpand('${year}', ${idx})" tabindex="0"
                    title="${hasComponents ? 'Expand components' : 'Add components'}">
              ${hasComponents ? '▶' : '+'}
            </button>
          </div>
          <input type="text" value="${mod.name || ''}" placeholder="Module name"
                 onchange="updateModule('${year}', ${idx}, 'name', this.value)" tabindex="0">
          <input type="number" value="${mod.credits || ''}" placeholder="20" min="0" max="120"
                 onchange="updateModule('${year}', ${idx}, 'credits', parseInt(this.value) || 0)" tabindex="0">
          <input type="number" value="${effectiveMark !== null ? Math.round(effectiveMark * 10) / 10 : ''}"
                 placeholder="--" min="0" max="100"
                 class="mark-input ${isCalculated ? 'calculated' : ''}"
                 onchange="updateModule('${year}', ${idx}, 'mark', this.value === '' ? null : parseFloat(this.value))"
                 title="${isCalculated ? 'Calculated from components' : ''}" tabindex="0">
          <button class="status-btn ${mod.confirmed ? 'confirmed' : 'predicted'}"
                  onclick="toggleStatus('${year}', ${idx})" tabindex="0">
            ${mod.confirmed ? 'Confirmed' : 'Predicted'}
          </button>
          <button class="delete-btn" onclick="deleteModule('${year}', ${idx})" tabindex="0">×</button>
        </div>
        ${componentsHtml}
      </div>
    `;
  }).join('');

  updateCreditCount(year);
}

function toggleExpand(year, idx) {
  const key = `${year}-${idx}`;
  const user = getActiveUser();

  if (expandedModules.has(key)) {
    expandedModules.delete(key);
  } else {
    expandedModules.add(key);
    // If no components, add first one
    if (!user[year][idx].components || user[year][idx].components.length === 0) {
      user[year][idx].components = [{ name: '', weight: 0, mark: null }];
      saveState();
    }
  }
  renderModules(year);
}

function addComponent(year, idx) {
  const user = getActiveUser();
  if (!user) return;

  if (!user[year][idx].components) {
    user[year][idx].components = [];
  }
  user[year][idx].components.push({ name: '', weight: 0, mark: null });
  saveState();
  renderModules(year);
}

function updateComponent(year, modIdx, compIdx, field, value) {
  const user = getActiveUser();
  if (!user) return;

  user[year][modIdx].components[compIdx][field] = value;
  saveState();
  renderModules(year);
  calculateGrades();
}

function deleteComponent(year, modIdx, compIdx) {
  const user = getActiveUser();
  if (!user) return;

  user[year][modIdx].components.splice(compIdx, 1);
  if (user[year][modIdx].components.length === 0) {
    delete user[year][modIdx].components;
    expandedModules.delete(`${year}-${modIdx}`);
  }
  saveState();
  renderModules(year);
  calculateGrades();
}

function updateModule(year, idx, field, value) {
  const user = getActiveUser();
  if (!user) return;

  user[year][idx][field] = value;
  saveState();

  if (field === 'credits') {
    updateCreditCount(year);
  }
  calculateGrades();
}

function toggleStatus(year, idx) {
  const user = getActiveUser();
  if (!user) return;

  user[year][idx].confirmed = !user[year][idx].confirmed;
  saveState();
  renderModules(year);
  calculateGrades();
}

function deleteModule(year, idx) {
  const user = getActiveUser();
  if (!user) return;

  user[year].splice(idx, 1);
  saveState();
  renderModules(year);
  calculateGrades();
}

function addModule(year) {
  const user = getActiveUser();
  if (!user) return;

  user[year].push({
    name: '',
    credits: 20,
    mark: null,
    confirmed: true
  });
  saveState();
  renderModules(year);

  // Focus the new module's name input
  setTimeout(() => {
    const container = document.getElementById(`${year}-modules`);
    const lastInput = container.querySelector('.module-row:last-child input');
    if (lastInput) lastInput.focus();
  }, 50);
}

function addDissertation() {
  const user = getActiveUser();
  if (!user) return;

  user.year4.push({
    name: 'Honours Project',
    code: 'INFR10044',
    credits: 40,
    mark: null,
    confirmed: false
  });
  saveState();
  renderModules('year4');
}

function updateCreditCount(year) {
  const user = getActiveUser();
  if (!user) return;

  const total = user[year].reduce((sum, m) => sum + (m.credits || 0), 0);
  document.getElementById(`${year}Credits`).textContent = total;
}

// ============================================
// Grade Calculations
// ============================================
function calculateYearAvg(modules) {
  if (!modules || modules.length === 0) return 0;

  // Use effective mark (which calculates from components if needed)
  const modulesWithMarks = modules.map(m => ({
    ...m,
    effectiveMark: getEffectiveMark(m)
  })).filter(m => m.effectiveMark !== null);

  if (modulesWithMarks.length === 0) return 0;

  const totalCredits = modulesWithMarks.reduce((sum, m) => sum + (m.credits || 0), 0);
  const weightedSum = modulesWithMarks.reduce((sum, m) => sum + (m.effectiveMark * (m.credits || 0)), 0);

  return totalCredits > 0 ? weightedSum / totalCredits : 0;
}

function calculateGrades() {
  const user = getActiveUser();
  if (!user) return;

  const year3Avg = calculateYearAvg(user.year3);
  const year4Avg = calculateYearAvg(user.year4);
  const finalGrade = (year3Avg * 0.5) + (year4Avg * 0.5);

  // Classification
  let classification = '--';
  if (user.year3.length > 0 || user.year4.length > 0) {
    if (finalGrade >= 70) classification = 'First Class';
    else if (finalGrade >= 60) classification = 'Upper Second (2:1)';
    else if (finalGrade >= 50) classification = 'Lower Second (2:2)';
    else if (finalGrade >= 40) classification = 'Third Class';
    else classification = 'Below Honours';
  }

  // Update display
  document.getElementById('year3Avg').textContent = year3Avg > 0 ? year3Avg.toFixed(1) : '--';
  document.getElementById('year4Avg').textContent = year4Avg > 0 ? year4Avg.toFixed(1) : '--';
  document.getElementById('finalGrade').textContent = finalGrade > 0 ? finalGrade.toFixed(1) : '--';
  document.getElementById('classification').textContent = classification;

  updateCreditCount('year3');
  updateCreditCount('year4');
}

// ============================================
// What-If Predictions
// ============================================
function setTarget(value) {
  state.targetGrade = parseFloat(value);

  // Update button states
  document.querySelectorAll('.target-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.target === String(value));
  });

  calculateWhatIf();
}

function calculateWhatIf() {
  const user = getActiveUser();
  if (!user) return;

  const year3Avg = calculateYearAvg(user.year3);

  // Only count confirmed modules for year 4
  const confirmedY4 = user.year4.filter(m => m.confirmed && m.mark !== null);
  const confirmedCredits = confirmedY4.reduce((sum, m) => sum + (m.credits || 0), 0);
  const confirmedWeighted = confirmedY4.reduce((sum, m) => sum + ((m.mark || 0) * (m.credits || 0)), 0);
  const remainingCredits = 120 - confirmedCredits;

  // Calculate required average on remaining
  const neededYear4Avg = (state.targetGrade - (year3Avg * 0.5)) / 0.5;
  const neededOnRemaining = remainingCredits > 0
    ? ((neededYear4Avg * 120) - confirmedWeighted) / remainingCredits
    : 0;

  // Update display
  document.getElementById('pYear3').textContent = year3Avg > 0 ? `${year3Avg.toFixed(1)}%` : '--';
  document.getElementById('pConfirmed').textContent = `${confirmedCredits} / 120 cr`;
  document.getElementById('pRemaining').textContent = `${remainingCredits} cr`;
  document.getElementById('pNeeded').textContent = neededOnRemaining > 0 ? neededOnRemaining.toFixed(1) : '--';

  // Verdict
  const verdict = document.getElementById('pVerdict');
  if (remainingCredits === 0) {
    const currentFinal = (year3Avg * 0.5) + (calculateYearAvg(user.year4) * 0.5);
    if (currentFinal >= state.targetGrade) {
      verdict.className = 'result-verdict achievable';
      verdict.textContent = `You've already achieved ${state.targetGrade}%!`;
    } else {
      verdict.className = 'result-verdict impossible';
      verdict.textContent = `Cannot achieve ${state.targetGrade}% - all credits confirmed`;
    }
  } else if (neededOnRemaining > 100) {
    verdict.className = 'result-verdict impossible';
    verdict.textContent = `Not achievable - would need ${neededOnRemaining.toFixed(1)}%`;
  } else if (neededOnRemaining < 0) {
    verdict.className = 'result-verdict achievable';
    verdict.textContent = `Already on track! Any passing grade will exceed ${state.targetGrade}%`;
  } else if (neededOnRemaining > 80) {
    verdict.className = 'result-verdict difficult';
    verdict.textContent = `Challenging - need to average ${neededOnRemaining.toFixed(1)}% on remaining work`;
  } else if (neededOnRemaining > 60) {
    verdict.className = 'result-verdict achievable';
    verdict.textContent = `Achievable - maintain ${neededOnRemaining.toFixed(1)}% average`;
  } else {
    verdict.className = 'result-verdict achievable';
    verdict.textContent = `Very achievable - only need ${neededOnRemaining.toFixed(1)}% average`;
  }
}

// ============================================
// Compare View
// ============================================
function renderCompareView() {
  const container = document.getElementById('compareGrid');

  container.innerHTML = state.users.map((user, idx) => {
    const year3Avg = calculateYearAvg(user.year3);
    const year4Avg = calculateYearAvg(user.year4);
    const finalGrade = (year3Avg * 0.5) + (year4Avg * 0.5);

    let classification = '--';
    if (user.year3.length > 0 || user.year4.length > 0) {
      if (finalGrade >= 70) classification = 'First';
      else if (finalGrade >= 60) classification = '2:1';
      else if (finalGrade >= 50) classification = '2:2';
      else if (finalGrade >= 40) classification = 'Third';
      else classification = 'Below';
    }

    const y3Credits = user.year3.reduce((sum, m) => sum + (m.credits || 0), 0);
    const y4Credits = user.year4.reduce((sum, m) => sum + (m.credits || 0), 0);

    return `
      <div class="compare-card" style="animation-delay: ${idx * 0.1}s">
        <div class="compare-card-header">
          <div class="compare-avatar">${user.name.charAt(0).toUpperCase()}</div>
          <div class="compare-name">${user.name}</div>
        </div>
        <div class="compare-card-body">
          <div class="compare-stat">
            <span class="compare-stat-label">Final Grade</span>
            <span class="compare-stat-value final">${finalGrade > 0 ? finalGrade.toFixed(1) : '--'}</span>
          </div>
          <div class="compare-stat">
            <span class="compare-stat-label">Classification</span>
            <span class="compare-stat-value">${classification}</span>
          </div>
          <div class="compare-stat">
            <span class="compare-stat-label">Year 3</span>
            <span class="compare-stat-value">${year3Avg > 0 ? year3Avg.toFixed(1) : '--'} (${y3Credits}cr)</span>
          </div>
          <div class="compare-stat">
            <span class="compare-stat-label">Year 4</span>
            <span class="compare-stat-value">${year4Avg > 0 ? year4Avg.toFixed(1) : '--'} (${y4Credits}cr)</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// File Upload & Parsing
// ============================================
function setupUpload() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  input.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFile(e.target.files[0]);
    }
  });
}

async function handleFile(file) {
  const status = document.getElementById('uploadStatus');
  const results = document.getElementById('parsedResults');

  status.className = 'upload-status visible loading';
  status.textContent = 'Parsing transcript...';
  results.classList.remove('visible');

  const formData = new FormData();
  formData.append('transcript', file);

  try {
    const res = await fetch('/api/parse-transcript-image', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    status.className = 'upload-status visible success';
    status.textContent = `Found ${data.modules?.length || 0} modules`;

    state.parsedModules = data.modules || [];

    if (data.year && data.year !== 'unknown') {
      document.getElementById('importYear').value = `year${data.year}`;
    }

    renderParsedModules();

  } catch (err) {
    status.className = 'upload-status visible error';
    status.textContent = `Error: ${err.message}`;
  }
}

function renderParsedModules() {
  const container = document.getElementById('parsedModules');
  const results = document.getElementById('parsedResults');

  if (!state.parsedModules.length) {
    results.classList.remove('visible');
    return;
  }

  results.classList.add('visible');

  container.innerHTML = state.parsedModules.map(m => {
    const isPending = !m.confirmed || m.mark === null;
    return `
      <div class="parsed-module ${isPending ? 'pending' : ''}">
        <div>
          <div class="parsed-module-name">${m.name}</div>
          ${m.code ? `<div class="parsed-module-code">${m.code}</div>` : ''}
        </div>
        <div class="parsed-module-credits">${m.credits}cr</div>
        <div class="parsed-module-mark ${isPending ? 'pending' : 'confirmed'}">
          ${m.mark !== null ? `${m.mark}%` : 'TBC'}
        </div>
      </div>
    `;
  }).join('');
}

function importParsedModules() {
  const user = getActiveUser();
  if (!user) return;

  const year = document.getElementById('importYear').value;

  state.parsedModules.forEach(m => {
    user[year].push({
      name: m.name,
      code: m.code,
      credits: m.credits,
      mark: m.mark,
      confirmed: m.confirmed !== false && m.mark !== null
    });
  });

  saveState();
  renderModules(year);
  calculateGrades();

  // Clear parsed and switch view
  state.parsedModules = [];
  document.getElementById('parsedResults').classList.remove('visible');
  document.getElementById('uploadStatus').className = 'upload-status';

  switchView('grades');
}

// ============================================
// Save to Server
// ============================================
async function saveGrades() {
  const user = getActiveUser();
  if (!user) return;

  const status = document.getElementById('saveStatus');

  try {
    const res = await fetch('/api/grades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year3: user.year3,
        year4: user.year4
      })
    });

    const data = await res.json();
    if (data.success) {
      status.textContent = 'Saved';
      setTimeout(() => { status.textContent = ''; }, 2000);
    }
  } catch (err) {
    status.textContent = 'Error';
    setTimeout(() => { status.textContent = ''; }, 2000);
  }
}

// ============================================
// Keyboard Navigation
// ============================================
function setupKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    // Quick nav with number keys when not in input
    if (document.activeElement.tagName !== 'INPUT') {
      if (e.key === '1') switchView('grades');
      if (e.key === '2') switchView('predict');
      if (e.key === '3') switchView('compare');
      if (e.key === '4') switchView('import');
    }

    // Cmd/Ctrl + S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveGrades();
    }
  });
}
