import {
  state, emptySheetMeta, emptyAnimEditor, ensureAnimId,
  loadFromStorage, applyLoaded, clearStorage, notify, saveNow, autoCellSize,
  materializeGridAnimations,
  DEFAULT_ANCHOR, DEFAULT_SHEET_MODE, ANCHOR_MODES, SHEET_MODES,
} from './state.js';
import {
  initSheetView, setSelectionListener,
  showSheet, setMode as sheetSetMode, setAnchorMode as sheetSetAnchorMode,
  setSequence, loadImage, clearEmptyCellCache,
  rectFromCellIndex, cellIndexOfRect,
  rectFromComponentId, componentIdOfRect,
  getComponentInfo,
  setZoom as sheetSetZoom, getZoom as sheetGetZoom,
  imageCoordsAtClientExt,
} from './sheet.js';
import { createPlayer } from './preview.js';
import {
  fetchManifest, readImageAsDataURL, downloadJSON, readJSONFile,
  validateImported, importPayload, uniqueSheetName,
} from './io.js';

const DATA_URL_WARN_BYTES = 4 * 1024 * 1024;
const THEME_KEY = 'sprite-animator:theme';
const FRAMES_MODE_KEY = 'sprite-animator:frames-mode';
const PREVIEW_BG_KEY = 'sprite-animator:preview-bg';
const PREVIEW_SCALE_KEY = 'sprite-animator:preview-scale';
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const PREVIEW_BGS = ['checker', 'solid', 'transparent'];

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  shortcutsBtn: document.getElementById('shortcuts-btn'),
  moreBtn: document.getElementById('more-btn'),
  moreMenu: document.getElementById('more-menu'),

  sheetList: document.getElementById('sheet-list'),
  modeGrid: document.getElementById('mode-grid'),
  modeFreepick: document.getElementById('mode-freepick'),
  anchorSelect: document.getElementById('anchor-select'),
  gridRow: document.getElementById('grid-row'),
  cellWidth: document.getElementById('cell-width'),
  cellHeight: document.getElementById('cell-height'),
  applyCell: document.getElementById('apply-cell'),
  gridInfo: document.getElementById('grid-info'),
  cursorInfo: document.getElementById('cursor-info'),

  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  zoomFit: document.getElementById('zoom-fit'),
  zoomDisplay: document.getElementById('zoom-display'),

  uploadBtn: document.getElementById('upload-btn'),
  uploadInput: document.getElementById('upload-input'),
  emptyUploadBtn: document.getElementById('empty-upload-btn'),
  deleteSheet: document.getElementById('delete-sheet'),

  importBtn: document.getElementById('import-btn'),
  importInput: document.getElementById('import-input'),
  exportBtn: document.getElementById('export-btn'),
  resetBtn: document.getElementById('reset-btn'),

  stage: document.getElementById('sheet-stage'),
  stageViewport: document.getElementById('stage-viewport'),
  stageContent: document.getElementById('stage-content'),
  image: document.getElementById('sheet-image'),
  overlay: document.getElementById('grid-overlay'),
  dragBox: document.getElementById('drag-box'),
  dropHint: document.getElementById('drop-hint'),
  sheetEmpty: document.getElementById('sheet-empty'),

  animName: document.getElementById('anim-name'),
  animFps: document.getElementById('anim-fps'),
  animLoop: document.getElementById('anim-loop'),
  animPingpong: document.getElementById('anim-pingpong'),
  animFrames: document.getElementById('anim-frames'),
  framesThumbs: document.getElementById('frames-thumbs'),
  framesCount: document.getElementById('frames-count'),
  framesModeThumb: document.getElementById('frames-mode-thumb'),
  framesModeText: document.getElementById('frames-mode-text'),
  hintGrid: document.getElementById('hint-grid'),
  hintFreepick: document.getElementById('hint-freepick'),

  previewCanvas: document.getElementById('preview-canvas'),
  previewCanvasWrap: document.getElementById('preview-canvas-wrap'),
  previewPlay: document.getElementById('preview-play'),
  previewPause: document.getElementById('preview-pause'),
  previewStepBack: document.getElementById('preview-step-back'),
  previewStepFwd: document.getElementById('preview-step-fwd'),
  previewScale: document.getElementById('preview-scale'),
  previewBg: document.getElementById('preview-bg'),
  previewInfo: document.getElementById('preview-info'),

  saveAnim: document.getElementById('save-anim'),
  newAnim: document.getElementById('new-anim'),

  animList: document.getElementById('anim-list'),
  animCount: document.getElementById('anim-count'),

  toastHost: document.getElementById('toast-host'),
  dialogHost: document.getElementById('dialog-host'),
};

const player = createPlayer(els.previewCanvas);
const cardPlayers = new Map();
let currentImage = null;
let framesMode = localStorage.getItem(FRAMES_MODE_KEY) || 'thumbs';
let previewBg = localStorage.getItem(PREVIEW_BG_KEY) || 'checker';
let previewScale = Number(localStorage.getItem(PREVIEW_SCALE_KEY)) || 2;
let dragSourceIndex = -1;

function getActiveSheet() {
  const name = state.ui.activeSheet;
  if (!name) return null;
  return state.sheets[name] || null;
}

/* ============================================================
   Theme
   ============================================================ */

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const useEl = els.themeToggle.querySelector('use');
  if (useEl) useEl.setAttribute('href', t === 'light' ? '#i-sun' : '#i-moon');
  els.themeToggle.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  els.themeToggle.setAttribute('aria-label', els.themeToggle.title);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}

/* ============================================================
   Toast & Dialog
   ============================================================ */

function toast(message, kind = 'info', duration = 2600) {
  const host = els.toastHost;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const iconRef = kind === 'success' ? '#i-save'
    : kind === 'warn' ? '#i-anchor'
    : kind === 'error' ? '#i-x'
    : '#i-image';
  el.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${iconRef}"/></svg><span></span>`;
  el.querySelector('span').textContent = message;
  host.appendChild(el);
  const remove = () => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  setTimeout(remove, duration);
  el.addEventListener('click', remove);
}

function dialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, third = null }) {
  return new Promise((resolve) => {
    const host = els.dialogHost;
    host.innerHTML = '';
    host.classList.add('open');
    host.setAttribute('aria-hidden', 'false');

    const dlg = document.createElement('div');
    dlg.className = 'dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');

    const h = document.createElement('h3');
    h.textContent = title;
    dlg.appendChild(h);

    if (body) {
      if (typeof body === 'string') {
        const p = document.createElement('p');
        p.textContent = body;
        dlg.appendChild(p);
      } else if (body instanceof Node) {
        dlg.appendChild(body);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost';
    cancel.textContent = cancelLabel;
    cancel.addEventListener('click', () => close('cancel'));
    actions.appendChild(cancel);

    if (third) {
      const tBtn = document.createElement('button');
      tBtn.type = 'button';
      tBtn.className = 'btn-ghost';
      tBtn.textContent = third;
      tBtn.addEventListener('click', () => close('third'));
      actions.appendChild(tBtn);
    }

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'danger' : 'btn-primary';
    ok.textContent = confirmLabel;
    ok.addEventListener('click', () => close('ok'));
    actions.appendChild(ok);

    dlg.appendChild(actions);
    host.appendChild(dlg);

    function close(result) {
      host.classList.remove('open');
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '';
      window.removeEventListener('keydown', onKey);
      host.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close('cancel'); }
      if (e.key === 'Enter') { e.preventDefault(); close('ok'); }
    }
    function onBackdrop(e) {
      if (e.target === host) close('cancel');
    }
    window.addEventListener('keydown', onKey);
    host.addEventListener('click', onBackdrop);
    setTimeout(() => ok.focus(), 0);
  });
}

async function confirmDialog(title, message, { danger = false, confirmLabel = 'OK' } = {}) {
  const r = await dialog({ title, body: message, danger, confirmLabel });
  return r === 'ok';
}

function showShortcuts() {
  const grid = document.createElement('div');
  grid.className = 'shortcuts-grid';
  const rows = [
    ['Toggle Grid / Freepick mode',  'G / F'],
    ['Play / Pause preview',         'Space'],
    ['Previous / Next frame',        '← / →'],
    ['Zoom in / out / fit',          '+ / − / 0'],
    ['Save animation',               'Ctrl/Cmd+S'],
    ['New animation',                'N'],
    ['Clear selection',              'Esc'],
    ['Toggle theme',                 'T'],
    ['Show this help',               '?'],
  ];
  for (const [label, key] of rows) {
    const a = document.createElement('div'); a.textContent = label;
    const b = document.createElement('div');
    b.innerHTML = key.split(' / ').map((k) => `<kbd>${k}</kbd>`).join(' / ');
    grid.appendChild(a);
    grid.appendChild(b);
  }
  dialog({ title: 'Keyboard shortcuts', body: grid, confirmLabel: 'Close', cancelLabel: 'Close' });
}

/* ============================================================
   Init
   ============================================================ */

async function init() {
  initTheme();
  initSheetView({
    stage: els.stageViewport,
    image: els.image,
    overlay: els.overlay,
    dragBox: els.dragBox,
  });
  setSelectionListener(onSelectionChanged);

  const stored = loadFromStorage();
  if (stored) applyLoaded(stored, { merge: false });

  const manifest = await fetchManifest();
  for (const entry of manifest) {
    if (!state.sheets[entry.name]) {
      state.sheets[entry.name] = emptySheetMeta({
        src: entry.src,
        origin: 'sample',
        cellWidth: entry.cellWidth || 0,
        cellHeight: entry.cellHeight || 0,
        persistImage: false,
      });
    } else {
      const sheet = state.sheets[entry.name];
      if (sheet.origin === 'sample' && (!sheet.src || sheet.src.startsWith('images/'))) {
        sheet.src = entry.src;
      }
    }
  }

  if (!state.ui.editing) state.ui.editing = emptyAnimEditor();

  const firstName = state.ui.activeSheet && state.sheets[state.ui.activeSheet]
    ? state.ui.activeSheet
    : Object.keys(state.sheets)[0];
  renderSheetList();
  applyFramesMode();
  applyPreviewBg();
  applyPreviewScale();
  if (firstName) {
    await selectSheet(firstName);
  } else {
    renderEmptyState();
  }

  wireEvents();
  saveNow();
}

/* ============================================================
   Sheet rendering
   ============================================================ */

function renderSheetList() {
  els.sheetList.innerHTML = '';
  const names = Object.keys(state.sheets);
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No sheets yet — Upload to start.';
    els.sheetList.appendChild(li);
    return;
  }
  for (const name of names) {
    const sheet = state.sheets[name];
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-item' + (name === state.ui.activeSheet ? ' active' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(name === state.ui.activeSheet));

    const thumb = document.createElement('img');
    thumb.className = 'sheet-thumb';
    thumb.alt = '';
    if (sheet.src) thumb.src = sheet.src;

    const meta = document.createElement('div');
    meta.className = 'sheet-meta';
    const nm = document.createElement('div');
    nm.className = 'sheet-name';
    nm.textContent = name;
    const tag = document.createElement('div');
    tag.className = 'sheet-tag';
    tag.textContent = `${sheet.animations?.length || 0} anim · ${sheet.mode || 'grid'}`;
    meta.appendChild(nm);
    meta.appendChild(tag);

    const badge = document.createElement('span');
    badge.className = 'sheet-badge' + (sheet.origin === 'uploaded' ? ' uploaded' : '');
    badge.textContent = sheet.origin === 'uploaded' ? 'Upload' : 'Sample';

    btn.appendChild(thumb);
    btn.appendChild(meta);
    btn.appendChild(badge);
    btn.addEventListener('click', () => selectSheet(name));
    li.appendChild(btn);
    els.sheetList.appendChild(li);
  }
}

