import { loadImage, anchorOf } from './sheet.js';

export function expandSequence(frames, pingpong) {
  if (!pingpong || frames.length <= 2) return frames.slice();
  const out = frames.slice();
  for (let i = frames.length - 2; i > 0; i--) out.push(frames[i]);
  return out;
}

export function computeEnvelope(frames, anchorMode) {
  let leftPad = 0, rightPad = 0, topPad = 0, bottomPad = 0;
  for (const f of frames) {
    const a = anchorOf(f, anchorMode);
    if (a.ax > leftPad) leftPad = a.ax;
    if (f.w - a.ax > rightPad) rightPad = f.w - a.ax;
    if (a.ay > topPad) topPad = a.ay;
    if (f.h - a.ay > bottomPad) bottomPad = f.h - a.ay;
  }
  return {
    leftPad, rightPad, topPad, bottomPad,
    width: Math.max(1, Math.ceil(leftPad + rightPad)),
    height: Math.max(1, Math.ceil(topPad + bottomPad)),
  };
}

export function createPlayer(canvas) {
  const ctx = canvas.getContext('2d');
  let img = null;
  let envelope = null;
  let anchorMode = 'bottom-center';
  let sequence = [];
  let fps = 8;
  let loop = true;
  let playing = false;
  let acc = 0;
  let lastTs = 0;
  let cursor = 0;
  let rafId = 0;
  let onStop = null;

  function setSheet({ image }) {
    img = image;
    drawCurrent();
  }

  function setAnimation(anim) {
    sequence = expandSequence(anim.frames || [], anim.pingpong);
    fps = Math.max(1, anim.fps || 8);
    loop = anim.loop !== false;
    anchorMode = anim.anchorMode || 'bottom-center';
    cursor = 0;
    acc = 0;
    if (sequence.length) {
      envelope = computeEnvelope(sequence, anchorMode);
      canvas.width = envelope.width;
      canvas.height = envelope.height;
    } else {
      envelope = null;
      canvas.width = 1;
      canvas.height = 1;
    }
    drawCurrent();
  }

  function drawCurrent() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img || sequence.length === 0 || !envelope) return;
    const f = sequence[Math.min(cursor, sequence.length - 1)];
    const a = anchorOf(f, anchorMode);
    const dx = envelope.leftPad - a.ax;
    const dy = envelope.topPad - a.ay;
    ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
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
  function pause() { playing = false; cancelAnimationFrame(rafId); }
  function stop() { pause(); cursor = 0; drawCurrent(); }
  function isPlaying() { return playing; }
  function setStopHandler(fn) { onStop = fn; }

  return { setSheet, setAnimation, play, pause, stop, drawCurrent, isPlaying, setStopHandler };
}

export async function ensureImage(src) {
  if (!src) return null;
  return loadImage(src);
}
