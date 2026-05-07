/* ── Helpers ────────────────────────────────────── */
function parseDate(str) {
  // Parse YYYY-MM-DD as local midnight (avoids UTC offset issues)
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dateDiff(a, b) {
  return Math.round((b - a) / 86400000);
}
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ── localStorage helpers ───────────────────────── */
const LS = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ── Strain helpers ─────────────────────────────── */
function getStrainDates(strain, lightDepOn) {
  if (strain.id === 'laughing-buddha' && lightDepOn && strain.lightDepMode) {
    return {
      vegStart: parseDate(strain.vegStart),
      flowerStart: parseDate(strain.lightDepMode.flowerStart),
      harvestStart: parseDate(strain.lightDepMode.harvestStart),
      harvestEnd: parseDate(strain.lightDepMode.harvestEnd),
    };
  }
  return {
    vegStart: parseDate(strain.vegStart),
    flowerStart: parseDate(strain.flowerStart),
    harvestStart: parseDate(strain.harvestStart),
    harvestEnd: parseDate(strain.harvestEnd),
  };
}

function strainPhase(strain, today, lightDepOn) {
  const { vegStart, flowerStart, harvestStart, harvestEnd } = getStrainDates(strain, lightDepOn);
  if (today < vegStart) return { phase: 'pre', label: 'Pre-season', next: vegStart, nextLabel: 'Transplant' };
  if (today < flowerStart) return { phase: 'veg', label: 'Vegetative', next: flowerStart, nextLabel: 'Flower', daysIn: dateDiff(vegStart, today) };
  if (today < harvestStart) return { phase: 'flower', label: 'Flowering', next: harvestStart, nextLabel: 'Harvest check', daysIn: dateDiff(flowerStart, today) };
  if (today <= harvestEnd) return { phase: 'harvest', label: 'Harvest window', next: harvestEnd, nextLabel: 'End of harvest', daysIn: dateDiff(harvestStart, today) };
  return { phase: 'done', label: 'Season complete', daysIn: dateDiff(harvestEnd, today) };
}

/* ── Task expansion ─────────────────────────────── */
function expandTasks(lightDepOn) {
  const tasks = [];
  for (const t of SEASON_DATA.tasks) {
    if (t.conditional === 'lightDep' && !lightDepOn) continue;
    if (!t.recurring) {
      tasks.push({ ...t, instanceId: t.id });
      continue;
    }
    const start = parseDate(t.date);
    const end = parseDate(t.until);
    let cur = new Date(start);
    let i = 0;
    while (cur <= end) {
      tasks.push({ ...t, date: isoDate(cur), instanceId: `${t.id}-${i}` });
      cur = addDays(cur, 7);
      i++;
    }
  }
  tasks.sort((a, b) => a.date.localeCompare(b.date));
  return tasks;
}

/* ── Safe DOM element builder ───────────────────── */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'textContent') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

