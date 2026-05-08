import { serialize, applyLoaded, SCHEMA_VERSION, migrate } from './state.js';

export async function fetchManifest(url = 'images/manifest.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.map(normalizeManifestEntry).filter(Boolean);
  } catch (err) {
    console.warn('manifest fetch failed:', err);
    return [];
  }
}

function normalizeManifestEntry(entry) {
  if (typeof entry === 'string') {
    const name = entry.replace(/\.[^.]+$/, '');
    return { name, src: `images/${entry}`, cellWidth: 0, cellHeight: 0 };
  }
  if (entry && typeof entry === 'object' && entry.src) {
    const src = /^(https?:|data:|\/|images\/)/.test(entry.src)
      ? entry.src
      : `images/${entry.src}`;
    const name = entry.name || src.split('/').pop().replace(/\.[^.]+$/, '');
    return {
      name,
      src,
      cellWidth: Number(entry.cellWidth) || 0,
      cellHeight: Number(entry.cellHeight) || 0,
    };
  }
  return null;
}

export function readImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function downloadJSON(filename = 'sprite-animations.json') {
  const data = serialize();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function validateImported(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid JSON.';
  if (payload.version && Number(payload.version) > SCHEMA_VERSION) {
    return `Unsupported version: ${payload.version}`;
  }
  if (!payload.sheets || typeof payload.sheets !== 'object') return 'Missing sheets.';
  return null;
}

export function importPayload(payload, { merge = true } = {}) {
  applyLoaded(migrate(payload), { merge });
}

export function uniqueSheetName(state, base) {
  let name = base;
  let n = 2;
  while (state.sheets[name]) {
    name = `${base} (${n})`;
    n++;
  }
  return name;
}
