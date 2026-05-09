import { loadImage } from '../js/sheet.js';
import { Scene } from './scene.js';
import { Stats } from './stats.js';
import { CarePanel } from './care.js';
import { Effects } from './effects.js';
import { WorldObjects } from './world-objects.js';
import { AppUI } from './app/ui.js';
import { InteractionController } from './app/interaction-controller.js';
import { InputController } from './app/input-controller.js';

const ANIMAL_KEYS = ['cat', 'rabbit', 'cogi', 'capybara'];
const SHEET_BY_KEY = new Map();
const IMAGE_BY_KEY = new Map();

async function loadAnimal(key) {
  const res = await fetch(`animations/${key}-animations.json`);
  if (!res.ok) throw new Error(`Failed to load ${key}-animations.json (${res.status})`);
  const json = await res.json();
  const sheetData = json.sheets?.[key];
  if (!sheetData) throw new Error(`Sheet "${key}" missing in ${key}-animations.json`);
  const image = await loadImage(sheetData.src);
  SHEET_BY_KEY.set(key, sheetData);
  IMAGE_BY_KEY.set(key, image);
}

async function init() {
  const ui = new AppUI(document);
  const stats = new Stats();
  const scene = new Scene(ui.canvas, ui.bubbleLayer);
  const effects = new Effects(ui.fxLayer);
  const worldObjects = new WorldObjects(ui.worldLayer);

  ui.buildStatsPanel();

  try {
    await Promise.all(ANIMAL_KEYS.map(loadAnimal));
  } catch (err) {
    ui.setStatus(`Failed to load: ${err.message}`);
    console.error(err);
    return;
  }
  ui.setStatus('');

  const controller = new InteractionController({
    scene,
    stats,
    effects,
    worldObjects,
    ui,
    sheets: SHEET_BY_KEY,
    images: IMAGE_BY_KEY,
  });

  let input = null;
  const carePanel = new CarePanel({
    root: ui.carePanel,
    scene,
    onCareImmediate: (action) => {
      const pointer = input ? input.getLastPointer() : null;
      controller.performImmediateCare(action, pointer && pointer.hasMoved ? pointer : null);
    },
    onCarePlace: (action, x, y) => controller.placeCare(action, x, y),
  });

  input = new InputController({ scene, controller, carePanel, ui });

  ui.buildPicker(ANIMAL_KEYS, (key) => controller.setActiveKey(key));
  controller.setActiveKey(ANIMAL_KEYS[0]);
  input.start();
  controller.startLoops({ isPettingActive: () => input.isPettingActive() });

  window.addEventListener('beforeunload', () => stats.save());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stats.save();
  });

  scene.start();
}

init();
