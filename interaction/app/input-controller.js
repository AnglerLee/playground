const HOVER_RADIUS = 200;
const PET_TAP_THRESHOLD = 5;
const PET_STEP_PX = 30;
const SCRUB_STEP_PX = 25;

export class InputController {
  constructor({ scene, controller, carePanel, ui }) {
    this.scene = scene;
    this.controller = controller;
    this.carePanel = carePanel;
    this.ui = ui;

    this.petSession = null;
    this.lastPointer = { x: 0, y: 0, hasMoved: false };

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  start() {
    const canvas = this.scene.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  isPettingActive() {
    return !!this.petSession;
  }

  getLastPointer() {
    return { ...this.lastPointer };
  }

  onPointerDown(e) {
    const animal = this.controller.activeAnimal;
    if (!animal) return;
    if (this.carePanel?.isDragging()) return;
    const world = this.scene.toWorld(e.clientX, e.clientY);
    if (animal.hitTest(world.x, world.y)) {
      this.petSession = {
        pointerId: e.pointerId,
        downX: e.clientX,
        downY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        accumPath: 0,
        gainHappy: 0,
        gainClean: 0,
        movedFar: false,
      };
      this.ui.showPetCursor(e.clientX, e.clientY, animal.isBathing());
      return;
    }
    this.controller.dashTo(world.x, world.y);
  }

  onPointerMove(e) {
    this.lastPointer = { x: e.clientX, y: e.clientY, hasMoved: true };
    const animal = this.controller.activeAnimal;
    if (!animal) return;

    if (this.petSession && this.petSession.pointerId === e.pointerId) {
      this.updatePetSession(e, animal);
      return;
    }

    const world = this.scene.toWorld(e.clientX, e.clientY);
    const onAnimal = animal.hitTest(world.x, world.y);
    if (animal.isBathing()) {
      this.ui.showPetCursor(e.clientX, e.clientY, true);
    } else if (onAnimal) {
      this.ui.showPetCursor(e.clientX, e.clientY, false);
    } else {
      this.ui.hidePetCursor();
    }
    const dist = Math.hypot(world.x - animal.x, world.y - animal.y);
    if (dist < HOVER_RADIUS) animal.faceTowards(world.x);
  }

  updatePetSession(e, animal) {
    const dx = e.clientX - this.petSession.lastX;
    const dy = e.clientY - this.petSession.lastY;
    this.petSession.lastX = e.clientX;
    this.petSession.lastY = e.clientY;

    const totalDistance = Math.hypot(e.clientX - this.petSession.downX, e.clientY - this.petSession.downY);
    if (totalDistance >= PET_TAP_THRESHOLD) this.petSession.movedFar = true;

    const world = this.scene.toWorld(e.clientX, e.clientY);
    if (!animal.hitTest(world.x, world.y)) {
      this.ui.hidePetCursor();
      return;
    }

    const isBathing = animal.isBathing();
    this.ui.showPetCursor(e.clientX, e.clientY, isBathing);
    this.petSession.accumPath += Math.hypot(dx, dy);

    const stepPx = isBathing ? SCRUB_STEP_PX : PET_STEP_PX;
    while (this.petSession.accumPath >= stepPx) {
      this.petSession.accumPath -= stepPx;
      if (isBathing) {
        this.controller.applyBathScrub(e.clientX, e.clientY, this.petSession);
      } else {
        this.controller.applyPetStep(e.clientX, e.clientY, this.petSession);
      }
    }
  }

  onPointerUp(e) {
    if (!this.petSession || this.petSession.pointerId !== e.pointerId) return;
    const animal = this.controller.activeAnimal;
    const wasTap = !this.petSession.movedFar;
    const lastX = this.petSession.lastX;
    const lastY = this.petSession.lastY;

    this.petSession = null;
    this.ui.hidePetCursor();

    if (!wasTap || !animal) return;
    const world = this.scene.toWorld(lastX, lastY);
    if (animal.hitTest(world.x, world.y) && !animal.getCurrentCareAction()) {
      this.controller.handleAnimalTap();
    }
  }

  onKeyDown(e) {
    if (e.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (this.carePanel?.isDragging()) return;
    this.controller.handleAnimalTap();
  }
}
