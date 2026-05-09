const imageCache = new Map();
const emptyCellCache = new Map();
const componentCache = new Map();

export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function emptyCellKey(src, cellW, cellH) { return `${src}|${cellW}x${cellH}`; }

export async function detectEmptyCells(img, cellW, cellH, src) {
  const key = emptyCellKey(src, cellW, cellH);
  if (emptyCellCache.has(key)) return emptyCellCache.get(key);

  const cols = Math.floor(img.naturalWidth / cellW);
  const rows = Math.floor(img.naturalHeight / cellH);
  const empty = new Set();
  if (cols <= 0 || rows <= 0) {
    emptyCellCache.set(key, empty);
    return empty;
  }

  const data = await readImageData(img);
  if (!data) { emptyCellCache.set(key, empty); return empty; }
  const stride = img.naturalWidth * 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cellW;
      const y0 = r * cellH;
      let alphaSum = 0;
      const stepX = Math.max(1, Math.floor(cellW / 16));
      const stepY = Math.max(1, Math.floor(cellH / 16));
      for (let y = 0; y < cellH; y += stepY) {
        const row = (y0 + y) * stride;
        for (let x = 0; x < cellW; x += stepX) {
          alphaSum += data[row + (x0 + x) * 4 + 3];
        }
      }
      if (alphaSum < 64) empty.add(r * cols + c);
    }
  }
  emptyCellCache.set(key, empty);
  return empty;
}

export function clearEmptyCellCache(src) {
  for (const key of emptyCellCache.keys()) {
    if (key.startsWith(`${src}|`)) emptyCellCache.delete(key);
  }
  componentCache.delete(src);
}

async function readImageData(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  try {
    return ctx.getImageData(0, 0, W, H).data;
  } catch (err) {
    console.warn('getImageData failed (likely CORS):', err);
    return null;
  }
}

const ALPHA_THRESHOLD = 8;
const MIN_COMPONENT_PIXELS = 16;

