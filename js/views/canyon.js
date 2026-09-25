/* The canyon: every line of Valence's source, flown through.
 *
 * All 6,586 lines of src/, tokenized in the page by the port of
 * cpp_highlighter.cpp and drawn as one instanced glyph field -- one quad per
 * character, a couple of hundred thousand of them, one draw call. The floor
 * of the canyon is the code; long lines climb its walls; each file's own line
 * numbers run up the left wall as a gutter.
 *
 * The lit band is the viewport. Valence paints only the rows on screen, and
 * so does this: inside the band glyphs stand up at full colour, outside it
 * they sink back and go dark. Scrolling the page moves the band through the
 * file, and at the end the whole buffer folds into columns so you can see how
 * little of it is ever painted.
 *
 * Before any of that, the same glyphs build the name. About fourteen thousand
 * of them -- real characters from the source, in their token colours --
 * gather into the letters of "Valence", and scatter out of the cursor's way as
 * it passes. Scrolling lets them go: they fall back to their own lines and the
 * name becomes the file it was made of.
 *
 * Glyph positions are computed on the GPU from (column, line), so moving the
 * band, the camera, the fold or the name costs a handful of uniforms a frame.
 */

import * as THREE from "three";
import { SOURCE_LINES, SOURCE_FILES } from "../data/source.js";
import { tokenize } from "../core/lexer.js";
import { glyphIndex, TOKEN_COLORS, FOG_GLSL, fogUniforms, damp } from "../gfx/atlas.js";

export const BAND = 46;
const CW = 0.6; // column width
const LH = 1.0; // line height
const CENTER_COL = 30;
const FOLD_ROWS = 700;
// GLSL needs float literals: 1.0 must not print as 1.
const glf = (n) => Number(n).toFixed(4);
const GUTTER_KIND = 9;
const WORD_GLYPHS = 14000;
const WORD_W = 64;
const WORD_Y = 33;
const WORD_Z = -40;

const VERTEX = /* glsl */ `
  attribute vec4 aData;       // column, line, glyph, kind
  attribute vec4 aHome;       // wordmark position; w = 1 if this glyph builds the name
  uniform float uForm;        // 1 the name, 0 the file
  uniform vec3 uMouse;
  uniform float uMouseOn;
  uniform float uBand;        // first painted line
  uniform float uFold;        // 0 canyon, 1 folded into columns
  uniform float uTime;
  uniform float uTotal;
  uniform float uCols;
  uniform float uFlat;
  uniform float uWall;
  varying vec2 vUv;
  varying float vKind;
  varying float vLit;
  varying float vDepth;
  varying float vAlpha;

  float wallY(float x) {
    float d = max(0.0, abs(x) - uFlat);
    return uWall * d * d;
  }

  void main() {
    float col = aData.x;
    float line = aData.y;
    float lit = smoothstep(uBand - 1.2, uBand, line) * (1.0 - smoothstep(uBand + ${glf(BAND)}, uBand + ${glf(BAND)} + 1.2, line));

    // Canyon placement: code on the floor, long lines up the walls.
    float x = (col - ${glf(CENTER_COL)}) * ${glf(CW)};
    float y = wallY(x);
    float slope = 2.0 * uWall * max(0.0, abs(x) - uFlat) * sign(x);
    vec3 tangent = normalize(vec3(1.0, slope, 0.0));
    vec3 canyon = vec3(x, y, -line * ${glf(LH)});
    canyon.y += lit * 0.18 - (1.0 - lit) * 0.25;

    // Folded placement: the buffer in newspaper columns, flat.
    float c = floor(line / ${glf(FOLD_ROWS)});
    float r = line - c * ${glf(FOLD_ROWS)};
    float colW = 124.0 * ${glf(CW)};
    vec3 folded = vec3((c - (uCols - 1.0) * 0.5) * colW + (col - 58.0) * ${glf(CW)}, 0.0, (r - ${glf(FOLD_ROWS)} * 0.5) * ${glf(LH)});
    folded.y += lit * 1.2;

    // The fold travels through the file rather than happening all at once.
    float t = smoothstep(0.0, 1.0, clamp(uFold * 1.7 - (line / uTotal) * 0.7, 0.0, 1.0));
    vec3 p = mix(canyon, folded, t);
    vec3 u = normalize(mix(tangent, vec3(1.0, 0.0, 0.0), t)) * ${glf(CW)};
    vec3 v = vec3(0.0, 0.0, -${glf(CW * 2)});

    // The name: glyphs gather into the letters, breathe a little, and part
    // around the cursor. The rest fade while it forms.
    float h = fract(sin(dot(aData.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float w = smoothstep(0.0, 1.0, clamp(uForm * 1.6 - h * 0.6, 0.0, 1.0));
    float inWord = aHome.w;
    vec3 home = aHome.xyz;
    home.z += sin(uTime * 0.9 + h * 6.2832) * 0.3;
    vec2 d = home.xy - uMouse.xy;
    float push = uMouseOn * exp(-dot(d, d) / 16.0) * 3.4;
    home.xy += normalize(d + vec2(1e-4)) * push;
    home.z += push * 2.0;
    float k = w * inWord;
    p = mix(p, home, k);
    u = mix(u, vec3(${glf(CW * 0.46)}, 0.0, 0.0), k);
    v = mix(v, vec3(0.0, ${glf(CW * 0.92)}, 0.0), k);
    vAlpha = mix(1.0, inWord, w);
    lit = max(lit, k);

    vec3 world = p + position.x * u + position.y * v;
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = vAlpha < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;

    float g = aData.z;
    float gc = mod(g, 16.0);
    float gr = floor(g / 16.0);
    vUv = (vec2(gc, gr) + vec2(position.x + 0.5, 0.5 - position.y)) / vec2(16.0, 7.0);
    vKind = aData.w;
    vLit = lit;
    vDepth = -mv.z;
  }
`;

