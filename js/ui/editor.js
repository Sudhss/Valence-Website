/* A working Valence editor surface, drawn the way EditorWidget draws itself.
 *
 * The same passes as paintEvent: fill, current-line wash, selection, tokens
 * coloured by the ported tokenizer, the gutter, and the caret -- a 2 px teal
 * bar with a 6 px glow behind it, blinking every 500 ms and held solid while
 * you type. Only visible rows are tokenized and drawn. Scrolling eases over
 * 140 ms with an out-cubic curve, like the editor's scroll animation.
 *
 * Editing behaviour is js/core/editing.js, a port of EditorWidget's handlers.
 * Esc releases the keyboard, because Tab is claimed for indentation.
 */

import { EditorState } from "../core/editing.js";
import { tokenize, commentStates, TOKEN } from "../core/lexer.js";

const THEME = {
  surface: "#15171d",
  currentLine: "rgba(255,255,255,0.043)",
  selection: "rgba(47,224,160,0.157)",
  gutterText: "rgba(233,236,241,0.4)",
  gutterCur: "rgba(233,236,241,0.63)",
  accent: "#2fe0a0",
  accentGlow: "rgba(47,224,160,0.25)",
  tokens: {
    [TOKEN.Plain]: "#e9ecf1",
    [TOKEN.Keyword]: "#56d1ff",
    [TOKEN.Type]: "#82aaff",
    [TOKEN.String]: "#c3e88d",
    [TOKEN.Comment]: "rgba(233,236,241,0.376)",
    [TOKEN.Number]: "#ffb74d",
    [TOKEN.Preprocessor]: "#c792ea",
    [TOKEN.Function]: "#82e787",
    [TOKEN.Punctuation]: "rgba(233,236,241,0.647)",
  },
};

export const SCRATCH = `// scratch.cpp -- this editor runs Valence's rules.
#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> a = {3, 1, 4, 1, 5, 9, 2, 6};
    sort(a.begin(), a.end());
    for (int x : a) cout << x << ' ';
    return 0;
}`;

