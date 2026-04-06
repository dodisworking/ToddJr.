/* ==========================================================================
   Gantt Chart Editor — App Logic
   ========================================================================== */

// ─── Icon SVG Library ────────────────────────────────────────────────────────
const ICONS = {
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  checkmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
};

const ICON_KEYS = Object.keys(ICONS);

const COLORS = [
  { name: 'Blue', value: '#3478F6' },
  { name: 'Purple', value: '#7B61C4' },
  { name: 'Orange', value: '#E8883C' },
  { name: 'Gray', value: '#8E8E93' },
  { name: 'Green', value: '#34C759' },
  { name: 'Red', value: '#FF3B30' },
  { name: 'Teal', value: '#5AC8FA' },
  { name: 'Pink', value: '#FF2D55' },
  { name: 'Indigo', value: '#5856D6' },
  { name: 'Brown', value: '#A2845E' },
];

const MONTH_COLORS = [
  '#3478F6', '#5856D6', '#AF52DE', '#FF2D55', '#FF9500',
  '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#8E8E93',
  '#FF6347', '#4682B4'
];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Utility Functions ───────────────────────────────────────────────────────
function uid() { return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function startOfWeek(d) {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  r.setDate(r.getDate() + diff);
  return r;
}

function weeksBetween(start, end) {
  const weeks = [];
  let cur = startOfWeek(parseDate(start));
  const endDate = parseDate(end);
  while (cur <= endDate) {
    const weekEnd = addDays(cur, 6);
    weeks.push({
      start: new Date(cur),
      end: weekEnd > endDate ? new Date(endDate) : weekEnd,
      month: cur.getMonth(),
      year: cur.getFullYear(),
    });
    cur = addDays(cur, 7);
  }
  return weeks;
}

function weekLabel(w, isFirstOfMonth) {
  const sd = w.start.getDate();
  if (isFirstOfMonth) {
    return `${MONTH_SHORT[w.start.getMonth()]} ${sd}`;
  }
  return String(sd);
}

function groupByMonth(weeks) {
  const groups = [];
  let cur = null;
  for (const w of weeks) {
    const key = `${w.year}-${w.month}`;
    if (!cur || cur.key !== key) {
      cur = { key, month: w.month, year: w.year, count: 0 };
      groups.push(cur);
    }
    cur.count++;
  }
  return groups;
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Sample Data ─────────────────────────────────────────────────────────────
function createSampleChart() {
  return {
    id: uid(),
    title: 'Timeline',
    note: 'Note: All dates tentative, dependent on receipt of key inputs and location and photographer availability.',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    dateRange: { start: '2026-04-01', end: '2026-06-07' },
    phases: [
      { id: uid(), order: 0, title: 'Site Selection', subtitle: 'Identify, evaluate and finalize locations', icon: 'location', color: '#3478F6', barStyle: 'solid', highlight: false, spans: [{ start: '2026-04-01', end: '2026-04-21' }] },
      { id: uid(), order: 1, title: 'Site Visits', subtitle: 'On-site scouting and assessments', icon: 'search', color: '#3478F6', barStyle: 'solid', highlight: false, spans: [{ start: '2026-04-08', end: '2026-04-24' }] },
      { id: uid(), order: 2, title: 'Final Site Approval', subtitle: 'Stakeholder sign-off', icon: 'checkmark', color: '#3478F6', barStyle: 'solid', highlight: false, spans: [{ start: '2026-04-22', end: '2026-04-30' }] },
      { id: uid(), order: 3, title: 'Vendor Bidding', subtitle: 'Vendor outreach and budget approval', icon: 'dollar', color: '#7B61C4', barStyle: 'solid', highlight: false, spans: [{ start: '2026-05-01', end: '2026-05-14' }] },
      { id: uid(), order: 4, title: 'Logistics + Permissions', subtitle: 'Access, unions, filming, drone, PPE, approvals', icon: 'calendar', color: '#7B61C4', barStyle: 'solid', highlight: false, spans: [{ start: '2026-04-27', end: '2026-05-18' }] },
      { id: uid(), order: 5, title: 'Production Planning', subtitle: 'Schedule, timing, blackout dates', icon: 'clipboard', color: '#7B61C4', barStyle: 'solid', highlight: false, spans: [{ start: '2026-05-06', end: '2026-05-18' }] },
      { id: uid(), order: 6, title: 'Tech Scouts', subtitle: 'Day before each shoot window', icon: 'people', color: '#8E8E93', barStyle: 'blocks', highlight: false, spans: [{ start: '2026-05-18', end: '2026-05-18' }, { start: '2026-05-27', end: '2026-05-27' }, { start: '2026-05-31', end: '2026-05-31' }] },
      { id: uid(), order: 7, title: 'Shoot Window 1', subtitle: 'May 19\u201322', icon: 'camera', color: '#E8883C', barStyle: 'solid', highlight: true, spans: [{ start: '2026-05-19', end: '2026-05-22' }] },
      { id: uid(), order: 8, title: 'Shoot Window 2', subtitle: 'May 28\u201329', icon: 'camera', color: '#E8883C', barStyle: 'solid', highlight: true, spans: [{ start: '2026-05-28', end: '2026-05-29' }] },
      { id: uid(), order: 9, title: 'Shoot Window 3', subtitle: 'Jun 1\u20133', icon: 'camera', color: '#E8883C', barStyle: 'solid', highlight: true, spans: [{ start: '2026-06-01', end: '2026-06-03' }] },
    ],
    theme: {}
  };
}

// ─── App State ───────────────────────────────────────────────────────────────
const STORAGE_KEY = 'gantt_charts';
let charts = [];
let currentChartId = null;
let selectedPhaseId = null;
let undoStack = [];
let redoStack = [];

// ─── Persistence ─────────────────────────────────────────────────────────────
function loadCharts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) charts = JSON.parse(raw);
  } catch (e) { charts = []; }
  if (!charts.length) {
    charts.push(createSampleChart());
  }
  currentChartId = charts[0].id;
}