function syncToolbarFromSheet(sheet) {
  const mode = sheet?.mode || DEFAULT_SHEET_MODE;
  const anchor = sheet?.anchorMode || DEFAULT_ANCHOR;
  els.modeGrid.checked = mode === 'grid';
  els.modeFreepick.checked = mode === 'freepick';
  els.anchorSelect.value = anchor;
  els.gridRow.classList.toggle('hidden', mode !== 'grid');
  els.hintGrid.classList.toggle('hidden', mode !== 'grid');
  els.hintFreepick.classList.toggle('hidden', mode !== 'freepick');
  syncDeleteSheetButton(sheet);
}

function syncDeleteSheetButton(sheet) {
  const isSample = !sheet || sheet.origin === 'sample';
  els.deleteSheet.disabled = isSample;
  els.deleteSheet.title = isSample
    ? 'Sample sheets cannot be deleted'
    : 'Delete current sheet';
}

async function selectSheet(name) {
  const sheet = state.sheets[name];
  if (!sheet) {
    state.ui.activeSheet = null;
    renderSheetList();
    renderEmptyState();
    return;
  }
  state.ui.activeSheet = name;
  if (!sheet.mode) sheet.mode = DEFAULT_SHEET_MODE;
  if (!sheet.anchorMode) sheet.anchorMode = DEFAULT_ANCHOR;
  state.ui.editing = emptyAnimEditor(sheet.mode);
  state.ui.editing.anchorMode = sheet.anchorMode;
  syncToolbarFromSheet(sheet);
  renderSheetList();

  if (!sheet.src) {
    els.cellWidth.value = sheet.cellWidth || '';
    els.cellHeight.value = sheet.cellHeight || '';
    syncEditorInputs();
    renderEmptyState('This uploaded sheet was not persisted. Re-upload to edit.');
    notify();
    renderAnimList();
    return;
  }

  els.sheetEmpty.classList.add('hidden');

  let img;
  try {
    img = await loadImage(sheet.src);
  } catch (err) {
    console.error(err);
    renderEmptyState('Failed to load image.');
    return;
  }
  if (!sheet.cellWidth || sheet.cellWidth <= 0) {
    sheet.cellWidth = autoCellSize(img.naturalWidth);
  }
  if (!sheet.cellHeight || sheet.cellHeight <= 0) {
    sheet.cellHeight = autoCellSize(img.naturalHeight);
  }
  els.cellWidth.value = sheet.cellWidth;
  els.cellHeight.value = sheet.cellHeight;

  if (materializeGridAnimations(sheet, img)) saveNow();

  syncEditorInputs();

  // Reset zoom each time a new sheet is opened
  sheetSetZoom(1);
  updateZoomDisplay();

  let result;
  try {
    setBusy(sheet.mode === 'freepick');
    result = await showSheet({
      src: sheet.src,
      mode: sheet.mode,
      cellWidth: sheet.cellWidth,
      cellHeight: sheet.cellHeight,
      anchorMode: sheet.anchorMode,
    });
  } catch (err) {
    console.error(err);
    renderEmptyState('Failed to load image.');
    return;
  } finally {
    setBusy(false);
  }
  if (result) {
    currentImage = result.image;
    const gridDesc = sheet.mode === 'grid' && result.columns > 0 && result.rows > 0
      ? `${result.columns}×${result.rows} grid (cell ${sheet.cellWidth}×${sheet.cellHeight})`
      : sheet.mode === 'freepick' ? 'freepick' : '—';
    els.gridInfo.textContent = `${result.width}×${result.height} → ${gridDesc}`;
    player.setSheet({ image: currentImage });
  }
  renderAnimList();
  applyEditorPreview();
  notify();
}

function setBusy(on) {
  if (on) els.gridInfo.textContent = 'Analyzing…';
  document.body.style.cursor = on ? 'progress' : '';
}

function renderEmptyState(message) {
  els.image.removeAttribute('src');
  els.overlay.innerHTML = '';
  els.overlay.style.display = 'none';
  els.sheetEmpty.querySelector('p').textContent = message || 'No sheet loaded.';
  els.sheetEmpty.classList.remove('hidden');
  els.gridInfo.textContent = '';
  els.cursorInfo.textContent = '';
  currentImage = null;
  syncDeleteSheetButton(null);
  renderAnimList();
}

/* ============================================================
   Frame editor (thumbs vs IDs)
   ============================================================ */

function onSelectionChanged(rects) {
  const ed = state.ui.editing;
  ed.frames = rects;
  els.animFrames.value = framesToInputString(ed);
  renderFramesThumbs();
  applyEditorPreview();
  notify();
}

function framesToInputString(ed) {
  if (!ed.frames.length) return '';
  if (ed.kind === 'freepick') {
    return ed.frames.map((f) => String(componentIdOfRect(f) || '?')).join(',');
  }
  return ed.frames.map((f) => String(cellIndexOfRect(f))).join(',');
}

function applyFramesMode() {
  const isThumb = framesMode === 'thumbs';
  els.framesModeThumb.classList.toggle('active', isThumb);
  els.framesModeText.classList.toggle('active', !isThumb);
  els.framesModeThumb.setAttribute('aria-pressed', String(isThumb));
  els.framesModeText.setAttribute('aria-pressed', String(!isThumb));
  els.framesThumbs.classList.toggle('hidden', !isThumb);
  els.animFrames.classList.toggle('hidden', isThumb);
  if (isThumb) renderFramesThumbs();
}

function setFramesMode(mode) {
  framesMode = mode;
  localStorage.setItem(FRAMES_MODE_KEY, mode);
  applyFramesMode();
}