/* ── Alpine app ─────────────────────────────────── */
document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    // ── State ──────────────────────────────────────
    activeTab: 'timeline',
    showSettings: false,

    _today: null,
    get today() {
      if (!this._today) {
        const p = new URLSearchParams(location.search).get('today');
        this._today = p ? parseDate(p) : new Date();
        this._today.setHours(0,0,0,0);
      }
      return this._today;
    },

    settings: {
      lightDep: false,
      transplantDate: '2026-06-01',
      firstFrostDate: '2026-10-21',
    },

    taskChecked: {},
    journalEntries: [],
    activeJournalStrain: 'sour-strawberry',
    journalForm: { date: '', text: '', height: '', nodes: '', water: '' },
    shopStatus: {},
    shopFilter: 'all',
    shopCollapsed: {},
    taskFilter: 'all',
    editTransplant: '',
    editFrost: '',

    // ── Init ───────────────────────────────────────
    init() {
      const s = LS.get('settings', null);
      if (s) Object.assign(this.settings, s);
      this.taskChecked = LS.get('taskChecked', {});
      this.journalEntries = LS.get('journal', []);
      this.shopStatus = LS.get('shopStatus', {});
      this.shopCollapsed = LS.get('shopCollapsed', {});
      this.journalForm.date = isoDate(this.today);
      this.editTransplant = this.settings.transplantDate;
      this.editFrost = this.settings.firstFrostDate;
      this.$nextTick(() => this.renderTimeline());
    },

    // ── Persistence ────────────────────────────────
    saveSettings() {
      LS.set('settings', this.settings);
      this.$nextTick(() => this.renderTimeline());
    },
    saveTaskChecked() { LS.set('taskChecked', this.taskChecked); },
    saveJournal() { LS.set('journal', this.journalEntries); },
    saveShopStatus() { LS.set('shopStatus', this.shopStatus); },
    saveShopCollapsed() { LS.set('shopCollapsed', this.shopCollapsed); },

    // ── Tab switching ───────────────────────────────
    switchTab(tab) {
      this.activeTab = tab;
      if (tab === 'timeline') this.$nextTick(() => this.renderTimeline());
    },

    // ── Settings helpers ────────────────────────────
    applySettings() {
      this.settings.transplantDate = this.editTransplant;
      this.settings.firstFrostDate = this.editFrost;
      this.saveSettings();
    },
    resetDates() {
      this.editTransplant = '2026-06-01';
      this.editFrost = '2026-10-21';
      this.settings.transplantDate = '2026-06-01';
      this.settings.firstFrostDate = '2026-10-21';
      this.saveSettings();
    },
    toggleLightDep() {
      this.settings.lightDep = !this.settings.lightDep;
      this.saveSettings();
    },

    // ── Now panel ───────────────────────────────────
    get strainStatuses() {
      return SEASON_DATA.strains.map(s => {
        const info = strainPhase(s, this.today, this.settings.lightDep);
        const dates = getStrainDates(s, this.settings.lightDep);
        return { strain: s, ...info, dates };
      });
    },
    get daysToFrost() {
      return dateDiff(this.today, parseDate(this.settings.firstFrostDate));
    },
    get buddhaFrostRisk() {
      const lb = SEASON_DATA.strains.find(s => s.id === 'laughing-buddha');
      const dates = getStrainDates(lb, this.settings.lightDep);
      const frostDate = parseDate(this.settings.firstFrostDate);
      return dateDiff(dates.harvestStart, frostDate) <= 7;
    },
    phaseBadgeClass(phase) {
      return { veg: 'badge-veg', flower: 'badge-flower', harvest: 'badge-harvest', done: 'badge-done', pre: 'badge-pre' }[phase] || '';
    },
    daysLabel(info) {
      if (info.phase === 'pre') return `Starts ${fmtDate(info.next)}`;
      if (info.phase === 'done') return `Done ${info.daysIn}d ago`;
      return `Day ${info.daysIn + 1}`;
    },
    untilLabel(info) {
      if (info.phase === 'done' || !info.next) return '';
      const d = dateDiff(this.today, info.next);
      if (d <= 0) return `${info.nextLabel} now`;
      return `${d}d to ${info.nextLabel}`;
    },

    // ── Tasks ───────────────────────────────────────
    get expandedTasks() { return expandTasks(this.settings.lightDep); },

    get filteredTasks() {
      const tasks = this.expandedTasks;
      const today = isoDate(this.today);
      const weekEnd = isoDate(addDays(this.today, 6));
      return tasks.filter(t => {
        if (this.taskFilter === 'today') return t.date === today;
        if (this.taskFilter === 'week') return t.date >= today && t.date <= weekEnd;
        if (this.taskFilter === 'overdue') return t.date < today && !this.taskChecked[t.instanceId];
        return true;
      });
    },

    isOverdue(task) {
      return task.date < isoDate(this.today) && !this.taskChecked[task.instanceId];
    },
    isToday(task) {
      return task.date === isoDate(this.today);
    },
    toggleTask(instanceId) {
      this.taskChecked[instanceId] = !this.taskChecked[instanceId];
      this.saveTaskChecked();
    },
    strainColor(scope) {
      if (scope === 'all') return '#8b949e';
      const s = SEASON_DATA.strains.find(x => x.id === scope);
      return s ? s.color : '#8b949e';
    },
    strainName(scope) {
      if (scope === 'all') return 'All';
      const s = SEASON_DATA.strains.find(x => x.id === scope);
      return s ? s.name : scope;
    },
    get taskCounts() {
      const today = isoDate(this.today);
      const tasks = this.expandedTasks;
      return {
        today: tasks.filter(t => t.date === today).length,
        overdue: tasks.filter(t => t.date < today && !this.taskChecked[t.instanceId]).length,
        week: tasks.filter(t => t.date >= today && t.date <= isoDate(addDays(this.today, 6))).length,
      };
    },

    // ── Journal ─────────────────────────────────────
    get activeStrainObj() {
      return SEASON_DATA.strains.find(s => s.id === this.activeJournalStrain);
    },
    get activeJournalEntries() {
      return [...this.journalEntries]
        .filter(e => e.strainId === this.activeJournalStrain)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    addJournalEntry() {
      if (!this.journalForm.text.trim()) return;
      this.journalEntries.push({
        id: Date.now().toString(),
        strainId: this.activeJournalStrain,
        date: this.journalForm.date || isoDate(this.today),
        text: this.journalForm.text.trim(),
        height: this.journalForm.height || null,
        nodes: this.journalForm.nodes || null,
        water: this.journalForm.water || null,
      });
      this.journalForm.text = '';
      this.journalForm.height = '';
      this.journalForm.nodes = '';
      this.journalForm.water = '';
      this.saveJournal();
    },
    deleteJournalEntry(id) {
      this.journalEntries = this.journalEntries.filter(e => e.id !== id);
      this.saveJournal();
    },
    exportJournal() {
      const lines = ['# GrowSeason 2026 Journal\n'];
      for (const strain of SEASON_DATA.strains) {
        const entries = this.journalEntries
          .filter(e => e.strainId === strain.id)
          .sort((a, b) => a.date.localeCompare(b.date));
        if (!entries.length) continue;
        lines.push(`## ${strain.name}\n`);
        for (const e of entries) {
          lines.push(`### ${e.date}\n`);
          lines.push(e.text + '\n');
          const stats = [];
          if (e.height) stats.push(`Height: ${e.height} in`);
          if (e.nodes) stats.push(`Nodes: ${e.nodes}`);
          if (e.water) stats.push(`Water: ${e.water} oz`);
          if (stats.length) lines.push('\n_' + stats.join(' | ') + '_\n');
          lines.push('');
        }
      }
      downloadText('growseason-journal.md', lines.join('\n'));
    },

    // ── Shopping ─────────────────────────────────────
    get shopCategories() {
      const cats = {};
      for (const item of SEASON_DATA.shopping) {
        if (item.category === 'lightdep' && !this.settings.lightDep) continue;
        if (!cats[item.category]) cats[item.category] = [];
        cats[item.category].push(item);
      }
      return cats;
    },
    get shopCategoryNames() {
      return Object.keys(this.shopCategories);
    },
    categoryLabel(cat) {
      const labels = { soil: 'Soil', mobility: 'Mobility', pests: 'Pest Control', tools: 'Tools', lightdep: 'Light Dep', drying: 'Drying & Cure', privacy: 'Privacy' };
      return labels[cat] || cat;
    },
    filteredShopItems(cat) {
      const items = this.shopCategories[cat] || [];
      const needBy14 = isoDate(addDays(this.today, 14));
      const today = isoDate(this.today);
      return items.filter(item => {
        const status = this.shopStatus[item.id] || 'needed';
        if (this.shopFilter === 'now') return status === 'needed' && item.needBy <= needBy14 && item.needBy >= today;
        if (this.shopFilter === 'needed') return status === 'needed';
        if (this.shopFilter === 'acquired') return status === 'acquired';
        return true;
      }).sort((a, b) => a.needBy.localeCompare(b.needBy));
    },
    catHasItems(cat) {
      return this.filteredShopItems(cat).length > 0;
    },
    cycleShopStatus(id) {
      const cur = this.shopStatus[id] || 'needed';
      const next = { needed: 'ordered', ordered: 'acquired', acquired: 'needed' }[cur];
      this.shopStatus[id] = next;
      this.saveShopStatus();
    },
    getShopStatus(id) { return this.shopStatus[id] || 'needed'; },
    toggleCat(cat) {
      this.shopCollapsed[cat] = !this.shopCollapsed[cat];
      this.saveShopCollapsed();
    },
    get shopProgress() {
      let total = 0, acquired = 0;
      for (const item of SEASON_DATA.shopping) {
        if (item.category === 'lightdep' && !this.settings.lightDep) continue;
        total++;
        if ((this.shopStatus[item.id] || 'needed') === 'acquired') acquired++;
      }
      return { total, acquired, pct: total ? Math.round(acquired / total * 100) : 0 };
    },
    catProgress(cat) {
      const items = this.shopCategories[cat] || [];
      const acquired = items.filter(i => (this.shopStatus[i.id] || 'needed') === 'acquired').length;
      return `${acquired}/${items.length}`;
    },

    // ── Import / Export ──────────────────────────────
    exportState() {
      const state = {
        settings: this.settings,
        taskChecked: this.taskChecked,
        journal: this.journalEntries,
        shopStatus: this.shopStatus,
        shopCollapsed: this.shopCollapsed,
        exportedAt: new Date().toISOString(),
      };
      downloadText('growseason-state.json', JSON.stringify(state, null, 2));
    },
    importState() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const state = JSON.parse(ev.target.result);
            if (state.settings) Object.assign(this.settings, state.settings);
            if (state.taskChecked) this.taskChecked = state.taskChecked;
            if (state.journal) this.journalEntries = state.journal;
            if (state.shopStatus) this.shopStatus = state.shopStatus;
            if (state.shopCollapsed) this.shopCollapsed = state.shopCollapsed;
            this.saveSettings(); this.saveTaskChecked(); this.saveJournal();
            this.saveShopStatus(); this.saveShopCollapsed();
            this.editTransplant = this.settings.transplantDate;
            this.editFrost = this.settings.firstFrostDate;
            this.$nextTick(() => this.renderTimeline());
          } catch {
            alert('Import failed: invalid JSON file.');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    },

    // ── Timeline rendering ───────────────────────────
    renderTimeline() {
      const svg = document.getElementById('timeline-svg');
      if (!svg) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const W = Math.max(svg.parentElement.clientWidth - 16, 600);
      const ROW_H = 36;
      const HEADER_H = 32;
      const LABEL_W = 120;
      const PADDING = 8;

      const seasonStart = parseDate('2026-05-01');
      const seasonEnd = parseDate('2026-11-15');
      const totalDays = dateDiff(seasonStart, seasonEnd);
      const chartW = W - LABEL_W - PADDING * 2;
      const H = HEADER_H + ROW_H * SEASON_DATA.strains.length + PADDING;

      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

      function xOf(date) {
        const d = dateDiff(seasonStart, date);
        return LABEL_W + PADDING + (d / totalDays) * chartW;
      }
      function mkEl(tag, attrs = {}) {
        const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
      }
      function mkTxt(content, attrs = {}) {
        const e = mkEl('text', attrs);
        e.textContent = String(content);
        return e;
      }

      svg.appendChild(mkEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#161b22' }));

      const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
      const monthDates = [
        parseDate('2026-05-01'), parseDate('2026-06-01'), parseDate('2026-07-01'),
        parseDate('2026-08-01'), parseDate('2026-09-01'), parseDate('2026-10-01'),
        parseDate('2026-11-01')
      ];
      monthDates.forEach((md, i) => {
        const x = xOf(md);
        svg.appendChild(mkEl('line', { x1: x, y1: HEADER_H, x2: x, y2: H, stroke: '#30363d', 'stroke-width': 1 }));
        svg.appendChild(mkTxt(months[i], { x: x + 4, y: HEADER_H - 8, fill: '#8b949e', 'font-size': 11 }));
      });

      SEASON_DATA.strains.forEach((strain, i) => {
        const y = HEADER_H + ROW_H * i;
        const dates = getStrainDates(strain, this.settings.lightDep);
        const { vegStart, flowerStart, harvestStart, harvestEnd } = dates;

        if (i % 2 === 1) svg.appendChild(mkEl('rect', { x: 0, y, width: W, height: ROW_H, fill: '#0d1117', opacity: .5 }));

        svg.appendChild(mkTxt(strain.name, { x: 4, y: y + ROW_H / 2 + 4, fill: strain.color, 'font-size': 11, 'font-weight': 600 }));

        const vx1 = xOf(vegStart), vx2 = xOf(flowerStart);
        svg.appendChild(mkEl('rect', { x: vx1, y: y+8, width: Math.max(0, vx2-vx1), height: ROW_H-16, fill: '#7FB069', opacity: .35, rx: 3 }));
        svg.appendChild(mkEl('rect', { x: vx1, y: y+8, width: Math.max(0, vx2-vx1), height: ROW_H-16, fill: 'none', stroke: '#7FB069', 'stroke-width': 1, rx: 3 }));

        const fx1 = xOf(flowerStart), fx2 = xOf(harvestStart);
        svg.appendChild(mkEl('rect', { x: fx1, y: y+8, width: Math.max(0, fx2-fx1), height: ROW_H-16, fill: strain.color, opacity: .5, rx: 3 }));

        const hx1 = xOf(harvestStart), hx2 = xOf(harvestEnd);
        svg.appendChild(mkEl('rect', { x: hx1, y: y+8, width: Math.max(0, hx2-hx1), height: ROW_H-16, fill: strain.color, opacity: .9, rx: 3 }));
      });

      const frostDate = parseDate(this.settings.firstFrostDate);
      if (frostDate >= seasonStart && frostDate <= seasonEnd) {
        const fx = xOf(frostDate);
        svg.appendChild(mkEl('line', { x1: fx, y1: 0, x2: fx, y2: H, stroke: '#58a6ff', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
        svg.appendChild(mkTxt('frost', { x: fx + 3, y: 12, fill: '#58a6ff', 'font-size': 9 }));
      }

      const todayX = xOf(this.today);
      if (todayX >= LABEL_W && todayX <= W) {
        svg.appendChild(mkEl('line', { x1: todayX, y1: 0, x2: todayX, y2: H, stroke: '#ffffff', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', opacity: .7 }));
        svg.appendChild(mkTxt('today', { x: todayX + 3, y: 12, fill: '#ffffff', 'font-size': 9, opacity: .7 }));
      }

      this.renderMobileTimeline();
    },

    renderMobileTimeline() {
      const wrap = document.getElementById('vtimeline-wrap');
      if (!wrap) return;
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

      const seasonStart = parseDate('2026-05-01');
      const seasonEnd = parseDate('2026-11-15');
      const totalDays = dateDiff(seasonStart, seasonEnd);

      function pct(d) { return clamp(dateDiff(seasonStart, d) / totalDays * 100, 0, 100) + '%'; }

      SEASON_DATA.strains.forEach(strain => {
        const dates = getStrainDates(strain, this.settings.lightDep);
        const { vegStart, flowerStart, harvestStart, harvestEnd } = dates;

        const vegW = clamp(dateDiff(vegStart, flowerStart) / totalDays * 100, 0, 100) + '%';
        const flrW = clamp(dateDiff(flowerStart, harvestStart) / totalDays * 100, 0, 100) + '%';
        const harW = clamp(dateDiff(harvestStart, harvestEnd) / totalDays * 100, 0, 100) + '%';

        const nameEl = el('div', { className: 'vtimeline-name', style: { color: strain.color }, textContent: strain.name });
        const barWrap = el('div', { className: 'vtimeline-bar-wrap' });

        const vegSeg = el('div', { className: 'vtimeline-seg', style: { left: pct(vegStart), width: vegW, background: '#7FB069', opacity: '0.4' } });
        const flrSeg = el('div', { className: 'vtimeline-seg', style: { left: pct(flowerStart), width: flrW, background: strain.color, opacity: '0.5' } });
        const harSeg = el('div', { className: 'vtimeline-seg', style: { left: pct(harvestStart), width: harW, background: strain.color, opacity: '0.9' } });

        barWrap.appendChild(vegSeg);
        barWrap.appendChild(flrSeg);
        barWrap.appendChild(harSeg);

        const labelsEl = el('div', { className: 'vtimeline-labels' }, [
          el('span', { className: 'vtimeline-label', textContent: 'May' }),
          el('span', { className: 'vtimeline-label', textContent: 'Jul' }),
          el('span', { className: 'vtimeline-label', textContent: 'Sep' }),
          el('span', { className: 'vtimeline-label', textContent: 'Nov' }),
        ]);

        const div = el('div', { className: 'vtimeline-strain' }, [nameEl, barWrap, labelsEl]);
        wrap.appendChild(div);
      });
    },
  }));
});

/* ── Utility ─────────────────────────────────────── */
function downloadText(filename, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
