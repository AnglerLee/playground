import { anchorOf } from '../js/sheet.js';
import { expandSequence } from '../js/preview.js';
import { getLine } from './dialogue/index.js';

const STATE_PLAN = {
  idle:    { anim: 'idle',  weight: 30 },
  wander:  { anim: 'walk',  weight: 30 },
  hop:     { anim: 'jump',  weight: 12 },
  groom:   { anim: 'lick',  weight: 10 },
  gesture: { anim: 'point', weight: 10 },
  dash:    { anim: 'run',   weight: 6 },
  nap:     { anim: 'sleep', weight: 2 },
};

const EPHEMERAL_STATES = new Set(['gesture', 'hop', 'groom']);

export class Animal {
  constructor({ key, sheetData, image, scene, bubbleLayer, stats = null }) {
    this.key = key;
    this.sheet = sheetData;
    this.image = image;
    this.scene = scene;
    this.bubbleLayer = bubbleLayer;
    this.stats = stats;

    this.animations = new Map();
    for (const a of sheetData.animations || []) {
      this.animations.set(a.name, {
        name: a.name,
        fps: Math.max(1, a.fps || 8),
        loop: a.loop !== false,
        anchorMode: a.anchorMode || sheetData.anchorMode || 'bottom-center',
        sequence: expandSequence(a.frames || [], a.pingpong),
      });
    }

    const w = scene.world();
    this.x = (w.left + w.right) / 2;
    this.y = (w.top + w.bottom) / 2;
    this.facing = 1;

    this.target = null;
    this.state = null;
    this.stateTimer = 0;
    this.stateDuration = 0;

    this.currentAnim = null;
    this.cursor = 0;
    this.acc = 0;
    this.cycles = 0;

    this.bubbleEl = null;
    this.bubbleTimer = 0;

    this._careOpts = null;
    this._onArrive = null;
    this._onTick = null;

    this.setState('idle');
  }

  setAnimation(name, force = false) {
    const anim = this.animations.get(name);
    if (!anim) return;
    if (!force && this.currentAnim && this.currentAnim.name === name) return;
    this.currentAnim = anim;
    this.cursor = 0;
    this.acc = 0;
    this.cycles = 0;
  }

