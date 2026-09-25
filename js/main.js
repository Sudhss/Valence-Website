/* Valence site -- wiring.
 *
 * One Stage (one WebGL context) hosts every 3D view; each view draws into the
 * rectangle of its placeholder element. Everything that is not 3D is plain
 * DOM and works without WebGL.
 */

import { Stage, webgl2Available } from "./gfx/stage.js";
import { glyphAtlas } from "./gfx/atlas.js";
import { createCanyon, BAND } from "./views/canyon.js";
import { mountChrome } from "./ui/chrome.js";
import { mountEditor } from "./ui/editor.js";
import { createVectorView, describeCost } from "./views/vector.js";
import { createUndoView } from "./views/undostack.js";
import { BREAK_REASONS } from "./core/undo.js";
import { createLexerView, LEX_SAMPLES, LANE_ORDER } from "./views/lexer3d.js";
import { createArchView } from "./views/arch3d.js";
import { mountJudge } from "./ui/judge.js";
import { mountBench } from "./ui/bench.js";
import { mountHistory } from "./ui/history.js";
import { ROLES } from "./data/arch.js";
import { TOKEN_NAMES } from "./core/lexer.js";
import { TOKEN_HEX } from "./gfx/atlas.js";
import { SOURCE_LINES } from "./data/source.js";

document.documentElement.classList.add("js");

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let stage = null;
const views = {};

/* ---------------------------------------------------------------- canyon */

const canyonEl = $("#canyon");
const beats = $$(".beat", canyonEl);
// Scroll progress (0..1) during which each beat is on screen.
const BEATS = [
  [0, 0.05],
  [0.3, 0.44],
  [0.47, 0.61],
  [0.64, 0.77],
  [0.83, 1.01],
];

function canyonProgress() {
  const r = canyonEl.getBoundingClientRect();
  const span = r.height - window.innerHeight;
  return Math.max(0, Math.min(1, -r.top / Math.max(1, span)));
}

function updateBeats() {
  const p = canyonProgress();
  if (views.canyon) views.canyon.progress = p;
  beats.forEach((b, i) => b.classList.toggle("on", p >= BEATS[i][0] && p < BEATS[i][1]));
  canyonEl.classList.toggle("flying", p > 0.26 && p < 0.8);
}
window.addEventListener("scroll", updateBeats, { passive: true });
updateBeats();

function canyonStatus() {
  const v = views.canyon;
  if (!v) return null;
  const file = v.fileAt(v.band);
  const ln = v.band - file.start + 1;
  $("#cy-file").textContent = file.path;
  $("#cy-range").textContent = `lines ${ln}–${ln + BAND - 1} · painted`;
  return { file: file.path.replace(/^src\//, ""), pos: `Ln ${ln}, Col 1` };
}

const chrome = mountChrome({
  fileOf(section) {
    return section?.id === "canyon" ? canyonStatus() : null;
  },
});

/* ------------------------------------------------------------- workbench */

const costOp = $("#cost-op");
const costDetail = $("#cost-detail");
const decision = $("#undo-decision");

const editor = mountEditor($("#editor"), {
  onChange(detail, state) {
    views.vector?.sync(state.buffer.lines, state.cursor);
    views.undo?.layout();
    if (detail.kind === "edit") {
      const c = describeCost(detail, state);
      costOp.textContent = c.op;
      costDetail.textContent = c.detail;
      const rec = detail.undo;
      if (rec) {
        decision.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = rec.joined ? "Joined the top group" : "New group";
        decision.append(b, document.createTextNode(rec.joined ? " — same kind, adjacent, same side of a word boundary, within 400 ms." : ` — ${BREAK_REASONS[rec.reason] || rec.reason}.`));
      }
    } else if (detail.kind === "undo" || detail.kind === "redo") {
      decision.textContent = `${detail.kind === "undo" ? "Undo" : "Redo"} replayed ${detail.actions.length} action${detail.actions.length === 1 ? "" : "s"} as one step.`;
      costOp.textContent = detail.kind === "undo" ? "performUndo()" : "performRedo()";
      costDetail.textContent = describeCost({ kind: "move" }, state).detail;
    }
  },
});
$("#undo-btn").addEventListener("click", () => editor.state.performUndo());
$("#redo-btn").addEventListener("click", () => editor.state.performRedo());

/* ----------------------------------------------------------------- lexer */

const lexInput = $("#lex-input");
const lexLanes = $("#lex-lanes");
let sampleAt = 0;
function renderLanes(counts) {
  lexLanes.replaceChildren();
  LANE_ORDER.forEach((type, k) => {
    const li = document.createElement("li");
    li.style.color = TOKEN_HEX[type];
    li.textContent = TOKEN_NAMES[type];
    const b = document.createElement("b");
    b.textContent = counts ? counts[k] : 0;
    li.append(b);
    lexLanes.append(li);
  });
}
renderLanes(null);
function runLexer() {
  views.lexer?.load(lexInput.value);
}
$("#lex-run").addEventListener("click", runLexer);
$("#lex-next").addEventListener("click", () => {
  sampleAt = (sampleAt + 1) % LEX_SAMPLES.length;
  lexInput.value = LEX_SAMPLES[sampleAt];
  runLexer();
});
let lexTimer = 0;
lexInput.addEventListener("input", () => {
  clearTimeout(lexTimer);
  lexTimer = setTimeout(runLexer, 350);
});
lexInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runLexer();
});

