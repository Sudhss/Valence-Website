/* std::vector<std::string> lines_, as objects.
 *
 * Every character in the editor's buffer is a key; every line is a row with a
 * std::string header block at its head. After each edit the scene is diffed
 * against the buffer -- rows by common prefix and suffix, characters within
 * the changed rows the same way -- so each character keeps its identity and
 * you see it move: typing into a line slides the rest of that line along
 * (std::string::insert), Enter sends the tail to a new row and pushes every
 * later row down (std::vector::insert), Backspace at column 0 pulls them back.
 * Anything that moved flashes; that flash is the cost of the edit.
 */

import * as THREE from "three";
import { tokenize, commentStates } from "../core/lexer.js";
import { GlyphLayer, SolidLayer, TOKEN_COLORS, fogUniforms } from "../gfx/atlas.js";

const KEY_W = 0.56;
const ROW_D = 1.05;
const VISIBLE_ROWS = 15;
const MAX_KEYS = 1600;

let nextId = 1;
const sp = (v) => ({ x: v, v: 0 });

function makeChar(ch, kind, x, z, spawn) {
  return { id: nextId++, ch, kind, px: sp(x), py: sp(spawn ? 2.4 : 0), pz: sp(z), flash: spawn ? 1 : 0, born: spawn };
}

