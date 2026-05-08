// Reference player for sprite-animator JSON exports.
//
// Schema version: 4.
// This module is intentionally framework-free and dependency-free: it works
// in any browser/runtime that has a 2D <canvas> context, and the algorithm
// translates directly to other platforms (Unity, Godot, Phaser, native C++
// with SDL/raylib, etc).
//
// Algorithm:
//   1. For each frame F compute its anchor (ax, ay) in the frame's local
//      coordinates from `animation.anchorMode`. The anchor is the point
//      that will stay fixed across frames during playback.
//        bottom-center: (w/2, h)        // characters standing on a floor
//        bbox-center:   (w/2, h/2)      // floating effects, projectiles
//        top-center:    (w/2, 0)
//        centroid:      (cx - x, cy - y) // mass center (pixel-weighted)
//   2. Envelope canvas:
//        leftPad   = max(ax_i)
//        rightPad  = max(w_i - ax_i)
//        topPad    = max(ay_i)
//        bottomPad = max(h_i - ay_i)
//        canvas    = (leftPad + rightPad) x (topPad + bottomPad)
//   3. Frame i is drawn at (leftPad - ax_i, topPad - ay_i). The anchor
//      lands at (leftPad, topPad) for every frame.
//   4. If `pingpong` is true the sequence [F0..Fn-1] is expanded to
//      [F0..Fn-1, Fn-2..F1] before iterating.
//   5. Step the cursor by 1 every (1 / fps) seconds. If `loop` is false,
//      stop on the last frame.
//
// Type definitions (see README.md for TypeScript form):
//
// @typedef {'bottom-center'|'bbox-center'|'top-center'|'centroid'} Anchor
//
// @typedef {Object} Frame
// @property {number} x   Top-left X in image pixels
// @property {number} y   Top-left Y in image pixels
// @property {number} w   Width in pixels
// @property {number} h   Height in pixels
// @property {number} [cx] Pixel-weighted centroid X (image space). Used only
//                         when anchorMode === 'centroid'.
// @property {number} [cy] Pixel-weighted centroid Y (image space).
//
// @typedef {Object} Animation
// @property {string} id
// @property {'grid'|'freepick'} kind  Authoring origin; runtime-irrelevant.
// @property {string} name
// @property {number} fps
// @property {boolean} loop
// @property {boolean} pingpong
// @property {Anchor} anchorMode
// @property {Frame[]} frames
//
// @typedef {Object} Sheet
// @property {string} src              Image URL or data URL
// @property {number} cellWidth        Informational
// @property {number} cellHeight       Informational
// @property {'grid'|'freepick'} mode  Authoring mode
// @property {Anchor} anchorMode       Sheet default
// @property {Animation[]} animations
//
// @typedef {Object} Document
// @property {number} version          Currently 4
// @property {Object<string, Sheet>} sheets

/**
 * @param {Frame} frame
 * @param {Anchor} mode
 * @returns {{ ax: number, ay: number }}
 */
export function anchorOf(frame, mode) {
  const w = frame.w, h = frame.h;
  switch (mode) {
    case 'bbox-center': return { ax: w / 2, ay: h / 2 };
    case 'top-center':  return { ax: w / 2, ay: 0 };
    case 'centroid':
      if (Number.isFinite(frame.cx) && Number.isFinite(frame.cy)) {
        return { ax: frame.cx - frame.x, ay: frame.cy - frame.y };
      }
      return { ax: w / 2, ay: h / 2 };
    case 'bottom-center':
    default:            return { ax: w / 2, ay: h };
  }
}

/**
 * Expand the frame array with pingpong if requested.
 * @param {Frame[]} frames
 * @param {boolean} pingpong
 * @returns {Frame[]}
 */
export function expandSequence(frames, pingpong) {
  if (!pingpong || frames.length <= 2) return frames.slice();
  const out = frames.slice();
  for (let i = frames.length - 2; i > 0; i--) out.push(frames[i]);
  return out;
}