function saveCharts() {
  try {
    const c = currentChart();
    if (c) c.modified = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(charts));
  } catch (e) { /* quota exceeded */ }
}

const autoSave = debounce(saveCharts, 400);

function currentChart() { return charts.find(c => c.id === currentChartId); }

// ─── Undo / Redo ─────────────────────────────────────────────────────────────
function pushUndo() {
  const c = currentChart();
  if (!c) return;
  undoStack.push(JSON.stringify(c));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

function undo() {
  if (!undoStack.length) return;
  const c = currentChart();
  redoStack.push(JSON.stringify(c));
  const prev = JSON.parse(undoStack.pop());
  Object.assign(c, prev);
  selectedPhaseId = null;
  closePanel();
  renderChart();
  autoSave();
  updateUndoButtons();
}

function redo() {
  if (!redoStack.length) return;
  const c = currentChart();
  undoStack.push(JSON.stringify(c));
  const next = JSON.parse(redoStack.pop());
  Object.assign(c, next);
  selectedPhaseId = null;
  closePanel();
  renderChart();
  autoSave();
  updateUndoButtons();
}

function updateUndoButtons() {
  document.getElementById('btn-undo').disabled = !undoStack.length;
  document.getElementById('btn-redo').disabled = !redoStack.length;
}

// ─── Chart Rendering ─────────────────────────────────────────────────────────
function renderChart() {
  const chart = currentChart();
  if (!chart) return;

  // Toolbar title
  const titleEl = document.getElementById('chart-title');
  if (titleEl.textContent !== chart.title) titleEl.textContent = chart.title;

  // Chart header title (in-chart, for export)
  const headerTitle = document.getElementById('chart-header-title');
  if (headerTitle.textContent !== chart.title) headerTitle.textContent = chart.title;

  // Chart header subtitle/description
  const headerSub = document.getElementById('chart-header-subtitle');
  const desc = chart.description || '';
  if (headerSub.textContent !== desc) headerSub.textContent = desc;

  // Note
  const noteEl = document.getElementById('chart-note');
  const noteTextEl = document.getElementById('note-text');
  if (chart.note) {
    noteEl.style.display = 'flex';
    if (noteTextEl.textContent !== chart.note) noteTextEl.textContent = chart.note;
  } else {
    noteEl.style.display = 'none';
  }

  // Compute weeks
  const weeks = weeksBetween(chart.dateRange.start, chart.dateRange.end);
  const months = groupByMonth(weeks);
  const numWeeks = weeks.length;
  const colTemplate = `var(--phase-label-width) repeat(${numWeeks}, minmax(var(--min-col-width), 1fr))`;

  const grid = document.getElementById('chart-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = colTemplate;

  // Month row
  const monthRow = document.createElement('div');
  monthRow.className = 'month-row';
  monthRow.style.gridTemplateColumns = colTemplate;

  const monthLabelCell = document.createElement('div');
  monthLabelCell.className = 'month-label-cell';
  monthRow.appendChild(monthLabelCell);

  months.forEach((mg, i) => {
    const cell = document.createElement('div');
    cell.className = 'grid-month';
    cell.style.gridColumn = `span ${mg.count}`;
    const mColor = MONTH_COLORS[mg.month % 12];
    cell.style.background = mColor;
    cell.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      ${MONTH_NAMES[mg.month].toUpperCase()}`;
    monthRow.appendChild(cell);
  });
  grid.appendChild(monthRow);

  // Week row
  const weekRow = document.createElement('div');
  weekRow.className = 'week-row';
  weekRow.style.gridTemplateColumns = colTemplate;

  const weekLabelCell = document.createElement('div');
  weekLabelCell.className = 'week-label-cell';
  weekRow.appendChild(weekLabelCell);

  weeks.forEach((w, i) => {
    const cell = document.createElement('div');
    cell.className = 'grid-week';
    const isFirstOfMonth = i === 0 || w.start.getMonth() !== weeks[i - 1].start.getMonth();
    cell.textContent = weekLabel(w, isFirstOfMonth);
    weekRow.appendChild(cell);
  });
  grid.appendChild(weekRow);

  // Phase rows
  chart.phases.sort((a, b) => a.order - b.order).forEach((phase, idx) => {
    const row = document.createElement('div');
    row.className = 'phase-row';
    row.style.gridTemplateColumns = colTemplate;
    row.style.animationDelay = `${idx * 30}ms`;
    row.dataset.phaseId = phase.id;

    if (phase.highlight) row.classList.add('highlighted');
    if (phase.id === selectedPhaseId) row.classList.add('selected');

    // Label
    const label = document.createElement('div');
    label.className = 'phase-label';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'phase-icon';
    iconWrap.style.background = hexToRgba(phase.color, 0.12);
    iconWrap.style.color = phase.color;
    iconWrap.innerHTML = ICONS[phase.icon] || ICONS.star;
    label.appendChild(iconWrap);

    const info = document.createElement('div');
    info.className = 'phase-info';
    const title = document.createElement('div');
    title.className = 'phase-title';
    if (phase.highlight) title.classList.add('shoot-title');
    title.textContent = phase.title;
    info.appendChild(title);

    if (phase.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'phase-subtitle';
      sub.textContent = phase.subtitle;
      info.appendChild(sub);
    }
    label.appendChild(info);
    row.appendChild(label);

    // Week cells + bars
    weeks.forEach((w, wi) => {
      const cell = document.createElement('div');
      cell.className = 'phase-cell';
      cell.dataset.weekIdx = wi;

      // Render bars for spans that overlap this week
      phase.spans.forEach((span, si) => {
        const spanStart = parseDate(span.start);
        const spanEnd = parseDate(span.end);
        if (spanEnd < w.start || spanStart > w.end) return; // no overlap

        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        if (phase.barStyle === 'blocks') bar.classList.add('bar-blocks');
        bar.style.background = phase.color;
        bar.dataset.spanIdx = si;
        bar.dataset.phaseId = phase.id;

        // Calculate position within cell
        const cellStart = w.start.getTime();
        const cellEnd = w.end.getTime() + 86400000; // end of end day
        const cellDuration = cellEnd - cellStart;

        const barStart = Math.max(spanStart.getTime(), cellStart);
        const barEnd = Math.min(spanEnd.getTime() + 86400000, cellEnd);

        const leftPct = ((barStart - cellStart) / cellDuration) * 100;
        const widthPct = ((barEnd - barStart) / cellDuration) * 100;

        bar.style.left = `${leftPct}%`;
        bar.style.width = `${widthPct}%`;

        // Round corners only on span edges
        const isSpanStart = spanStart >= w.start;
        const isSpanEnd = spanEnd <= w.end;
        const r = phase.barStyle === 'blocks' ? 4 : 6;
        bar.style.borderRadius = `${isSpanStart ? r : 0}px ${isSpanEnd ? r : 0}px ${isSpanEnd ? r : 0}px ${isSpanStart ? r : 0}px`;

        // Resize handles (only on first/last cell of span)
        if (isSpanStart) {
          const hl = document.createElement('div');
          hl.className = 'bar-handle bar-handle-left';
          hl.dataset.spanIdx = si;
          hl.dataset.phaseId = phase.id;
          hl.dataset.side = 'start';
          bar.appendChild(hl);
        }
        if (isSpanEnd) {
          const hr = document.createElement('div');
          hr.className = 'bar-handle bar-handle-right';
          hr.dataset.spanIdx = si;
          hr.dataset.phaseId = phase.id;
          hr.dataset.side = 'end';
          bar.appendChild(hr);
        }

        cell.appendChild(bar);
      });

      row.appendChild(cell);
    });

    // Click to select
    row.addEventListener('click', (e) => {
      if (e.target.closest('.bar-handle') || e.target.closest('.gantt-bar')) return;
      selectPhase(phase.id);
    });

    grid.appendChild(row);
  });

  // Store weeks for drag calculations
  grid._weeks = weeks;
}

// ─── Phase Selection & Panel ─────────────────────────────────────────────────
function selectPhase(id) {
  selectedPhaseId = id;
  // Update row highlights
  document.querySelectorAll('.phase-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.phaseId === id);
  });
  if (id) openPanel(id);
}

let panelIsNewPhase = false;

function openPanel(phaseId, isNew = false) {
  const chart = currentChart();
  const phase = chart.phases.find(p => p.id === phaseId);
  if (!phase) return;

  panelIsNewPhase = isNew;

  // Update panel title and done button text
  document.getElementById('panel-title-text').textContent = isNew ? 'Add Phase' : 'Edit Phase';
  const doneBtn = document.getElementById('panel-done');
  doneBtn.innerHTML = isNew
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Add'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done';

  document.getElementById('field-title').value = phase.title;
  document.getElementById('field-subtitle').value = phase.subtitle || '';
  document.getElementById('field-highlight').checked = phase.highlight;

  // Icon picker
  renderIconPicker(phase.icon);

  // Color picker
  renderColorPicker(phase.color);

  // Bar style toggle
  document.querySelectorAll('#bar-style-toggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === phase.barStyle);
  });

  // Spans
  renderSpansEditor(phase);

  // Show panel
  document.getElementById('editor-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('visible');

  // Focus title input for new phases
  if (isNew) {
    setTimeout(() => {
      const titleInput = document.getElementById('field-title');
      titleInput.focus();
      titleInput.select();
    }, 300);
  }
}

function closePanel() {
  document.getElementById('editor-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('visible');
  selectedPhaseId = null;
  document.querySelectorAll('.phase-row.selected').forEach(r => r.classList.remove('selected'));
}

function renderIconPicker(selected) {
  const picker = document.getElementById('icon-picker');
  picker.innerHTML = '';
  ICON_KEYS.forEach(key => {
    const opt = document.createElement('button');
    opt.className = 'icon-option' + (key === selected ? ' selected' : '');
    opt.innerHTML = ICONS[key];
    opt.title = key;
    opt.addEventListener('click', () => {
      if (!selectedPhaseId) return;
      pushUndo();
      const phase = currentChart().phases.find(p => p.id === selectedPhaseId);
      phase.icon = key;
      picker.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      renderChart();
      autoSave();
    });
    picker.appendChild(opt);
  });
}

function renderColorPicker(selected) {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = '';
  COLORS.forEach(c => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch' + (c.value === selected ? ' selected' : '');
    swatch.style.background = c.value;
    swatch.title = c.name;
    swatch.addEventListener('click', () => {
      if (!selectedPhaseId) return;
      pushUndo();
      const phase = currentChart().phases.find(p => p.id === selectedPhaseId);
      phase.color = c.value;
      picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      renderChart();
      autoSave();
    });
    picker.appendChild(swatch);
  });
}

function renderSpansEditor(phase) {
  const container = document.getElementById('spans-editor');
  container.innerHTML = '';
  phase.spans.forEach((span, i) => {
    const row = document.createElement('div');
    row.className = 'span-row';

    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.value = span.start;
    startInput.addEventListener('change', () => {
      pushUndo();
      span.start = startInput.value;
      recalcDateRange();
      renderChart();
      autoSave();
    });

    const dash = document.createElement('span');
    dash.className = 'span-dash';
    dash.textContent = '\u2013';

    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.value = span.end;
    endInput.addEventListener('change', () => {
      pushUndo();
      span.end = endInput.value;
      recalcDateRange();
      renderChart();
      autoSave();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'span-remove';
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener('click', () => {
      if (phase.spans.length <= 1) return;
      pushUndo();
      phase.spans.splice(i, 1);
      recalcDateRange();
      renderSpansEditor(phase);
      renderChart();
      autoSave();
    });

    row.append(startInput, dash, endInput, removeBtn);
    container.appendChild(row);
  });
}

function recalcDateRange() {
  const chart = currentChart();
  if (!chart.phases.length) return;

  let minDate = null, maxDate = null;
  chart.phases.forEach(p => {
    p.spans.forEach(s => {
      const sd = parseDate(s.start);
      const ed = parseDate(s.end);
      if (!minDate || sd < minDate) minDate = sd;
      if (!maxDate || ed > maxDate) maxDate = ed;
    });
  });

  if (minDate && maxDate) {
    // Pad to start of week and end of week
    const ws = startOfWeek(minDate);
    const we = addDays(startOfWeek(maxDate), 6);
    chart.dateRange.start = fmtDate(ws);
    chart.dateRange.end = fmtDate(we);
  }
}

// ─── Bar Drag Interactions ───────────────────────────────────────────────────
let dragState = null;

function initDragHandlers() {
  const grid = document.getElementById('chart-grid');

  grid.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.bar-handle');
    const bar = e.target.closest('.gantt-bar');

    if (handle) {
      // Resize
      e.preventDefault();
      e.stopPropagation();
      const phaseId = handle.dataset.phaseId;
      const spanIdx = parseInt(handle.dataset.spanIdx);
      const side = handle.dataset.side;
      pushUndo();
      dragState = { type: 'resize', phaseId, spanIdx, side, startX: e.clientX };
      document.body.style.cursor = 'col-resize';
    } else if (bar && !e.target.closest('.bar-handle')) {
      // Move
      e.preventDefault();
      e.stopPropagation();
      const phaseId = bar.dataset.phaseId;
      const spanIdx = parseInt(bar.dataset.spanIdx);
      pushUndo();
      dragState = { type: 'move', phaseId, spanIdx, startX: e.clientX };
      document.body.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    e.preventDefault();

    const chart = currentChart();
    const phase = chart.phases.find(p => p.id === dragState.phaseId);
    if (!phase) return;

    const span = phase.spans[dragState.spanIdx];
    if (!span) return;

    const weeks = grid._weeks;
    if (!weeks || !weeks.length) return;

    // Calculate how many days the mouse moved
    const cells = grid.querySelectorAll('.phase-cell');
    if (!cells.length) return;
    const cellWidth = cells[0].getBoundingClientRect().width;
    const daysPerCell = 7;
    const pixelsPerDay = cellWidth / daysPerCell;
    const dx = e.clientX - dragState.startX;
    const daysDelta = Math.round(dx / pixelsPerDay);

    if (daysDelta === 0) return;

    if (dragState.type === 'resize') {
      if (dragState.side === 'start') {
        const newStart = addDays(parseDate(span.start), daysDelta);
        const end = parseDate(span.end);
        if (newStart <= end) {
          span.start = fmtDate(newStart);
          dragState.startX = e.clientX;
        }
      } else {
        const start = parseDate(span.start);
        const newEnd = addDays(parseDate(span.end), daysDelta);
        if (newEnd >= start) {
          span.end = fmtDate(newEnd);
          dragState.startX = e.clientX;
        }
      }
    } else if (dragState.type === 'move') {
      span.start = fmtDate(addDays(parseDate(span.start), daysDelta));
      span.end = fmtDate(addDays(parseDate(span.end), daysDelta));
      dragState.startX = e.clientX;
    }

    recalcDateRange();
    renderChart();

    // Re-open panel if editing this phase
    if (selectedPhaseId === dragState.phaseId) {
      openPanel(dragState.phaseId);
    }
  });

  document.addEventListener('mouseup', () => {
    if (dragState) {
      dragState = null;
      document.body.style.cursor = '';
      autoSave();
    }
  });
}

// ─── Panel Field Handlers ────────────────────────────────────────────────────
function initPanelHandlers() {
  // Title
  document.getElementById('field-title').addEventListener('input', (e) => {
    if (!selectedPhaseId) return;
    const phase = currentChart().phases.find(p => p.id === selectedPhaseId);
    phase.title = e.target.value;
    renderChart();
    autoSave();
  });

  // Subtitle
  document.getElementById('field-subtitle').addEventListener('input', (e) => {
    if (!selectedPhaseId) return;
    const phase = currentChart().phases.find(p => p.id === selectedPhaseId);
    phase.subtitle = e.target.value;
    renderChart();
    autoSave();
  });

  // Bar style toggle
  document.querySelectorAll('#bar-style-toggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedPhaseId) return;
      pushUndo();
      const phase = currentChart().phases.find(p => p.id === selectedPhaseId);
      phase.barStyle = btn.dataset.value;
      document.querySelectorAll('#bar-style-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderChart();
      autoSave();
    });
  });

  // Highlight toggle
  document.getElementById('field-highlight').addEventListener('change', (e) => {
    if (!selectedPhaseId) return;
    pushUndo();
    const phase = currentChart().phases.find(p => p.id === selectedPhaseId);
    phase.highlight = e.target.checked;
    renderChart();
    autoSave();
  });

  // Add span
  document.getElementById('btn-add-span').addEventListener('click', () => {
    if (!selectedPhaseId) return;
    pushUndo();
    const chart = currentChart();
    const phase = chart.phases.find(p => p.id === selectedPhaseId);
    const lastSpan = phase.spans[phase.spans.length - 1];
    const newStart = lastSpan ? fmtDate(addDays(parseDate(lastSpan.end), 7)) : chart.dateRange.start;
    const newEnd = fmtDate(addDays(parseDate(newStart), 3));
    phase.spans.push({ start: newStart, end: newEnd });
    recalcDateRange();
    renderSpansEditor(phase);
    renderChart();
    autoSave();
  });

  // Delete phase
  document.getElementById('btn-delete-phase').addEventListener('click', () => {
    if (!selectedPhaseId) return;
    pushUndo();
    const chart = currentChart();
    chart.phases = chart.phases.filter(p => p.id !== selectedPhaseId);
    // Reorder
    chart.phases.forEach((p, i) => p.order = i);
    selectedPhaseId = null;
    closePanel();
    recalcDateRange();
    renderChart();
    autoSave();
  });

  // Close panel
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('panel-overlay').addEventListener('click', closePanel);
  document.getElementById('panel-done').addEventListener('click', () => {
    if (panelIsNewPhase) {
      showToast('Phase added!');
    }
    closePanel();
    renderChart();
    autoSave();
  });
}

// ─── Toolbar Handlers ────────────────────────────────────────────────────────
function initZoomHandlers() {
  const slider = document.getElementById('zoom-slider');
  const label = document.getElementById('zoom-label');
  const root = document.documentElement;
  const chart = document.getElementById('gantt-chart');
  const BASE_COL = 100; // default --min-col-width in px

  function applyZoom(pct) {
    const px = Math.round(BASE_COL * (pct / 100));
    root.style.setProperty('--min-col-width', px + 'px');
    label.textContent = pct + '%';
    slider.value = pct;

    // Apply vertical density class based on zoom level
    chart.classList.remove('density-compact', 'density-tight', 'density-ultra');
    if (pct <= 30) {
      chart.classList.add('density-ultra');
    } else if (pct <= 50) {
      chart.classList.add('density-tight');
    } else if (pct <= 70) {
      chart.classList.add('density-compact');
    }
  }

  slider.addEventListener('input', () => applyZoom(Number(slider.value)));

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const cur = Number(slider.value);
    const next = Math.max(Number(slider.min), cur - 20);
    applyZoom(next);
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    const cur = Number(slider.value);
    const next = Math.min(Number(slider.max), cur + 20);
    applyZoom(next);
  });

  // Toggle subtitles
  document.getElementById('btn-toggle-subtitles').addEventListener('click', () => {
    const btn = document.getElementById('btn-toggle-subtitles');
    const chart = document.getElementById('gantt-chart');
    btn.classList.toggle('active');
    chart.classList.toggle('hide-subtitles', !btn.classList.contains('active'));
  });

  // Keyboard shortcuts: - and + for zoom
  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      document.getElementById('btn-zoom-out').click();
    }
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      document.getElementById('btn-zoom-in').click();
    }
    if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      applyZoom(100);
    }
  });
}

function initToolbarHandlers() {
  // Chart title (toolbar) — syncs both toolbar and in-chart header
  const titleEl = document.getElementById('chart-title');
  const headerTitleEl = document.getElementById('chart-header-title');

  function syncTitle(source) {
    const chart = currentChart();
    if (chart && source.textContent.trim()) {
      chart.title = source.textContent.trim();
      // Sync the other one
      if (source === titleEl && headerTitleEl.textContent !== chart.title) headerTitleEl.textContent = chart.title;
      if (source === headerTitleEl && titleEl.textContent !== chart.title) titleEl.textContent = chart.title;
      autoSave();
    }
  }

  titleEl.addEventListener('blur', () => { pushUndo(); syncTitle(titleEl); });
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  headerTitleEl.addEventListener('blur', () => { pushUndo(); syncTitle(headerTitleEl); });
  headerTitleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); headerTitleEl.blur(); } });

  // Chart description (in-chart header subtitle)
  const headerSubEl = document.getElementById('chart-header-subtitle');
  headerSubEl.addEventListener('blur', () => {
    const chart = currentChart();
    if (chart) {
      chart.description = headerSubEl.textContent.trim();
      autoSave();
    }
  });

  // Note text
  const noteTextEl = document.getElementById('note-text');
  noteTextEl.addEventListener('blur', () => {
    const chart = currentChart();
    if (chart) {
      chart.note = noteTextEl.textContent.trim();
      autoSave();
    }
  });

  document.getElementById('note-close').addEventListener('click', () => {
    pushUndo();
    const chart = currentChart();
    chart.note = '';
    renderChart();
    autoSave();
  });

  // Add phase
  document.getElementById('btn-add-phase').addEventListener('click', () => {
    pushUndo();
    const chart = currentChart();
    const newPhase = {
      id: uid(),
      order: chart.phases.length,
      title: 'New Phase',
      subtitle: '',
      icon: 'star',
      color: COLORS[chart.phases.length % COLORS.length].value,
      barStyle: 'solid',
      highlight: false,
      spans: [{
        start: chart.dateRange.start,
        end: fmtDate(addDays(parseDate(chart.dateRange.start), 7))
      }]
    };
    chart.phases.push(newPhase);
    renderChart();
    selectedPhaseId = newPhase.id;
    document.querySelectorAll('.phase-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.phaseId === newPhase.id);
    });
    openPanel(newPhase.id, true);
    autoSave();
  });

  // Edit note
  document.getElementById('btn-edit-note').addEventListener('click', () => {
    const chart = currentChart();
    document.getElementById('note-textarea').value = chart.note || '';
    document.getElementById('note-modal-overlay').classList.add('visible');
    document.getElementById('note-modal').classList.add('visible');
    document.getElementById('note-textarea').focus();
  });

  document.getElementById('note-modal-close').addEventListener('click', closeNoteModal);
  document.getElementById('note-modal-overlay').addEventListener('click', closeNoteModal);

  document.getElementById('note-save').addEventListener('click', () => {
    pushUndo();
    const chart = currentChart();
    chart.note = document.getElementById('note-textarea').value.trim();
    closeNoteModal();
    renderChart();
    autoSave();
  });

  document.getElementById('note-clear').addEventListener('click', () => {
    document.getElementById('note-textarea').value = '';
  });

  // Export dropdown
  const exportDropdown = document.getElementById('export-dropdown');
  document.getElementById('btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => exportDropdown.classList.remove('open'));

  document.getElementById('export-png').addEventListener('click', () => exportPNG());
  document.getElementById('export-pdf').addEventListener('click', () => exportPDF());

  // Undo/Redo
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // Charts modal
  document.getElementById('btn-charts').addEventListener('click', openChartsModal);
  document.getElementById('modal-close').addEventListener('click', closeChartsModal);
  document.getElementById('modal-overlay').addEventListener('click', closeChartsModal);
  document.getElementById('btn-new-chart').addEventListener('click', () => {
    const newChart = createSampleChart();
    newChart.title = 'New Timeline';
    newChart.note = '';
    newChart.phases = [];
    newChart.dateRange = { start: fmtDate(new Date()), end: fmtDate(addDays(new Date(), 56)) };
    charts.push(newChart);
    currentChartId = newChart.id;
    undoStack = [];
    redoStack = [];
    updateUndoButtons();
    closeChartsModal();
    renderChart();
    autoSave();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
    }
    if (e.key === 'Escape') {
      closePanel();
      closeChartsModal();
      closeNoteModal();
      closeAiModal();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedPhaseId && document.activeElement === document.body) {
        e.preventDefault();
        document.getElementById('btn-delete-phase').click();
      }
    }
  });
}

function closeNoteModal() {
  document.getElementById('note-modal-overlay').classList.remove('visible');
  document.getElementById('note-modal').classList.remove('visible');
}

// ─── Charts Modal ────────────────────────────────────────────────────────────
function openChartsModal() {
  const list = document.getElementById('charts-list');
  list.innerHTML = '';

  if (!charts.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-title">No charts yet</div><div class="empty-state-text">Create your first timeline chart to get started.</div></div>';
  } else {
    charts.forEach(c => {
      const item = document.createElement('div');
      item.className = 'chart-item' + (c.id === currentChartId ? ' active' : '');

      item.innerHTML = `
        <div class="chart-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </div>
        <div class="chart-item-info">
          <div class="chart-item-title">${c.title}</div>
          <div class="chart-item-meta">${c.phases.length} phases &middot; Modified ${new Date(c.modified).toLocaleDateString()}</div>
        </div>
        <div class="chart-item-actions">
          <button class="chart-item-btn duplicate" title="Duplicate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="chart-item-btn delete" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>`;

      // Select chart
      item.addEventListener('click', (e) => {
        if (e.target.closest('.chart-item-btn')) return;
        currentChartId = c.id;
        undoStack = [];
        redoStack = [];
        updateUndoButtons();
        selectedPhaseId = null;
        closePanel();
        closeChartsModal();
        renderChart();
      });

      // Duplicate
      item.querySelector('.duplicate').addEventListener('click', (e) => {
        e.stopPropagation();
        const dup = JSON.parse(JSON.stringify(c));
        dup.id = uid();
        dup.title = c.title + ' (Copy)';
        dup.created = new Date().toISOString();
        dup.modified = new Date().toISOString();
        dup.phases.forEach(p => p.id = uid());
        charts.push(dup);
        saveCharts();
        openChartsModal(); // refresh list
      });

      // Delete
      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (charts.length <= 1) {
          showToast('Cannot delete the last chart');
          return;
        }
        charts = charts.filter(ch => ch.id !== c.id);
        if (currentChartId === c.id) {
          currentChartId = charts[0].id;
          undoStack = [];
          redoStack = [];
          updateUndoButtons();
          renderChart();
        }
        saveCharts();
        openChartsModal(); // refresh list
      });

      list.appendChild(item);
    });
  }

  document.getElementById('modal-overlay').classList.add('visible');
  document.getElementById('charts-modal').classList.add('visible');
}

function closeChartsModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
  document.getElementById('charts-modal').classList.remove('visible');
}

// ─── Export ──────────────────────────────────────────────────────────────────
function prepareExport() {
  const chart = document.getElementById('gantt-chart');
  const wrapper = document.getElementById('chart-wrapper');

  // Temporarily make wrapper non-fixed and fully expanded so html2canvas sees everything
  wrapper.style.position = 'static';
  wrapper.style.overflow = 'visible';
  wrapper.style.height = 'auto';
  wrapper.style.maxHeight = 'none';
  chart.classList.add('export-mode');

  // Force all rows fully visible — kill animations that html2canvas captures mid-flight
  chart.querySelectorAll('.phase-row').forEach(row => {
    row.style.animation = 'none';
    row.style.opacity = '1';
    row.style.transform = 'none';
  });

  return { chart, wrapper };
}

function cleanupExport({ chart, wrapper }) {
  chart.classList.remove('export-mode');
  wrapper.style.position = '';
  wrapper.style.overflow = '';
  wrapper.style.height = '';
  wrapper.style.maxHeight = '';

  // Restore row animations
  chart.querySelectorAll('.phase-row').forEach(row => {
    row.style.animation = '';
    row.style.opacity = '';
    row.style.transform = '';
  });
}

async function exportPNG() {
  showToast('Exporting PNG...');
  const refs = prepareExport();

  try {
    const canvas = await html2canvas(refs.chart, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#FFFFFF',
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: refs.chart.scrollWidth,
      windowHeight: refs.chart.scrollHeight,
    });
    const link = document.createElement('a');
    const title = currentChart().title.replace(/[^a-zA-Z0-9]/g, '-');
    link.download = `${title}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('PNG exported!');
  } catch (err) {
    showToast('Export failed: ' + err.message);
  }
  cleanupExport(refs);
}

async function exportPDF() {
  showToast('Exporting PDF...');
  const refs = prepareExport();

  try {
    const canvas = await html2canvas(refs.chart, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#FFFFFF',
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: refs.chart.scrollWidth,
      windowHeight: refs.chart.scrollHeight,
    });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
    const title = currentChart().title.replace(/[^a-zA-Z0-9]/g, '-');
    pdf.save(`${title}.pdf`);
    showToast('PDF exported!');
  } catch (err) {
    showToast('Export failed: ' + err.message);
  }
  cleanupExport(refs);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2500);
}

// ─── AI Generate ─────────────────────────────────────────────────────────────
function initAiHandlers() {
  const promptInput = document.getElementById('ai-prompt');
  const submitBtn = document.getElementById('ai-submit');
  const submitText = document.getElementById('ai-submit-text');
  const errorEl = document.getElementById('ai-error');

  // Enable/disable submit based on input
  promptInput.addEventListener('input', () => {
    submitBtn.disabled = !promptInput.value.trim();
  });

  // Open modal
  document.getElementById('btn-ai-generate').addEventListener('click', () => {
    promptInput.value = '';
    submitBtn.disabled = true;
    errorEl.style.display = 'none';
    submitText.textContent = 'Generate';
    submitBtn.disabled = true;
    document.getElementById('ai-modal-overlay').classList.add('visible');
    document.getElementById('ai-modal').classList.add('visible');
    setTimeout(() => promptInput.focus(), 300);
  });

  // Close modal
  document.getElementById('ai-modal-close').addEventListener('click', closeAiModal);
  document.getElementById('ai-modal-overlay').addEventListener('click', closeAiModal);
  document.getElementById('ai-cancel').addEventListener('click', closeAiModal);

  // Example chips
  document.querySelectorAll('.ai-example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      promptInput.value = chip.dataset.prompt;
      submitBtn.disabled = false;
      promptInput.focus();
    });
  });

  // Submit
  submitBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    // Loading state
    submitBtn.disabled = true;
    submitText.innerHTML = '<span class="ai-loading"><span class="ai-spinner"></span> Generating...</span>';
    errorEl.style.display = 'none';

    try {
      const resp = await fetch('/api/gantt/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || `Server error: ${resp.status}`);
      }

      const data = await resp.json();

      // Apply to current chart
      pushUndo();
      const chart = currentChart();
      if (data.title) chart.title = data.title;
      if (data.note) chart.note = data.note;

      if (data.phases && data.phases.length) {
        chart.phases = data.phases.map((p, i) => ({
          id: uid(),
          order: i,
          title: p.title || 'Untitled',
          subtitle: p.subtitle || '',
          icon: ICON_KEYS.includes(p.icon) ? p.icon : 'star',
          color: p.color || COLORS[i % COLORS.length].value,
          barStyle: p.barStyle === 'blocks' ? 'blocks' : 'solid',
          highlight: !!p.highlight,
          spans: (p.spans || []).map(s => ({
            start: s.start,
            end: s.end
          }))
        }));

        recalcDateRange();
      }

      closeAiModal();
      renderChart();
      autoSave();
      showToast(`Generated ${chart.phases.length} phases!`);

    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitText.textContent = 'Generate';
    }
  });

  // Ctrl/Cmd+Enter to submit
  promptInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitBtn.disabled) submitBtn.click();
    }
  });
}

function closeAiModal() {
  document.getElementById('ai-modal-overlay').classList.remove('visible');
  document.getElementById('ai-modal').classList.remove('visible');
}

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  loadCharts();
  renderChart();
  initDragHandlers();
  initPanelHandlers();
  initToolbarHandlers();
  initZoomHandlers();
  initAiHandlers();
  updateUndoButtons();
}

document.addEventListener('DOMContentLoaded', init);