function renderFramesThumbs() {
  const wrap = els.framesThumbs;
  wrap.innerHTML = '';
  const ed = state.ui.editing;
  els.framesCount.textContent = ed.frames.length ? `· ${ed.frames.length}` : '';
  if (!ed.frames.length) return;
  if (!currentImage) return;

  ed.frames.forEach((f, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'frame-thumb';
    thumb.draggable = true;
    thumb.dataset.index = String(i);
    thumb.title = `Frame ${i + 1}`;

    const c = document.createElement('canvas');
    const size = 48;
    const targetW = f.w;
    const targetH = f.h;
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const fit = Math.min(size / targetW, size / targetH);
    const dw = targetW * fit;
    const dh = targetH * fit;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    try {
      ctx.drawImage(currentImage, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    } catch {}
    thumb.appendChild(c);

    const order = document.createElement('span');
    order.className = 'order';
    order.textContent = i + 1;
    thumb.appendChild(order);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.title = 'Remove frame';
    remove.setAttribute('aria-label', `Remove frame ${i + 1}`);
    remove.textContent = '×';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFrameAt(i);
    });
    thumb.appendChild(remove);

    thumb.addEventListener('dragstart', (e) => {
      dragSourceIndex = i;
      thumb.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch {}
    });
    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
      wrap.querySelectorAll('.frame-thumb').forEach((el) => {
        el.classList.remove('drop-before', 'drop-after');
      });
      dragSourceIndex = -1;
    });
    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = thumb.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      thumb.classList.toggle('drop-before', before);
      thumb.classList.toggle('drop-after', !before);
    });
    thumb.addEventListener('dragleave', () => {
      thumb.classList.remove('drop-before', 'drop-after');
    });
    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      const r = thumb.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      const target = i + (before ? 0 : 1);
      moveFrame(dragSourceIndex, target);
    });

    wrap.appendChild(thumb);
  });
}

function removeFrameAt(index) {
  const ed = state.ui.editing;
  if (index < 0 || index >= ed.frames.length) return;
  ed.frames.splice(index, 1);
  setSequence(ed.frames);
  renderFramesThumbs();
  applyEditorPreview();
  notify();
}

function moveFrame(from, to) {
  const ed = state.ui.editing;
  if (from < 0 || from >= ed.frames.length) return;
  const [item] = ed.frames.splice(from, 1);
  let target = to;
  if (from < to) target -= 1;
  target = Math.max(0, Math.min(ed.frames.length, target));
  ed.frames.splice(target, 0, item);
  setSequence(ed.frames);
  renderFramesThumbs();
  applyEditorPreview();
  notify();
}

function syncEditorInputs() {
  const ed = state.ui.editing;
  els.animName.value = ed.name;
  els.animFps.value = ed.fps;
  els.animLoop.checked = !!ed.loop;
  els.animPingpong.checked = !!ed.pingpong;
  els.animFrames.value = framesToInputString(ed);
  setSequence(ed.frames);
  renderFramesThumbs();
  applyEditorPreview();
}

function applyEditorPreview() {
  const ed = state.ui.editing;
  player.setAnimation({
    frames: ed.frames,
    anchorMode: ed.anchorMode,
    pingpong: ed.pingpong,
    fps: ed.fps,
    loop: ed.loop,
  });
  els.previewInfo.textContent = ed.frames.length
    ? `${ed.frames.length} frames · ${ed.fps}fps · ${ed.kind === 'freepick' ? ed.anchorMode : 'grid'}`
    : 'no frames';
  applyPreviewScale();
  if (ed.frames.length && !player.isPlaying() && !prefersReducedMotion()) player.play();
}

function applyPreviewScale() {
  const c = els.previewCanvas;
  c.style.width = `${(c.width || 1) * previewScale}px`;
  c.style.height = `${(c.height || 1) * previewScale}px`;
}

function applyPreviewBg() {
  els.previewCanvasWrap.dataset.bg = previewBg;
  localStorage.setItem(PREVIEW_BG_KEY, previewBg);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* ============================================================
   IDs string parsing (for text mode)
   ============================================================ */

function parseIdsString(value) {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => n | 0);
}

function idsToFrames(ids, kind) {
  const out = [];
  if (kind === 'freepick') {
    for (const id of ids) {
      const r = rectFromComponentId(id);
      if (r) out.push(r);
    }
  } else {
    for (const id of ids) {
      const r = rectFromCellIndex(id);
      if (r) out.push(r);
    }
  }
  return out;
}

/* ============================================================
   Zoom
   ============================================================ */

function updateZoomDisplay() {
  els.zoomDisplay.textContent = `${Math.round(sheetGetZoom() * 100)}%`;
}

function nearestZoomIndex(z) {
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const d = Math.abs(ZOOM_STEPS[i] - z);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

function stepZoom(direction) {
  const z = sheetGetZoom();
  const i = nearestZoomIndex(z);
  let next;
  if (direction > 0) next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, i + 1)];
  else next = ZOOM_STEPS[Math.max(0, i - 1)];
  sheetSetZoom(next);
  updateZoomDisplay();
}

function setZoomTo(value) {
  sheetSetZoom(value);
  updateZoomDisplay();
}

/* ============================================================
   Wire events
   ============================================================ */