/**
 * Compute the canvas envelope that fits every frame anchored at a common point.
 * @param {Frame[]} frames
 * @param {Anchor} mode
 */
export function computeEnvelope(frames, mode) {
  let leftPad = 0, rightPad = 0, topPad = 0, bottomPad = 0;
  for (const f of frames) {
    const { ax, ay } = anchorOf(f, mode);
    if (ax > leftPad) leftPad = ax;
    if (f.w - ax > rightPad) rightPad = f.w - ax;
    if (ay > topPad) topPad = ay;
    if (f.h - ay > bottomPad) bottomPad = f.h - ay;
  }
  return {
    leftPad, rightPad, topPad, bottomPad,
    width: Math.max(1, Math.ceil(leftPad + rightPad)),
    height: Math.max(1, Math.ceil(topPad + bottomPad)),
  };
}

/**
 * Draw a single frame onto the canvas, anchor-aligned.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} image
 * @param {Frame} frame
 * @param {Anchor} mode
 * @param {ReturnType<typeof computeEnvelope>} envelope
 */
export function drawFrame(ctx, image, frame, mode, envelope) {
  const { ax, ay } = anchorOf(frame, mode);
  const dx = envelope.leftPad - ax;
  const dy = envelope.topPad - ay;
  ctx.clearRect(0, 0, envelope.width, envelope.height);
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, dx, dy, frame.w, frame.h);
}

/**
 * Load an image as a Promise<HTMLImageElement>.
 * @param {string} url
 */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Build a player that renders an animation onto the given canvas.
 * The canvas is resized to the envelope of the animation.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasImageSource} image
 * @param {Animation} animation
 * @returns {{ play(): void, pause(): void, stop(): void, isPlaying(): boolean }}
 */
export function createPlayer(canvas, image, animation) {
  const ctx = canvas.getContext('2d');
  const sequence = expandSequence(animation.frames, animation.pingpong);
  const envelope = computeEnvelope(sequence, animation.anchorMode);
  canvas.width = envelope.width;
  canvas.height = envelope.height;

  const frameDur = 1000 / Math.max(1, animation.fps);
  let cursor = 0;
  let acc = 0;
  let lastTs = 0;
  let rafId = 0;
  let playing = false;

  function render() {
    if (sequence.length === 0) return;
    drawFrame(ctx, image, sequence[cursor], animation.anchorMode, envelope);
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    acc += ts - lastTs;
    lastTs = ts;
    while (acc >= frameDur) {
      acc -= frameDur;
      cursor++;
      if (cursor >= sequence.length) {
        if (animation.loop) {
          cursor = 0;
        } else {
          cursor = sequence.length - 1;
          playing = false;
          render();
          return;
        }
      }
    }
    render();
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (playing || sequence.length === 0) return;
    playing = true;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }
  function pause() { playing = false; cancelAnimationFrame(rafId); }
  function stop() { pause(); cursor = 0; render(); }
  function isPlaying() { return playing; }

  render();
  return { play, pause, stop, isPlaying };
}

/**
 * Convenience: load a JSON document and resolve its sheet image.
 * Returns the first sheet (export files contain exactly one).
 *
 * @param {string} jsonUrl
 * @returns {Promise<{ name: string, sheet: Sheet, image: HTMLImageElement }>}
 */
export async function loadDocument(jsonUrl) {
  const res = await fetch(jsonUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${jsonUrl}: ${res.status}`);
  /** @type {Document} */
  const doc = await res.json();
  if (!doc.sheets) throw new Error('Missing sheets in document');
  const [name, sheet] = Object.entries(doc.sheets)[0] || [];
  if (!sheet) throw new Error('Document has no sheet');
  const imageUrl = new URL(sheet.src, new URL(jsonUrl, location.href)).toString();
  const image = await loadImage(imageUrl);
  return { name, sheet, image };
}
