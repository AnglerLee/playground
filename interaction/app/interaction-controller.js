import { Animal } from '../animal.js';
import { getLine } from '../dialogue/index.js';

const MIN_PLACE_DIST = 80;
const SCRUB_CLEAN_PER_STEP = 0.8;
const SCRUB_GAIN_CAP = 35;
const PET_HAPPY_PER_STEP = 0.5;
const PET_GAIN_CAP = 15;
const POOP_SPAWN_MIN_MS = 25000;
const POOP_SPAWN_MAX_MS = 60000;
const POOP_SPAWN_THRESHOLD = 80;
const POOP_MAX_COUNT = 5;
const FOOD_TTL_MS = 30000;
const BALL_TTL_MS = 30000;

export class InteractionController {
  constructor({ scene, stats, effects, worldObjects, ui, sheets, images }) {
    this.scene = scene;
    this.stats = stats;
    this.effects = effects;
    this.worldObjects = worldObjects;
    this.ui = ui;
    this.sheets = sheets;
    this.images = images;

    this.nextPoopAt = 0;
    this.timeouts = new Set();
    this.intervals = [];
  }

  get activeAnimal() {
    return this.scene.activeAnimal;
  }

  setActiveKey(key) {
    this.stats.setActive(key);
    const sheetData = this.sheets.get(key);
    const image = this.images.get(key);
    if (!sheetData || !image) return;

    const animal = new Animal({
      key,
      sheetData,
      image,
      scene: this.scene,
      bubbleLayer: this.ui.bubbleLayer,
      stats: this.stats,
    });
    this.scene.setActive(animal);
    this.worldObjects.clearAll();
    this.ui.hidePetCursor();
    this.ui.setActivePicker(key);
    this.scheduleNextPoop();
    this.refreshStatsPanel();
  }

  refreshStatsPanel() {
    this.ui.refreshStatsPanel(this.stats.get(this.stats.activeKey));
  }

  getActiveStats() {
    return this.stats.get(this.stats.activeKey);
  }

  canRunAction(action) {
    const animal = this.activeAnimal;
    if (!animal) return { ok: false, animal: null, stats: null };
    const stats = this.stats.get(animal.key);
    if (!stats) return { ok: false, animal, stats: null };
    if (action.refuseWhen && action.refuseWhen(stats)) {
      const refuse = getLine(animal.key, action.refuseCategory || 'refuseFull');
      if (refuse) animal.say(refuse);
      return { ok: false, animal, stats };
    }
    return { ok: true, animal, stats };
  }

  applyActionEffect(animal, action) {
    if (!this.effects || !action.effect) return;
    this.effects.spawn({
      kind: action.effect.kind,
      x: animal.x,
      y: animal.y + (action.effect.offsetY ?? -50),
      count: action.effect.count,
      durationMs: action.effect.durationMs,
    });
  }

  applyActionStats(animalKey, statDelta) {
    if (!statDelta) return;
    for (const [stat, delta] of Object.entries(statDelta)) {
      this.stats.add(animalKey, stat, delta);
    }
    this.refreshStatsPanel();
  }

  performImmediateCare(action, pointer = null) {
    const result = this.canRunAction(action);
    if (!result.ok) return false;
    const { animal } = result;

    this.applyActionStats(animal.key, action.statDelta);
    animal.setState('careAction', {
      anim: action.anim,
      duration: action.durationSec,
      lineCategory: action.lineCategory,
      isResting: !!action.isResting,
    });
    this.applyActionEffect(animal, action);

    if (action.id === 'bath' && pointer) {
      this.ui.showPetCursor(pointer.x, pointer.y, true);
      this.scheduleTimeout(() => {
        if (!this.activeAnimal || !this.activeAnimal.isBathing()) {
          this.ui.hidePetCursor();
        }
      }, action.durationSec * 1000 + 200);
    }
    return true;
  }

  placeCare(action, worldX, worldY) {
    const result = this.canRunAction(action);
    if (!result.ok) return false;
    const { animal } = result;
    const point = this.normalizePlacedPoint(animal, worldX, worldY);
    if (action.id === 'feed') {
      const item = this.worldObjects.add({ kind: 'food', x: point.x, y: point.y, ttlMs: FOOD_TTL_MS });
      if (item) this.pursueFood(item);
      return !!item;
    }
    if (action.id === 'play') {
      const item = this.worldObjects.add({ kind: 'ball', x: point.x, y: point.y, ttlMs: BALL_TTL_MS });
      if (item) this.pursueBall(item);
      return !!item;
    }
    return false;
  }