export async function labelComponents(img, src) {
  if (componentCache.has(src)) return componentCache.get(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const data = await readImageData(img);
  if (!data) return null;
  const N = W * H;
  const labels = new Uint32Array(N);
  const queue = new Int32Array(N);
  const components = [null];
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1];
  let nextLabel = 1;

  for (let p = 0; p < N; p++) {
    if (labels[p] !== 0) continue;
    if (data[p * 4 + 3] < ALPHA_THRESHOLD) continue;
    let head = 0, tail = 0;
    queue[tail++] = p;
    labels[p] = nextLabel;
    let xmin = W, ymin = H, xmax = -1, ymax = -1;
    let sumX = 0, sumY = 0, count = 0;
    while (head < tail) {
      const q = queue[head++];
      const qx = q % W;
      const qy = (q / W) | 0;
      if (qx < xmin) xmin = qx;
      if (qy < ymin) ymin = qy;
      if (qx > xmax) xmax = qx;
      if (qy > ymax) ymax = qy;
      sumX += qx;
      sumY += qy;
      count++;
      for (let k = 0; k < 8; k++) {
        const nx = qx + dx[k];
        const ny = qy + dy[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (labels[np] !== 0) continue;
        if (data[np * 4 + 3] < ALPHA_THRESHOLD) continue;
        labels[np] = nextLabel;
        queue[tail++] = np;
      }
    }
    if (count >= MIN_COMPONENT_PIXELS) {
      components.push({
        label: nextLabel,
        x: xmin,
        y: ymin,
        w: xmax - xmin + 1,
        h: ymax - ymin + 1,
        cx: sumX / count,
        cy: sumY / count,
        count,
      });
      nextLabel++;
    } else {
      for (let k = 0; k < tail; k++) labels[queue[k]] = 0;
    }
  }

  const byLabel = new Map();
  for (const c of components) if (c) byLabel.set(c.label, c);
  const componentList = components.filter(Boolean);
  // Pre-compute a stable id (1..N) ordered by top-left for nicer display
  componentList.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  componentList.forEach((c, i) => { c.id = i + 1; });
  const byId = new Map();
  for (const c of componentList) byId.set(c.id, c);
  const result = { labels, components: componentList, byLabel, byId, width: W, height: H };
  componentCache.set(src, result);
  return result;
}

export function anchorOf(frame, anchorMode) {
  switch (anchorMode) {
    case 'bbox-center': return { ax: frame.w / 2, ay: frame.h / 2 };
    case 'top-center':  return { ax: frame.w / 2, ay: 0 };
    case 'centroid':
      if (Number.isFinite(frame.cx) && Number.isFinite(frame.cy)) {
        return { ax: frame.cx - frame.x, ay: frame.cy - frame.y };
      }
      return { ax: frame.w / 2, ay: frame.h / 2 };
    case 'bottom-center':
    default:            return { ax: frame.w / 2, ay: frame.h };
  }
}

const sheetState = {
  src: null,
  imageWidth: 0,
  imageHeight: 0,
  cellWidth: 0,
  cellHeight: 0,
  columns: 0,
  rows: 0,
  emptyCells: new Set(),
  components: null,
  mode: 'grid',
  anchorMode: 'bottom-center',
  sequence: [],     // unified rect[]: each rect = { x, y, w, h, cx, cy }
  scale: 1,
  zoom: 1,
  onSelectionChange: null,
};

let stage, image, overlay, dragBox;
let hoverBox = null;
let pressIndicator = null;
let pointerDown = false;
let pointerButton = 0;
let dragStarted = false;
let dragStart = null;
let resizeObserver = null;

const LONG_PRESS_MS = 500; // keep in sync with .press-indicator transition in styles.css
const LONG_PRESS_MOVE_TOL = 4;
let pressTimer = null;
let longPressFired = false;
let pressOrigin = null;

export function initSheetView(refs) {
  stage = refs.stage;
  image = refs.image;
  overlay = refs.overlay;
  dragBox = refs.dragBox;
  pressIndicator = refs.pressIndicator || document.getElementById('press-indicator');

  overlay.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  overlay.addEventListener('contextmenu', onContextMenu);
  overlay.addEventListener('mousemove', onHoverMove);
  overlay.addEventListener('mouseleave', () => {
    if (hoverBox) hoverBox.classList.add('hidden');
  });

  resizeObserver = new ResizeObserver(() => relayout());
  resizeObserver.observe(stage);
  window.addEventListener('resize', relayout);
}

export function setSelectionListener(fn) { sheetState.onSelectionChange = fn; }

export async function showSheet({
  src,
  mode = 'grid',
  cellWidth = 0,
  cellHeight = 0,
  anchorMode = 'bottom-center',
}) {
  if (!src) {
    image.removeAttribute('src');
    overlay.style.display = 'none';
    sheetState.src = null;
    sheetState.columns = 0;
    sheetState.rows = 0;
    sheetState.emptyCells = new Set();
    sheetState.components = null;
    sheetState.sequence = [];
    emit();
    return null;
  }
  const img = await loadImage(src);
  image.src = src;
  overlay.style.display = '';

  sheetState.src = src;
  sheetState.imageWidth = img.naturalWidth;
  sheetState.imageHeight = img.naturalHeight;
  sheetState.mode = mode;
  sheetState.anchorMode = anchorMode;
  sheetState.cellWidth = cellWidth;
  sheetState.cellHeight = cellHeight;
  sheetState.columns = cellWidth > 0 ? Math.floor(img.naturalWidth / cellWidth) : 0;
  sheetState.rows = cellHeight > 0 ? Math.floor(img.naturalHeight / cellHeight) : 0;
  sheetState.sequence = [];

  if (mode === 'grid' && cellWidth > 0 && cellHeight > 0) {
    sheetState.emptyCells = await detectEmptyCells(img, cellWidth, cellHeight, src);
  } else {
    sheetState.emptyCells = new Set();
  }
  if (mode === 'freepick') {
    sheetState.components = await labelComponents(img, src);
  } else {
    sheetState.components = null;
  }

  rebuildOverlay();
  relayout();
  emit();
  return {
    image: img,
    columns: sheetState.columns,
    rows: sheetState.rows,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

export async function setMode(mode) {
  if (sheetState.mode === mode) return;
  sheetState.mode = mode;
  if (mode === 'grid' && sheetState.cellWidth > 0 && sheetState.cellHeight > 0 && sheetState.src) {
    const img = await loadImage(sheetState.src);
    sheetState.emptyCells = await detectEmptyCells(img, sheetState.cellWidth, sheetState.cellHeight, sheetState.src);
    sheetState.columns = Math.floor(sheetState.imageWidth / sheetState.cellWidth);
    sheetState.rows = Math.floor(sheetState.imageHeight / sheetState.cellHeight);
  }
  if (mode === 'freepick' && sheetState.src) {
    const img = await loadImage(sheetState.src);
    sheetState.components = await labelComponents(img, sheetState.src);
  }
  sheetState.sequence = [];
  rebuildOverlay();
  relayout();
  emit();
}

export function setAnchorMode(anchorMode) {
  sheetState.anchorMode = anchorMode;
  if (sheetState.mode === 'freepick') {
    rebuildFreepickSelection();
    emit();
  }
}

// ─── Grid ↔ rect helpers ──────────────────────────────────────────────────

export function rectFromCellIndex(idx) {
  const cols = sheetState.columns;
  const cw = sheetState.cellWidth;
  const ch = sheetState.cellHeight;
  if (cols <= 0 || cw <= 0 || ch <= 0) return null;
  if (idx < 0 || idx >= cols * sheetState.rows) return null;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const x = col * cw;
  const y = row * ch;
  return { x, y, w: cw, h: ch, cx: x + cw / 2, cy: y + ch / 2 };
}

export function cellIndexOfRect(rect) {
  const cols = sheetState.columns;
  const cw = sheetState.cellWidth;
  const ch = sheetState.cellHeight;
  if (!rect || cols <= 0 || cw <= 0 || ch <= 0) return -1;
  if (rect.w !== cw || rect.h !== ch) return -1;
  if (rect.x % cw !== 0 || rect.y % ch !== 0) return -1;
  const col = rect.x / cw;
  const row = rect.y / ch;
  if (col < 0 || col >= cols) return -1;
  if (row < 0 || row >= sheetState.rows) return -1;
  return row * cols + col;
}

export function rectFromComponentId(id) {
  const comp = sheetState.components?.byId.get(id | 0);
  if (!comp) return null;
  return { x: comp.x, y: comp.y, w: comp.w, h: comp.h, cx: comp.cx, cy: comp.cy };
}

export function componentIdOfRect(rect) {
  if (!sheetState.components || !rect) return -1;
  for (const c of sheetState.components.components) {
    if (c.x === rect.x && c.y === rect.y && c.w === rect.w && c.h === rect.h) return c.id;
  }
  return -1;
}

// ─── Sequence ─────────────────────────────────────────────────────────────

export function getSequence() {
  return sheetState.sequence.map(cloneRect);
}

function cloneRect(r) {
  return { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy };
}

function sameRect(a, b) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function setSequence(frames) {
  const next = [];
  const list = frames || [];
  if (sheetState.mode === 'grid') {
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      const idx = cellIndexOfRect(f);
      if (idx < 0) continue;
      if (sheetState.emptyCells.has(idx)) continue;
      next.push(cloneRect(f));
    }
  } else if (sheetState.mode === 'freepick') {
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      if (componentIdOfRect(f) < 0) continue;
      next.push(cloneRect(f));
    }
  }
  sheetState.sequence = next;
  refreshDisplay();
  emit();
}

function refreshDisplay() {
  if (sheetState.mode === 'grid') syncCellsSelected();
  if (sheetState.mode === 'freepick') rebuildFreepickSelection();
}

function syncCellsSelected() {
  const positions = new Map();
  sheetState.sequence.forEach((rect, i) => {
    const idx = cellIndexOfRect(rect);
    if (idx < 0) return;
    if (!positions.has(idx)) positions.set(idx, []);
    positions.get(idx).push(i + 1);
  });
  for (const cell of overlay.querySelectorAll('.cell')) {
    const idx = Number(cell.dataset.index);
    const list = positions.get(idx);
    if (list) {
      cell.classList.add('selected');
      cell.dataset.order = list.join(',');
    } else {
      cell.classList.remove('selected');
      delete cell.dataset.order;
    }
  }
}

function rebuildFreepickSelection() {
  if (sheetState.mode !== 'freepick') return;
  for (const el of overlay.querySelectorAll('.freepick-box')) el.remove();
  if (!sheetState.components) return;
  const W = sheetState.imageWidth || 1;
  const H = sheetState.imageHeight || 1;
  const positions = new Map();
  sheetState.sequence.forEach((rect, i) => {
    const id = componentIdOfRect(rect);
    if (id < 0) return;
    if (!positions.has(id)) positions.set(id, { rect, list: [] });
    positions.get(id).list.push(i + 1);
  });
  for (const { rect: f, list } of positions.values()) {
    const box = document.createElement('div');
    box.className = 'freepick-box';
    box.style.left = `${(f.x / W) * 100}%`;
    box.style.top = `${(f.y / H) * 100}%`;
    box.style.width = `${(f.w / W) * 100}%`;
    box.style.height = `${(f.h / H) * 100}%`;
    box.dataset.order = list.join(',');

    const a = anchorOf(f, sheetState.anchorMode);
    const dot = document.createElement('span');
    dot.className = 'anchor-dot';
    dot.style.left = `${(a.ax / Math.max(1, f.w)) * 100}%`;
    dot.style.top = `${(a.ay / Math.max(1, f.h)) * 100}%`;
    box.appendChild(dot);

    overlay.appendChild(box);
  }
}

function rebuildOverlay() {
  overlay.innerHTML = '';
  hoverBox = null;
  const { columns, rows, emptyCells, mode } = sheetState;
  if (mode === 'grid' && columns > 0 && rows > 0) {
    overlay.classList.remove('freepick');
    overlay.classList.add('grid');
    overlay.style.display = 'grid';
    overlay.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    overlay.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const idx = r * columns + c;
        const cell = document.createElement('div');
        cell.className = 'cell' + (emptyCells.has(idx) ? ' empty' : '');
        cell.dataset.index = String(idx);
        cell.title = `#${idx} (r${r}, c${c})`;
        frag.appendChild(cell);
      }
    }
    overlay.appendChild(frag);
    syncCellsSelected();
  } else if (mode === 'freepick') {
    overlay.classList.remove('grid');
    overlay.classList.add('freepick');
    overlay.style.display = 'block';
    overlay.style.gridTemplate = '';
    hoverBox = document.createElement('div');
    hoverBox.className = 'freepick-hover hidden';
    overlay.appendChild(hoverBox);
    rebuildFreepickSelection();
  } else {
    overlay.style.display = 'none';
  }
}