function wireEvents() {
  // Theme
  els.themeToggle.addEventListener('click', toggleTheme);
  els.shortcutsBtn.addEventListener('click', showShortcuts);

  // More menu
  els.moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMoreMenu();
  });
  document.addEventListener('click', (e) => {
    if (!els.moreMenu.classList.contains('hidden')) {
      if (!els.moreMenu.contains(e.target) && e.target !== els.moreBtn) closeMoreMenu();
    }
  });

  // Mode + anchor
  els.modeGrid.addEventListener('change', () => onModeChange('grid'));
  els.modeFreepick.addEventListener('change', () => onModeChange('freepick'));
  els.anchorSelect.addEventListener('change', () => onAnchorChange(els.anchorSelect.value));

  // Cell size
  els.applyCell.addEventListener('click', applyCellSize);
  els.cellWidth.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCellSize(); });
  els.cellHeight.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCellSize(); });

  // Upload
  const triggerUpload = () => els.uploadInput.click();
  els.uploadBtn.addEventListener('click', triggerUpload);
  els.emptyUploadBtn.addEventListener('click', triggerUpload);
  els.uploadInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await handleUploads(files);
    els.uploadInput.value = '';
  });

  els.deleteSheet.addEventListener('click', deleteCurrentSheet);

  // Import / Export / Reset
  els.importBtn.addEventListener('click', () => { closeMoreMenu(); els.importInput.click(); });
  els.importInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await handleImport(file);
    els.importInput.value = '';
  });
  els.exportBtn.addEventListener('click', () => {
    closeMoreMenu();
    const name = state.ui.activeSheet;
    if (!name) { toast('No sheet selected.', 'warn'); return; }
    downloadJSON(name);
    toast(`Exported "${name}"`, 'success');
  });
  els.resetBtn.addEventListener('click', () => { closeMoreMenu(); resetAll(); });

  // Animation editor inputs
  els.animName.addEventListener('input', () => { state.ui.editing.name = els.animName.value; notify(); });
  els.animFps.addEventListener('input', () => {
    state.ui.editing.fps = Math.max(1, Number(els.animFps.value) || 1);
    applyEditorPreview();
    notify();
  });
  els.animLoop.addEventListener('change', () => {
    state.ui.editing.loop = els.animLoop.checked;
    applyEditorPreview();
    notify();
  });
  els.animPingpong.addEventListener('change', () => {
    state.ui.editing.pingpong = els.animPingpong.checked;
    applyEditorPreview();
    notify();
  });
  els.animFrames.addEventListener('change', () => {
    const ed = state.ui.editing;
    const ids = parseIdsString(els.animFrames.value);
    const frames = idsToFrames(ids, ed.kind);
    ed.frames = frames;
    setSequence(frames);
    renderFramesThumbs();
    applyEditorPreview();
    notify();
  });

  // Frames mode toggle
  els.framesModeThumb.addEventListener('click', () => setFramesMode('thumbs'));
  els.framesModeText.addEventListener('click', () => setFramesMode('text'));

  // Preview controls
  els.previewPlay.addEventListener('click', () => player.play());
  els.previewPause.addEventListener('click', () => player.pause());
  els.previewStepBack.addEventListener('click', () => stepPreview(-1));
  els.previewStepFwd.addEventListener('click', () => stepPreview(+1));
  els.previewScale.value = String(previewScale);
  els.previewScale.addEventListener('change', () => {
    previewScale = Number(els.previewScale.value) || 2;
    localStorage.setItem(PREVIEW_SCALE_KEY, String(previewScale));
    applyPreviewScale();
  });
  els.previewBg.addEventListener('click', () => {
    const i = PREVIEW_BGS.indexOf(previewBg);
    previewBg = PREVIEW_BGS[(i + 1) % PREVIEW_BGS.length];
    applyPreviewBg();
  });

  // Animation actions
  els.saveAnim.addEventListener('click', saveAnimation);
  els.newAnim.addEventListener('click', async () => {
    if (!(await confirmDiscardEditor())) return;
    const sheet = getActiveSheet();
    state.ui.editing = emptyAnimEditor(sheet?.mode || DEFAULT_SHEET_MODE);
    state.ui.editing.anchorMode = sheet?.anchorMode || DEFAULT_ANCHOR;
    syncEditorInputs();
    renderAnimList();
    notify();
  });

  // Zoom
  els.zoomIn.addEventListener('click', () => stepZoom(+1));
  els.zoomOut.addEventListener('click', () => stepZoom(-1));
  els.zoomFit.addEventListener('click', () => setZoomTo(1));
  els.stageViewport.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? +1 : -1);
  }, { passive: false });

  // Cursor info
  els.stageViewport.addEventListener('mousemove', (e) => {
    const coord = imageCoordsAtClientExt(e.clientX, e.clientY);
    if (coord) {
      els.cursorInfo.textContent = `x ${Math.floor(coord.x)}, y ${Math.floor(coord.y)}`;
    } else {
      els.cursorInfo.textContent = '';
    }
  });
  els.stageViewport.addEventListener('mouseleave', () => {
    els.cursorInfo.textContent = '';
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', onKeydown);

  setupDragAndDrop();
}

function toggleMoreMenu() {
  const open = els.moreMenu.classList.toggle('hidden');
  els.moreBtn.setAttribute('aria-expanded', String(!open));
}
function closeMoreMenu() {
  els.moreMenu.classList.add('hidden');
  els.moreBtn.setAttribute('aria-expanded', 'false');
}

function stepPreview(direction) {
  const ed = state.ui.editing;
  if (!ed.frames.length) return;
  player.step(direction);
}

function isTextInput(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function onKeydown(e) {
  if (isTextInput(e.target)) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveAnimation();
    }
    return;
  }
  if (els.dialogHost.classList.contains('open')) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveAnimation();
    return;
  }
  switch (e.key) {
    case ' ':
    case 'Spacebar':
      e.preventDefault();
      if (player.isPlaying()) player.pause(); else player.play();
      break;
    case 'g': case 'G':
      els.modeGrid.checked = true;
      onModeChange('grid');
      break;
    case 'f': case 'F':
      els.modeFreepick.checked = true;
      onModeChange('freepick');
      break;
    case 'n': case 'N':
      els.newAnim.click();
      break;
    case 'Escape':
      els.newAnim.click();
      break;
    case '+': case '=':
      stepZoom(+1);
      break;
    case '-': case '_':
      stepZoom(-1);
      break;
    case '0':
      setZoomTo(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      stepPreview(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      stepPreview(+1);
      break;
    case 't': case 'T':
      toggleTheme();
      break;
    case '?':
      showShortcuts();
      break;
  }
}

/* ============================================================
   Mode / anchor / cell-size handlers
   ============================================================ */

async function onModeChange(newMode) {
  if (!SHEET_MODES.includes(newMode)) return;
  const sheet = getActiveSheet();
  if (!sheet) return;
  if (sheet.mode === newMode) return;
  sheet.mode = newMode;
  state.ui.editing = emptyAnimEditor(newMode);
  state.ui.editing.anchorMode = sheet.anchorMode || DEFAULT_ANCHOR;
  syncToolbarFromSheet(sheet);
  syncEditorInputs();
  setBusy(newMode === 'freepick');
  try {
    await sheetSetMode(newMode);
  } finally {
    setBusy(false);
  }
  if (sheet.mode === 'grid' && currentImage) {
    const cols = Math.floor(currentImage.naturalWidth / sheet.cellWidth);
    const rows = Math.floor(currentImage.naturalHeight / sheet.cellHeight);
    els.gridInfo.textContent = `${currentImage.naturalWidth}×${currentImage.naturalHeight} → ${cols}×${rows} grid (cell ${sheet.cellWidth}×${sheet.cellHeight})`;
  } else if (sheet.mode === 'freepick' && currentImage) {
    const info = getComponentInfo();
    const n = info?.components?.length || 0;
    els.gridInfo.textContent = `${currentImage.naturalWidth}×${currentImage.naturalHeight} → freepick (${n} sprites)`;
  }
  renderSheetList();
  renderAnimList();
  applyEditorPreview();
  notify();
}

function onAnchorChange(newAnchor) {
  if (!ANCHOR_MODES.includes(newAnchor)) return;
  const sheet = getActiveSheet();
  if (!sheet) return;
  sheet.anchorMode = newAnchor;
  state.ui.editing.anchorMode = newAnchor;
  sheetSetAnchorMode(newAnchor);
  applyEditorPreview();
  notify();
}

async function applyCellSize() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  if (sheet.mode !== 'grid') return;
  const w = Math.max(1, Math.floor(Number(els.cellWidth.value) || 1));
  const h = Math.max(1, Math.floor(Number(els.cellHeight.value) || 1));
  if (w === sheet.cellWidth && h === sheet.cellHeight) return;
  const gridAnims = sheet.animations.filter((a) => (a.kind || 'grid') === 'grid');
  if (gridAnims.length) {
    const ok = await confirmDialog(
      'Change cell size?',
      `This will invalidate frames in ${gridAnims.length} grid animation(s) for "${state.ui.activeSheet}".`,
      { danger: true, confirmLabel: 'Apply' },
    );
    if (!ok) {
      els.cellWidth.value = sheet.cellWidth;
      els.cellHeight.value = sheet.cellHeight;
      return;
    }
  }
  sheet.cellWidth = w;
  sheet.cellHeight = h;
  clearEmptyCellCache(sheet.src);
  for (const a of sheet.animations) {
    if ((a.kind || 'grid') === 'grid') a.frames = [];
  }
  selectSheet(state.ui.activeSheet);
}