  normalizePlacedPoint(animal, worldX, worldY) {
    let x = worldX;
    let y = worldY;
    const dx = x - animal.x;
    const dy = y - animal.y;
    const dist = Math.hypot(dx, dy);
    if (dist < MIN_PLACE_DIST) {
      const ux = dist > 0.5 ? dx / dist : (animal.facing >= 0 ? 1 : -1);
      const uy = dist > 0.5 ? dy / dist : 0;
      x = animal.x + ux * MIN_PLACE_DIST;
      y = animal.y + uy * MIN_PLACE_DIST;
      const bounds = this.scene.world();
      x = Math.max(bounds.left, Math.min(bounds.right, x));
      y = Math.max(bounds.top, Math.min(bounds.bottom, y));
    }
    return { x, y };
  }

  pursueFood(item) {
    const animal = this.activeAnimal;
    if (!animal) return;
    animal.setState('fetch', {
      target: { x: item.x, y: item.y },
      speed: 120,
      onArrive: (currentAnimal) => {
        if (!this.worldObjects.has(item.id)) {
          currentAnimal.setState('idle');
          return;
        }
        this.worldObjects.remove(item.id);
        this.stats.add(currentAnimal.key, 'hunger', 30);
        this.stats.add(currentAnimal.key, 'happiness', 5);
        this.refreshStatsPanel();
        currentAnimal.setState('careAction', { anim: 'lick', duration: 1.5, lineCategory: 'eating' });
        this.effects?.spawn({ kind: 'food', x: currentAnimal.x, y: currentAnimal.y - 45, count: 6, durationMs: 1500 });
      },
    });
  }

  pursueBall(item) {
    const animal = this.activeAnimal;
    if (!animal) return;
    animal.setState('fetch', {
      target: { x: item.x, y: item.y },
      speed: 240,
      anim: 'run',
      onArrive: (currentAnimal) => {
        if (!this.worldObjects.has(item.id)) {
          currentAnimal.setState('idle');
          return;
        }
        const bounds = this.scene.world();
        const targetX = this.scene.cssWidth / 2;
        const targetY = bounds.bottom - 30;
        currentAnimal.setState('carry', {
          target: { x: targetX, y: targetY },
          speed: 200,
          anim: 'run',
          onTick: (movingAnimal) => {
            if (!this.worldObjects.has(item.id)) return;
            this.worldObjects.move(item.id, movingAnimal.x, movingAnimal.y - 60);
          },
          onArrive: (arrivedAnimal) => {
            if (this.worldObjects.has(item.id)) {
              this.worldObjects.move(item.id, targetX, targetY);
              this.scheduleTimeout(() => {
                if (this.worldObjects.has(item.id)) this.worldObjects.remove(item.id);
              }, 3000);
            }
            this.stats.add(arrivedAnimal.key, 'happiness', 20);
            this.stats.add(arrivedAnimal.key, 'energy', -10);
            this.stats.add(arrivedAnimal.key, 'hunger', -5);
            this.refreshStatsPanel();
            this.effects?.spawn({ kind: 'sparkle', x: targetX, y: targetY, count: 8, durationMs: 700 });
            const line = getLine(arrivedAnimal.key, 'playing');
            if (line) arrivedAnimal.say(line);
            arrivedAnimal.setState('idle');
          },
        });
      },
    });
  }

  applyPetStep(clientX, clientY, session) {
    const animal = this.activeAnimal;
    if (!animal) return;
    if (session.gainHappy >= PET_GAIN_CAP) return;
    this.stats.add(animal.key, 'happiness', PET_HAPPY_PER_STEP);
    session.gainHappy += PET_HAPPY_PER_STEP;
    this.refreshStatsPanel();
    if (session.gainHappy >= PET_GAIN_CAP) {
      const line = getLine(animal.key, 'refuseFull');
      if (line) animal.say(line);
    }
    this.effects?.spawn({
      kind: 'heart',
      x: clientX,
      y: clientY,
      count: 1,
      durationMs: 700,
      spreadX: 6,
      spreadY: 6,
    });
  }

