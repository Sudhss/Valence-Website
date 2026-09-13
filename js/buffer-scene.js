/* Valence — the buffer.
 *
 * THE IDEA
 * The site makes a specific claim: rendering is O(visible lines), so a
 * 100,000-line file draws exactly as fast as a ten-line one, because the editor
 * only ever paints the viewport. That is the single most important decision in
 * the program and it is invisible in a screenshot.
 *
 * So this draws the whole file — and the file is Valence itself. Four thousand
 * lines of the real C++, every character a quad, tokenized at runtime by
 * js/lexer.js, the port of the editor's own cpp_highlighter.cpp. The page
 * colours Valence's source using Valence's own lexer.
 *
 * Only the band the viewport covers is painted; the rest sits recessed and
 * unlit — present in the buffer, absent from the frame. Scrolling moves the
 * band, and the camera pulls back far enough to show how little of the file is
 * ever being drawn.
 *
 * WHY WEBGL, AND ONLY HERE
 * Well over a hundred thousand glyphs in one draw call. There is no DOM version
 * of that; the count IS the argument. The tokenizer section next to it is DOM,
 * because it is about text you edit, and that should be real text.
 */

import * as THREE from './vendor/three.module.min.js';
import { SOURCE_LINES } from './source-data.js';
import { tokenizeLine } from './lexer.js';
import { buildGlyphAtlas, glyphIndex, ATLAS_COLS, ATLAS_ROWS } from './glyph-atlas.js';

const BAND = 46;                 // lines the viewport covers — the editor's V
const CHAR_W = 0.62;
const LINE_H = 1.15;
const RECESS = -9;               // how far unpainted lines sit back

/* The editor's palette, from src/theme/theme.h, keyed by the token kinds
 * js/lexer.js emits. */
const KIND_COLOR = {
  keyword: 0x56d1ff,
  type: 0x82aaff,
  function: 0x82e787,
  string: 0xc3e88d,
  number: 0xffb74d,
  comment: 0x5c6470,
  punctuation: 0x99a0ad,
  plain: 0xe9ecf1,
};
const DIM = 0x0e1116;

