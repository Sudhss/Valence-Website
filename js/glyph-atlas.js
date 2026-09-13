/* Valence — a monospace glyph atlas.
 *
 * Every printable ASCII character drawn once into a grid on a canvas, uploaded
 * as a single texture. Each character in the scene is then one instanced quad
 * that samples its own cell.
 *
 * This is the only way to get several hundred thousand readable glyphs into one
 * draw call. The alternatives are worse in obvious ways: a DOM node per
 * character cannot survive the count, a texture per line means thousands of
 * uploads, and a mesh per glyph means thousands of draw calls.
 */

import * as THREE from './vendor/three.module.min.js';

export const FIRST_CHAR = 32;      // space
export const LAST_CHAR = 126;      // ~
export const GLYPH_COUNT = LAST_CHAR - FIRST_CHAR + 1;

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = Math.ceil(GLYPH_COUNT / ATLAS_COLS);

/** Index into the atlas, or -1 for anything it cannot draw (including space,
 *  which is never emitted as an instance). */
export function glyphIndex(ch) {
  const code = ch.charCodeAt(0);
  if (code <= FIRST_CHAR || code > LAST_CHAR) return -1;   // note: space excluded
  return code - FIRST_CHAR;
}

export function buildGlyphAtlas(cell = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * cell;
  canvas.height = ATLAS_ROWS * cell;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';           // white, tinted per instance in the shader
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The same family stack the site and the editor use, so the code in the scene
  // is set in the typeface the product actually renders.
  ctx.font = `${Math.floor(cell * 0.68)}px "JetBrains Mono","Cascadia Mono",Consolas,monospace`;

  for (let i = 0; i < GLYPH_COUNT; i++) {
    const ch = String.fromCharCode(FIRST_CHAR + i);
    const cx = (i % ATLAS_COLS) * cell + cell / 2;
    const cy = Math.floor(i / ATLAS_COLS) * cell + cell / 2;
    ctx.fillText(ch, cx, cy);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  // Thousands of glyphs end up sub-pixel at distance; without anisotropy the
  // far half of the file turns to aliased noise.
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return { texture, cell, cols: ATLAS_COLS, rows: ATLAS_ROWS, canvas };
}
