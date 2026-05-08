export const STORAGE_KEY = 'sprite-animator:v1';
export const SCHEMA_VERSION = 3;

export const ANCHOR_MODES = ['bottom-center', 'bbox-center', 'top-center', 'centroid'];
export const DEFAULT_ANCHOR = 'bottom-center';
export const SHEET_MODES = ['grid', 'freepick'];
export const DEFAULT_SHEET_MODE = 'grid';

const listeners = new Set();

export const state = {
  version: SCHEMA_VERSION,
  sheets: {},
  ui: {
    activeSheet: null,
    editing: null,
  },
};

export function emptyAnimEditor(kind = 'grid') {
  return {
    id: null,
    kind,
    name: '',
    frames: [],
    anchorMode: DEFAULT_ANCHOR,
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
  mode = DEFAULT_SHEET_MODE,
  anchorMode = DEFAULT_ANCHOR,
} = {}) {
  return {
    src,
    origin,
    persistImage,
    cellWidth,
    cellHeight,
    mode,
    anchorMode,
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
      mode: sheet.mode || DEFAULT_SHEET_MODE,
      anchorMode: sheet.anchorMode || DEFAULT_ANCHOR,
      animations: sheet.animations.map(cloneAnimation),
    };
  }
  return { version: SCHEMA_VERSION, sheets };
}

export function cloneAnimation(a) {
  const base = {
    id: a.id,
    name: a.name,
    fps: a.fps,
    loop: !!a.loop,
    pingpong: !!a.pingpong,
  };
  if (a.kind === 'freepick') {
    return {
      ...base,
      kind: 'freepick',
      anchorMode: a.anchorMode || DEFAULT_ANCHOR,
      frames: a.frames.map((f) => ({
        x: f.x | 0, y: f.y | 0, w: f.w | 0, h: f.h | 0,
        ax: Number(f.ax) || 0, ay: Number(f.ay) || 0,
      })),
    };
  }
  return {
    ...base,
    kind: 'grid',
    frames: a.frames.slice(),
  };
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return migrate(parsed);
  } catch (err) {
    console.warn('localStorage load failed:', err);
    return null;
  }
}

export function migrate(payload) {
  let v = Number(payload.version) || 1;
  if (v < 2 && payload.sheets && typeof payload.sheets === 'object') {
    for (const sheet of Object.values(payload.sheets)) {
      if (sheet && typeof sheet === 'object') {
        sheet.cellWidth = 0;
        sheet.cellHeight = 0;
      }
    }
    v = 2;
  }
  if (v < 3 && payload.sheets && typeof payload.sheets === 'object') {
    for (const sheet of Object.values(payload.sheets)) {
      if (sheet && typeof sheet === 'object') {
        if (!sheet.mode) sheet.mode = DEFAULT_SHEET_MODE;
        if (!sheet.anchorMode) sheet.anchorMode = DEFAULT_ANCHOR;
        if (Array.isArray(sheet.animations)) {
          for (const a of sheet.animations) {
            if (a && typeof a === 'object' && !a.kind) a.kind = 'grid';
          }
        }
      }
    }
    v = 3;
  }
  payload.version = v;
  return payload;
}

export function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function ensureAnimId(anim) {
  if (!anim.id) anim.id = `a_${Math.random().toString(36).slice(2, 10)}`;
  return anim;
}

function normalizeAnimation(a) {
  const kind = a.kind === 'freepick' ? 'freepick' : 'grid';
  const base = ensureAnimId({
    id: a.id,
    kind,
    name: String(a.name || 'unnamed'),
    fps: Number(a.fps) || 8,
    loop: a.loop !== false,
    pingpong: !!a.pingpong,
  });
  if (kind === 'freepick') {
    base.anchorMode = ANCHOR_MODES.includes(a.anchorMode) ? a.anchorMode : DEFAULT_ANCHOR;
    base.frames = Array.isArray(a.frames)
      ? a.frames
          .filter((f) => f && typeof f === 'object')
          .map((f) => ({
            x: Number(f.x) | 0,
            y: Number(f.y) | 0,
            w: Math.max(0, Number(f.w) | 0),
            h: Math.max(0, Number(f.h) | 0),
            ax: Number(f.ax) || 0,
            ay: Number(f.ay) || 0,
          }))
      : [];
  } else {
    base.frames = Array.isArray(a.frames)
      ? a.frames.map((n) => Number(n) | 0).filter((n) => n >= 0)
      : [];
  }
  return base;
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
          mode: SHEET_MODES.includes(sheet.mode) ? sheet.mode : DEFAULT_SHEET_MODE,
          anchorMode: ANCHOR_MODES.includes(sheet.anchorMode) ? sheet.anchorMode : DEFAULT_ANCHOR,
        });
    if (sheet.src) merged.src = sheet.src;
    if (sheet.origin) merged.origin = sheet.origin;
    if (sheet.cellWidth) merged.cellWidth = Number(sheet.cellWidth) || merged.cellWidth;
    if (sheet.cellHeight) merged.cellHeight = Number(sheet.cellHeight) || merged.cellHeight;
    if (typeof sheet.persistImage === 'boolean') merged.persistImage = sheet.persistImage;
    if (SHEET_MODES.includes(sheet.mode)) merged.mode = sheet.mode;
    if (ANCHOR_MODES.includes(sheet.anchorMode)) merged.anchorMode = sheet.anchorMode;
    const incomingAnims = Array.isArray(sheet.animations) ? sheet.animations : [];
    const animMap = new Map((merged.animations || []).map((a) => [a.id || a.name, a]));
    for (const a of incomingAnims) {
      const norm = normalizeAnimation(a);
      animMap.set(norm.id, norm);
    }
    merged.animations = Array.from(animMap.values());
    state.sheets[name] = merged;
  }
}
