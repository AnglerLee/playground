export const CARE_ACTIONS = [
  {
    id: 'feed',
    icon: '🍖',
    label: '먹이',
    anim: 'lick',
    durationSec: 2.0,
    cooldownMs: 4000,
    placeable: true,
    statDelta: { hunger: 30, happiness: 5 },
    lineCategory: 'eating',
    refuseWhen: (s) => s.hunger >= 90,
    refuseCategory: 'refuseFull',
    effect: { kind: 'food', count: 6, durationMs: 1500, offsetY: -45 },
  },
  {
    id: 'play',
    icon: '🧶',
    label: '놀기',
    anim: 'jump',
    durationSec: 2.5,
    cooldownMs: 4000,
    placeable: true,
    statDelta: { happiness: 20, energy: -10, hunger: -5 },
    lineCategory: 'playing',
    refuseWhen: (s) => s.energy < 15,
    refuseCategory: 'tired',
    effect: { kind: 'sparkle', count: 12, durationMs: 800, offsetY: -55 },
  },
  {
    id: 'sleep',
    icon: '💤',
    label: '잠',
    anim: 'sleep',
    durationSec: 5.0,
    cooldownMs: 8000,
    placeable: false,
    statDelta: { energy: 40, happiness: 5 },
    lineCategory: 'sleeping',
    isResting: true,
    refuseWhen: (s) => s.energy >= 95,
    refuseCategory: 'refuseFull',
    effect: { kind: 'zzz', count: 8, durationMs: 4500, offsetY: -90 },
  },
  {
    id: 'bath',
    icon: '🛁',
    label: '씻기',
    anim: 'jump',
    durationSec: 5.0,
    cooldownMs: 4000,
    placeable: false,
    triggerOnClick: true,
    statDelta: { cleanliness: 15, happiness: -5 },
    lineCategory: 'bathing',
    refuseWhen: (s) => s.cleanliness >= 95,
    refuseCategory: 'refuseFull',
    effect: { kind: 'bubble', count: 30, durationMs: 5000, offsetY: -50 },
  },
];

export class CarePanel {
  constructor({ root, scene, onCareImmediate, onCarePlace }) {
    this.root = root;
    this.scene = scene;
    this.onCareImmediate = onCareImmediate;
    this.onCarePlace = onCarePlace;
    this.cooldowns = new Map();
    this.buttons = new Map();
    this._cooldownRaf = 0;
    this.activeDrag = null;
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'care-grid';
    for (const action of CARE_ACTIONS) {
      const btn = document.createElement('button');
      btn.className = 'care-btn';
      btn.type = 'button';
      btn.dataset.id = action.id;
      btn.setAttribute('aria-label', action.label);
      btn.title = action.label;
      btn.innerHTML = `
        <span class="care-icon">${action.icon}</span>
        <span class="care-label">${action.label}</span>
        <span class="care-cd"></span>
      `;
      if (action.triggerOnClick) {
        btn.addEventListener('click', (e) => this.handleClick(e, action));
      } else {
        btn.addEventListener('pointerdown', (e) => this.startDrag(e, action));
        btn.addEventListener('click', (e) => e.preventDefault());
      }
      grid.appendChild(btn);
      this.buttons.set(action.id, btn);
    }
    this.root.appendChild(grid);
  }

  handleClick(e, action) {
    e.preventDefault();
    if (this.activeDrag) return;
    if (this.isOnCooldown(action.id)) return;
    this.startCooldown(action);
    this.onCareImmediate(action);
  }

