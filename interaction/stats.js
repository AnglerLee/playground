const STAT_KEYS = ['hunger', 'happiness', 'cleanliness', 'energy'];
const ANIMALS = ['cat', 'rabbit', 'cogi', 'capybara'];
const STORAGE_KEY = 'interaction.stats.v1';
const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;

const DECAY_PER_MIN = {
  hunger: 2.0,
  happiness: 1.2,
  cleanliness: 1.0,
  energy: 1.5,
};
const ENERGY_RECOVER_PER_MIN = 6.0;
const BACKGROUND_RATE = 0.5;
const OFFLINE_RATE = 0.5;

const DEFAULT_STAT = { hunger: 80, happiness: 90, cleanliness: 90, energy: 90 };

function clamp(v) { return Math.max(0, Math.min(100, v)); }

function freshDefaults() {
  const out = {};
  for (const k of ANIMALS) out[k] = { ...DEFAULT_STAT };
  return out;
}

export class Stats {
  constructor() {
    this.byAnimal = freshDefaults();
    this.lastUpdate = Date.now();
    this.activeKey = null;
    this.dirty = false;
    this.load();
  }

  setActive(key) { this.activeKey = key; }

  get(key) { return this.byAnimal[key]; }

  add(key, stat, delta) {
    const s = this.byAnimal[key];
    if (!s || !(stat in s)) return;
    s[stat] = clamp(s[stat] + delta);
    this.dirty = true;
  }

  // dt in seconds. opts.resting = key currently sleeping (skips energy decay, regenerates instead).
  // opts.poopCount = number of uncleaned poops (active animal only) → accelerates cleanliness decay.
  tick(dt, opts = {}) {
    if (dt <= 0) return;
    const restingKey = opts.resting || null;
    const poopMul = 1 + 0.3 * (opts.poopCount || 0);
    for (const k of ANIMALS) {
      const s = this.byAnimal[k];
      const isActive = k === this.activeKey;
      const scale = isActive ? 1.0 : BACKGROUND_RATE;
      const cleanScale = isActive ? poopMul : 1;
      s.hunger      = clamp(s.hunger      - (DECAY_PER_MIN.hunger      / 60) * dt * scale);
      s.cleanliness = clamp(s.cleanliness - (DECAY_PER_MIN.cleanliness / 60) * dt * scale * cleanScale);
      if (k === restingKey) {
        s.happiness = clamp(s.happiness - (DECAY_PER_MIN.happiness / 60) * dt * 0.3);
        s.energy    = clamp(s.energy    + (ENERGY_RECOVER_PER_MIN  / 60) * dt);
      } else {
        s.happiness = clamp(s.happiness - (DECAY_PER_MIN.happiness / 60) * dt * scale);
        s.energy    = clamp(s.energy    - (DECAY_PER_MIN.energy    / 60) * dt * scale);
      }
    }
    this.dirty = true;
  }

  applyOfflineDecay() {
    const now = Date.now();
    let elapsedMs = Math.max(0, now - this.lastUpdate);
    elapsedMs = Math.min(elapsedMs, MAX_OFFLINE_MS);
    const dt = elapsedMs / 1000;
    if (dt < 1) return;
    for (const k of ANIMALS) {
      const s = this.byAnimal[k];
      s.hunger      = clamp(s.hunger      - (DECAY_PER_MIN.hunger      / 60) * dt * OFFLINE_RATE);
      s.happiness   = clamp(s.happiness   - (DECAY_PER_MIN.happiness   / 60) * dt * OFFLINE_RATE);
      s.cleanliness = clamp(s.cleanliness - (DECAY_PER_MIN.cleanliness / 60) * dt * OFFLINE_RATE);
      s.energy      = clamp(s.energy      - (DECAY_PER_MIN.energy      / 60) * dt * OFFLINE_RATE);
    }
    this.lastUpdate = now;
    this.dirty = true;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.byAnimal) {
        for (const k of ANIMALS) {
          if (data.byAnimal[k]) {
            const merged = { ...DEFAULT_STAT, ...data.byAnimal[k] };
            for (const sk of STAT_KEYS) merged[sk] = clamp(Number(merged[sk]) || 0);
            this.byAnimal[k] = merged;
          }
        }
      }
      if (data && typeof data.lastUpdate === 'number') this.lastUpdate = data.lastUpdate;
      this.applyOfflineDecay();
    } catch (e) {
      console.warn('[stats] load failed:', e);
    }
  }

  save() {
    if (!this.dirty) return;
    try {
      this.lastUpdate = Date.now();
      const data = {
        version: 1,
        lastUpdate: this.lastUpdate,
        byAnimal: this.byAnimal,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.dirty = false;
    } catch (e) {
      console.warn('[stats] save failed:', e);
    }
  }

  reset(key = null) {
    if (key) {
      this.byAnimal[key] = { ...DEFAULT_STAT };
    } else {
      this.byAnimal = freshDefaults();
    }
    this.dirty = true;
  }

  // Adjust state-machine weights based on current stats.
  getStateWeights(baseWeights, key = this.activeKey) {
    const s = this.byAnimal[key];
    if (!s) return { ...baseWeights };
    const w = { ...baseWeights };
    if (s.energy < 30 && 'nap' in w) w.nap *= 4;
    if (s.cleanliness < 30 && 'groom' in w) w.groom *= 3;
    if (s.happiness < 30) {
      if ('idle' in w)  w.idle  *= 1.4;
      if ('groom' in w) w.groom *= 1.2;
      if ('dash' in w)  w.dash  *= 0.5;
      if ('hop' in w)   w.hop   *= 0.5;
    }
    if (s.hunger < 30) {
      if ('dash' in w) w.dash *= 0.4;
      if ('hop' in w)  w.hop  *= 0.6;
    }
    if (s.hunger >= 70 && s.happiness >= 70 && s.cleanliness >= 70 && s.energy >= 70) {
      if ('hop' in w)  w.hop  *= 1.5;
      if ('dash' in w) w.dash *= 1.5;
    }
    return w;
  }

  // Pick a dialogue category that reflects the dominant low/high stat.
  getMoodCategory(key = this.activeKey) {
    const s = this.byAnimal[key];
    if (!s) return 'idle';
    if (s.energy < 30) return 'tired';
    if (s.hunger < 30) return 'hungry';
    if (s.cleanliness < 30) return 'dirty';
    if (s.happiness < 20) return 'sad';
    if (s.hunger >= 80 && s.happiness >= 80 && s.cleanliness >= 80 && s.energy >= 80) return 'happy';
    return 'idle';
  }

  speedMultiplier(key = this.activeKey) {
    const s = this.byAnimal[key];
    if (!s) return 1;
    if (s.hunger < 30 || s.energy < 20) return 0.7;
    return 1;
  }
}

export { STAT_KEYS, ANIMALS };