  setState(name, opts = {}) {
    this.state = name;
    this.cycles = 0;
    this.stateTimer = 0;
    this._careOpts = null;
    this._onArrive = null;
    this._onTick = null;

    const planned = STATE_PLAN[name]?.anim;
    if (planned) this.setAnimation(planned);

    const w = this.scene.world();
    const speed = this.stats ? this.stats.speedMultiplier(this.key) : 1;

    switch (name) {
      case 'idle': {
        this.target = null;
        this.stateDuration = 1.5 + Math.random() * 2.5;
        if (Math.random() < 0.25) {
          const cat = this.stats ? this.stats.getMoodCategory(this.key) : 'idle';
          const line = getLine(this.key, cat);
          if (line) this.say(line);
        }
        break;
      }
      case 'wander': {
        this.target = {
          x: w.left + Math.random() * (w.right - w.left),
          y: w.top + Math.random() * (w.bottom - w.top),
          speed: 60 * speed,
        };
        this.stateDuration = 12;
        break;
      }
      case 'dash': {
        const t = opts.target || {
          x: w.left + Math.random() * (w.right - w.left),
          y: w.top + Math.random() * (w.bottom - w.top),
        };
        this.target = {
          x: Math.max(w.left, Math.min(w.right, t.x)),
          y: Math.max(w.top, Math.min(w.bottom, t.y)),
          speed: 180 * speed,
        };
        this.stateDuration = 6;
        break;
      }
      case 'hop': {
        this.target = null;
        this.stateDuration = 1.5;
        if (opts.lineCategory) {
          const line = getLine(this.key, opts.lineCategory);
          if (line) this.say(line);
        }
        break;
      }
      case 'groom': {
        this.target = null;
        this.stateDuration = 4.0;
        break;
      }
      case 'gesture': {
        this.target = null;
        this.stateDuration = 2.5;
        if (typeof opts.faceX === 'number') {
          this.facing = opts.faceX > this.x ? 1 : -1;
        }
        const line = getLine(this.key, 'gesture');
        if (line) this.say(line);
        break;
      }
      case 'nap': {
        this.target = null;
        this.stateDuration = 8 + Math.random() * 6;
        const line = getLine(this.key, 'sleeping');
        if (line) this.say(line);
        break;
      }
      case 'careAction': {
        this.target = null;
        this._careOpts = opts;
        this.setAnimation(opts.anim || 'idle', true);
        this.stateDuration = Math.max(0.8, opts.duration || 2.0);
        if (opts.lineCategory) {
          const line = getLine(this.key, opts.lineCategory);
          if (line) this.say(line);
        }
        break;
      }
      case 'fetch': {
        const t = opts.target || { x: this.x, y: this.y };
        this.target = {
          x: Math.max(w.left, Math.min(w.right, t.x)),
          y: Math.max(w.top,  Math.min(w.bottom, t.y)),
          speed: (opts.speed || 120) * speed,
        };
        this.setAnimation(opts.anim || 'walk');
        this._onArrive = opts.onArrive || null;
        this._onTick = opts.onTick || null;
        this.stateDuration = 30;
        break;
      }
      case 'carry': {
        const t = opts.target || { x: this.x, y: this.y };
        this.target = {
          x: Math.max(w.left, Math.min(w.right, t.x)),
          y: Math.max(w.top,  Math.min(w.bottom, t.y)),
          speed: (opts.speed || 100) * speed,
        };
        this.setAnimation(opts.anim || 'walk');
        this._onArrive = opts.onArrive || null;
        this._onTick = opts.onTick || null;
        this.stateDuration = 30;
        break;
      }
    }
  }

  pickNext() {
    const exclude = new Set();
    if (this.state === 'nap') exclude.add('nap');
    if (this.state === 'dash') exclude.add('dash');

    const baseWeights = {};
    for (const [k, v] of Object.entries(STATE_PLAN)) {
      if (!exclude.has(k)) baseWeights[k] = v.weight;
    }
    const weights = this.stats ? this.stats.getStateWeights(baseWeights, this.key) : baseWeights;

    const entries = Object.entries(weights);
    let total = 0;
    for (const [, v] of entries) total += Math.max(0, v);
    if (total <= 0) return 'idle';
    let r = Math.random() * total;
    for (const [k, v] of entries) {
      r -= Math.max(0, v);
      if (r <= 0) return k;
    }
    return 'idle';
  }

  update(dt) {
    if (this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const step = this.target.speed * dt;
      if (dist <= step || dist < 1.5) {
        this.x = this.target.x;
        this.y = this.target.y;
        this.target = null;
        this.advanceFrame(dt);
        this.layoutBubble();
        this.updateBubbleTimer(dt);
        if (this._onArrive) {
          const cb = this._onArrive;
          this._onArrive = null;
          this._onTick = null;
          cb(this);
        } else {
          this.setState('idle');
        }
        return;
      }
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      if (Math.abs(dx) > 0.5) this.facing = dx >= 0 ? 1 : -1;
      if (this._onTick) this._onTick(this);
    }

    this.stateTimer += dt;

    if (EPHEMERAL_STATES.has(this.state) && this.cycles >= 1) {
      this.advanceFrame(dt);
      this.layoutBubble();
      this.updateBubbleTimer(dt);
      this.setState('idle');
      return;
    }

    if (this.stateTimer >= this.stateDuration) {
      this.advanceFrame(dt);
      this.layoutBubble();
      this.updateBubbleTimer(dt);
      this.setState(this.pickNext());
      return;
    }

    this.advanceFrame(dt);
    this.layoutBubble();
    this.updateBubbleTimer(dt);
  }

