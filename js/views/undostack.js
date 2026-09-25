/* The undo and redo stacks as two towers.
 *
 * Each slab is one ActionGroup of the ported UndoManager -- the text it holds
 * is written on its face, teal for inserts, coral for deletes. Typing within
 * a group grows the top slab; a new group drops a new one; Ctrl+Z carries the
 * top slab across to the redo tower and Ctrl+Y carries it back. The slabs are
 * keyed by the group arrays themselves, which move between the manager's two
 * stacks by identity, so each slab is the same object on both towers.
 */

import * as THREE from "three";
import { GlyphLayer, SolidLayer, fogUniforms } from "../gfx/atlas.js";
import { INSERT } from "../core/undo.js";

const SLAB_H = 0.46;
const GAP = 0.08;
const CHAR_W = 0.3;
const MAX_CHARS = 18;
const SHOW = 12;

export function createUndoView(stage, atlas, el, undo) {
  const fog = fogUniforms(20, 60);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const solids = new SolidLayer(64, { fog });
  const glyphs = new GlyphLayer(atlas, 1200, { fog });
  scene.add(solids.mesh, glyphs.mesh);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slabs = new Map(); // group array -> slab

  const insertColor = new THREE.Color("#1d4a3e");
  const deleteColor = new THREE.Color("#4d2a31");
  const insertText = new THREE.Color("#5cf0ba");
  const deleteText = new THREE.Color("#f5a0a6");
  const plate = new THREE.Color("#1a1d25");
  const labelColor = new THREE.Color("#8a90a0");
  const tmp = new THREE.Color();

  function label(group) {
    const del = group[0].type !== INSERT;
    // Backspaces record right-to-left; read them in text order.
    const parts = group.map((a) => a.text);
    if (del && group.every((a) => a.text.length === 1)) parts.reverse();
    let text = parts.join("").replace(/\n/g, "¶").replace(/ /g, "·").replace(/\t/g, "→");
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1) + "~";
    return { text, del };
  }

  function layout() {
    const place = (stack, tower) => {
      const start = Math.max(0, stack.length - SHOW);
      stack.forEach((group, i) => {
        let s = slabs.get(group);
        const x = tower === "undo" ? -3.1 : 3.1;
        const y = (i - start) * (SLAB_H + GAP) + SLAB_H / 2;
        if (!s) {
          s = { x: { x, v: 0 }, y: { x: y + 4, v: 0 }, flash: 1, tower };
          slabs.set(group, s);
        }
        if (s.tower !== tower) {
          s.tower = tower;
          s.lift = 1; // arc over between towers
          s.flash = 1;
        }
        s.tx = x;
        s.ty = i < start ? -10 : y;
        s.hidden = i < start;
        const { text, del } = label(group);
        if (s.text !== undefined && s.text !== text) s.flash = 1;
        s.text = text;
        s.del = del;
        s.count = group.length;
        s.seen = true;
      });
    };
    for (const s of slabs.values()) s.seen = false;
    place(undo.undoStack, "undo");
    place(undo.redoStack, "redo");
    for (const [g, s] of slabs) if (!s.seen) slabs.delete(g);
  }

  const view = {
    el,
    scene,
    camera,
    layout,
    update(dt) {
      solids.begin();
      glyphs.begin();
      // Tower bases with their names.
      for (const [x, name] of [
        [-3.1, "undoStack_"],
        [3.1, "redoStack_"],
      ]) {
        solids.push(x, -0.08, 0, 6.2, 0.16, 2.2, plate, 0);
        name.split("").forEach((ch, i) => {
          glyphs.push(ch, x - ((name.length - 1) * 0.26) / 2 + i * 0.26, -0.08, 1.12, 0.26, 0, 0, 0, 0.52, 0, labelColor, 1);
        });
      }
      for (const s of slabs.values()) {
        if (s.hidden) continue;
        if (reduced) {
          s.x.x = s.tx;
          s.y.x = s.ty;
          s.lift = 0;
        } else {
          for (const [axis, target] of [
            ["x", s.tx],
            ["y", s.ty],
          ]) {
            const a = 150 * (target - s[axis].x) - 22 * s[axis].v;
            s[axis].v += a * dt;
            s[axis].x += s[axis].v * dt;
          }
          s.lift = Math.max(0, (s.lift || 0) - dt * 2.2);
        }
        s.flash = Math.max(0, s.flash - dt * 2);
        const arc = Math.sin(Math.min(1, s.lift || 0) * Math.PI) * 1.4;
        const w = Math.max(1.2, Math.min(MAX_CHARS, s.text.length) * CHAR_W + 0.9);
        tmp.copy(s.del ? deleteColor : insertColor).lerp(s.del ? deleteText : insertText, s.flash * 0.35);
        const y = s.y.x + arc;
        solids.push(s.x.x, y, 0, w, SLAB_H, 1.8, tmp, s.flash * 0.4);
        const color = s.del ? deleteText : insertText;
        const x0 = s.x.x - ((s.text.length - 1) * CHAR_W) / 2;
        for (let i = 0; i < s.text.length; i += 1) {
          glyphs.push(s.text[i], x0 + i * CHAR_W, y, 0.905, CHAR_W, 0, 0, 0, CHAR_W * 2, 0, color, 1);
        }
      }
      solids.end();
      glyphs.end();
      // Frame the taller tower, with room above it for the next slab to land.
      const tallest = Math.min(SHOW, Math.max(undo.undoStack.length, undo.redoStack.length, 3));
      const top = tallest * (SLAB_H + GAP) + 1.2;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.max((top / 2 + 0.6) / tanHalf, 5.6 / (tanHalf * camera.aspect)) * 1.02;
      camera.position.set(0, top * 0.55 + 1.6, dist);
      camera.lookAt(0, top * 0.45, 0);
    },
  };
  layout();
  stage.add(view);
  return view;
}
