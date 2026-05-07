export const STORAGE_KEY = 'sprite-animator:v1';
export const SCHEMA_VERSION = 1;

const listeners = new Set();

export const state = {
  version: SCHEMA_VERSION,
  sheets: {},
  ui: {
    activeSheet: null,
    editing: null,
  },
};

export function emptyAnimEditor() {
  return {
    id: null,
    name: '',
    frames: [],
    fps: 8,
    loop: true,
    pingpong: false,
  };
}

export function emptySheetMeta({
  src,
  origin = 'sample',
  cellWidth = 0,
  cellHeight = 0,
  persistImage = true,
} = {}) {
  return {
    src,
    origin,
    persistImage,
    cellWidth,
    cellHeight,
    animations: [],
  };
}

export const REF_BASE_SIZE = 1408;
export const REF_CELL_SIZE = 128;

export function autoCellSize(natural) {
  if (!Number.isFinite(natural) || natural <= 0) return REF_CELL_SIZE;
  return Math.max(1, Math.round((natural * REF_CELL_SIZE) / REF_BASE_SIZE));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error(e); }
  }
  scheduleSave();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

export function saveNow() {
  try {
    const payload = serialize();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('localStorage save failed:', err);
  }
}

export function serialize() {
  const sheets = {};
  for (const [name, sheet] of Object.entries(state.sheets)) {
    const isUploadedNoPersist =
      sheet.origin === 'uploaded' && sheet.persistImage === false;
    sheets[name] = {
      src: isUploadedNoPersist ? '' : sheet.src,
      origin: sheet.origin,
      persistImage: sheet.persistImage !== false,
      cellWidth: sheet.cellWidth,
      cellHeight: sheet.cellHeight,
      animations: sheet.animations.map(cloneAnimation),
    };
  }
  return { version: SCHEMA_VERSION, sheets };
}

export function cloneAnimation(a) {
  return {
    id: a.id,
    name: a.name,
    frames: a.frames.slice(),
    fps: a.fps,
    loop: !!a.loop,
    pingpong: !!a.pingpong,
  };
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.warn('localStorage load failed:', err);
    return null;
  }
}

export function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function ensureAnimId(anim) {
  if (!anim.id) anim.id = `a_${Math.random().toString(36).slice(2, 10)}`;
  return anim;
}

export function applyLoaded(payload, { merge = false } = {}) {
  if (!payload || !payload.sheets) return;
  if (!merge) {
    for (const k of Object.keys(state.sheets)) delete state.sheets[k];
  }
  for (const [name, sheet] of Object.entries(payload.sheets)) {
    const existing = state.sheets[name];
    const merged = existing && merge
      ? { ...existing }
      : emptySheetMeta({
          src: sheet.src || '',
          origin: sheet.origin || 'sample',
          cellWidth: Number(sheet.cellWidth) || 0,
          cellHeight: Number(sheet.cellHeight) || 0,
          persistImage: sheet.persistImage !== false,
        });
    if (sheet.src) merged.src = sheet.src;
    if (sheet.origin) merged.origin = sheet.origin;
    if (sheet.cellWidth) merged.cellWidth = Number(sheet.cellWidth) || merged.cellWidth;
    if (sheet.cellHeight) merged.cellHeight = Number(sheet.cellHeight) || merged.cellHeight;
    if (typeof sheet.persistImage === 'boolean') merged.persistImage = sheet.persistImage;
    const incomingAnims = Array.isArray(sheet.animations) ? sheet.animations : [];
    const animMap = new Map((merged.animations || []).map((a) => [a.id || a.name, a]));
    for (const a of incomingAnims) {
      const norm = ensureAnimId({
        id: a.id,
        name: String(a.name || 'unnamed'),
        frames: Array.isArray(a.frames) ? a.frames.map((n) => Number(n) | 0) : [],
        fps: Number(a.fps) || 8,
        loop: a.loop !== false,
        pingpong: !!a.pingpong,
      });
      animMap.set(norm.id, norm);
    }
    merged.animations = Array.from(animMap.values());
    state.sheets[name] = merged;
  }
}