  advanceFrame(dt) {
    const anim = this.currentAnim;
    if (!anim || !anim.sequence.length) return;
    this.acc += dt;
    const frameDur = 1 / anim.fps;
    while (this.acc >= frameDur) {
      this.acc -= frameDur;
      this.cursor++;
      if (this.cursor >= anim.sequence.length) {
        if (anim.loop) {
          this.cursor = 0;
        } else {
          this.cursor = anim.sequence.length - 1;
        }
        this.cycles++;
      }
    }
  }

  draw(ctx) {
    const anim = this.currentAnim;
    if (!anim || !this.image || !anim.sequence.length) return;
    const f = anim.sequence[Math.min(this.cursor, anim.sequence.length - 1)];
    const a = anchorOf(f, anim.anchorMode);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing, 1);
    ctx.drawImage(this.image, f.x, f.y, f.w, f.h, -a.ax, -a.ay, f.w, f.h);
    ctx.restore();
  }

  hitTest(px, py) {
    const anim = this.currentAnim;
    if (!anim || !anim.sequence.length) return false;
    const f = anim.sequence[Math.min(this.cursor, anim.sequence.length - 1)];
    const a = anchorOf(f, anim.anchorMode);
    const left = this.facing > 0 ? this.x - a.ax : this.x - (f.w - a.ax);
    const top = this.y - a.ay;
    return px >= left && px <= left + f.w && py >= top && py <= top + f.h;
  }

  faceTowards(targetX) {
    if (this.target) return;
    this.facing = targetX > this.x ? 1 : -1;
  }

  isBusy() {
    return this.state === 'careAction' || this.state === 'fetch' || this.state === 'carry' || this.state === 'nap';
  }

  isInteractive() {
    return this.state !== 'fetch' && this.state !== 'carry';
  }

  isResting() {
    if (this.state === 'nap') return true;
    if (this.state === 'careAction' && this._careOpts && this._careOpts.isResting) return true;
    return false;
  }

  isBathing() {
    return this.state === 'careAction' && this._careOpts && this._careOpts.lineCategory === 'bathing';
  }

  getCurrentCareAction() {
    if (this.state !== 'careAction' || !this._careOpts) return null;
    return {
      anim: this._careOpts.anim || null,
      duration: this._careOpts.duration || null,
      lineCategory: this._careOpts.lineCategory || null,
      isResting: !!this._careOpts.isResting,
    };
  }

  say(text) {
    if (!text) return;
    if (!this.bubbleEl) {
      this.bubbleEl = document.createElement('div');
      this.bubbleEl.className = 'bubble';
      this.bubbleLayer.appendChild(this.bubbleEl);
    }
    this.bubbleEl.classList.remove('fade-out');
    this.bubbleEl.textContent = text;
    this.bubbleTimer = 2.5;
    this.layoutBubble();
  }

  updateBubbleTimer(dt) {
    if (this.bubbleTimer <= 0) return;
    this.bubbleTimer -= dt;
    if (this.bubbleTimer <= 0.3 && this.bubbleEl) {
      this.bubbleEl.classList.add('fade-out');
    }
    if (this.bubbleTimer <= 0) {
      this.removeBubble();
    }
  }

  layoutBubble() {
    if (!this.bubbleEl || !this.currentAnim || !this.currentAnim.sequence.length) return;
    const f = this.currentAnim.sequence[Math.min(this.cursor, this.currentAnim.sequence.length - 1)];
    const a = anchorOf(f, this.currentAnim.anchorMode);
    const topY = this.y - a.ay;
    this.bubbleEl.style.left = `${this.x}px`;
    this.bubbleEl.style.top = `${topY - 10}px`;
  }

  removeBubble() {
    if (!this.bubbleEl) return;
    this.bubbleEl.remove();
    this.bubbleEl = null;
    this.bubbleTimer = 0;
  }

  destroy() {
    this.removeBubble();
  }
}