const FRAGMENT = /* glsl */ `
  ${FOG_GLSL}
  uniform sampler2D uAtlas;
  uniform vec3 uColors[11];
  uniform float uDark;
  varying vec2 vUv;
  varying float vKind;
  varying float vLit;
  varying float vDepth;
  varying float vAlpha;
  void main() {
    float a = texture2D(uAtlas, vUv).a * vAlpha;
    if (a < 0.08) discard;
    vec3 c = uColors[int(vKind + 0.5)];
    float bright = mix(uDark, 1.0, vLit);
    c *= bright;
    c += c * vLit * 0.25;
    gl_FragColor = vec4(fogged(c, vDepth), a * mix(0.75, 1.0, vLit));
    #include <colorspace_fragment>
  }
`;

export function createCanyon(stage, atlas, el) {
  // ---- build the static glyph field -------------------------------------
  const data = [];
  const state = { inBlockComment: false };
  let fileIndex = 0;
  SOURCE_LINES.forEach((line, n) => {
    while (fileIndex < SOURCE_FILES.length - 1 && n >= SOURCE_FILES[fileIndex].start + SOURCE_FILES[fileIndex].lines) {
      fileIndex += 1;
      state.inBlockComment = false; // a new file starts outside any comment
    }
    const file = SOURCE_FILES[fileIndex];
    // Gutter: the file's own line number, right-aligned up the left wall.
    const num = String(n - file.start + 1);
    for (let i = 0; i < num.length; i += 1) {
      data.push(-7 + i - num.length + 1, n, glyphIndex(num[i]), GUTTER_KIND);
    }
    for (const t of tokenize(line, state)) {
      for (let i = t.start; i < t.start + t.length; i += 1) {
        const ch = line[i];
        if (ch === " ") continue;
        data.push(i, n, glyphIndex(ch), t.type);
      }
    }
  });
  const count = data.length / 4;

  // ---- the name ---------------------------------------------------------------
  // Draw "Valence" once, offscreen, and give each chosen glyph a filled pixel.
  const home = new Float32Array(count * 4);
  const word = document.createElement("canvas");
  word.width = 1600;
  word.height = 380;
  const wctx = word.getContext("2d");
  wctx.fillStyle = "#fff";
  wctx.textAlign = "center";
  wctx.textBaseline = "middle";
  wctx.font = '800 330px "JetBrains Mono", Consolas, monospace';
  wctx.fillText("Valence", word.width / 2, word.height / 2 + 10);
  const px = wctx.getImageData(0, 0, word.width, word.height).data;
  const filled = [];
  for (let y = 0; y < word.height; y += 2) {
    for (let x = 0; x < word.width; x += 2) if (px[(y * word.width + x) * 4 + 3] > 140) filled.push(x, y);
  }
  let seed = 20260926;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const chance = WORD_GLYPHS / count;
  for (let i = 0; i < count; i += 1) {
    if (rand() >= chance || !filled.length) continue;
    const j = Math.floor(rand() * (filled.length / 2)) * 2;
    home[i * 4] = (filled[j] / word.width - 0.5) * WORD_W;
    home[i * 4 + 1] = WORD_Y + (0.5 - filled[j + 1] / word.height) * WORD_W * (word.height / word.width);
    home[i * 4 + 2] = WORD_Z + (rand() - 0.5) * 1.2;
    home[i * 4 + 3] = 1;
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.attributes.position);
  geometry.setAttribute("aData", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
  geometry.setAttribute("aHome", new THREE.InstancedBufferAttribute(home, 4));
  geometry.instanceCount = count;

  const colors = [...TOKEN_COLORS.map((c) => c.clone()), new THREE.Color("#4a4e57"), new THREE.Color("#9aa0a8")];
  const fog = fogUniforms(40, 150);
  const uniforms = {
    ...fog,
    uAtlas: { value: atlas },
    uColors: { value: colors },
    uBand: { value: 0 },
    uFold: { value: 0 },
    uTime: { value: 0 },
    uTotal: { value: SOURCE_LINES.length },
    uCols: { value: Math.ceil(SOURCE_LINES.length / FOLD_ROWS) },
    uFlat: { value: 9 },
    uWall: { value: 0.045 },
    uDark: { value: 0.16 },
    uForm: { value: 1 },
    uMouse: { value: new THREE.Vector3(0, -999, 0) },
    uMouseOn: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  // The caret: Valence's teal bar with its glow, at the start of the band.
  const caretMat = new THREE.MeshBasicMaterial({ color: 0x2fe0a0, transparent: true });
  const caret = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, LH * 0.9), caretMat);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x2fe0a0, transparent: true, opacity: 0.25, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, LH * 0.94), glowMat);
  // The current-line wash across the canyon floor.
  const washMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.035, depthWrite: false });
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(90, LH), washMat);
  wash.rotation.x = -Math.PI / 2;

  const scene = new THREE.Scene();
  scene.add(mesh, wash, glow, caret);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 4000);

  const total = SOURCE_LINES.length;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = {
    el,
    scene,
    camera,
    progress: 0,
    mouseTarget: false,
    cam: { line: 0, fold: 0 },
    band: 0,
    glyphs: count,
    fileAt(line) {
      let lo = 0;
      let hi = SOURCE_FILES.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (SOURCE_FILES[mid].start <= line) lo = mid;
        else hi = mid - 1;
      }
      return SOURCE_FILES[lo];
    },
    update(dt, rect, s) {
      const p = view.progress;
      const snap = reduced || view.snapNext;
      view.snapNext = false;
      const ease = (target, current, rate) => current + (target - current) * (snap ? 1 : damp(rate, dt));
      // Short and quick: the name lets go in the first fifth of the scroll, the
      // flight covers the whole file in the next half, then the fold.
      const form = 1 - THREE.MathUtils.smoothstep(p, 0.03, 0.22);
      const leave = THREE.MathUtils.smoothstep(p, 0.05, 0.26);
      const fly = THREE.MathUtils.smoothstep(p, 0.26, 0.78);
      const fold = THREE.MathUtils.smoothstep(p, 0.8, 0.95);
      view.cam.line = ease(fly * (total - BAND - 20), view.cam.line, 7);
      view.cam.fold = ease(fold, view.cam.fold, 5);
      view.cam.form = ease(form, view.cam.form ?? 1, 5);
      view.cam.leave = ease(leave, view.cam.leave ?? 0, 5);
      view.mouseOn = ease(view.mouseTarget && view.cam.form > 0.3 ? 1 : 0, view.mouseOn || 0, 6);

      const line = view.cam.line;
      view.band = Math.min(total - BAND, Math.floor(line + 3));
      uniforms.uBand.value = line + 3;
      uniforms.uFold.value = view.cam.fold;
      uniforms.uForm.value = view.cam.form;
      uniforms.uMouseOn.value = view.mouseOn;
      uniforms.uTime.value = s.clock;

      // Camera: facing the name, then low over the floor looking down the
      // canyon, then high over the whole folded buffer.
      const f = view.cam.fold;
      const z = -line * LH;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const heroDist = Math.max(62, (WORD_W / 2 + 2) / (tanHalf * camera.aspect));
      // Aim below the name so it sits in the upper part of the frame, clear
      // of the hero text anchored to the bottom.
      const lift = 2 * heroDist * tanHalf * (camera.aspect < 1 ? 0.3 : 0.25);
      const heroPos = new THREE.Vector3(0, WORD_Y - lift, WORD_Z + heroDist);
      const heroLook = new THREE.Vector3(0, WORD_Y - lift, WORD_Z);
      const flyPos = new THREE.Vector3(0.5, 6.2, z + 9);
      const flyLook = new THREE.Vector3(0, 0, z - 30);
      const bandFold = foldedPosition(line + 3 + BAND / 2);
      const overPos = new THREE.Vector3(bandFold.x * 0.2, 720, 300);
      const overLook = new THREE.Vector3(bandFold.x * 0.25, 0, -40);
      const l = view.cam.leave;
      const le = l * l * (3 - 2 * l);
      const e = f * f * (3 - 2 * f);
      const pos = new THREE.Vector3().lerpVectors(heroPos, flyPos, le).lerp(overPos, e);
      const look = new THREE.Vector3().lerpVectors(heroLook, flyLook, le).lerp(overLook, e);
      camera.position.copy(pos);
      camera.lookAt(look);
      camera.far = 5000;
      camera.updateProjectionMatrix();
      view.heroCamera = { dist: heroDist };
      fog.uFogNear.value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(80, 40, le), 1200, e);
      fog.uFogFar.value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(260, 150, le), 3000, e);
      uniforms.uDark.value = THREE.MathUtils.lerp(0.16, 0.36, e);

      // Caret and current-line wash ride the band's first line on the floor.
      const caretLine = line + 3;
      const cz = -caretLine * LH - LH * 0.5;
      const blink = reduced || Math.floor(s.clock * 2) % 2 === 0 ? 1 : 0;
      const text = SOURCE_LINES[Math.min(total - 1, Math.floor(caretLine))] || "";
      const first = Math.max(0, text.search(/\S|$/));
      const cx = (first - CENTER_COL) * CW - CW * 0.5;
      caret.position.set(cx, wallY(cx) + 0.3, cz);
      glow.position.copy(caret.position);
      caretMat.opacity = blink * (1 - e) * le;
      glowMat.opacity = 0.25 * blink * (1 - e) * le;
      wash.position.set(0, 0.02, cz);
      washMat.opacity = 0.035 * (1 - e) * le;
    },
  };

  function wallY(x) {
    const d = Math.max(0, Math.abs(x) - uniforms.uFlat.value);
    return uniforms.uWall.value * d * d;
  }

  function foldedPosition(line) {
    const c = Math.floor(line / FOLD_ROWS);
    const cols = Math.ceil(total / FOLD_ROWS);
    return { x: (c - (cols - 1) / 2) * 124 * CW, z: ((line % FOLD_ROWS) - FOLD_ROWS / 2) * LH };
  }

  // The cursor, projected onto the plane the name stands in.
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -WORD_Z);
  const hit = new THREE.Vector3();
  const pointer = (e) => {
    if (!view.visible) return;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) {
      uniforms.uMouse.value.copy(hit);
      view.mouseTarget = !reduced;
    }
  };
  window.addEventListener("pointermove", pointer, { passive: true });
  document.addEventListener("pointerleave", () => (view.mouseTarget = false));

  stage.add(view);
  return view;
}
