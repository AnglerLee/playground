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
} from './sheet.js';
import { createPlayer } from './preview.js';
import {
  fetchManifest, readImageAsDataURL, downloadJSON, readJSONFile,
  validateImported, importPayload, uniqueSheetName,
} from './io.js';

const DATA_URL_WARN_BYTES = 4 * 1024 * 1024;

const els = {
  sheetSelect: document.getElementById('sheet-select'),
  modeGrid: document.getElementById('mode-grid'),
  modeFreepick: document.getElementById('mode-freepick'),
  anchorSelect: document.getElementById('anchor-select'),
  gridRow: document.getElementById('grid-row'),
  cellWidth: document.getElementById('cell-width'),
  cellHeight: document.getElementById('cell-height'),
  applyCell: document.getElementById('apply-cell'),
  gridInfo: document.getElementById('grid-info'),

  uploadBtn: document.getElementById('upload-btn'),
  uploadInput: document.getElementById('upload-input'),
  deleteSheet: document.getElementById('delete-sheet'),

  importBtn: document.getElementById('import-btn'),
  importInput: document.getElementById('import-input'),
  exportBtn: document.getElementById('export-btn'),
  resetBtn: document.getElementById('reset-btn'),

  stage: document.getElementById('sheet-stage'),
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
  framesField: document.getElementById('frames-field'),
  hintGrid: document.getElementById('hint-grid'),
  hintFreepick: document.getElementById('hint-freepick'),

  previewCanvas: document.getElementById('preview-canvas'),
  previewPlay: document.getElementById('preview-play'),
  previewPause: document.getElementById('preview-pause'),
  previewInfo: document.getElementById('preview-info'),

  saveAnim: document.getElementById('save-anim'),
  clearSel: document.getElementById('clear-selection'),
  newAnim: document.getElementById('new-anim'),

  animList: document.getElementById('anim-list'),
  animCount: document.getElementById('anim-count'),
};

const player = createPlayer(els.previewCanvas);
const cardPlayers = new Map();
let currentImage = null;

function getActiveSheet() {
  const name = state.ui.activeSheet;
  if (!name) return null;
  return state.sheets[name] || null;
}