/* ============================================================
   Uploads / Import / Reset
   ============================================================ */

async function handleUploads(files) {
  let lastName = null;
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    let dataUrl;
    try {
      dataUrl = await readImageAsDataURL(file);
    } catch (err) {
      toast(`Failed to read ${file.name}: ${err}`, 'error');
      continue;
    }
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'upload';
    const name = uniqueSheetName(state, baseName);
    let persistImage = true;
    if ((dataUrl.length || 0) > DATA_URL_WARN_BYTES) {
      persistImage = await confirmDialog(
        'Persist large image?',
        `"${file.name}" is ~${Math.round(dataUrl.length / 1024 / 1024)}MB. Save into browser storage anyway? Cancel keeps it for this session only.`,
        { confirmLabel: 'Persist' },
      );
    }
    state.sheets[name] = emptySheetMeta({
      src: dataUrl,
      origin: 'uploaded',
      cellWidth: 0,
      cellHeight: 0,
      persistImage,
    });
    lastName = name;
    added++;
  }
  renderSheetList();
  if (lastName) await selectSheet(lastName);
  notify();
  if (added) toast(`Added ${added} sheet${added > 1 ? 's' : ''}`, 'success');
}

async function deleteCurrentSheet() {
  const name = state.ui.activeSheet;
  if (!name) return;
  const sheet = state.sheets[name];
  if (!sheet) return;
  if (sheet.origin === 'sample') {
    toast('Sample sheets cannot be deleted.', 'warn');
    return;
  }
  const ok = await confirmDialog(
    'Delete sheet?',
    `"${name}" and ${sheet.animations.length} animation(s) will be removed.`,
    { danger: true, confirmLabel: 'Delete' },
  );
  if (!ok) return;
  delete state.sheets[name];
  const next = Object.keys(state.sheets)[0];
  if (next) {
    await selectSheet(next);
  } else {
    state.ui.activeSheet = null;
    renderSheetList();
    renderEmptyState();
  }
  notify();
  toast(`Deleted "${name}"`, 'success');
}

async function handleImport(file) {
  let payload;
  try {
    payload = await readJSONFile(file);
  } catch (err) {
    toast(`Invalid JSON: ${err}`, 'error');
    return;
  }
  const errMsg = validateImported(payload);
  if (errMsg) { toast(errMsg, 'error'); return; }
  const choice = await dialog({
    title: 'Import data',
    body: 'Choose how to apply the imported file.',
    confirmLabel: 'Merge',
    third: 'Replace',
    cancelLabel: 'Cancel',
  });
  if (choice === 'cancel') return;
  importPayload(payload, { merge: choice === 'ok' });
  renderSheetList();
  const next = state.ui.activeSheet && state.sheets[state.ui.activeSheet]
    ? state.ui.activeSheet
    : Object.keys(state.sheets)[0];
  if (next) await selectSheet(next);
  else renderEmptyState();
  notify();
  toast(choice === 'ok' ? 'Imported and merged' : 'Imported (replaced)', 'success');
}