function relayout() {
  if (!sheetState.imageWidth || !sheetState.imageHeight) return;
  const stageW = Math.max(1, stage.clientWidth);
  const stageH = Math.max(1, stage.clientHeight);
  const fit = Math.min(stageW / sheetState.imageWidth, stageH / sheetState.imageHeight, 1);
  const scale = fit * (sheetState.zoom || 1);
  sheetState.scale = scale;
  const w = sheetState.imageWidth * scale;
  const h = sheetState.imageHeight * scale;
  image.style.width = `${w}px`;
  image.style.height = `${h}px`;
  overlay.style.width = `${w}px`;
  overlay.style.height = `${h}px`;
}

export function setZoom(zoom) {
  const clamped = Math.max(0.1, Math.min(8, Number(zoom) || 1));
  if (clamped === sheetState.zoom) return clamped;
  sheetState.zoom = clamped;
  relayout();
  return clamped;
}

export function getZoom() { return sheetState.zoom; }

export function imageCoordsAtClientExt(clientX, clientY) {
  return imageCoordsAtClient(clientX, clientY);
}

function emit() {
  if (!sheetState.onSelectionChange) return;
  sheetState.onSelectionChange(getSequence());
}

function imageCoordsAtClient(clientX, clientY) {
  const rect = overlay.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) * (sheetState.imageWidth / rect.width);
  const y = (clientY - rect.top) * (sheetState.imageHeight / rect.height);
  if (x < 0 || y < 0 || x >= sheetState.imageWidth || y >= sheetState.imageHeight) return null;
  return { x, y };
}

