import { loadImage } from './sheet.js';

export function expandSequence(frames, pingpong) {
  if (!pingpong || frames.length <= 2) return frames.slice();
  const out = frames.slice();
  for (let i = frames.length - 2; i > 0; i--) out.push(frames[i]);
  return out;
}

export function createPlayer(canvas) {
  const ctx = canvas.getContext('2d');
  let img = null;
  let cellWidth = 128;
  let cellHeight = 128;
  let columns = 1;
  let sequence = [];
  let fps = 8;
  let loop = true;
  let playing = false;
  let acc = 0;
  let lastTs = 0;
  let cursor = 0;
  let rafId = 0;
  let onStop = null;

  function setSheet({ image, cellW, cellH, cols }) {
    img = image;
    cellWidth = cellW;
    cellHeight = cellH;
    columns = cols;
    canvas.width = cellW;
    canvas.height = cellH;
    drawCurrent();
  }

  function setAnimation({ frames, pingpong, fps: f, loop: l }) {
    sequence = expandSequence(frames, pingpong);
    fps = Math.max(1, f || 8);
    loop = l !== false;
    cursor = 0;
    acc = 0;
    drawCurrent();
  }

  function drawCurrent() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img || sequence.length === 0 || columns <= 0) return;
    const idx = sequence[Math.min(cursor, sequence.length - 1)];
    const c = idx % columns;
    const r = Math.floor(idx / columns);
    ctx.drawImage(
      img,
      c * cellWidth, r * cellHeight, cellWidth, cellHeight,
      0, 0, canvas.width, canvas.height,
    );
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    acc += dt;
    const frameDur = 1 / fps;
    while (acc >= frameDur) {
      acc -= frameDur;
      cursor++;
      if (cursor >= sequence.length) {
        if (loop) {
          cursor = 0;
        } else {
          cursor = sequence.length - 1;
          playing = false;
          drawCurrent();
          if (onStop) onStop();
          return;
        }
      }
    }
    drawCurrent();
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (sequence.length === 0) return;
    playing = true;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(rafId);
  }
  function stop() {
    pause();
    cursor = 0;
    drawCurrent();
  }
  function isPlaying() { return playing; }

  function setStopHandler(fn) { onStop = fn; }

  return { setSheet, setAnimation, play, pause, stop, drawCurrent, isPlaying, setStopHandler };
}

export async function ensureImage(src) {
  if (!src) return null;
  return loadImage(src);
}