export class BufferScene {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.onReady = opts.onReady;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 500);

    // Scratch and state BEFORE the build: the build paints every glyph dim, and
    // creating these afterwards left setColorAt receiving undefined — which is
    // exactly the bug the slab version shipped with.
    this._col = new THREE.Color();
    this._dim = new THREE.Color(DIM);
    this._clock = new THREE.Clock();
    this._running = false;
    this._lastBand = -1;
    this.progress = 0;
    this.eased = 0;
    this.pointer = { x: 0, y: 0 };
    this.pointerEased = { x: 0, y: 0 };

    this._layout();
    this._build();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });
    this.resize();
    this._paintBand(0, true);
    this.renderOnce();
    this.onReady?.();
  }

  /* One pass over the source: tokenize each line, then record one glyph per
   * non-space character with the colour of the token it belongs to. Runs once,
   * at build. Nothing in here happens per frame. */
  _layout() {
    this.lines = SOURCE_LINES;
    this.lineCount = this.lines.length;

    const glyphs = [];
    this.lineStart = new Int32Array(this.lineCount + 1);
    let inBlockComment = false;

    for (let row = 0; row < this.lineCount; row++) {
      this.lineStart[row] = glyphs.length;
      const text = this.lines[row];
      const res = tokenizeLine(text, inBlockComment);
      inBlockComment = res.inBlockComment;

      for (const tok of res.tokens) {
        const hex = KIND_COLOR[tok.kind] ?? KIND_COLOR.plain;
        for (let k = 0; k < tok.length; k++) {
          const gi = glyphIndex(text[tok.start + k]);
          if (gi < 0) continue;                    // space, and anything unmapped
          glyphs.push({ row, col: tok.start + k, gi, hex });
        }
      }
    }
    this.lineStart[this.lineCount] = glyphs.length;
    this.glyphs = glyphs;
    this.count = glyphs.length;
  }

  _build() {
    this.atlas = buildGlyphAtlas(64);

    const geo = new THREE.PlaneGeometry(CHAR_W * 0.95, LINE_H * 0.8);

    // Per-instance glyph index; the vertex shader turns it into an atlas cell.
    const gid = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) gid[i] = this.glyphs[i].gi;
    geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(gid, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
        uFogColor: { value: new THREE.Color(0x000000) },
        uFogNear: { value: 70 },
        uFogFar: { value: 320 },
      },
      transparent: true,
      // Glyph quads are cut-outs. Writing depth makes each one occlude its
      // neighbours across its whole rectangle, which punches holes in the text.
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aGlyph;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vFogDepth;
        uniform vec2 uGrid;
        void main() {
          float col = mod(aGlyph, uGrid.x);
          float row = floor(aGlyph / uGrid.x);
          // uv.y is flipped: atlas row 0 is the TOP of the canvas.
          vUv = vec2((uv.x + col) / uGrid.x, 1.0 - ((1.0 - uv.y) + row) / uGrid.y);
          vColor = instanceColor;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vFogDepth;
        uniform sampler2D uAtlas;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        void main() {
          float a = texture2D(uAtlas, vUv).a;
          if (a < 0.04) discard;                  // keep the cut-out crisp
          float f = smoothstep(uFogNear, uFogFar, vFogDepth);
          gl_FragColor = vec4(mix(vColor, uFogColor, f), a);
        }`,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One object spanning the entire document; its bounding sphere is useless
    // for culling and would pop the whole file out of view.
    this.mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    for (let i = 0; i < this.count; i++) {
      const g = this.glyphs[i];
      m.identity();
      m.setPosition(g.col * CHAR_W, -g.row * LINE_H, RECESS);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, this._dim);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.scene.add(this.mesh);
  }

  /* Repaints only the lines that entered or left the viewport. Repainting every
   * glyph each frame would be ~150k colour writes for a band of forty-six. */
  _paintBand(topLine, force = false) {
    const prev = this._lastBand;
    if (!force && prev === topLine) return;

    const m = new THREE.Matrix4();
    const touch = (from, to, lit) => {
      from = Math.max(0, from); to = Math.min(this.lineCount - 1, to);
      if (to < from) return;
      const a = this.lineStart[from];
      const b = this.lineStart[to + 1];
      for (let i = a; i < b; i++) {
        const g = this.glyphs[i];
        if (lit) {
          this._col.setHex(g.hex);
          // Fade toward the band edges so the viewport does not end on a
          // hard line across the file.
          const d = Math.min(g.row - topLine, topLine + BAND - g.row) / 7;
          this._col.multiplyScalar(Math.min(1, Math.max(0.2, d)));
        } else {
          this._col.copy(this._dim);
        }
        this.mesh.setColorAt(i, this._col);

        this.mesh.getMatrixAt(i, m);
        m.elements[14] = lit ? 0 : RECESS;        // painted lines come forward
        this.mesh.setMatrixAt(i, m);
      }
    };

    if (!force && prev >= 0 && Math.abs(topLine - prev) < BAND * 3) touch(prev, prev + BAND, false);
    else touch(0, this.lineCount - 1, false);
    touch(topLine, topLine + BAND, true);

    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this._lastBand = topLine;
  }

  setProgress(p) { this.progress = Math.min(1, Math.max(0, p)); }
  setPointer(x, y) { this.pointer.x = x; this.pointer.y = y; }

  get bandInfo() {
    const top = Math.max(0, this._lastBand);
    return {
      first: top + 1,
      last: Math.min(this.lineCount, top + BAND),
      drawn: Math.min(BAND, this.lineCount - top),
      total: this.lineCount,
    };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* At rest the camera sits square to the page and close, so the thing reads as
   * an editor. Scrolling swings it out and back, and the file it was cropping
   * turns out to continue for thousands of lines. Eased toward, never snapped,
   * and it never orbits on its own. */
  _updateCamera(dt) {
    const k = 1 - Math.pow(0.0015, dt);           // frame-rate independent damping
    this.eased += (this.progress - this.eased) * k;
    this.pointerEased.x += (this.pointer.x - this.pointerEased.x) * k;
    this.pointerEased.y += (this.pointer.y - this.pointerEased.y) * k;

    const p = this.eased;
    const topLine = Math.floor(p * Math.max(1, this.lineCount - BAND - 1));
    this._paintBand(topLine);

    const focusX = 20;
    const focusY = -(topLine + BAND / 2) * LINE_H;
    const swing = Math.sin(p * Math.PI);          // out and back across the scroll

    const dist = 30 + swing * 56;
    const angle = swing * 0.78 + this.pointerEased.x * 0.14;
    const lift = swing * 20 + this.pointerEased.y * 3;

    this.camera.position.set(
      focusX + Math.sin(angle) * dist,
      focusY + lift,
      Math.cos(angle) * dist + 10,
    );
    this.camera.lookAt(focusX, focusY - swing * 8, RECESS * 0.5);
  }

  renderOnce() { this.renderer.render(this.scene, this.camera); }

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.getDelta();
    const tick = () => {
      if (!this._running) return;
      const dt = Math.min(this._clock.getDelta(), 0.1);
      this._updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /* Reduced motion still gets the picture, just not the movement. */
  renderStatic() {
    this.progress = 0.3; this.eased = 0.3;
    this._updateCamera(1);
    this.renderOnce();
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.atlas.texture.dispose();
    this.renderer.dispose();
  }
}

/** Returns null when WebGL is unavailable, so the caller can leave the copy in
 *  place rather than showing an empty box. */
export function createBufferScene(canvas, opts) {
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
    return new BufferScene(canvas, opts);
  } catch (err) {
    console.warn('[valence] buffer scene unavailable:', err);
    return null;
  }
}
