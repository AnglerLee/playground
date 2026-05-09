export class Scene {
  constructor(canvas, bubbleLayer) {
    this.canvas = canvas;
    this.bubbleLayer = bubbleLayer;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.activeAnimal = null;
    this.lastTs = 0;
    this.running = false;

    this._tick = this._tick.bind(this);
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cssWidth = w;
    this.cssHeight = h;
    this.dpr = dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    if (this.activeAnimal) {
      const wb = this.world();
      this.activeAnimal.x = Math.max(wb.left, Math.min(wb.right, this.activeAnimal.x));
      this.activeAnimal.y = Math.max(wb.top, Math.min(wb.bottom, this.activeAnimal.y));
      this.activeAnimal.layoutBubble();
    }
  }

  world() {
    const padX = Math.min(80, this.cssWidth * 0.08);
    return {
      left: padX,
      right: this.cssWidth - padX,
      top: this.cssHeight * 0.20,
      bottom: this.cssHeight * 0.88,
    };
  }

  setActive(animal) {
    if (this.activeAnimal && this.activeAnimal !== animal) {
      this.activeAnimal.destroy();
    }
    this.activeAnimal = animal;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    requestAnimationFrame(this._tick);
  }

  _tick(ts) {
    if (!this.running) return;
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;

    if (this.activeAnimal) this.activeAnimal.update(dt);
    this._draw();
    requestAnimationFrame(this._tick);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (this.activeAnimal) this.activeAnimal.draw(ctx);
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
}