export function mountEditor(host, { onChange } = {}) {
  const canvas = host.querySelector("canvas");
  const input = host.querySelector("textarea");
  const popup = host.querySelector(".ed-popup");
  const posEl = document.getElementById("ed-pos");
  const linesEl = document.getElementById("ed-lines");
  const ctx = canvas.getContext("2d");
  const state = new EditorState(SCRATCH);
  state.cursor = { row: 6, col: 4 };

  const FONT_PX = 14;
  const LINE_H = 21;
  const PAD_TOP = 10;
  let charW = 8.4;
  let gutterW = 44;
  let dpr = 1;
  let width = 0;
  let height = 0;
  let scrollY = 0;
  let scrollTarget = 0;
  let scrollFrom = 0;
  let scrollStart = 0;
  let blinkEpoch = performance.now();
  let focused = false;
  let states = commentStates(state.buffer.lines);
  let matches = [];
  let dragging = false;

  function measure() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = r.width;
    height = r.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `400 ${FONT_PX}px "JetBrains Mono", Consolas, monospace`;
    charW = ctx.measureText("M").width;
    updateGutter();
    draw();
  }

  function updateGutter() {
    const digits = String(state.buffer.lineCount()).length;
    gutterW = Math.max(3, digits) * charW + 28;
  }

  const xFromCol = (col) => gutterW + 8 + col * charW;
  const yFromRow = (row) => PAD_TOP + row * LINE_H - scrollY;

  function posFromPoint(x, y) {
    const row = Math.max(0, Math.min(state.buffer.lineCount() - 1, Math.floor((y + scrollY - PAD_TOP) / LINE_H)));
    const col = Math.max(0, Math.min(state.buffer.lineLength(row), Math.round((x - gutterW - 8) / charW)));
    return { row, col };
  }

  function maxScroll() {
    return Math.max(0, PAD_TOP * 2 + state.buffer.lineCount() * LINE_H - height);
  }

  function ensureCursorVisible() {
    const top = PAD_TOP + state.cursor.row * LINE_H;
    let target = scrollTarget;
    if (top < target + LINE_H) target = top - LINE_H;
    if (top + LINE_H > target + height - LINE_H) target = top + 2 * LINE_H - height;
    scrollTo(target);
  }

  function scrollTo(target) {
    target = Math.max(0, Math.min(maxScroll(), target));
    if (Math.abs(target - scrollTarget) < 0.5) return;
    scrollFrom = scrollY;
    scrollTarget = target;
    scrollStart = performance.now();
    requestAnimationFrame(animateScroll);
  }

  function animateScroll(now) {
    const t = Math.min(1, (now - scrollStart) / 140);
    const e = 1 - Math.pow(1 - t, 3); // OutCubic
    scrollY = scrollFrom + (scrollTarget - scrollFrom) * e;
    draw();
    if (t < 1) requestAnimationFrame(animateScroll);
  }

  function draw() {
    const b = state.buffer;
    ctx.fillStyle = THEME.surface;
    ctx.fillRect(0, 0, width, height);
    ctx.font = `400 ${FONT_PX}px "JetBrains Mono", Consolas, monospace`;
    ctx.textBaseline = "middle";

    // Only the rows on screen, exactly like paintEvent.
    const startRow = Math.max(0, Math.floor((scrollY - PAD_TOP) / LINE_H));
    const endRow = Math.min(b.lineCount(), Math.ceil((scrollY + height) / LINE_H) + 1);
    const range = state.selectionRange();

    for (let row = startRow; row < endRow; row += 1) {
      const y = yFromRow(row);
      if (row === state.cursor.row) {
        ctx.fillStyle = THEME.currentLine;
        ctx.fillRect(gutterW, y, width - gutterW, LINE_H);
      }
      if (range && row >= range[0].row && row <= range[1].row) {
        const from = row === range[0].row ? xFromCol(range[0].col) : gutterW;
        const to = row === range[1].row ? xFromCol(range[1].col) : xFromCol(b.lineLength(row)) + charW;
        ctx.fillStyle = THEME.selection;
        ctx.fillRect(from, y, Math.max(0, to - from), LINE_H);
      }
      const line = b.line(row);
      for (const t of tokenize(line, { inBlockComment: states[row] })) {
        if (t.type === TOKEN.Plain && line[t.start] === " ") continue;
        ctx.fillStyle = THEME.tokens[t.type];
        ctx.fillText(line.substr(t.start, t.length), xFromCol(t.start), y + LINE_H / 2 + 0.5);
      }
    }

    // Gutter shares the surface: no band, no rule.
    ctx.fillStyle = THEME.surface;
    ctx.fillRect(0, 0, gutterW, height);
    ctx.textAlign = "right";
    for (let row = startRow; row < endRow; row += 1) {
      ctx.fillStyle = row === state.cursor.row ? THEME.gutterCur : THEME.gutterText;
      ctx.fillText(String(row + 1), gutterW - 14, yFromRow(row) + LINE_H / 2 + 0.5);
    }
    ctx.textAlign = "left";

    // Caret with glow; solid for a beat after each keystroke.
    const blinkOn = !focused || Math.floor((performance.now() - blinkEpoch) / 500) % 2 === 0;
    if (blinkOn) {
      const cx = xFromCol(state.cursor.col);
      const cy = yFromRow(state.cursor.row);
      ctx.fillStyle = THEME.accentGlow;
      ctx.fillRect(cx - 2, cy, 6, LINE_H);
      ctx.fillStyle = focused ? THEME.accent : "rgba(47,224,160,0.45)";
      ctx.fillRect(cx, cy, 2, LINE_H);
    }
  }

  function refreshStatus() {
    posEl.textContent = `Ln ${state.cursor.row + 1}, Col ${state.cursor.col + 1}`;
    linesEl.textContent = `${state.buffer.lineCount()} lines`;
  }

  function showSnippets() {
    matches = state.snippetMatches();
    if (!matches.length || !focused) {
      popup.hidden = true;
      return;
    }
    const { start } = state.wordBeforeCursor();
    popup.innerHTML = "";
    for (const m of matches) {
      const row = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = m.trigger;
      const d = document.createElement("span");
      d.textContent = `${m.detail} · Tab`;
      row.append(b, d);
      popup.append(row);
    }
    popup.style.left = `${Math.min(width - 250, xFromCol(start))}px`;
    popup.style.top = `${yFromRow(state.cursor.row) + LINE_H + 2}px`;
    popup.hidden = false;
  }

  state.on((detail) => {
    if (detail.kind !== "move" && detail.kind !== "select") {
      states = commentStates(state.buffer.lines);
      updateGutter();
    }
    blinkEpoch = performance.now();
    ensureCursorVisible();
    refreshStatus();
    if (detail.kind === "edit" || detail.kind === "move") showSnippets();
    draw();
    onChange?.(detail, state);
  });

  // ---- input -------------------------------------------------------------
  function focus() {
    input.focus({ preventScroll: true });
  }
  host.addEventListener("focus", focus);
  input.addEventListener("focus", () => {
    focused = true;
    blinkEpoch = performance.now();
    draw();
  });
  input.addEventListener("blur", () => {
    focused = false;
    popup.hidden = true;
    draw();
  });

  input.addEventListener("input", () => {
    const text = input.value;
    input.value = "";
    for (const ch of text) {
      if (ch === "\n") state.enter();
      else if (ch >= " " || ch === "\t") state.typeChar(ch === "\t" ? " " : ch);
    }
  });

  input.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const handled = () => e.preventDefault();

    if (!popup.hidden && (key === "Tab" || key === "Enter") && matches.length) {
      handled();
      state.acceptSnippet(matches[0]);
      popup.hidden = true;
      return;
    }
    if (key === "Escape") {
      if (!popup.hidden) popup.hidden = true;
      else input.blur();
      return handled();
    }
    if (ctrl && (key === "z" || key === "Z")) {
      handled();
      if (e.shiftKey) state.performRedo();
      else state.performUndo();
      return;
    }
    if (ctrl && (key === "y" || key === "Y")) return handled(), state.performRedo();
    if (ctrl && (key === "a" || key === "A")) return handled(), state.selectAll();
    if (ctrl && (key === "c" || key === "x" || key === "v")) return; // clipboard events below

    switch (key) {
      case "ArrowLeft":
        handled();
        return state.move("left", { extend: e.shiftKey, word: ctrl });
      case "ArrowRight":
        handled();
        return state.move("right", { extend: e.shiftKey, word: ctrl });
      case "ArrowUp":
        handled();
        return state.move("up", { extend: e.shiftKey });
      case "ArrowDown":
        handled();
        return state.move("down", { extend: e.shiftKey });
      case "Home":
        handled();
        return state.move("home", { extend: e.shiftKey });
      case "End":
        handled();
        return state.move("end", { extend: e.shiftKey });
      case "Backspace":
        handled();
        return state.backspace(ctrl);
      case "Delete":
        handled();
        return state.deleteForward();
      case "Enter":
        handled();
        return state.enter();
      case "Tab":
        handled();
        return state.tab(e.shiftKey);
      default:
        break;
    }
  });

  input.addEventListener("copy", (e) => {
    e.preventDefault();
    e.clipboardData.setData("text/plain", state.selectedText());
  });
  input.addEventListener("cut", (e) => {
    e.preventDefault();
    e.clipboardData.setData("text/plain", state.selectedText());
    state.deleteSelection();
  });
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    if (text) state.paste(text.slice(0, 20000));
  });

  host.addEventListener("pointerdown", (e) => {
    const r = host.getBoundingClientRect();
    const pos = posFromPoint(e.clientX - r.left, e.clientY - r.top);
    state.moveTo(pos, e.shiftKey);
    dragging = true;
    host.setPointerCapture(e.pointerId);
    focus();
    e.preventDefault();
  });
  host.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const r = host.getBoundingClientRect();
    state.moveTo(posFromPoint(e.clientX - r.left, e.clientY - r.top), true);
  });
  host.addEventListener("pointerup", () => {
    dragging = false;
  });
  host.addEventListener(
    "wheel",
    (e) => {
      if (maxScroll() <= 0) return;
      const next = Math.max(0, Math.min(maxScroll(), scrollTarget + e.deltaY));
      if (next === scrollTarget) return; // let the page scroll at the ends
      e.preventDefault();
      scrollTo(next);
    },
    { passive: false }
  );

  // Blink without a timer per frame: redraw at each half-second edge.
  setInterval(() => {
    if (focused) draw();
  }, 250);

  new ResizeObserver(measure).observe(host);
  document.fonts?.ready.then(measure);
  measure();
  refreshStatus();
  return { state, focus };
}