/* ------------------------------------------------------------------ arch */

const archFile = $("#arch-file");
const callpath = $$("#callpath li");
function showFile(file) {
  archFile.replaceChildren();
  if (!file) {
    const p = document.createElement("p");
    p.className = "fine";
    p.textContent = "Point at a tower to read the file.";
    archFile.append(p);
    return;
  }
  const h = document.createElement("h4");
  h.textContent = file.path;
  const loc = document.createElement("p");
  loc.className = "loc";
  loc.textContent = `${file.lines.toLocaleString()} lines · ${file.layer}`;
  const role = document.createElement("p");
  role.textContent = ROLES[file.path] || "";
  archFile.append(h, loc, role);
}

/* ---------------------------------------------------------------- judge etc */

mountJudge({ reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
mountBench();
mountHistory();

/* ------------------------------------------------ downloads on a phone */

// A Windows installer is no use on a phone; say so, and let them have it anyway.
const isHandheld = () => window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
const mobileDialog = $("#mobile-dl");
$$('a[href$="Valence_V3_Setup.exe"]').forEach((a) => {
  if (a.id === "mdl-anyway") return;
  a.addEventListener("click", (e) => {
    if (!isHandheld() || !mobileDialog?.showModal) return;
    e.preventDefault();
    mobileDialog.showModal();
  });
});
$("#mdl-anyway")?.addEventListener("click", () => mobileDialog.close());

/* ------------------------------------------------------------------ boot */

async function boot() {
  if (!webgl2Available()) return fallback();
  try {
    stage = new Stage($("#gl"));
  } catch (error) {
    console.error("Valence: WebGL stage failed", error);
    return fallback();
  }
  stage.onContextLost = fallback;
  const atlas = await glyphAtlas(stage.renderer);
  document.documentElement.classList.add("gl");
  views.canyon = createCanyon(stage, atlas, $("[data-view='canyon']"));
  views.vector = createVectorView(stage, atlas, $("[data-view='vector']"), editor.state);
  views.vector.sync(editor.state.buffer.lines, editor.state.cursor);
  views.undo = createUndoView(stage, atlas, $("[data-view='undo']"), editor.state.undo);
  views.lexer = createLexerView(stage, atlas, $("[data-view='lexer']"));
  views.lexer.on(({ counts }) => renderLanes(counts));
  // Run the machine the first time it comes into view, not while off screen.
  views.lexer.onVisibility = (on) => {
    if (on && !views.lexer.ran) {
      views.lexer.ran = true;
      runLexer();
    }
  };
  views.arch = createArchView(stage, atlas, $("[data-view='arch']"));
  views.arch.on("hover", showFile);
  views.arch.on("step", (i) => callpath.forEach((li, j) => li.classList.toggle("on", j === i)));
  updateBeats();

  const fps = $("#st-fps");
  setInterval(() => {
    fps.textContent = `${stage.fps} fps`;
    chrome.update();
  }, 500);
  stage.start();
  window.__valence = { stage, views, editor };
}

function fallback() {
  $(".canyon-fallback").hidden = false;
  $("#cy-fallback-code").textContent = SOURCE_LINES.slice(0, 80).join("\n");
  $("#gl").hidden = true;
}

boot();
