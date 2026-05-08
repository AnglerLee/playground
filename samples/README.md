# Playback Sample

This folder contains a minimal, framework-free reference for consuming the
JSON files produced by the controller's **Export JSON** button.

- [`playback.js`](./playback.js) — runnable reference player. Pure ES module,
  no dependencies, written so the algorithm translates 1:1 to other engines.
- [`index.html`](./index.html) — live demo. Open it from a local server
  (`python3 -m http.server` from the repo root, then visit `/samples/`).
- [`example.json`](./example.json) — small example for `cat.png`.

## Schema

Exported documents are valid JSON of schema **version 4**. In TypeScript:

```ts
type Anchor = 'bottom-center' | 'bbox-center' | 'top-center' | 'centroid';

interface Frame {
  x: number;   // top-left X in image pixels
  y: number;   // top-left Y in image pixels
  w: number;   // width  in pixels
  h: number;   // height in pixels
  cx?: number; // pixel-weighted centroid X (image space) — used by 'centroid'
  cy?: number; // pixel-weighted centroid Y (image space)
}

interface Animation {
  id: string;
  kind: 'grid' | 'freepick'; // authoring origin; runtime can ignore
  name: string;
  fps: number;
  loop: boolean;
  pingpong: boolean;
  anchorMode: Anchor;
  frames: Frame[];
}

interface Sheet {
  src: string;            // image URL, relative path, or data: URL
  cellWidth: number;      // grid cell W (informational)
  cellHeight: number;     // grid cell H (informational)
  mode: 'grid' | 'freepick';
  anchorMode: Anchor;     // sheet default
  animations: Animation[];
}

interface ExportedDocument {
  version: 4;
  sheets: Record<string, Sheet>; // exports contain exactly one entry
}
```

Notes:
- Frames are always rectangles in image pixels regardless of `kind`. A
  consumer does not need to distinguish `grid` from `freepick`; the
  drawing/anchoring logic is the same.
- `cellWidth` / `cellHeight` are kept for round-tripping with the editor and
  are unused at playback.
- Animations carry their own `anchorMode` so playback is independent of the
  sheet default.

## Algorithm

For an animation with frames `F[0..N-1]`:

```
1. Compute per-frame anchor (ax, ay) in the frame's local coordinates:
     bottom-center: (w/2, h)
     bbox-center  : (w/2, h/2)
     top-center   : (w/2, 0)
     centroid     : (cx - x, cy - y)        // requires cx, cy

2. Envelope canvas size, anchored at a single common point:
     leftPad   = max(ax_i)
     rightPad  = max(w_i - ax_i)
     topPad    = max(ay_i)
     bottomPad = max(h_i - ay_i)
     canvas    = (leftPad + rightPad) x (topPad + bottomPad)

3. Draw frame i at:
     dst = (leftPad - ax_i, topPad - ay_i)
   The anchor lands at (leftPad, topPad) for every frame, so frames of
   different sizes do not jitter.

4. If `pingpong`, expand the sequence to:
     [F0, F1, ..., Fn-1, Fn-2, ..., F1]

5. Step the cursor every (1 / fps) seconds. Stop on the last frame if
   `loop` is false.
```

## Porting to other platforms

The math is trivial and the only library calls a runtime needs are:

- read JSON
- decode an image (the same one referenced by `sheet.src`)
- a blit / draw-image with source rectangle
- a frame timer

Sketch in language-agnostic pseudocode:

```
Anchor anchorOf(Frame f, AnchorMode m):
  match m:
    bottom-center -> (f.w/2, f.h)
    bbox-center   -> (f.w/2, f.h/2)
    top-center    -> (f.w/2, 0)
    centroid      -> (f.cx - f.x, f.cy - f.y)

Envelope envelopeOf(Frame[] frames, AnchorMode m):
  L = R = T = B = 0
  for f in frames:
    (ax, ay) = anchorOf(f, m)
    L = max(L, ax)
    R = max(R, f.w - ax)
    T = max(T, ay)
    B = max(B, f.h - ay)
  return (L, R, T, B, L+R, T+B)

void drawFrame(Image img, Frame f, AnchorMode m, Envelope e, Surface dst):
  (ax, ay) = anchorOf(f, m)
  blit(img,
       src = (f.x, f.y, f.w, f.h),
       dst = (e.leftPad - ax, e.topPad - ay))
```

Concrete mappings:

| Engine                | Image type        | Blit call                                      |
| --------------------- | ----------------- | ---------------------------------------------- |
| HTML5 Canvas (here)   | `HTMLImageElement`| `ctx.drawImage(img, sx,sy,sw,sh, dx,dy,sw,sh)` |
| Phaser 3              | `Phaser.Texture`  | `scene.add.image(x,y,texKey).setCrop(...)`     |
| Pixi.js               | `PIXI.Texture`    | `new PIXI.Texture(base, new Rect(...))`        |
| Unity                 | `Texture2D`       | `Sprite.Create(tex, new Rect(...), pivot)`     |
| Godot                 | `AtlasTexture`    | `region = Rect2(...)` on `AtlasTexture`        |
| Cocos2d-x             | `cc.SpriteFrame`  | `SpriteFrame::create(name, Rect(...))`         |
| SDL2 / raylib (C/C++) | `SDL_Texture`     | `SDL_RenderCopy(rend, tex, &src, &dst)`        |

The anchor point usually maps to the engine's pivot/origin: store
`(ax / w, ay / h)` as the normalized pivot so the engine handles alignment
natively.

## Quick usage (browser, ES modules)

```js
import { loadDocument, createPlayer } from './playback.js';

const { sheet, image } = await loadDocument('./my-export.json');
const canvas = document.querySelector('canvas');
const player = createPlayer(canvas, image, sheet.animations[0]);
player.play();
```
