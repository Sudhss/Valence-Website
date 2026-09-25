/* The tokenizer, run as a machine.
 *
 * The line sits at the back as a row of character blocks. A scan head crosses
 * it once, left to right -- the one pass. Each time the head reaches the end of
 * a token, that token's characters lift out and fly to the lane for its type,
 * in emission order, so you watch the single pass and its output at once.
 * Whitespace is a Plain token in Valence's lexer too, so it goes to the plain
 * lane rather than vanishing.
 */

import * as THREE from "three";
import { tokenize, TOKEN, TOKEN_NAMES } from "../core/lexer.js";
import { GlyphLayer, SolidLayer, TOKEN_COLORS, fogUniforms } from "../gfx/atlas.js";

export const LANE_ORDER = [TOKEN.Keyword, TOKEN.Type, TOKEN.Function, TOKEN.String, TOKEN.Number, TOKEN.Preprocessor, TOKEN.Comment, TOKEN.Punctuation, TOKEN.Plain];

const CW = 0.46;
const LANE_GAP = 0.78;
const SPEED = 26; // characters per second for the scan head
const FLIGHT = 0.6;

export function createLexerView(stage, atlas, el) {
  const fog = fogUniforms(22, 60);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const solids = new SolidLayer(400, { fog });
  const glyphs = new GlyphLayer(atlas, 700, { fog });
  scene.add(solids.mesh, glyphs.mesh);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let line = "";
  let tokens = [];
  let chars = [];
  let t = 0;
  let laneFill = [];
  let started = false;
  const listeners = new Set();

  const laneZ = (k) => -1.2 + k * LANE_GAP;
  const sourceZ = -3.6;
  const laneX0 = -8.2;

  function load(text) {
    line = text;
    tokens = tokenize(text, { inBlockComment: false });
    chars = [];
    laneFill = LANE_ORDER.map(() => 0);
    const x0 = -((text.length - 1) * CW) / 2;
    tokens.forEach((tok, ti) => {
      const lane = LANE_ORDER.indexOf(tok.type);
      const start = laneFill[lane];
      laneFill[lane] += tok.length + 1; // a gap between tokens in a lane
      for (let i = 0; i < tok.length; i += 1) {
        const col = tok.start + i;
        chars.push({
          ch: text[col],
          type: tok.type,
          token: ti,
          from: { x: x0 + col * CW, y: 0.3, z: sourceZ },
          to: { x: laneX0 + 2.7 + (start + i) * CW * 0.82, y: 0.2, z: laneZ(lane) },
          emit: (tok.start + tok.length) / SPEED,
        });
      }
    });
    t = reduced ? 1e6 : 0;
    started = true;
    const counts = LANE_ORDER.map((type) => tokens.filter((tk) => tk.type === type).length);
    for (const fn of listeners) fn({ tokens, counts, line });
  }

  const dark = new THREE.Color("#1d2029");
  const laneColor = new THREE.Color("#14161c");
  const headColor = new THREE.Color("#2fe0a0");
  const tmp = new THREE.Color();
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  const view = {
    el,
    scene,
    camera,
    load,
    on: (fn) => listeners.add(fn),
    update(dt) {
      if (started) t += dt;
      solids.begin();
      glyphs.begin();

      // Lanes, each named in its own colour.
      LANE_ORDER.forEach((type, k) => {
        const z = laneZ(k);
        const len = Math.max(10, laneFill[k] || 0) * CW * 0.82 + 3.2;
        solids.push(laneX0 + len / 2 - 0.2, -0.06, z, len, 0.08, LANE_GAP * 0.78, laneColor, 0);
        const name = TOKEN_NAMES[type];
        name.split("").forEach((ch, i) => {
          glyphs.push(ch, laneX0 + i * 0.2, 0.0, z, 0.2, 0, 0, 0, 0, -0.4, TOKEN_COLORS[type], 0.9);
        });
      });

      // The line itself, and the scan head crossing it once.
      const x0 = -((line.length - 1) * CW) / 2;
      const headCol = Math.min(line.length, t * SPEED);
      for (let i = 0; i < line.length; i += 1) {
        const passed = i < headCol;
        tmp.copy(dark).multiplyScalar(passed ? 0.7 : 1);
        solids.push(x0 + i * CW, 0.18, sourceZ, CW * 0.86, 0.36, CW * 0.86, tmp, 0);
      }
      if (headCol < line.length || t * SPEED < line.length + 3) {
        const hx = x0 + headCol * CW - CW / 2;
        solids.push(hx, 0.45, sourceZ, 0.06, 0.9, 0.7, headColor, 1);
      }

      for (const c of chars) {
        const local = reduced ? 1 : Math.max(0, Math.min(1, (t - c.emit) / FLIGHT));
        const e = ease(local);
        const x = c.from.x + (c.to.x - c.from.x) * e;
        const z = c.from.z + (c.to.z - c.from.z) * e;
        const y = c.from.y + (c.to.y - c.from.y) * e + Math.sin(local * Math.PI) * 1.6;
        const color = TOKEN_COLORS[c.type];
        // A ghost stays in the source row once the character has left.
        if (local > 0) glyphs.push(c.ch === " " ? "·" : c.ch, c.from.x, c.from.y + 0.37, c.from.z, CW * 0.8, 0, 0, 0, 0, -CW * 1.6, color, 0.18);
        const glyph = c.ch === " " ? "·" : c.ch;
        const lift = local > 0 && local < 1 ? 0.25 : 0;
        glyphs.push(glyph, x, y + 0.37 + lift, z, CW * 0.8, 0, 0, 0, 0, -CW * 1.6, color, c.ch === " " ? 0.45 : 1);
      }

      solids.end();
      glyphs.end();
      // Fit the source row and every lane.
      const laneEnd = Math.max(...LANE_ORDER.map((_, k) => laneX0 + Math.max(10, laneFill[k] || 0) * CW * 0.82 + 3));
      const left = Math.min(laneX0, x0) - 0.6;
      const right = Math.max(laneEnd, x0 + line.length * CW) + 0.6;
      const near = laneZ(LANE_ORDER.length - 1) + 0.6;
      const cx = (left + right) / 2;
      const cz = (sourceZ + near) / 2;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const pitch = 1.08;
      const dist = Math.max((right - left) / 2 / (tanHalf * camera.aspect), (((near - sourceZ) / 2 + 2.2) * Math.sin(pitch)) / tanHalf) * 1.08;
      camera.position.set(cx, Math.sin(pitch) * dist, cz + Math.cos(pitch) * dist);
      camera.lookAt(cx, 0.4, cz);
    },
  };
  stage.add(view);
  return view;
}

export const LEX_SAMPLES = [
  "const long long MOD = 1'000'000'007; // prime",
  "for (int i = 0; i < n; i++) cout << a[i] << ' ';",
  "#include <bits/stdc++.h>",
  "auto it = lower_bound(v.begin(), v.end(), x) - v.begin();",
  "x = a /* inline */ + 0x1F'FF;",
  'string s = "a \\"quoted\\" word";',
  "template<typename T> T maxOf(T a, T b) { return a > b ? a : b; }",
];