export function createVectorView(stage, atlas, el, editorState) {
  const fog = fogUniforms(18, 60);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const keys = new SolidLayer(MAX_KEYS + 64, { fog });
  const glyphs = new GlyphLayer(atlas, MAX_KEYS + 64, { fog });
  scene.add(keys.mesh, glyphs.mesh);

  const rows = []; // { hdr: {pz, py, flash}, chars: [char], str }
  const dying = [];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cursor = { row: 0, col: 0 };
  let windowStart = 0;
  const camState = { z: sp(0) };

  const colX = (col) => col * KEY_W;
  const rowZ = (row) => row * ROW_D;

  function sync(lines, cursorPos) {
    cursor = cursorPos;
    const states = commentStates(lines);
    const kindsFor = (row) => {
      const kinds = new Array(lines[row].length).fill(0);
      for (const t of tokenize(lines[row], { inBlockComment: states[row] })) {
        for (let i = 0; i < t.length; i += 1) kinds[t.start + i] = t.type;
      }
      return kinds;
    };

    const old = rows.slice();
    let p = 0;
    while (p < old.length && p < lines.length && old[p].str === lines[p]) p += 1;
    let s = 0;
    while (s < old.length - p && s < lines.length - p && old[old.length - 1 - s].str === lines[lines.length - 1 - s]) s += 1;

    const oldMid = old.slice(p, old.length - s);
    const newMid = lines.slice(p, lines.length - s);
    const A = oldMid.flatMap((r) => r.chars);
    const B = [];
    newMid.forEach((line, i) => {
      for (let c = 0; c < line.length; c += 1) B.push({ row: p + i, col: c, ch: line[c] });
    });
    let k = 0;
    while (k < A.length && k < B.length && A[k].ch === B[k].ch) k += 1;
    let m = 0;
    while (m < A.length - k && m < B.length - k && A[A.length - 1 - m].ch === B[B.length - 1 - m].ch) m += 1;

    const assigned = new Array(B.length);
    for (let i = 0; i < k; i += 1) assigned[i] = A[i];
    for (let j = 0; j < m; j += 1) assigned[B.length - 1 - j] = A[A.length - 1 - j];
    for (const gone of A.slice(k, A.length - m)) {
      gone.dieAt = 0;
      dying.push(gone);
    }

    const midRows = newMid.map((line, i) => {
      const hdr = oldMid[i]?.hdr || { pz: sp(rowZ(p + i)), py: sp(1.8), flash: 1 };
      return { hdr, chars: [], str: line };
    });
    for (const extra of oldMid.slice(newMid.length)) {
      extra.hdr.dieAt = 0;
      dying.push({ hdrOnly: extra.hdr });
    }
    B.forEach((b, i) => {
      let obj = assigned[i];
      if (!obj) obj = makeChar(b.ch, 0, colX(b.col), rowZ(b.row), !reduced);
      midRows[b.row - p].chars.push(obj);
    });

    rows.length = 0;
    rows.push(...old.slice(0, p), ...midRows, ...old.slice(old.length - s));

    // Retarget everything; anything whose slot changed flashes.
    rows.forEach((r, ri) => {
      r.str = lines[ri];
      const kinds = kindsFor(ri);
      const z = rowZ(ri);
      if (Math.abs((r.hdr.tz ?? z) - z) > 1e-6) r.hdr.flash = 1;
      r.hdr.tz = z;
      r.chars.forEach((c, ci) => {
        const x = colX(ci);
        if ((c.tx !== undefined && Math.abs(c.tx - x) > 1e-6) || (c.tz !== undefined && Math.abs(c.tz - z) > 1e-6)) c.flash = 1;
        c.tx = x;
        c.tz = z;
        c.kind = kinds[ci];
        if (reduced) {
          c.px.x = x;
          c.pz.x = z;
          c.py.x = 0;
        }
      });
    });

    // Keep the caret's row in the window.
    if (cursor.row < windowStart + 2) windowStart = Math.max(0, cursor.row - 2);
    if (cursor.row > windowStart + VISIBLE_ROWS - 3) windowStart = cursor.row - VISIBLE_ROWS + 3;
    windowStart = Math.max(0, Math.min(windowStart, Math.max(0, rows.length - VISIBLE_ROWS)));
  }

  const hdrColor = new THREE.Color("#2b4466");
  const keyBase = new THREE.Color("#1f232c");
  const spaceColor = new THREE.Color("#171a21");
  const flashColor = new THREE.Color("#2fe0a0");
  const hdrFlash = new THREE.Color("#60a5fa");
  const caretColor = new THREE.Color("#2fe0a0");
  const tmp = new THREE.Color();
  const dimText = new THREE.Color("#7c8290");

  const view = {
    el,
    scene,
    camera,
    sync,
    update(dt) {
      const step = (obj, target, axis) => {
        if (reduced) {
          obj[axis].x = target;
          return;
        }
        const a = 190 * (target - obj[axis].x) - 24 * obj[axis].v;
        obj[axis].v += a * dt;
        obj[axis].x += obj[axis].v * dt;
      };

      keys.begin();
      glyphs.begin();
      const first = windowStart;
      const last = Math.min(rows.length, windowStart + VISIBLE_ROWS);

      for (let ri = first; ri < last; ri += 1) {
        const r = rows[ri];
        step(r.hdr, r.hdr.tz, "pz");
        step(r.hdr, 0, "py");
        r.hdr.flash = Math.max(0, r.hdr.flash - dt * 2.2);
        const hz = r.hdr.pz.x;
        const hy = r.hdr.py.x;
        tmp.copy(hdrColor).lerp(hdrFlash, r.hdr.flash * 0.8);
        keys.push(-1.35, hy + 0.2, hz, 1.6, 0.4, ROW_D * 0.8, tmp, r.hdr.flash * 0.35);
        // Row index on the header: [n]
        const label = `[${ri}]`;
        label.split("").forEach((ch, i) => {
          glyphs.push(ch, -1.35 - (label.length - 1) * 0.13 + i * 0.26, hy + 0.41, hz, 0.26, 0, 0, 0, 0, -0.52, dimText, 0.95);
        });
        if (ri === cursor.row) {
          keys.push(Math.max(0, r.chars.length) * KEY_W * 0.5 - KEY_W * 0.5, -0.06, hz, Math.max(1, r.chars.length) * KEY_W + 0.2, 0.02, ROW_D * 0.92, tmp.set("#262b36"), 0.1);
        }
        r.chars.forEach((c) => {
          step(c, c.tx, "px");
          step(c, c.tz, "pz");
          step(c, 0, "py");
          c.flash = Math.max(0, c.flash - dt * 2.4);
          const space = c.ch === " ";
          const h = space ? 0.06 : 0.24;
          const color = TOKEN_COLORS[c.kind] || TOKEN_COLORS[0];
          tmp.copy(space ? spaceColor : keyBase).lerp(color, space ? 0 : 0.12).lerp(flashColor, c.flash * 0.7);
          keys.push(c.px.x, c.py.x + h / 2, c.pz.x, KEY_W * 0.86, h, ROW_D * 0.78, tmp, c.flash * 0.4);
          if (!space) glyphs.push(c.ch, c.px.x, c.py.x + h + 0.005, c.pz.x, KEY_W * 0.78, 0, 0, 0, 0, -KEY_W * 1.56, color, 1);
        });
      }

      // Characters on their way out: up and gone.
      for (let i = dying.length - 1; i >= 0; i -= 1) {
        const d = dying[i];
        d.dieAt += dt;
        if (d.dieAt > 0.5 || reduced) {
          dying.splice(i, 1);
          continue;
        }
        if (d.hdrOnly) continue;
        const t = d.dieAt / 0.5;
        const color = TOKEN_COLORS[d.kind] || TOKEN_COLORS[0];
        glyphs.push(d.ch, d.px.x, 0.3 + t * 2.2, d.pz.x, KEY_W * 0.78, 0, 0, 0, 0, -KEY_W * 1.56, color, 1 - t);
      }

      // The caret stands where the next character will go.
      const cr = rows[cursor.row];
      if (cr) {
        const cx = colX(cursor.col) - KEY_W * 0.5;
        const on = reduced || Math.floor(performance.now() / 500) % 2 === 0;
        if (on) keys.push(cx, 0.35, cr.hdr.pz.x, 0.05, 0.7, ROW_D * 0.8, caretColor, 0.9);
      }
      keys.end();
      glyphs.end();

      // Camera: fit the window of rows (headers included) and look down at it.
      const shown = Math.max(1, last - first);
      const centerZ = rowZ(first + (shown - 1) / 2);
      if (reduced) camState.z.x = centerZ;
      else {
        camState.z.v += (60 * (centerZ - camState.z.x) - 14 * camState.z.v) * dt;
        camState.z.x += camState.z.v * dt;
      }
      let widest = 14;
      for (let ri = first; ri < last; ri += 1) widest = Math.max(widest, rows[ri].chars.length);
      const left = -2.3;
      const right = widest * KEY_W;
      const cx = (left + right) / 2;
      const halfW = (right - left) / 2 + 0.3;
      const halfD = (shown * ROW_D) / 2 + 0.8;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const pitch = 1.16;
      const dist = Math.max(halfW / (tanHalf * camera.aspect), (halfD * Math.sin(pitch)) / tanHalf) * 0.94;
      camera.position.set(cx, Math.sin(pitch) * dist, camState.z.x + Math.cos(pitch) * dist);
      camera.lookAt(cx, 0, camState.z.x);
    },
  };
  stage.add(view);
  return view;
}

