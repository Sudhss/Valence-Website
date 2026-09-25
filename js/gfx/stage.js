/* One WebGL context for the whole page.
 *
 * Every 3D view is a rectangle of a single fixed, full-window canvas that sits
 * behind the page. Each frame, each view whose placeholder element is on
 * screen is drawn into exactly that rectangle with viewport + scissor. One
 * context, one set of shaders and textures, however many views the page has --
 * instead of five canvases each paying for their own.
 */

import * as THREE from "three";

export const BASE = 0x0b0c10;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(BASE, 1);
    this.renderer.autoClear = false;
    this.views = [];
    this.running = false;
    this.clock = 0;
    this.fps = 0;
    this._frames = 0;
    this._fpsAt = performance.now();
    this._dirty = true;
    this._frame = this._frame.bind(this);
    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    this._resize();
    document.addEventListener("visibilitychange", () => (document.hidden ? this.stop() : this.start()));
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.stop();
      this.onContextLost?.();
    });
  }

  /** view: { el, scene, camera, update(dt, rect, stage), visible } */
  add(view) {
    this.views.push(view);
    return view;
  }

  _resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this._dirty = true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  _frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.clock += dt;
    this.render(dt);
    this._frames += 1;
    if (now - this._fpsAt > 500) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsAt));
      this._frames = 0;
      this._fpsAt = now;
    }
    requestAnimationFrame(this._frame);
  }

  /** Draw one frame. Exposed so tests and captures can drive frames directly. */
  render(dt) {
    const r = this.renderer;
    const visible = [];
    for (const view of this.views) {
      const rect = view.el.getBoundingClientRect();
      const on = rect.bottom > 0 && rect.top < this.height && rect.right > 0 && rect.left < this.width && rect.width > 0;
      if (view.visible !== on) {
        view.visible = on;
        view.onVisibility?.(on);
      }
      if (on) visible.push([view, rect]);
    }
    if (!visible.length && !this._dirty) return;
    this._dirty = visible.length > 0;

    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    for (const [view, rect] of visible) {
      view.update?.(dt, rect, this);
      const x = rect.left;
      const y = this.height - rect.bottom;
      r.setViewport(x, y, rect.width, rect.height);
      const sx = Math.max(0, x);
      const sy = Math.max(0, y);
      r.setScissor(sx, sy, Math.min(this.width, x + rect.width) - sx, Math.min(this.height, y + rect.height) - sy);
      if (view.camera.isPerspectiveCamera) {
        const aspect = rect.width / Math.max(1, rect.height);
        if (Math.abs(view.camera.aspect - aspect) > 1e-4) {
          view.camera.aspect = aspect;
          view.camera.updateProjectionMatrix();
        }
      }
      r.render(view.scene, view.camera);
    }
  }

  /** Pixel ratio-aware size of one screen pixel at distance d for a camera. */
  static pixelAt(camera, rectHeight, distance) {
    return (2 * Math.tan((camera.fov * Math.PI) / 360) * distance) / Math.max(1, rectHeight);
  }
}

export function webgl2Available() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}