async function init() {
  initSheetView({
    stage: els.stage,
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
  populateSheetSelect();
  if (firstName) {
    await selectSheet(firstName);
  } else {
    renderEmptyState();
  }

  wireEvents();
  saveNow();
}

function populateSheetSelect() {
  const previous = els.sheetSelect.value;
  els.sheetSelect.innerHTML = '';
  const names = Object.keys(state.sheets);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    const sheet = state.sheets[name];
    const tag = sheet.origin === 'uploaded' ? '↑' : '·';
    opt.textContent = `${tag} ${name}`;
    els.sheetSelect.appendChild(opt);
  }
  if (state.ui.activeSheet && state.sheets[state.ui.activeSheet]) {
    els.sheetSelect.value = state.ui.activeSheet;
  } else if (previous && state.sheets[previous]) {
    els.sheetSelect.value = previous;
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
}

async function selectSheet(name) {
  const sheet = state.sheets[name];
  if (!sheet) {
    state.ui.activeSheet = null;
    renderEmptyState();
    return;
  }
  state.ui.activeSheet = name;
  els.sheetSelect.value = name;
  if (!sheet.mode) sheet.mode = DEFAULT_SHEET_MODE;
  if (!sheet.anchorMode) sheet.anchorMode = DEFAULT_ANCHOR;
  state.ui.editing = emptyAnimEditor(sheet.mode);
  state.ui.editing.anchorMode = sheet.anchorMode;
  syncToolbarFromSheet(sheet);

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

  // Convert legacy int-frames grid animations to rect[] now that image is available.
  if (materializeGridAnimations(sheet, img)) saveNow();

  syncEditorInputs();

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
    els.gridInfo.textContent = `Image ${result.width}×${result.height} → ${gridDesc}`;
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
  els.sheetEmpty.textContent = message || 'No sheet loaded. Upload an image or pick a sample.';
  els.sheetEmpty.classList.remove('hidden');
  els.gridInfo.textContent = '';
  currentImage = null;
  renderAnimList();
}

function onSelectionChanged(rects) {
  const ed = state.ui.editing;
  ed.frames = rects;
  els.animFrames.value = framesToInputString(ed);
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

function syncEditorInputs() {
  const ed = state.ui.editing;
  els.animName.value = ed.name;
  els.animFps.value = ed.fps;
  els.animLoop.checked = !!ed.loop;
  els.animPingpong.checked = !!ed.pingpong;
  els.animFrames.value = framesToInputString(ed);
  setSequence(ed.frames);
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
    ? `${ed.frames.length}f @ ${ed.fps}fps · ${ed.kind === 'freepick' ? ed.anchorMode : 'grid'}`
    : 'no frames';
  if (ed.frames.length && !player.isPlaying()) player.play();
}

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

function wireEvents() {
  els.sheetSelect.addEventListener('change', () => selectSheet(els.sheetSelect.value));

  els.modeGrid.addEventListener('change', () => onModeChange('grid'));
  els.modeFreepick.addEventListener('change', () => onModeChange('freepick'));
  els.anchorSelect.addEventListener('change', () => onAnchorChange(els.anchorSelect.value));

  els.applyCell.addEventListener('click', applyCellSize);
  els.cellWidth.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCellSize(); });
  els.cellHeight.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCellSize(); });

  els.uploadBtn.addEventListener('click', () => els.uploadInput.click());
  els.uploadInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await handleUploads(files);
    els.uploadInput.value = '';
  });

  els.deleteSheet.addEventListener('click', deleteCurrentSheet);

  els.importBtn.addEventListener('click', () => els.importInput.click());
  els.importInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await handleImport(file);
    els.importInput.value = '';
  });
  els.exportBtn.addEventListener('click', () => {
    const name = state.ui.activeSheet;
    if (!name) { alert('No sheet selected.'); return; }
    downloadJSON(name);
  });
  els.resetBtn.addEventListener('click', resetAll);

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
    applyEditorPreview();
    notify();
  });

  els.previewPlay.addEventListener('click', () => player.play());
  els.previewPause.addEventListener('click', () => player.pause());

  els.saveAnim.addEventListener('click', saveAnimation);
  els.clearSel.addEventListener('click', () => {
    state.ui.editing.frames = [];
    setSequence([]);
    applyEditorPreview();
    notify();
  });
  els.newAnim.addEventListener('click', () => {
    const sheet = getActiveSheet();
    state.ui.editing = emptyAnimEditor(sheet?.mode || DEFAULT_SHEET_MODE);
    state.ui.editing.anchorMode = sheet?.anchorMode || DEFAULT_ANCHOR;
    syncEditorInputs();
    notify();
  });

  setupDragAndDrop();
}

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
    els.gridInfo.textContent = `Image ${currentImage.naturalWidth}×${currentImage.naturalHeight} → ${cols}×${rows} grid (cell ${sheet.cellWidth}×${sheet.cellHeight})`;
  } else if (sheet.mode === 'freepick' && currentImage) {
    const info = getComponentInfo();
    const n = info?.components?.length || 0;
    els.gridInfo.textContent = `Image ${currentImage.naturalWidth}×${currentImage.naturalHeight} → freepick (${n} sprites)`;
  }
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