/** A sentence for an edit's cost, in the terms of the C++ it maps to. */
export function describeCost(detail, state) {
  const cost = detail.cost;
  const lines = state.buffer.lines;
  const bytes = lines.reduce((n, l) => n + l.length, 0);
  const summary = `${lines.length} std::string${lines.length === 1 ? "" : "s"} · ${bytes} bytes of text · ${lines.length * 32} bytes of headers`;
  if (!cost || detail.kind === "move") return { op: "", detail: summary };
  const at = `row ${cost.row}`;
  switch (cost.op) {
    case "insertChar":
      return { op: `insertChar(${at})`, detail: `std::string::insert shifted ${cost.bytesShifted} byte${cost.bytesShifted === 1 ? "" : "s"} along that line. ${summary}.` };
    case "deleteChar":
    case "deleteRange":
      return cost.objectsMoved
        ? { op: `deleteRange(${at})`, detail: `std::vector::erase moved ${cost.objectsMoved} std::string objects up (${cost.objectsMoved * 32} bytes). ${summary}.` }
        : { op: `${cost.op}(${at})`, detail: `std::string::erase shifted ${cost.bytesShifted} byte${cost.bytesShifted === 1 ? "" : "s"} back. ${summary}.` };
    case "splitLine":
    case "insertText":
      return cost.objectsMoved
        ? { op: `insertText(${at}) → new line`, detail: `std::vector::insert moved ${cost.objectsMoved} later std::string object${cost.objectsMoved === 1 ? "" : "s"} down (${cost.objectsMoved * 32} bytes). ${summary}.` }
        : { op: `insertText(${at})`, detail: `std::string::insert shifted ${cost.bytesShifted} bytes. ${summary}.` };
    case "mergeLines":
      return { op: `mergeLines(${at})`, detail: `std::vector::erase moved ${cost.objectsMoved} std::string object${cost.objectsMoved === 1 ? "" : "s"} up (${cost.objectsMoved * 32} bytes). ${summary}.` };
    default:
      return { op: cost.op, detail: summary };
  }
}