function cellIndexAtPoint(clientX, clientY) {
  const rect = overlay.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return -1;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return -1;
  const c = Math.floor(x / (rect.width / sheetState.columns));
  const r = Math.floor(y / (rect.height / sheetState.rows));
  if (c < 0 || c >= sheetState.columns) return -1;
  if (r < 0 || r >= sheetState.rows) return -1;
  return r * sheetState.columns + c;
}

function pickComponent(clientX, clientY) {
  if (!sheetState.components) return null;
  const coord = imageCoordsAtClient(clientX, clientY);
  if (!coord) return null;
  const W = sheetState.components.width;
  const H = sheetState.components.height;
  const ix = Math.floor(coord.x);
  const iy = Math.floor(coord.y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return null;
  let label = sheetState.components.labels[iy * W + ix];
  if (label === 0) {
    outer:
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = ix + dx, ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const v = sheetState.components.labels[ny * W + nx];
          if (v !== 0) { label = v; break outer; }
        }
      }
    }
  }
  if (label === 0) return null;
  return sheetState.components.byLabel.get(label) || null;
}

function onHoverMove(e) {
  if (sheetState.mode !== 'freepick' || !hoverBox) return;
  const comp = pickComponent(e.clientX, e.clientY);
  if (!comp) {
    hoverBox.classList.add('hidden');
    return;
  }
  const W = sheetState.imageWidth || 1;
  const H = sheetState.imageHeight || 1;
  hoverBox.classList.remove('hidden');
  hoverBox.style.left = `${(comp.x / W) * 100}%`;
  hoverBox.style.top = `${(comp.y / H) * 100}%`;
  hoverBox.style.width = `${(comp.w / W) * 100}%`;
  hoverBox.style.height = `${(comp.h / H) * 100}%`;
}

