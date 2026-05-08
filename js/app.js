import {
  state, emptySheetMeta, emptyAnimEditor, ensureAnimId,
  loadFromStorage, applyLoaded, clearStorage, notify, saveNow, autoCellSize,
} from './state.js';
import {
  initSheetView, setSelectionListener,
  showSheet, setSequence, loadImage, clearEmptyCellCache,
} from './sheet.js';
import { createPlayer } from './preview.js';
import {
  fetchManifest, readImageAsDataURL, downloadJSON, readJSONFile,
  validateImported, importPayload, uniqueSheetName,
} from './io.js';

const DATA_URL_WARN_BYTES = 4 * 1024 * 1024;

const els = {
  sheetSelect: document.getElementById('sheet-select'),
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

async function selectSheet(name) {
  const sheet = state.sheets[name];
  if (!sheet) {
    state.ui.activeSheet = null;
    renderEmptyState();
    return;
  }
  state.ui.activeSheet = name;
  els.sheetSelect.value = name;
  state.ui.editing = emptyAnimEditor();

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
  syncEditorInputs();

  let result;
  try {
    result = await showSheet({
      src: sheet.src,
      cellWidth: sheet.cellWidth,
      cellHeight: sheet.cellHeight,
    });
  } catch (err) {
    console.error(err);
    renderEmptyState('Failed to load image.');
    return;
  }
  if (result) {
    currentImage = result.image;
    els.gridInfo.textContent = `Image ${result.width}×${result.height} → ${result.columns}×${result.rows} grid (cell ${sheet.cellWidth}×${sheet.cellHeight})`;
    player.setSheet({
      image: currentImage,
      cellW: sheet.cellWidth,
      cellH: sheet.cellHeight,
      cols: result.columns,
    });
  }
  renderAnimList();
  applyEditorPreview();
  notify();
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

function onSelectionChanged(indices) {
  const ed = state.ui.editing;
  ed.frames = indices.slice();
  els.animFrames.value = indices.join(',');
  applyEditorPreview();
  notify();
}

function syncEditorInputs() {
  const ed = state.ui.editing;
  els.animName.value = ed.name;
  els.animFps.value = ed.fps;
  els.animLoop.checked = !!ed.loop;
  els.animPingpong.checked = !!ed.pingpong;
  els.animFrames.value = ed.frames.join(',');
  setSequence(ed.frames);
  applyEditorPreview();
}

function applyEditorPreview() {
  const ed = state.ui.editing;
  player.setAnimation({
    frames: ed.frames,
    pingpong: ed.pingpong,
    fps: ed.fps,
    loop: ed.loop,
  });
  els.previewInfo.textContent = ed.frames.length
    ? `${ed.frames.length}f @ ${ed.fps}fps`
    : 'no frames';
  if (ed.frames.length && !player.isPlaying()) player.play();
}

function parseFrameInput(value) {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => n | 0);
}

function wireEvents() {
  els.sheetSelect.addEventListener('change', () => selectSheet(els.sheetSelect.value));

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
  els.exportBtn.addEventListener('click', () => downloadJSON());
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
    const frames = parseFrameInput(els.animFrames.value);
    state.ui.editing.frames = frames;
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
    state.ui.editing = emptyAnimEditor();
    syncEditorInputs();
    notify();
  });

  setupDragAndDrop();
}

function applyCellSize() {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const w = Math.max(1, Math.floor(Number(els.cellWidth.value) || 1));
  const h = Math.max(1, Math.floor(Number(els.cellHeight.value) || 1));
  if (w === sheet.cellWidth && h === sheet.cellHeight) return;
  if (sheet.animations.length) {
    const ok = confirm(
      `Changing cell size may invalidate frame indices in ${sheet.animations.length} saved animation(s) for "${state.ui.activeSheet}". Continue?`,
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

  let target = ed.id ? sheet.animations.find((a) => a.id === ed.id) : null;
  if (!target) {
    const dup = sheet.animations.find((a) => a.name === name);
    if (dup) target = dup;
  }
  if (target) {
    target.name = name;
    target.frames = ed.frames.slice();
    target.fps = fps;
    target.loop = !!ed.loop;
    target.pingpong = !!ed.pingpong;
    ed.id = target.id;
  } else {
    const created = ensureAnimId({
      id: null,
      name,
      frames: ed.frames.slice(),
      fps,
      loop: !!ed.loop,
      pingpong: !!ed.pingpong,
    });
    sheet.animations.push(created);
    ed.id = created.id;
  }
  renderAnimList();
  notify();
}

function loadAnimIntoEditor(anim) {
  state.ui.editing = {
    id: anim.id,
    name: anim.name,
    frames: anim.frames.slice(),
    fps: anim.fps,
    loop: !!anim.loop,
    pingpong: !!anim.pingpong,
  };
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

    const canvas = document.createElement('canvas');
    canvas.width = sheet.cellWidth;
    canvas.height = sheet.cellHeight;
    li.appendChild(canvas);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = anim.name;
    meta.appendChild(name);

    const info = document.createElement('div');
    info.className = 'muted';
    const tags = [`${anim.frames.length}f`, `${anim.fps}fps`];
    if (anim.loop) tags.push('loop');
    if (anim.pingpong) tags.push('pingpong');
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
        name: `${anim.name} copy`,
        frames: anim.frames.slice(),
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
        state.ui.editing = emptyAnimEditor();
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

    if (currentImage) {
      const cardPlayer = createPlayer(canvas);
      cardPlayer.setSheet({
        image: currentImage,
        cellW: sheet.cellWidth,
        cellH: sheet.cellHeight,
        cols: Math.floor(currentImage.naturalWidth / sheet.cellWidth),
      });
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
