// Persistent emoji objects placed in the world (food, ball, poop).
// Lives in #world-layer (DOM), positioned in client coords (= canvas coords since canvas covers viewport).

const KIND_CONFIG = {
  food: { emoji: '🍖', className: 'food', defaultTtlMs: 30000 },
  ball: { emoji: '🧶', className: 'ball', defaultTtlMs: Infinity },
  poop: { emoji: '💩', className: 'poop', defaultTtlMs: Infinity },
};

let _idSeq = 0;

export class WorldObjects {
  constructor(layer) {
    this.layer = layer;
    this.items = new Map();
  }

  add({ kind, x, y, ttlMs, draggable = false, onUserCleaned = null }) {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) return null;
    const id = ++_idSeq;
    const el = document.createElement('span');
    el.className = `world-item ${cfg.className}`;
    el.textContent = cfg.emoji;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (draggable) el.style.pointerEvents = 'auto';
    this.layer.appendChild(el);

    const item = {
      id, kind, x, y, el,
      ttlMs: ttlMs ?? cfg.defaultTtlMs,
      ageMs: 0,
      onUserCleaned,
      cleanupDrag: null,
    };
    this.items.set(id, item);
    return item;
  }

  move(id, x, y) {
    const item = this.items.get(id);
    if (!item) return;
    item.x = x;
    item.y = y;
    item.el.style.left = `${x}px`;
    item.el.style.top = `${y}px`;
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.cleanupDrag) item.cleanupDrag();
    item.el.remove();
    this.items.delete(id);
  }

  has(id) { return this.items.has(id); }

  getItem(id) { return this.items.get(id) || null; }

  getFirstByKind(kind) {
    for (const item of this.items.values()) {
      if (item.kind === kind) return item;
    }
    return null;
  }

  getAllByKind(kind) {
    const matches = [];
    for (const item of this.items.values()) {
      if (item.kind === kind) matches.push(item);
    }
    return matches;
  }

  forEach(callback) {
    for (const item of this.items.values()) callback(item);
  }

  bindDrag(id, handlers = {}) {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.cleanupDrag) item.cleanupDrag();

    let pointerId = null;
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      handlers.onMove?.(item, ev);
    };
    const onUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      handlers.onDrop?.(item, ev);
    };
    const onCancel = (ev) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      handlers.onCancel?.(item, ev);
    };
    const onPointerDown = (ev) => {
      if (pointerId !== null) return;
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      pointerId = ev.pointerId;
      item.el.classList.add('dragging');
      handlers.onStart?.(item, ev);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      item.el.classList.remove('dragging');
      pointerId = null;
    };

    item.el.style.pointerEvents = 'auto';
    item.el.addEventListener('pointerdown', onPointerDown);
    item.cleanupDrag = () => {
      cleanup();
      item.el.removeEventListener('pointerdown', onPointerDown);
      item.cleanupDrag = null;
    };
    return item.cleanupDrag;
  }

  countByKind(kind) {
    let n = 0;
    for (const item of this.items.values()) if (item.kind === kind) n++;
    return n;
  }

  tickAge(dtSec) {
    if (!dtSec) return;
    const dtMs = dtSec * 1000;
    const expired = [];
    for (const item of this.items.values()) {
      if (!isFinite(item.ttlMs)) continue;
      item.ageMs += dtMs;
      if (item.ageMs >= item.ttlMs) expired.push(item.id);
    }
    for (const id of expired) this.remove(id);
  }

  clearAll() {
    for (const item of this.items.values()) {
      if (item.cleanupDrag) item.cleanupDrag();
      item.el.remove();
    }
    this.items.clear();
  }
}
