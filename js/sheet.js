const imageCache = new Map();
const emptyCellCache = new Map();

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

function emptyCellKey(src, cellW, cellH) {
  return `${src}|${cellW}x${cellH}`;
}

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

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (err) {
    console.warn('getImageData failed (likely CORS); skipping empty-cell detection', err);
    emptyCellCache.set(key, empty);
    return empty;
  }
  const data = imageData.data;
  const stride = canvas.width * 4;

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
}

const sheetState = {
  imageWidth: 0,
  imageHeight: 0,
  cellWidth: 0,
  cellHeight: 0,
  columns: 0,
  rows: 0,
  emptyCells: new Set(),
  sequence: [],
  scale: 1,
  onSelectionChange: null,
  onDoubleClickAdd: null,
};

let stage, image, overlay, dragBox;
let pointerDown = false;
let dragStarted = false;
let dragStart = null;
let initialSequence = [];
let dragMode = 'replace';
let resizeObserver = null;

export function initSheetView(refs) {
  stage = refs.stage;
  image = refs.image;
  overlay = refs.overlay;
  dragBox = refs.dragBox;

  overlay.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('dblclick', onDoubleClick);

  resizeObserver = new ResizeObserver(() => relayout());
  resizeObserver.observe(stage);
  window.addEventListener('resize', relayout);
}

export function setSelectionListener(fn) { sheetState.onSelectionChange = fn; }
export function setDoubleClickListener(fn) { sheetState.onDoubleClickAdd = fn; }

export async function showSheet({ src, cellWidth, cellHeight }) {
  if (!src) {
    image.removeAttribute('src');
    overlay.style.display = 'none';
    sheetState.columns = 0;
    sheetState.rows = 0;
    sheetState.emptyCells = new Set();
    setSequence([]);
    return null;
  }
  const img = await loadImage(src);
  image.src = src;
  overlay.style.display = 'grid';

  sheetState.imageWidth = img.naturalWidth;
  sheetState.imageHeight = img.naturalHeight;
  sheetState.cellWidth = cellWidth;
  sheetState.cellHeight = cellHeight;
  sheetState.columns = Math.floor(img.naturalWidth / cellWidth);
  sheetState.rows = Math.floor(img.naturalHeight / cellHeight);

  sheetState.emptyCells = await detectEmptyCells(img, cellWidth, cellHeight, src);
  rebuildOverlay();
  relayout();
  setSequence([]);
  return {
    image: img,
    columns: sheetState.columns,
    rows: sheetState.rows,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

function rebuildOverlay() {
  overlay.innerHTML = '';
  const { columns, rows, emptyCells } = sheetState;
  if (columns <= 0 || rows <= 0) return;
  overlay.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  overlay.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  const frag = document.createDocumentFragment();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const idx = r * columns + c;
      const cell = document.createElement('div');
      cell.className = 'cell' + (emptyCells.has(idx) ? ' empty' : '');
      cell.dataset.index = String(idx);
      cell.title = `#${idx} (r${r}, c${c}) — double-click to append duplicate`;
      frag.appendChild(cell);
    }
  }
  overlay.appendChild(frag);
}

function relayout() {
  if (!sheetState.imageWidth || !sheetState.imageHeight) return;
  const stageW = Math.max(1, stage.clientWidth);
  const stageH = Math.max(1, stage.clientHeight);
  const scale = Math.min(stageW / sheetState.imageWidth, stageH / sheetState.imageHeight, 1);
  sheetState.scale = scale;
  const w = sheetState.imageWidth * scale;
  const h = sheetState.imageHeight * scale;
  image.style.width = `${w}px`;
  image.style.height = `${h}px`;
  overlay.style.width = `${w}px`;
  overlay.style.height = `${h}px`;
}

export function getSequence() {
  return sheetState.sequence.slice();
}