  applyBathScrub(clientX, clientY, session) {
    const animal = this.activeAnimal;
    if (!animal) return;
    if (session.gainClean < SCRUB_GAIN_CAP) {
      this.stats.add(animal.key, 'cleanliness', SCRUB_CLEAN_PER_STEP);
      session.gainClean += SCRUB_CLEAN_PER_STEP;
      this.refreshStatsPanel();
    }
    this.effects?.spawn({
      kind: 'bubble',
      x: clientX,
      y: clientY,
      count: 1,
      durationMs: 700,
      spreadX: 14,
      spreadY: 14,
    });
  }

  dashTo(worldX, worldY) {
    const animal = this.activeAnimal;
    if (!animal) return;
    animal.setState('dash', { target: { x: worldX, y: worldY } });
  }

  handleAnimalTap() {
    const animal = this.activeAnimal;
    if (!animal || animal.getCurrentCareAction()) return;
    animal.setState('hop', { lineCategory: 'greeting' });
  }

  isBathing() {
    return !!this.activeAnimal?.isBathing();
  }

  spawnPoop() {
    if (this.worldObjects.countByKind('poop') >= POOP_MAX_COUNT) return;
    const bounds = this.scene.world();
    const x = bounds.left + Math.random() * (bounds.right - bounds.left);
    const y = bounds.top + (bounds.bottom - bounds.top) * (0.55 + Math.random() * 0.4);
    const item = this.worldObjects.add({ kind: 'poop', x, y, draggable: true });
    if (!item) return;
    this.worldObjects.bindDrag(item.id, {
      onMove: (draggedItem, ev) => this.worldObjects.move(draggedItem.id, ev.clientX, ev.clientY),
      onDrop: (draggedItem) => this.cleanPoop(draggedItem),
    });
  }

  cleanPoop(item) {
    if (!this.worldObjects.has(item.id)) return;
    const { x, y } = item;
    this.worldObjects.remove(item.id);
    if (this.stats.activeKey) {
      this.stats.add(this.stats.activeKey, 'cleanliness', 15);
      this.stats.add(this.stats.activeKey, 'happiness', 2);
      this.refreshStatsPanel();
    }
    this.effects?.spawn({ kind: 'sparkle', x, y, count: 6, durationMs: 700 });
  }

  autoResume() {
    const animal = this.activeAnimal;
    if (!animal) return;
    if (animal.state !== 'idle' && animal.state !== 'wander') return;
    const food = this.worldObjects.getFirstByKind('food');
    if (food) {
      this.pursueFood(food);
      return;
    }
    const ball = this.worldObjects.getFirstByKind('ball');
    if (ball) this.pursueBall(ball);
  }

  tickStats(dtSec) {
    const animal = this.activeAnimal;
    const poopCount = this.worldObjects.countByKind('poop');
    this.stats.tick(dtSec, {
      resting: animal && animal.isResting() ? animal.key : null,
      poopCount,
    });
    this.worldObjects.tickAge(dtSec);
    this.refreshStatsPanel();
  }

  tickPoopSpawn() {
    const animal = this.activeAnimal;
    if (!animal) return;
    const stats = this.stats.get(animal.key);
    if (!stats) return;
    if (stats.cleanliness >= POOP_SPAWN_THRESHOLD) {
      this.scheduleNextPoop();
      return;
    }
    if (Date.now() < this.nextPoopAt) return;
    this.spawnPoop();
    this.scheduleNextPoop();
  }

  scheduleNextPoop() {
    const span = POOP_SPAWN_MAX_MS - POOP_SPAWN_MIN_MS;
    this.nextPoopAt = Date.now() + POOP_SPAWN_MIN_MS + Math.random() * span;
  }

  scheduleTimeout(fn, delayMs) {
    const timeoutId = setTimeout(() => {
      this.timeouts.delete(timeoutId);
      fn();
    }, delayMs);
    this.timeouts.add(timeoutId);
    return timeoutId;
  }

  startLoops({ isPettingActive }) {
    this.stopLoops();
    this.intervals = [
      setInterval(() => this.tickStats(0.1), 100),
      setInterval(() => {
        if (!isPettingActive()) this.autoResume();
      }, 2500),
      setInterval(() => this.tickPoopSpawn(), 1000),
      setInterval(() => this.stats.save(), 2000),
    ];
  }

  stopLoops() {
    for (const intervalId of this.intervals) clearInterval(intervalId);
    this.intervals = [];
    for (const timeoutId of this.timeouts) clearTimeout(timeoutId);
    this.timeouts.clear();
  }
}