function onPointerDown(e) {
  if (sheetState.mode === 'grid' && sheetState.columns === 0) return;
  if (sheetState.mode === 'freepick' && !sheetState.components) return;
  if (e.button !== 0 && e.button !== 2) return;
  pointerDown = true;
  pointerButton = e.button;
  dragStarted = false;
  longPressFired = false;
  dragStart = { x: e.clientX, y: e.clientY };
  if (e.button === 0) {
    overlay.setPointerCapture?.(e.pointerId);
    pressOrigin = { x: e.clientX, y: e.clientY };
    showPressIndicator(e.clientX, e.clientY);
    pressTimer = setTimeout(triggerLongPress, LONG_PRESS_MS);
  }
}

function onPointerMove(e) {
  if (!pointerDown) return;
  if (pointerButton !== 0) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (Math.hypot(dx, dy) >= LONG_PRESS_MOVE_TOL) cancelLongPress();
  if (!dragStarted && Math.hypot(dx, dy) < 4) return;
  dragStarted = true;

  const stageRect = stage.getBoundingClientRect();
  const x1 = Math.min(dragStart.x, e.clientX);
  const y1 = Math.min(dragStart.y, e.clientY);
  const x2 = Math.max(dragStart.x, e.clientX);
  const y2 = Math.max(dragStart.y, e.clientY);

  dragBox.classList.remove('hidden');
  dragBox.style.left = `${x1 - stageRect.left + stage.scrollLeft}px`;
  dragBox.style.top = `${y1 - stageRect.top + stage.scrollTop}px`;
  dragBox.style.width = `${x2 - x1}px`;
  dragBox.style.height = `${y2 - y1}px`;
}

function boxCellIndices(x1, y1, x2, y2) {
  const overlayRect = overlay.getBoundingClientRect();
  const cellW = overlayRect.width / sheetState.columns;
  const cellH = overlayRect.height / sheetState.rows;
  const cx1 = Math.max(0, Math.floor((x1 - overlayRect.left) / cellW));
  const cy1 = Math.max(0, Math.floor((y1 - overlayRect.top) / cellH));
  const cx2 = Math.min(sheetState.columns - 1, Math.floor((x2 - overlayRect.left) / cellW));
  const cy2 = Math.min(sheetState.rows - 1, Math.floor((y2 - overlayRect.top) / cellH));
  const out = [];
  for (let r = cy1; r <= cy2; r++) {
    for (let c = cx1; c <= cx2; c++) {
      const idx = r * sheetState.columns + c;
      if (idx >= 0 && !sheetState.emptyCells.has(idx)) out.push(idx);
    }
  }
  return out;
}

