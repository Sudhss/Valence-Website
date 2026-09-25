/* Valence's source as a building: six terraces, one tower per file.
 *
 * Terraces rise front to back in dependency order -- theme at the front and
 * lowest, the entry point at the back and highest -- so every file only ever
 * leans on the terraces in front of it. Tower height is lines of code, read
 * from the generated source data, not typed in. A light walks the path one
 * keystroke really takes through the files, and pointing at a tower names it.
 */

import * as THREE from "three";
import { SOURCE_FILES } from "../data/source.js";
import { LAYERS, KEYSTROKE } from "../data/arch.js";
import { GlyphLayer, SolidLayer, fogUniforms } from "../gfx/atlas.js";

const SPACING = 2.5;
const PER_ROW = 7;
const TOWER = 1.3;
const HEIGHT_PER_LINE = 0.0085;
const TERRACE_RISE = 1.0;
const TERRACE_DEPTH = 5.2;

const LAYER_HUES = {
  theme: "#c792ea",
  core: "#82aaff",
  editor: "#2fe0a0",
  cph: "#ffb74d",
  ui: "#56d1ff",
  app: "#82e787",
};

export function createArchView(stage, atlas, el) {
  const fog = fogUniforms(40, 120);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  const plates = new SolidLayer(16, { fog });
  const towers = new SolidLayer(40, { fog });
  const bits = new SolidLayer(8, { fog });
  const glyphs = new GlyphLayer(atlas, 1400, { fog });
  scene.add(plates.mesh, towers.mesh, bits.mesh, glyphs.mesh);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const listeners = { hover: new Set(), step: new Set() };

  // ---- layout, computed once ------------------------------------------------
  const byLayer = LAYERS.map((l) => SOURCE_FILES.filter((f) => f.layer === l.id));
  const items = [];
  const plateSpecs = [];
  byLayer.forEach((files, k) => {
    const rowsN = Math.ceil(files.length / PER_ROW);
    const cols = Math.min(PER_ROW, files.length);
    const y = k * TERRACE_RISE;
    const zc = -k * TERRACE_DEPTH;
    const w = cols * SPACING + 1.4;
    const d = rowsN * 2.3 + 1.8;
    plateSpecs.push({ x: 0, y, z: zc, w, d, layer: LAYERS[k] });
    files.forEach((f, i) => {
      const r = Math.floor(i / PER_ROW);
      const c = i % PER_ROW;
      const inRow = Math.min(PER_ROW, files.length - r * PER_ROW);
      const x = (c - (inRow - 1) / 2) * SPACING;
      const z = zc + (r - (rowsN - 1) / 2) * 2.3 - 0.3;
      const h = 0.2 + f.lines * HEIGHT_PER_LINE;
      items.push({ file: f, x, y, z, h, color: new THREE.Color("#262a34").lerp(new THREE.Color(LAYER_HUES[f.layer]), 0.28), glow: 0 });
    });
  });
  const itemOf = (path) => items.find((it) => it.file.path === path);
  const plateColor = new THREE.Color("#15181e");
  const labelColor = new THREE.Color("#7d8391");
  const packetColor = new THREE.Color("#5cf0ba");

  // ---- the keystroke --------------------------------------------------------
  const HOP = 0.75;
  const PAUSE = 1.1;
  const cycle = KEYSTROKE.length * HOP + PAUSE;
  let t = 0;
  let step = -1;

  // ---- orbit + hover --------------------------------------------------------
  const orbit = { yaw: -0.5, pitch: 0.58, dist: 41, targetYaw: -0.5 };
  let hovered = -1;
  const raycaster = new THREE.Raycaster();
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, yaw: orbit.targetYaw };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (drag) {
      orbit.targetYaw = drag.yaw - (e.clientX - drag.x) * 0.006;
      return;
    }
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(towers.mesh)[0];
    const idx = hit ? hit.instanceId : -1;
    if (idx !== hovered) {
      hovered = idx;
      for (const fn of listeners.hover) fn(idx >= 0 ? items[idx].file : null);
    }
  });
  el.addEventListener("pointerup", () => (drag = null));
  el.addEventListener("pointerleave", () => {
    if (hovered !== -1) {
      hovered = -1;
      for (const fn of listeners.hover) fn(null);
    }
  });

  const view = {
    el,
    scene,
    camera,
    items,
    on: (kind, fn) => listeners[kind].add(fn),
    update(dt) {
      t += dt;
      const phase = t % cycle;
      const s = Math.min(KEYSTROKE.length - 1, Math.floor(phase / HOP));
      const active = phase < KEYSTROKE.length * HOP ? s : -1;
      if (active !== step) {
        step = active;
        for (const fn of listeners.step) fn(step);
      }

      plates.begin();
      plateSpecs.forEach((p) => plates.push(p.x, p.y - 0.12, p.z, p.w, 0.24, p.d, plateColor, 0));
      plates.end();

      towers.begin();
      const activeItem = step >= 0 ? itemOf(KEYSTROKE[step]) : null;
      items.forEach((it, i) => {
        const target = it === activeItem ? 0.55 : i === hovered ? 0.35 : 0;
        it.glow += (target - it.glow) * (reduced ? 1 : Math.min(1, dt * 8));
        towers.push(it.x, it.y + it.h / 2, it.z, TOWER, it.h, TOWER, it.color, it.glow);
      });
      towers.end();
      if (!towers.mesh.boundingSphere) towers.mesh.computeBoundingSphere();

      // The packet travels tower top to tower top along an arc.
      bits.begin();
      if (step >= 0 && !reduced) {
        const local = (phase - step * HOP) / HOP;
        const from = itemOf(KEYSTROKE[step]);
        const to = itemOf(KEYSTROKE[Math.min(KEYSTROKE.length - 1, step + 1)]);
        const e = local * local * (3 - 2 * local);
        const x = from.x + (to.x - from.x) * e;
        const z = from.z + (to.z - from.z) * e;
        const y = from.y + from.h + (to.y + to.h - from.y - from.h) * e + Math.sin(local * Math.PI) * 2.2 + 0.5;
        bits.push(x, y, z, 0.42, 0.42, 0.42, packetColor, 2.2);
      }
      bits.end();

      // Labels: layer names on the terrace fronts, file names at tower feet.
      glyphs.begin();
      plateSpecs.forEach((p) => {
        const name = p.layer.name;
        const x0 = -p.w / 2 + 0.5;
        const hue = new THREE.Color(LAYER_HUES[p.layer.id]);
        name.split("").forEach((ch, i) => glyphs.push(ch, x0 + i * 0.36, p.y + 0.01, p.z + p.d / 2 - 0.5, 0.36, 0, 0, 0, 0, -0.72, hue, 0.95));
      });
      items.forEach((it, i) => {
        const base = it.file.path.split("/").pop();
        const size = 0.16;
        const x0 = it.x - ((base.length - 1) * size) / 2;
        const alpha = i === hovered || (activeItem === it) ? 1 : 0.6;
        base.split("").forEach((ch, j) => glyphs.push(ch, x0 + j * size, it.y + 0.02, it.z + TOWER / 2 + 0.34, size, 0, 0, 0, 0, -size * 2, labelColor, alpha));
      });
      glyphs.end();

      orbit.yaw += (orbit.targetYaw - orbit.yaw) * (reduced ? 1 : Math.min(1, dt * 6));
      const cy = 2.2;
      const cz = -11.5;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.max(orbit.dist, 19 / (tanHalf * camera.aspect));
      camera.position.set(Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist, cy + Math.sin(orbit.pitch) * dist, cz + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist);
      camera.lookAt(0, cy, cz);
    },
  };
  stage.add(view);
  return view;
}
