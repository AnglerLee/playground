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
  cellWidth: 128,
  cellHeight: 128,
  columns: 0,
  rows: 0,
  emptyCells: new Set(),
  selectionOrder: [],
  onSelectionChange: null,
};

let stage, image, overlay, dragBox;
let pointerDown = false;
let dragStarted = false;
let dragStart = null;
let initialSelection = [];
let dragMode = 'replace';

export function initSheetView(refs) {
  stage = refs.stage;
  image = refs.image;
  overlay = refs.overlay;
  dragBox = refs.dragBox;

  overlay.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

export function setSelectionListener(fn) {
  sheetState.onSelectionChange = fn;
}

export async function showSheet({ src, cellWidth, cellHeight }) {
  if (!src) {
    image.removeAttribute('src');
    overlay.style.display = 'none';
    sheetState.columns = 0;
    sheetState.rows = 0;
    sheetState.emptyCells = new Set();
    setSelection([]);
    return null;
  }
  const img = await loadImage(src);
  image.src = src;
  image.style.width = `${img.naturalWidth}px`;
  image.style.height = `${img.naturalHeight}px`;
  overlay.style.display = 'grid';
  overlay.style.width = `${img.naturalWidth}px`;
  overlay.style.height = `${img.naturalHeight}px`;

  sheetState.cellWidth = cellWidth;
  sheetState.cellHeight = cellHeight;
  sheetState.columns = Math.floor(img.naturalWidth / cellWidth);
  sheetState.rows = Math.floor(img.naturalHeight / cellHeight);

  sheetState.emptyCells = await detectEmptyCells(img, cellWidth, cellHeight, src);
  rebuildOverlay();
  setSelection([]);
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
  const { columns, rows, cellWidth, cellHeight, emptyCells } = sheetState;
  overlay.style.gridTemplateColumns = `repeat(${columns}, ${cellWidth}px)`;
  overlay.style.gridTemplateRows = `repeat(${rows}, ${cellHeight}px)`;
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
}

export function getSelection() {
  return sheetState.selectionOrder.slice();
}

export function setSelection(indices) {
  const valid = [];
  const seen = new Set();
  for (const i of indices) {
    const n = i | 0;
    if (n < 0) continue;
    if (n >= sheetState.columns * sheetState.rows) continue;
    if (sheetState.emptyCells.has(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    valid.push(n);
  }
  sheetState.selectionOrder = valid;
  syncCellsSelected();
  if (sheetState.onSelectionChange) sheetState.onSelectionChange(valid);
}

function syncCellsSelected() {
  const order = new Map(sheetState.selectionOrder.map((idx, i) => [idx, i + 1]));
  for (const cell of overlay.querySelectorAll('.cell')) {
    const idx = Number(cell.dataset.index);
    if (order.has(idx)) {
      cell.classList.add('selected');
      cell.dataset.order = String(order.get(idx));
    } else {
      cell.classList.remove('selected');
      delete cell.dataset.order;
    }
  }
}

function cellIndexAtPoint(clientX, clientY) {
  const rect = overlay.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0) return -1;
  const c = Math.floor(x / sheetState.cellWidth);
  const r = Math.floor(y / sheetState.cellHeight);
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
  initialSelection = sheetState.selectionOrder.slice();
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

  const ox = overlayRect.left;
  const oy = overlayRect.top;
  const cx1 = Math.max(0, Math.floor((x1 - ox) / sheetState.cellWidth));
  const cy1 = Math.max(0, Math.floor((y1 - oy) / sheetState.cellHeight));
  const cx2 = Math.min(sheetState.columns - 1, Math.floor((x2 - ox) / sheetState.cellWidth));
  const cy2 = Math.min(sheetState.rows - 1, Math.floor((y2 - oy) / sheetState.cellHeight));

  const boxIndices = [];
  for (let r = cy1; r <= cy2; r++) {
    for (let c = cx1; c <= cx2; c++) {
      const idx = r * sheetState.columns + c;
      if (idx >= 0 && !sheetState.emptyCells.has(idx)) boxIndices.push(idx);
    }
  }

  let next;
  if (dragMode === 'toggle') {
    const set = new Set(initialSelection);
    for (const i of boxIndices) {
      if (set.has(i)) set.delete(i);
      else set.add(i);
    }
    next = initialSelection.filter((i) => set.has(i));
    for (const i of boxIndices) if (set.has(i) && !next.includes(i)) next.push(i);
  } else {
    next = boxIndices;
  }
  setSelection(next);
}

function onPointerUp(e) {
  if (!pointerDown) return;
  pointerDown = false;
  dragBox.classList.add('hidden');
  if (!dragStarted) {
    const idx = cellIndexAtPoint(e.clientX, e.clientY);
    if (idx >= 0 && !sheetState.emptyCells.has(idx)) {
      if (dragMode === 'toggle') {
        const next = initialSelection.slice();
        const at = next.indexOf(idx);
        if (at >= 0) next.splice(at, 1);
        else next.push(idx);
        setSelection(next);
      } else {
        setSelection([idx]);
      }
    } else if (dragMode === 'replace') {
      setSelection([]);
    }
  }
  dragStarted = false;
  initialSelection = [];
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