function boxComponents(x1, y1, x2, y2) {
  if (!sheetState.components) return [];
  const a = imageCoordsAtClient(x1, y1);
  const b = imageCoordsAtClient(x2, y2);
  if (!a || !b) return [];
  const ix1 = Math.min(a.x, b.x), iy1 = Math.min(a.y, b.y);
  const ix2 = Math.max(a.x, b.x), iy2 = Math.max(a.y, b.y);
  const hits = sheetState.components.components.filter((c) => {
    const ccx = c.x + c.w / 2;
    const ccy = c.y + c.h / 2;
    return ccx >= ix1 && ccx <= ix2 && ccy >= iy1 && ccy <= iy2;
  });
  hits.sort((p, q) => (p.y - q.y) || (p.x - q.x));
  return hits;
}

function onPointerUp(e) {
  if (!pointerDown) return;
  const wasButton = pointerButton;
  pointerDown = false;
  dragBox.classList.add('hidden');
  cancelLongPress();
  if (longPressFired) { dragStarted = false; return; }
  if (wasButton !== 0) { dragStarted = false; return; }

  if (sheetState.mode === 'grid') {
    if (dragStarted) {
      const x1 = Math.min(dragStart.x, e.clientX);
      const y1 = Math.min(dragStart.y, e.clientY);
      const x2 = Math.max(dragStart.x, e.clientX);
      const y2 = Math.max(dragStart.y, e.clientY);
      const indices = boxCellIndices(x1, y1, x2, y2);
      if (indices.length) appendGridIndices(indices);
    } else {
      const idx = cellIndexAtPoint(e.clientX, e.clientY);
      if (idx >= 0 && !sheetState.emptyCells.has(idx)) appendGridIndices([idx]);
    }
  } else if (sheetState.mode === 'freepick') {
    if (dragStarted) {
      const x1 = Math.min(dragStart.x, e.clientX);
      const y1 = Math.min(dragStart.y, e.clientY);
      const x2 = Math.max(dragStart.x, e.clientX);
      const y2 = Math.max(dragStart.y, e.clientY);
      const comps = boxComponents(x1, y1, x2, y2);
      if (comps.length) appendComponents(comps);
    } else {
      const comp = pickComponent(e.clientX, e.clientY);
      if (comp) appendComponents([comp]);
    }
  }
  dragStarted = false;
}

function onPointerCancel() {
  if (!pointerDown) return;
  pointerDown = false;
  dragStarted = false;
  dragBox.classList.add('hidden');
  cancelLongPress();
}

function onContextMenu(e) {
  e.preventDefault();
  // On touch devices, the browser fires a synthetic contextmenu after the
  // platform long-press AND our own pressTimer fires — cancel/skip whichever
  // is second so we only delete one frame per gesture.
  cancelLongPress();
  if (longPressFired) return;
  longPressFired = true;
  if (sheetState.mode === 'grid') {
    if (sheetState.columns === 0) return;
    const idx = cellIndexAtPoint(e.clientX, e.clientY);
    if (idx < 0 || sheetState.emptyCells.has(idx)) return;
    removeLastGrid(idx);
  } else if (sheetState.mode === 'freepick') {
    const comp = pickComponent(e.clientX, e.clientY);
    if (!comp) return;
    removeLastFreepick(comp);
  }
}

function triggerLongPress() {
  pressTimer = null;
  if (!pointerDown || pointerButton !== 0 || dragStarted || !pressOrigin) {
    hidePressIndicator();
    return;
  }
  longPressFired = true;
  hidePressIndicator();
  const { x, y } = pressOrigin;
  if (sheetState.mode === 'grid') {
    if (sheetState.columns === 0) return;
    const idx = cellIndexAtPoint(x, y);
    if (idx < 0 || sheetState.emptyCells.has(idx)) return;
    removeLastGrid(idx);
  } else if (sheetState.mode === 'freepick') {
    const comp = pickComponent(x, y);
    if (!comp) return;
    removeLastFreepick(comp);
  }
}

function cancelLongPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  hidePressIndicator();
}

function cellRectAtIndex(idx) {
  const overlayRect = overlay.getBoundingClientRect();
  if (sheetState.columns === 0 || sheetState.rows === 0) return null;
  const cellW = overlayRect.width / sheetState.columns;
  const cellH = overlayRect.height / sheetState.rows;
  const c = idx % sheetState.columns;
  const r = (idx / sheetState.columns) | 0;
  return {
    left: overlayRect.left + c * cellW,
    top: overlayRect.top + r * cellH,
    width: cellW,
    height: cellH,
  };
}

function componentClientRect(comp) {
  const rect = overlay.getBoundingClientRect();
  const W = sheetState.imageWidth || 1;
  const H = sheetState.imageHeight || 1;
  return {
    left: rect.left + (comp.x / W) * rect.width,
    top: rect.top + (comp.y / H) * rect.height,
    width: (comp.w / W) * rect.width,
    height: (comp.h / H) * rect.height,
  };
}

function currentTargetRect(clientX, clientY) {
  if (sheetState.mode === 'grid') {
    if (sheetState.columns === 0) return null;
    const idx = cellIndexAtPoint(clientX, clientY);
    if (idx < 0 || sheetState.emptyCells.has(idx)) return null;
    return cellRectAtIndex(idx);
  }
  if (sheetState.mode === 'freepick') {
    const comp = pickComponent(clientX, clientY);
    if (!comp) return null;
    return componentClientRect(comp);
  }
  return null;
}

function showPressIndicator(clientX, clientY) {
  if (!pressIndicator || !stage) return;
  const rect = currentTargetRect(clientX, clientY);
  if (!rect) return;
  const stageRect = stage.getBoundingClientRect();
  pressIndicator.style.left   = `${rect.left - stageRect.left + stage.scrollLeft}px`;
  pressIndicator.style.top    = `${rect.top  - stageRect.top  + stage.scrollTop}px`;
  pressIndicator.style.width  = `${rect.width}px`;
  pressIndicator.style.height = `${rect.height}px`;
  pressIndicator.classList.remove('hidden');
  pressIndicator.classList.remove('active');
  // Force reflow so the next frame triggers the stroke-dashoffset transition.
  void pressIndicator.offsetWidth;
  requestAnimationFrame(() => {
    if (pressIndicator) pressIndicator.classList.add('active');
  });
}

function hidePressIndicator() {
  if (!pressIndicator) return;
  pressIndicator.classList.remove('active');
  pressIndicator.classList.add('hidden');
}

function appendGridIndices(indices) {
  const next = sheetState.sequence.slice();
  for (const idx of indices) {
    const r = rectFromCellIndex(idx);
    if (r) next.push(r);
  }
  sheetState.sequence = next;
  syncCellsSelected();
  emit();
}

function removeLastGrid(idx) {
  const next = sheetState.sequence.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (cellIndexOfRect(next[i]) === idx) { next.splice(i, 1); break; }
  }
  sheetState.sequence = next;
  syncCellsSelected();
  emit();
}

function appendComponents(comps) {
  const next = sheetState.sequence.slice();
  for (const c of comps) {
    next.push({ x: c.x, y: c.y, w: c.w, h: c.h, cx: c.cx, cy: c.cy });
  }
  sheetState.sequence = next;
  rebuildFreepickSelection();
  emit();
}

function removeLastFreepick(comp) {
  const next = sheetState.sequence.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (sameRect(next[i], comp)) { next.splice(i, 1); break; }
  }
  sheetState.sequence = next;
  rebuildFreepickSelection();
  emit();
}

export function getSheetGrid() {
  return {
    columns: sheetState.columns,
    rows: sheetState.rows,
    cellWidth: sheetState.cellWidth,
    cellHeight: sheetState.cellHeight,
    emptyCells: sheetState.emptyCells,
  };
}

export function getMode() { return sheetState.mode; }
export function getAnchorMode() { return sheetState.anchorMode; }
export function getComponentInfo() { return sheetState.components; }
