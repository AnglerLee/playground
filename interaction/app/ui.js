import { STAT_KEYS } from '../stats.js';

const STAT_META = [
  { key: 'hunger', icon: '🍖', label: '배고픔' },
  { key: 'happiness', icon: '❤️', label: '행복' },
  { key: 'cleanliness', icon: '🫧', label: '청결' },
  { key: 'energy', icon: '💤', label: '기력' },
];

export class AppUI {
  constructor(doc = document) {
    this.doc = doc;
    this.statsPanelEls = null;
    this.petCursorEl = null;

    this.canvas = doc.getElementById('scene');
    this.bubbleLayer = doc.getElementById('bubble-layer');
    this.worldLayer = doc.getElementById('world-layer');
    this.fxLayer = doc.getElementById('fx-layer');
    this.statsPanel = doc.getElementById('stats-panel');
    this.picker = doc.getElementById('picker');
    this.carePanel = doc.getElementById('care-panel');
    this.hint = doc.getElementById('hint');
    this.status = doc.getElementById('status');
  }

  buildPicker(keys, onSelect) {
    this.picker.innerHTML = '';
    for (const key of keys) {
      const btn = this.doc.createElement('button');
      btn.className = 'chip';
      btn.type = 'button';
      btn.dataset.key = key;
      btn.textContent = key;
      btn.setAttribute('aria-label', `${key} 선택`);
      btn.addEventListener('click', () => onSelect(key));
      this.picker.appendChild(btn);
    }
  }

  setActivePicker(key) {
    for (const btn of this.picker.querySelectorAll('.chip')) {
      btn.classList.toggle('active', btn.dataset.key === key);
    }
  }

  buildStatsPanel() {
    this.statsPanel.innerHTML = '';
    const els = {};
    for (const meta of STAT_META) {
      const row = this.doc.createElement('div');
      row.className = 'stat-row';
      row.dataset.stat = meta.key;
      row.setAttribute('aria-label', meta.label);
      row.innerHTML = `
        <span class="stat-icon">${meta.icon}</span>
        <span class="stat-bar"><span class="stat-fill"></span></span>
        <span class="stat-num">0</span>
      `;
      this.statsPanel.appendChild(row);
      els[meta.key] = {
        row,
        fill: row.querySelector('.stat-fill'),
        num: row.querySelector('.stat-num'),
      };
    }
    this.statsPanelEls = els;
  }

  refreshStatsPanel(statValues) {
    if (!this.statsPanelEls || !statValues) return;
    for (const key of STAT_KEYS) {
      const el = this.statsPanelEls[key];
      if (!el) continue;
      const value = Math.round(statValues[key]);
      el.fill.style.width = `${value}%`;
      el.num.textContent = String(value);
      el.row.classList.toggle('low', value < 30);
      el.row.classList.toggle('full', value >= 90);
    }
  }

  setStatus(text) {
    this.status.textContent = text || '';
  }

  ensurePetCursor() {
    if (this.petCursorEl) return this.petCursorEl;
    this.petCursorEl = this.doc.createElement('div');
    this.petCursorEl.className = 'pet-cursor';
    this.petCursorEl.textContent = '🖐️';
    this.doc.body.appendChild(this.petCursorEl);
    return this.petCursorEl;
  }

  showPetCursor(clientX, clientY, isBathing) {
    const el = this.ensurePetCursor();
    el.textContent = isBathing ? '🧽' : '🖐️';
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
    el.classList.add('active');
  }

  hidePetCursor() {
    if (this.petCursorEl) this.petCursorEl.classList.remove('active');
  }
}