function applyCellSize() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  if (sheet.mode !== 'grid') return;
  const w = Math.max(1, Math.floor(Number(els.cellWidth.value) || 1));
  const h = Math.max(1, Math.floor(Number(els.cellHeight.value) || 1));
  if (w === sheet.cellWidth && h === sheet.cellHeight) return;
  const gridAnims = sheet.animations.filter((a) => (a.kind || 'grid') === 'grid');
  if (gridAnims.length) {
    const ok = confirm(
      `Changing cell size may invalidate frames in ${gridAnims.length} grid animation(s) for "${state.ui.activeSheet}". Continue?`,
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
  // Existing rect frames may no longer align — drop them so user re-picks
  for (const a of sheet.animations) {
    if ((a.kind || 'grid') === 'grid') a.frames = [];
  }
  selectSheet(state.ui.activeSheet);
}

async function handleUploads(files) {
  let lastName = null;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    let dataUrl;
    try {
      dataUrl = await readImageAsDataURL(file);
    } catch (err) {
      alert(`Failed to read ${file.name}: ${err}`);
      continue;
    }
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'upload';
    const name = uniqueSheetName(state, baseName);
    let persistImage = true;
    if ((dataUrl.length || 0) > DATA_URL_WARN_BYTES) {
      persistImage = confirm(
        `"${file.name}" is large (~${Math.round(dataUrl.length / 1024 / 1024)}MB). Save into browser storage anyway?\nClick Cancel to keep it only for this session.`,
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
  }
  populateSheetSelect();
  if (lastName) await selectSheet(lastName);
  notify();
}

function deleteCurrentSheet() {
  const name = state.ui.activeSheet;
  if (!name) return;
  const sheet = state.sheets[name];
  if (!sheet) return;
  const ok = confirm(`Delete sheet "${name}" and ${sheet.animations.length} animation(s)?`);
  if (!ok) return;
  delete state.sheets[name];
  populateSheetSelect();
  const next = Object.keys(state.sheets)[0];
  if (next) selectSheet(next);
  else {
    state.ui.activeSheet = null;
    renderEmptyState();
  }
  notify();
}

async function handleImport(file) {
  let payload;
  try {
    payload = await readJSONFile(file);
  } catch (err) {
    alert(`Invalid JSON: ${err}`);
    return;
  }
  const errMsg = validateImported(payload);
  if (errMsg) { alert(errMsg); return; }
  const replace = confirm(
    'Import: click OK to MERGE with existing data, or Cancel to REPLACE everything.',
  );
  importPayload(payload, { merge: replace });
  populateSheetSelect();
  const next = state.ui.activeSheet && state.sheets[state.ui.activeSheet]
    ? state.ui.activeSheet
    : Object.keys(state.sheets)[0];
  if (next) await selectSheet(next);
  else renderEmptyState();
  notify();
}

function resetAll() {
  if (!confirm('Reset all data? This clears localStorage.')) return;
  clearStorage();
  for (const k of Object.keys(state.sheets)) delete state.sheets[k];
  state.ui.activeSheet = null;
  state.ui.editing = emptyAnimEditor();
  location.reload();
}

function saveAnimation() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const ed = state.ui.editing;
  const name = (ed.name || '').trim();
  if (!name) { alert('Animation name is required.'); return; }
  if (!ed.frames.length) { alert('Select at least one frame.'); return; }
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
  notify();
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
  // Defensive: ensure frames are rect[] (should already be after materialize)
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
  els.animCount.textContent = `(${state.ui.activeSheet}, ${sheet.animations.length})`;
  for (const anim of sheet.animations) {
    const li = document.createElement('li');
    li.className = 'anim-card' + (state.ui.editing.id === anim.id ? ' active' : '');
    const kind = anim.kind === 'freepick' ? 'freepick' : 'grid';

    const canvas = document.createElement('canvas');
    canvas.width = sheet.cellWidth || 64;
    canvas.height = sheet.cellHeight || 64;
    li.appendChild(canvas);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = anim.name;
    meta.appendChild(name);

    const info = document.createElement('div');
    info.className = 'muted';
    const tags = [`${anim.frames.length}f`, `${anim.fps}fps`, kind];
    if (anim.loop) tags.push('loop');
    if (anim.pingpong) tags.push('pp');
    info.textContent = tags.join(' · ');
    meta.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => loadAnimIntoEditor(anim));
    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Dup';
    dupBtn.addEventListener('click', () => {
      const copy = ensureAnimId({
        id: null,
        kind,
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
    });
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Delete "${anim.name}"?`)) return;
      const i = sheet.animations.indexOf(anim);
      if (i >= 0) sheet.animations.splice(i, 1);
      if (state.ui.editing.id === anim.id) {
        state.ui.editing = emptyAnimEditor(sheet.mode);
        state.ui.editing.anchorMode = sheet.anchorMode || DEFAULT_ANCHOR;
        syncEditorInputs();
      }
      renderAnimList();
      notify();
    });
    actions.appendChild(editBtn);
    actions.appendChild(dupBtn);
    actions.appendChild(delBtn);
    meta.appendChild(actions);
    li.appendChild(meta);

    els.animList.appendChild(li);

    if (currentImage && Array.isArray(anim.frames) && anim.frames.length && typeof anim.frames[0] === 'object') {
      const cardPlayer = createPlayer(canvas);
      cardPlayer.setSheet({ image: currentImage });
      cardPlayer.setAnimation(anim);
      cardPlayer.play();
      cardPlayers.set(anim.id, cardPlayer);
    }
  }
}

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

init();