export function setSequence(frames) {
  const total = sheetState.columns * sheetState.rows;
  const valid = [];
  for (const i of frames) {
    const n = i | 0;
    if (n < 0 || n >= total) continue;
    if (sheetState.emptyCells.has(n)) continue;
    valid.push(n);
  }
  sheetState.sequence = valid;
  syncCellsSelected();
  if (sheetState.onSelectionChange) sheetState.onSelectionChange(valid);
}

function syncCellsSelected() {
  const seen = new Set(sheetState.sequence);
  for (const cell of overlay.querySelectorAll('.cell')) {
    const idx = Number(cell.dataset.index);
    if (seen.has(idx)) cell.classList.add('selected');
    else cell.classList.remove('selected');
  }
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

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (sheetState.columns === 0) return;
  pointerDown = true;
  dragStarted = false;
  dragStart = { x: e.clientX, y: e.clientY };
  initialSequence = sheetState.sequence.slice();
  dragMode = e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
  overlay.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!pointerDown) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (!dragStarted && Math.hypot(dx, dy) < 4) return;
  dragStarted = true;

  const stageRect = stage.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const x1 = Math.min(dragStart.x, e.clientX);
  const y1 = Math.min(dragStart.y, e.clientY);
  const x2 = Math.max(dragStart.x, e.clientX);
  const y2 = Math.max(dragStart.y, e.clientY);

  dragBox.classList.remove('hidden');
  dragBox.style.left = `${x1 - stageRect.left + stage.scrollLeft}px`;
  dragBox.style.top = `${y1 - stageRect.top + stage.scrollTop}px`;
  dragBox.style.width = `${x2 - x1}px`;
  dragBox.style.height = `${y2 - y1}px`;

  const cellW = overlayRect.width / sheetState.columns;
  const cellH = overlayRect.height / sheetState.rows;
  const cx1 = Math.max(0, Math.floor((x1 - overlayRect.left) / cellW));
  const cy1 = Math.max(0, Math.floor((y1 - overlayRect.top) / cellH));
  const cx2 = Math.min(sheetState.columns - 1, Math.floor((x2 - overlayRect.left) / cellW));
  const cy2 = Math.min(sheetState.rows - 1, Math.floor((y2 - overlayRect.top) / cellH));

  const boxIndices = [];
  for (let r = cy1; r <= cy2; r++) {
    for (let c = cx1; c <= cx2; c++) {
      const idx = r * sheetState.columns + c;
      if (idx >= 0 && !sheetState.emptyCells.has(idx)) boxIndices.push(idx);
    }
  }

  let next;
  if (dragMode === 'toggle') {
    const baseSeen = new Set(initialSequence);
    next = initialSequence.slice();
    for (const i of boxIndices) {
      if (baseSeen.has(i)) {
        next = next.filter((x) => x !== i);
      } else {
        baseSeen.add(i);
        next.push(i);
      }
    }
  } else {
    next = boxIndices;
  }
  setSequence(next);
}

function onPointerUp(e) {
  if (!pointerDown) return;
  pointerDown = false;
  dragBox.classList.add('hidden');
  if (!dragStarted) {
    const idx = cellIndexAtPoint(e.clientX, e.clientY);
    if (idx >= 0 && !sheetState.emptyCells.has(idx)) {
      const present = initialSequence.includes(idx);
      if (dragMode === 'toggle') {
        const next = present
          ? initialSequence.filter((x) => x !== idx)
          : [...initialSequence, idx];
        setSequence(next);
      } else if (present) {
        setSequence(initialSequence.filter((x) => x !== idx));
      } else {
        setSequence([...initialSequence, idx]);
      }
    } else if (dragMode === 'replace') {
      setSequence([]);
    }
  }
  dragStarted = false;
  initialSequence = [];
}

function onDoubleClick(e) {
  const idx = cellIndexAtPoint(e.clientX, e.clientY);
  if (idx < 0 || sheetState.emptyCells.has(idx)) return;
  if (sheetState.onDoubleClickAdd) sheetState.onDoubleClickAdd(idx);
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