async function resetAll() {
  const ok = await confirmDialog(
    'Reset all data?',
    'This clears localStorage and reloads. Uploaded sheets will be lost unless exported.',
    { danger: true, confirmLabel: 'Reset' },
  );
  if (!ok) return;
  clearStorage();
  for (const k of Object.keys(state.sheets)) delete state.sheets[k];
  state.ui.activeSheet = null;
  state.ui.editing = emptyAnimEditor();
  location.reload();
}

/* ============================================================
   Save / Animation list
   ============================================================ */

function nextDefaultAnimName(sheet, sheetName) {
  const raw = (sheetName || state.ui.activeSheet || 'animation').trim();
  const base = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^\w.-]+/g, '') || 'animation';
  const used = new Set(
    (sheet.animations || [])
      .map((a) => (a && typeof a.name === 'string' ? a.name.trim() : ''))
      .filter(Boolean),
  );
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function framesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    if (p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h) return false;
  }
  return true;
}

function hasUnsavedChanges() {
  const ed = state.ui.editing;
  if (!ed) return false;
  const sheet = getActiveSheet();
  if (!sheet) return false;
  const saved = ed.id ? sheet.animations.find((a) => a.id === ed.id) : null;
  if (!saved) {
    return (ed.frames || []).length > 0 || (ed.name || '').trim() !== '';
  }
  if ((ed.name || '') !== (saved.name || '')) return true;
  if ((ed.fps | 0) !== (saved.fps | 0)) return true;
  if (!!ed.loop !== !!saved.loop) return true;
  if (!!ed.pingpong !== !!saved.pingpong) return true;
  if ((ed.anchorMode || '') !== (saved.anchorMode || '')) return true;
  return !framesEqual(ed.frames || [], saved.frames || []);
}

async function confirmDiscardEditor() {
  if (!hasUnsavedChanges()) return true;
  return await confirmDialog(
    'Discard unsaved changes?',
    'The current animation has unsaved changes. Start a new one anyway?',
    { danger: true, confirmLabel: 'Discard' },
  );
}

async function saveAnimation() {
  const sheet = getActiveSheet();
  if (!sheet) { toast('No sheet selected.', 'warn'); return; }
  const ed = state.ui.editing;
  if (!ed.frames.length) { toast('Select at least one frame.', 'warn'); return; }
  let name = (ed.name || '').trim();
  if (!name) {
    name = nextDefaultAnimName(sheet, state.ui.activeSheet);
    ed.name = name;
    if (els.animName) els.animName.value = name;
  }
  const fps = Math.max(1, Number(ed.fps) || 1);
  const kind = ed.kind === 'freepick' ? 'freepick' : 'grid';

  let target = ed.id ? sheet.animations.find((a) => a.id === ed.id) : null;
  if (!target) {
    const dup = sheet.animations.find((a) => a.name === name);
    if (dup) target = dup;
  }
  const payload = {
    name,
    kind,
    fps,
    loop: !!ed.loop,
    pingpong: !!ed.pingpong,
    anchorMode: ed.anchorMode || sheet.anchorMode || DEFAULT_ANCHOR,
    frames: ed.frames.map((f) => ({
      x: f.x | 0, y: f.y | 0, w: f.w | 0, h: f.h | 0,
      cx: f.cx, cy: f.cy,
    })),
  };

  if (target) {
    Object.assign(target, payload);
    ed.id = target.id;
  } else {
    const created = ensureAnimId({ id: null, ...payload });
    sheet.animations.push(created);
    ed.id = created.id;
  }
  renderAnimList();
  renderSheetList();
  notify();
  toast(`Saved "${name}"`, 'success');

  // Move on to a fresh editor so the user can start the next one immediately
  state.ui.editing = emptyAnimEditor(sheet.mode);
  state.ui.editing.anchorMode = sheet.anchorMode || DEFAULT_ANCHOR;
  syncEditorInputs();
  renderAnimList();
}

async function loadAnimIntoEditor(anim) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const kind = anim.kind === 'freepick' ? 'freepick' : 'grid';
  if (sheet.mode !== kind) {
    sheet.mode = kind;
    syncToolbarFromSheet(sheet);
    setBusy(kind === 'freepick');
    try { await sheetSetMode(kind); } finally { setBusy(false); }
  }
  const frames = Array.isArray(anim.frames) && anim.frames.length && typeof anim.frames[0] === 'object'
    ? anim.frames.map((f) => ({ ...f }))
    : [];
  state.ui.editing = {
    id: anim.id,
    kind,
    name: anim.name,
    frames,
    anchorMode: anim.anchorMode || sheet.anchorMode || DEFAULT_ANCHOR,
    fps: anim.fps,
    loop: !!anim.loop,
    pingpong: !!anim.pingpong,
  };
  if (kind === 'freepick') {
    els.anchorSelect.value = state.ui.editing.anchorMode;
    sheetSetAnchorMode(state.ui.editing.anchorMode);
  }
  syncEditorInputs();
  renderAnimList();
  notify();
}