  startDrag(e, action) {
    if (e.button !== undefined && e.button !== 0) return;
    if (this.activeDrag) return;
    if (this.isOnCooldown(action.id)) return;
    e.preventDefault();

    const ghost = document.createElement('div');
    ghost.className = 'care-ghost';
    ghost.textContent = action.icon;
    document.body.appendChild(ghost);

    const drag = {
      action,
      ghost,
      pointerId: e.pointerId,
      onMove: null,
      onUp: null,
      onCancel: null,
      onKey: null,
    };
    this.activeDrag = drag;
    this.updateGhost(e.clientX, e.clientY);
    this.updateHover(e.clientX, e.clientY);

    drag.onMove = (ev) => {
      if (ev.pointerId !== drag.pointerId) return;
      this.updateGhost(ev.clientX, ev.clientY);
      this.updateHover(ev.clientX, ev.clientY);
    };
    drag.onUp = (ev) => {
      if (ev.pointerId !== drag.pointerId) return;
      this.tryDrop(ev.clientX, ev.clientY, action);
      this.endDrag();
    };
    drag.onCancel = () => { this.endDrag(); };
    drag.onKey = (kev) => { if (kev.code === 'Escape') this.endDrag(); };
    window.addEventListener('pointermove', drag.onMove);
    window.addEventListener('pointerup', drag.onUp);
    window.addEventListener('pointercancel', drag.onCancel);
    window.addEventListener('keydown', drag.onKey);
  }

  endDrag() {
    if (!this.activeDrag) return;
    const drag = this.activeDrag;
    drag.ghost.remove();
    window.removeEventListener('pointermove', drag.onMove);
    window.removeEventListener('pointerup', drag.onUp);
    window.removeEventListener('pointercancel', drag.onCancel);
    window.removeEventListener('keydown', drag.onKey);
    this.activeDrag = null;
  }

  updateGhost(clientX, clientY) {
    if (!this.activeDrag) return;
    this.activeDrag.ghost.style.left = `${clientX}px`;
    this.activeDrag.ghost.style.top = `${clientY}px`;
  }

  updateHover(clientX, clientY) {
    if (!this.activeDrag) return;
    const a = this.scene && this.scene.activeAnimal;
    const action = this.activeDrag.action;
    let overAnimal = false;
    if (a) {
      const w = this.scene.toWorld(clientX, clientY);
      overAnimal = a.hitTest(w.x, w.y);
    }
    const ghost = this.activeDrag.ghost;
    ghost.classList.toggle('over-target', overAnimal);
    ghost.classList.toggle('over-empty-ok', !overAnimal && !!action.placeable);
    ghost.classList.toggle('over-empty-bad', !overAnimal && !action.placeable);
  }

  tryDrop(clientX, clientY, action) {
    const a = this.scene && this.scene.activeAnimal;
    if (!a) return false;
    const w = this.scene.toWorld(clientX, clientY);
    const overAnimal = a.hitTest(w.x, w.y);
    if (overAnimal) {
      this.startCooldown(action);
      this.onCareImmediate(action);
      return true;
    }
    if (action.placeable) {
      this.startCooldown(action);
      this.onCarePlace(action, w.x, w.y);
      return true;
    }
    return false;
  }

  startCooldown(action) {
    this.cooldowns.set(action.id, { ready: Date.now() + action.cooldownMs, total: action.cooldownMs });
    this.scheduleCooldownTick();
  }

  isDragging() { return !!this.activeDrag; }

  isOnCooldown(id) {
    const e = this.cooldowns.get(id);
    return !!(e && Date.now() < e.ready);
  }

  scheduleCooldownTick() {
    if (this._cooldownRaf) return;
    const tick = () => {
      this._cooldownRaf = 0;
      const now = Date.now();
      let any = false;
      for (const [id, e] of this.cooldowns) {
        const btn = this.buttons.get(id);
        if (!btn) continue;
        const remain = Math.max(0, e.ready - now);
        const cd = btn.querySelector('.care-cd');
        if (remain > 0) {
          btn.classList.add('cooling');
          if (cd) cd.style.transform = `scaleX(${remain / e.total})`;
          any = true;
        } else {
          btn.classList.remove('cooling');
          if (cd) cd.style.transform = 'scaleX(0)';
        }
      }
      if (any) this._cooldownRaf = requestAnimationFrame(tick);
    };
    this._cooldownRaf = requestAnimationFrame(tick);
  }
}
