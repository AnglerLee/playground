// Emoji particle effects. Each kind has its own CSS keyframe animation.
// Add a new kind by adding an entry here + a `.fx-<class>` rule + keyframes in styles.css.

const KINDS = {
  bubble: {
    emojis: ['🫧', '🫧', '🫧', '✨', '💧'],
    cssClass: 'fx-bubble',
    perParticleMs: 1800,
    defaultSpawnMs: 2200,
    spreadX: 70,
    spreadY: 50,
    delayJitterMs: 250,
  },
  water: {
    emojis: ['💦', '💧'],
    cssClass: 'fx-water',
    perParticleMs: 1200,
    defaultSpawnMs: 1200,
    spreadX: 40,
    spreadY: 20,
    delayJitterMs: 150,
  },
  heart: {
    emojis: ['❤️', '💕', '♥', '💖'],
    cssClass: 'fx-heart',
    perParticleMs: 1600,
    defaultSpawnMs: 1000,
    spreadX: 40,
    spreadY: 20,
    delayJitterMs: 200,
  },
  sparkle: {
    emojis: ['✨', '💫', '⭐'],
    cssClass: 'fx-sparkle',
    perParticleMs: 900,
    defaultSpawnMs: 700,
    spreadX: 70,
    spreadY: 70,
    delayJitterMs: 100,
  },
  food: {
    emojis: ['🍖', '🥩', '❤️'],
    cssClass: 'fx-food',
    perParticleMs: 1100,
    defaultSpawnMs: 1500,
    spreadX: 35,
    spreadY: 25,
    delayJitterMs: 220,
  },
  zzz: {
    emojis: ['💤', '𝓏', 'z'],
    cssClass: 'fx-zzz',
    perParticleMs: 2200,
    defaultSpawnMs: 4000,
    spreadX: 20,
    spreadY: 30,
    delayJitterMs: 700,
  },
};

export class Effects {
  constructor(layer) {
    this.layer = layer;
    this._timeouts = new Set();
  }

  spawn({ kind, x, y, count = 8, durationMs, spreadX, spreadY }) {
    const cfg = KINDS[kind];
    if (!cfg) return;
    const window = durationMs || cfg.defaultSpawnMs;
    const step = window / Math.max(1, count);
    const sx = (spreadX !== undefined) ? spreadX : cfg.spreadX;
    const sy = (spreadY !== undefined) ? spreadY : cfg.spreadY;
    for (let i = 0; i < count; i++) {
      const delay = i * step + Math.random() * cfg.delayJitterMs;
      const t = setTimeout(() => {
        this._timeouts.delete(t);
        this._spawnOne(cfg, x, y, sx, sy);
      }, delay);
      this._timeouts.add(t);
    }
  }

  _spawnOne(cfg, x, y, sx, sy) {
    if (!this.layer || !this.layer.isConnected) return;
    const el = document.createElement('span');
    el.className = `fx-particle ${cfg.cssClass}`;
    el.textContent = cfg.emojis[Math.floor(Math.random() * cfg.emojis.length)];

    const ox = (Math.random() - 0.5) * 2 * sx;
    const oy = (Math.random() - 0.5) * 2 * sy;
    el.style.left = `${x + ox}px`;
    el.style.top  = `${y + oy}px`;

    // Per-particle randomization fed into CSS via custom properties.
    el.style.setProperty('--rot',         `${(Math.random() - 0.5) * 40}deg`);
    const scaleFrom = cfg.cssClass === 'fx-bubble'
      ? (0.6 + Math.random() * 1.0)
      : (0.55 + Math.random() * 0.4);
    el.style.setProperty('--scale-from',  `${scaleFrom}`);
    el.style.setProperty('--rise',        `${50 + Math.random() * 50}px`);
    el.style.setProperty('--wobble',      `${(Math.random() - 0.5) * 30}px`);
    el.style.setProperty('--burst-x',     `${(Math.random() - 0.5) * 80}px`);
    el.style.setProperty('--burst-y',     `${(Math.random() - 0.5) * 80}px`);

    this.layer.appendChild(el);
    const t = setTimeout(() => {
      this._timeouts.delete(t);
      el.remove();
    }, cfg.perParticleMs + 50);
    this._timeouts.add(t);
  }

  clear() {
    for (const t of this._timeouts) clearTimeout(t);
    this._timeouts.clear();
    if (this.layer) this.layer.innerHTML = '';
  }
}