function renderAnimList() {
  for (const p of cardPlayers.values()) p.pause();
  cardPlayers.clear();
  els.animList.innerHTML = '';
  const sheet = getActiveSheet();
  if (!sheet) {
    els.animCount.textContent = '';
    return;
  }
  els.animCount.textContent = `(${sheet.animations.length})`;
  if (!sheet.animations.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No animations yet — pick frames and save.';
    els.animList.appendChild(li);
    return;
  }
  for (const anim of sheet.animations) {
    const li = document.createElement('li');
    li.className = 'anim-card' + (state.ui.editing.id === anim.id ? ' active' : '');
    li.tabIndex = 0;
    const kind = anim.kind === 'freepick' ? 'freepick' : 'grid';

    const canvas = document.createElement('canvas');
    canvas.width = sheet.cellWidth || 56;
    canvas.height = sheet.cellHeight || 56;
    li.appendChild(canvas);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = anim.name;
    meta.appendChild(name);

    const tags = document.createElement('div');
    tags.className = 'tags';
    const t1 = document.createElement('span'); t1.className = 'tag'; t1.textContent = `${anim.frames.length}f`; tags.appendChild(t1);
    const t2 = document.createElement('span'); t2.className = 'tag'; t2.textContent = `${anim.fps}fps`; tags.appendChild(t2);
    const t3 = document.createElement('span'); t3.className = 'tag'; t3.textContent = kind; tags.appendChild(t3);
    if (anim.loop) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'loop'; tags.appendChild(t); }
    if (anim.pingpong) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'pp'; tags.appendChild(t); }
    meta.appendChild(tags);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'menu-btn icon-btn';
    menuBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-more"/></svg>';
    menuBtn.title = 'Card actions';
    menuBtn.setAttribute('aria-label', 'Card actions');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardMenu(menuBtn, anim);
    });

    li.appendChild(meta);
    li.appendChild(menuBtn);
    li.addEventListener('click', () => loadAnimIntoEditor(anim));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        loadAnimIntoEditor(anim);
      }
    });

    els.animList.appendChild(li);

    if (currentImage && Array.isArray(anim.frames) && anim.frames.length && typeof anim.frames[0] === 'object') {
      const cardPlayer = createPlayer(canvas);
      cardPlayer.setSheet({ image: currentImage });
      cardPlayer.setAnimation(anim);
      if (!prefersReducedMotion()) cardPlayer.play();
      cardPlayers.set(anim.id, cardPlayer);
    }
  }
}

function popMenu(targetEl, items) {
  closePopMenu();
  const menu = document.createElement('div');
  menu.className = 'pop-menu';
  for (const it of items) {
    if (it === '-') {
      const hr = document.createElement('hr');
      menu.appendChild(hr);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.classList.add('danger');
    b.innerHTML = it.icon ? `<svg class="icon" aria-hidden="true"><use href="${it.icon}"/></svg>` : '';
    const label = document.createElement('span');
    label.textContent = it.label;
    b.appendChild(label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopMenu();
      it.onClick?.();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = targetEl.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = r.bottom + 6;
  let left = Math.min(window.innerWidth - mw - 8, r.right - mw);
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  menu.style.position = 'fixed';
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.zIndex = '120';

  const off = (e) => {
    if (!menu.contains(e.target)) closePopMenu();
  };
  setTimeout(() => document.addEventListener('click', off, { once: true }), 0);
  window.addEventListener('keydown', escClose, { once: true });
  function escClose(e) { if (e.key === 'Escape') closePopMenu(); }
  popMenu._current = menu;
}
function closePopMenu() {
  if (popMenu._current) {
    popMenu._current.remove();
    popMenu._current = null;
  }
}

function openCardMenu(btn, anim) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  popMenu(btn, [
    { label: 'Edit',      icon: '#i-edit', onClick: () => loadAnimIntoEditor(anim) },
    { label: 'Duplicate', icon: '#i-copy', onClick: () => duplicateAnim(anim) },
    '-',
    { label: 'Delete',    icon: '#i-trash', danger: true, onClick: () => deleteAnim(anim) },
  ]);
}

function duplicateAnim(anim) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const copy = ensureAnimId({
    id: null,
    kind: anim.kind || 'grid',
    name: `${anim.name} copy`,
    frames: Array.isArray(anim.frames) && anim.frames.length && typeof anim.frames[0] === 'object'
      ? anim.frames.map((f) => ({ ...f }))
      : anim.frames.slice(),
    anchorMode: anim.anchorMode || DEFAULT_ANCHOR,
    fps: anim.fps,
    loop: !!anim.loop,
    pingpong: !!anim.pingpong,
  });
  sheet.animations.push(copy);
  renderAnimList();
  notify();
  toast(`Duplicated "${anim.name}"`, 'success');
}

async function deleteAnim(anim) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const ok = await confirmDialog(
    `Delete "${anim.name}"?`,
    'This animation will be removed.',
    { danger: true, confirmLabel: 'Delete' },
  );
  if (!ok) return;
  const i = sheet.animations.indexOf(anim);
  if (i >= 0) sheet.animations.splice(i, 1);
  if (state.ui.editing.id === anim.id) {
    state.ui.editing = emptyAnimEditor(sheet.mode);
    state.ui.editing.anchorMode = sheet.anchorMode || DEFAULT_ANCHOR;
    syncEditorInputs();
  }
  renderAnimList();
  renderSheetList();
  notify();
  toast(`Deleted "${anim.name}"`, 'success');
}

/* ============================================================
   Drag and drop uploads
   ============================================================ */

function setupDragAndDrop() {
  let depth = 0;
  const show = () => els.dropHint.classList.remove('hidden');
  const hide = () => els.dropHint.classList.add('hidden');
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    depth++;
    show();
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
    }
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) hide();
  });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    depth = 0;
    hide();
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length) await handleUploads(images);
  });
}

/* ============================================================
   Card menu — also offer Delete from a Shift-clicked menu (kept simple here)
   ============================================================ */

// Right-click on a card → contextual menu
document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.anim-card');
  if (!card) return;
  e.preventDefault();
  const sheet = getActiveSheet();
  if (!sheet) return;
  const idx = Array.from(els.animList.children).indexOf(card);
  const anim = sheet.animations[idx];
  if (!anim) return;
  // Position the popup near the cursor
  const fakeTarget = { getBoundingClientRect: () => ({
    left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY,
    width: 0, height: 0,
  }) };
  openCardMenu(fakeTarget, anim);
});

init();
