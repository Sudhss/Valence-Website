/* The glyph atlas and the two instanced layers every view is built from.
 *
 * GlyphLayer draws characters: one quad per glyph, placed by a centre and two
 * axis vectors, so the same layer can lay text flat on the ground, stand it on
 * the face of a block, or tilt it up a canyon wall. SolidLayer draws blocks:
 * one lit box per instance with its own colour and glow. A whole scene is a
 * handful of draw calls regardless of how much is in it.
 */

import * as THREE from "three";

const COLS = 16;
const ROWS = 7;
// Cells match the face's advance (0.6 em) so adjacent glyphs sit like text.
const CELL_W = 48;
const CELL_H = 96;
export const GLYPH_ASPECT = CELL_H / CELL_W;
const EXTRA = ["·", "¶", "→"]; // shown space, newline, tab

export function glyphIndex(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return code - 32;
  const extra = EXTRA.indexOf(ch);
  if (extra >= 0) return 95 + extra;
  return 31; // '?'
}

let atlasTexture = null;

/** Build once, after the web font has loaded, so the atlas is drawn in it. */
export async function glyphAtlas(renderer) {
  if (atlasTexture) return atlasTexture;
  try {
    await document.fonts.load('700 72px "JetBrains Mono"');
  } catch {
    /* fall back to whatever monospace the system has */
  }
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 72px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
  const chars = [];
  for (let c = 32; c <= 126; c += 1) chars.push(String.fromCharCode(c));
  chars.push(...EXTRA);
  chars.forEach((ch, i) => {
    const x = (i % COLS) * CELL_W + CELL_W / 2;
    const y = Math.floor(i / COLS) * CELL_H + CELL_H / 2 + 3;
    ctx.fillText(ch, x, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.flipY = false;
  tex.needsUpdate = true;
  atlasTexture = tex;
  return tex;
}

/* Theme.h syntax palette, indexed by js/core/lexer.js TOKEN values. Comment
 * and punctuation are pre-blended against the editor surface. */
export const TOKEN_HEX = [
  "#e9ecf1", // plain
  "#56d1ff", // keyword
  "#82aaff", // type
  "#c3e88d", // string
  "#6d7178", // comment
  "#ffb74d", // number
  "#c792ea", // preprocessor
  "#82e787", // function
  "#a4a8ae", // punctuation
];
export const TOKEN_COLORS = TOKEN_HEX.map((h) => new THREE.Color(h));

export const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  vec3 fogged(vec3 c, float depth) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, depth)); }
`;

export function fogUniforms(near = 30, far = 120) {
  return {
    uFogColor: { value: new THREE.Color(0x0b0c10) },
    uFogNear: { value: near },
    uFogFar: { value: far },
  };
}

const GLYPH_VERTEX = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aU;
  attribute vec3 aV;
  attribute float aGlyph;
  attribute vec4 aColor;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vDepth;
  void main() {
    vec3 p = aCenter + position.x * aU + position.y * aV;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float col = mod(aGlyph, ${COLS}.0);
    float row = floor(aGlyph / ${COLS}.0);
    vUv = (vec2(col, row) + vec2(position.x + 0.5, 0.5 - position.y)) / vec2(${COLS}.0, ${ROWS}.0);
    vColor = aColor;
    vDepth = -mv.z;
  }
`;

const GLYPH_FRAGMENT = /* glsl */ `
  ${FOG_GLSL}
  uniform sampler2D uAtlas;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vDepth;
  void main() {
    float a = texture2D(uAtlas, vUv).a * vColor.a * uOpacity;
    if (a < 0.02) discard;
    gl_FragColor = vec4(fogged(vColor.rgb, vDepth), a);
    #include <colorspace_fragment>
  }
`;

export class GlyphLayer {
  constructor(atlas, capacity, { fog = fogUniforms(), depthWrite = false, renderOrder = 2 } = {}) {
    this.capacity = capacity;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.attributes.position);
    const attr = (size) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    this.center = attr(3);
    this.u = attr(3);
    this.v = attr(3);
    this.glyph = attr(1);
    this.color = attr(4);
    g.setAttribute("aCenter", this.center);
    g.setAttribute("aU", this.u);
    g.setAttribute("aV", this.v);
    g.setAttribute("aGlyph", this.glyph);
    g.setAttribute("aColor", this.color);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERTEX,
      fragmentShader: GLYPH_FRAGMENT,
      uniforms: { ...fog, uAtlas: { value: atlas }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  /** Add one glyph. u and v are the quad's full width and height vectors. */
  push(ch, cx, cy, cz, ux, uy, uz, vx, vy, vz, color, alpha = 1) {
    if (this.count >= this.capacity) return;
    const i = this.count;
    this.center.setXYZ(i, cx, cy, cz);
    this.u.setXYZ(i, ux, uy, uz);
    this.v.setXYZ(i, vx, vy, vz);
    this.glyph.setX(i, typeof ch === "number" ? ch : glyphIndex(ch));
    this.color.setXYZW(i, color.r, color.g, color.b, alpha);
    this.count += 1;
  }

  end() {
    this.geometry.instanceCount = this.count;
    for (const a of [this.center, this.u, this.v, this.glyph, this.color]) {
      a.needsUpdate = true;
      a.clearUpdateRanges?.();
      a.addUpdateRange?.(0, this.count * a.itemSize);
    }
  }
}

const SOLID_VERTEX = /* glsl */ `
  attribute float aGlow;
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying float vGlow;
  varying float vDepth;
  varying vec3 vLocal;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 world = m * vec4(position, 1.0);
    vNormalW = normalize(mat3(m) * normal);
    vColor = instanceColor;
    vGlow = aGlow;
    vLocal = position;
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SOLID_FRAGMENT = /* glsl */ `
  ${FOG_GLSL}
  varying vec3 vNormalW;
  varying vec3 vColor;
  varying float vGlow;
  varying float vDepth;
  varying vec3 vLocal;
  void main() {
    vec3 n = normalize(vNormalW);
    float sky = 0.5 + 0.5 * n.y;
    float key = max(dot(n, normalize(vec3(-0.4, 0.85, 0.5))), 0.0);
    vec3 c = vColor * (0.30 + 0.32 * sky + 0.46 * key);
    // Top faces sit a touch lighter, the way theme.h lights raised surfaces from above.
    c += vColor * step(0.5, n.y) * 0.06;
    c += vColor * vGlow * 1.2;
    gl_FragColor = vec4(fogged(c, vDepth), 1.0);
    #include <colorspace_fragment>
  }
`;

export class SolidLayer {
  constructor(capacity, { fog = fogUniforms(), geometry } = {}) {
    const geo = geometry || new THREE.BoxGeometry(1, 1, 1);
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aGlow", this.glowAttr);
    this.material = new THREE.ShaderMaterial({ vertexShader: SOLID_VERTEX, fragmentShader: SOLID_FRAGMENT, uniforms: { ...fog } });
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.capacity = capacity;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  push(x, y, z, sx, sy, sz, color, glow = 0, rotY = 0) {
    if (this.count >= this.capacity) return -1;
    const i = this.count;
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.setColorAt(i, color);
    this.glowAttr.setX(i, glow);
    this.count += 1;
    return i;
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }
}

/** Critically-damped spring toward a target, per axis. */
export function spring(state, target, dt, stiffness = 170, damping = 26) {
  const a = stiffness * (target - state.x) - damping * state.v;
  state.v += a * dt;
  state.x += state.v * dt;
}

export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
