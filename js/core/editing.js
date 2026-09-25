/* Valence's editing behaviour, ported from src/editor/editor_widget.cpp.
 *
 * handleChar (auto-close pairs, step over closers, re-indent a typed '}'),
 * handleBackspace (delete an empty auto-inserted pair as one), handleEnter
 * (carry indentation, open a block between braces), handleTab (four spaces,
 * block indent), the cppmain snippet, and undo/redo applied to the buffer
 * exactly as performUndo/performRedo do.
 *
 * Pure state and logic. The canvas that draws it lives in js/ui/editor.js.
 */

import { TextBuffer, comparePos, advance } from "./buffer.js";
import { UndoManager } from "./undo.js";
import { tokenize, TOKEN } from "./lexer.js";

export const INDENT_WIDTH = 4;

const closerFor = (open) => ({ "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" })[open] || "";
const isCloser = (c) => c === ")" || c === "]" || c === "}" || c === '"' || c === "'";
const isIdentLike = (c) => !!c && /[A-Za-z0-9_]/.test(c);

export const SNIPPETS = [
  {
    trigger: "cppmain",
    detail: "C++ template",
    body: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \u0001\n    return 0;\n}",
  },
];
export const SNIPPET_MIN_PREFIX = 3;

export class EditorState {
  constructor(text = "", now) {
    this.buffer = new TextBuffer(text);
    this.undo = new UndoManager(now);
    this.cursor = { row: 0, col: 0 };
    this.anchor = null; // selection anchor, null when no selection
    this.listeners = new Set();
    this.version = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed(detail) {
    this.version += 1;
    for (const fn of this.listeners) fn(detail);
  }

  /* ------------------------------------------------------------ selection */

  hasSelection() {
    return this.anchor !== null && comparePos(this.anchor, this.cursor) !== 0;
  }

  selectionRange() {
    if (!this.hasSelection()) return null;
    return comparePos(this.anchor, this.cursor) < 0 ? [this.anchor, this.cursor] : [this.cursor, this.anchor];
  }

  selectAll() {
    this.anchor = { row: 0, col: 0 };
    const last = this.buffer.lineCount() - 1;
    this.cursor = { row: last, col: this.buffer.lineLength(last) };
    this._changed({ kind: "select" });
  }

  deleteSelection() {
    const range = this.selectionRange();
    if (!range) return;
    const [start, end] = range;
    const text = this.buffer.getText(start, end);
    const rec = this.undo.recordDelete(start, text);
    this.undo.forceNewGroup();
    this.buffer.deleteRange(start, end);
    this.cursor = { ...start };
    this.anchor = null;
    this._changed({ kind: "edit", op: "deleteSelection", undo: rec });
  }

  /* ------------------------------------------------------------- movement */

  moveTo(pos, extend = false) {
    if (extend && !this.anchor) this.anchor = { ...this.cursor };
    if (!extend) this.anchor = null;
    const row = Math.max(0, Math.min(pos.row, this.buffer.lineCount() - 1));
    const col = Math.max(0, Math.min(pos.col, this.buffer.lineLength(row)));
    this.cursor = { row, col };
    this._changed({ kind: "move" });
  }

  move(direction, { extend = false, word = false } = {}) {
    const { row, col } = this.cursor;
    const b = this.buffer;
    if (!extend && this.hasSelection() && (direction === "left" || direction === "right")) {
      const [start, end] = this.selectionRange();
      this.moveTo(direction === "left" ? start : end);
      return;
    }
    if (direction === "left") {
      if (col > 0) this.moveTo({ row, col: word ? b.findWordBoundaryLeft(row, col) : col - 1 }, extend);
      else if (row > 0) this.moveTo({ row: row - 1, col: b.lineLength(row - 1) }, extend);
    } else if (direction === "right") {
      if (col < b.lineLength(row)) this.moveTo({ row, col: word ? b.findWordBoundaryRight(row, col) : col + 1 }, extend);
      else if (row < b.lineCount() - 1) this.moveTo({ row: row + 1, col: 0 }, extend);
    } else if (direction === "up") {
      this.moveTo({ row: row - 1, col }, extend);
    } else if (direction === "down") {
      this.moveTo({ row: row + 1, col }, extend);
    } else if (direction === "home") {
      const indent = b.getLeadingWhitespace(row).length;
      this.moveTo({ row, col: col === indent ? 0 : indent }, extend);
    } else if (direction === "end") {
      this.moveTo({ row, col: b.lineLength(row) }, extend);
    }
  }

  /* ---------------------------------------------------------------- edits */

  typeChar(ch) {
    if (this.hasSelection()) this.deleteSelection();
    const b = this.buffer;
    const line = b.line(this.cursor.row);
    const nextCh = this.cursor.col < line.length ? line[this.cursor.col] : "";
    const prevCh = this.cursor.col > 0 ? line[this.cursor.col - 1] : "";

    // Typing a closer that is already under the caret steps over it.
    if (isCloser(ch) && nextCh === ch) {
      this.cursor.col += 1;
      this._changed({ kind: "move", op: "stepOver" });
      return;
    }

    if (ch === "}") this.undo.beginCompound();
    const at = { ...this.cursor };
    b.insertChar(at.row, at.col, ch);
    const cost = b.lastCost;
    const rec = this.undo.recordInsert(at, ch);
    this.cursor.col += 1;

    let paired = false;
    if (ch === "}") {
      this._reindentClosingBrace();
      this.undo.endCompound();
    } else {
      const closing = closerFor(ch);
      const suppress = isIdentLike(nextCh) || ((ch === '"' || ch === "'") && isIdentLike(prevCh));
      if (closing && !suppress) {
        b.insertChar(this.cursor.row, this.cursor.col, closing);
        this.undo.recordInsert({ ...this.cursor }, closing);
        paired = true;
      }
    }
    this.anchor = null;
    this._changed({ kind: "edit", op: "insertChar", at, ch, paired, cost, undo: rec });
  }

  backspace(ctrl = false) {
    if (this.hasSelection()) return this.deleteSelection();
    const b = this.buffer;
    const { row, col } = this.cursor;

    if (ctrl) {
      const newCol = b.findWordBoundaryLeft(row, col);
      if (newCol === col && col === 0 && row > 0) return this._mergeUp();
      const start = { row, col: newCol };
      const rec = this.undo.recordDelete(start, b.getText(start, this.cursor));
      this.undo.forceNewGroup();
      b.deleteRange(start, this.cursor);
      this.cursor.col = newCol;
      this._changed({ kind: "edit", op: "deleteRange", cost: b.lastCost, undo: rec });
      return;
    }

    if (col > 0) {
      const l = b.line(row);
      const left = l[col - 1];
      const right = col < l.length ? l[col] : "";
      if (right && closerFor(left) === right) {
        const start = { row, col: col - 1 };
        const end = { row, col: col + 1 };
        const rec = this.undo.recordDelete(start, b.getText(start, end));
        this.undo.forceNewGroup();
        b.deleteRange(start, end);
        this.cursor.col -= 1;
        this._changed({ kind: "edit", op: "deletePair", cost: b.lastCost, undo: rec });
        return;
      }
      const rec = this.undo.recordDelete({ row, col: col - 1 }, left);
      b.deleteChar(row, col);
      this.cursor.col -= 1;
      this._changed({ kind: "edit", op: "deleteChar", cost: b.lastCost, undo: rec });
    } else if (row > 0) {
      this._mergeUp();
    }
  }

  _mergeUp() {
    const b = this.buffer;
    const row = this.cursor.row;
    const prevLen = b.lineLength(row - 1);
    const rec = this.undo.recordDelete({ row: row - 1, col: prevLen }, "\n");
    this.undo.forceNewGroup();
    b.mergeLines(row);
    this.cursor = { row: row - 1, col: prevLen };
    this._changed({ kind: "edit", op: "mergeLines", cost: b.lastCost, undo: rec });
  }

  deleteForward() {
    if (this.hasSelection()) return this.deleteSelection();
    const b = this.buffer;
    const { row, col } = this.cursor;
    if (col < b.lineLength(row)) {
      const rec = this.undo.recordDelete({ row, col }, b.line(row)[col]);
      b.deleteRange({ row, col }, { row, col: col + 1 });
      this._changed({ kind: "edit", op: "deleteChar", cost: b.lastCost, undo: rec });
    } else if (row < b.lineCount() - 1) {
      const rec = this.undo.recordDelete({ row, col }, "\n");
      this.undo.forceNewGroup();
      b.mergeLines(row + 1);
      this._changed({ kind: "edit", op: "mergeLines", cost: b.lastCost, undo: rec });
    }
  }

  enter() {
    if (this.hasSelection()) this.deleteSelection();
    const b = this.buffer;
    const indent = b.getLeadingWhitespace(this.cursor.row);
    const line = b.line(this.cursor.row);
    let lastCode = "";
    for (let i = Math.min(this.cursor.col, line.length) - 1; i >= 0; i -= 1) {
      if (line[i] !== " " && line[i] !== "\t") {
        lastCode = line[i];
        break;
      }
    }
    let nextCode = "";
    for (let i = this.cursor.col; i < line.length; i += 1) {
      if (line[i] !== " " && line[i] !== "\t") {
        nextCode = line[i];
        break;
      }
    }
    const opensBlock = lastCode === "{";
    const between = opensBlock && nextCode === "}";
    const nextIndent = indent + (opensBlock ? " ".repeat(INDENT_WIDTH) : "");
    const at = { ...this.cursor };
    const text = between ? `\n${nextIndent}\n${indent}` : `\n${nextIndent}`;
    const rec = this.undo.recordInsert(at, text);
    this.undo.forceNewGroup();
    const end = b.insertText(at.row, at.col, text);
    const cost = b.lastCost;
    this.cursor = between ? { row: at.row + 1, col: nextIndent.length } : end;
    this._changed({ kind: "edit", op: "splitLine", at, cost, undo: rec });
  }

  tab(shift = false) {
    const range = this.selectionRange();
    if (range) {
      const [start, end] = range;
      let lastRow = end.row;
      if (end.col === 0 && lastRow > start.row) lastRow -= 1;
      if (shift || lastRow > start.row) {
        this._indentBlock(start.row, lastRow, shift);
        return;
      }
      this.deleteSelection();
    } else if (shift) {
      this._indentBlock(this.cursor.row, this.cursor.row, true);
      return;
    }
    const at = { ...this.cursor };
    const spaces = " ".repeat(INDENT_WIDTH);
    this.buffer.insertText(at.row, at.col, spaces);
    const cost = this.buffer.lastCost;
    this.cursor.col += INDENT_WIDTH;
    const rec = this.undo.recordInsert(at, spaces);
    this.undo.forceNewGroup();
    this._changed({ kind: "edit", op: "insertText", at, cost, undo: rec });
  }

  _indentBlock(first, last, unindent) {
    const b = this.buffer;
    this.undo.beginCompound();
    let rec = null;
    for (let row = first; row <= last && row < b.lineCount(); row += 1) {
      const line = b.line(row);
      if (unindent) {
        let strip = 0;
        while (strip < INDENT_WIDTH && strip < line.length && line[strip] === " ") strip += 1;
        if (strip === 0 && line[0] === "\t") strip = 1;
        if (!strip) continue;
        const r = this.undo.recordDelete({ row, col: 0 }, line.slice(0, strip));
        rec = rec || r;
        b.deleteRange({ row, col: 0 }, { row, col: strip });
        this._shiftCol(row, -strip);
      } else {
        if (!line.length) continue;
        const r = this.undo.recordInsert({ row, col: 0 }, " ".repeat(INDENT_WIDTH));
        rec = rec || r;
        b.insertText(row, 0, " ".repeat(INDENT_WIDTH));
        this._shiftCol(row, INDENT_WIDTH);
      }
    }
    this.undo.endCompound();
    this._changed({ kind: "edit", op: "indentBlock", cost: b.lastCost, undo: rec });
  }

  _shiftCol(row, delta) {
    if (this.cursor.row === row) this.cursor.col = Math.max(0, this.cursor.col + delta);
    if (this.anchor && this.anchor.row === row) this.anchor.col = Math.max(0, this.anchor.col + delta);
  }

  /* --------------------------------------------------- '}' re-indentation */

  _indentWidthOf(line) {
    let width = 0;
    for (const c of line) {
      if (c === " ") width += 1;
      else if (c === "\t") width += INDENT_WIDTH - (width % INDENT_WIDTH);
      else break;
    }
    return width;
  }

  _findMatchingOpenBrace(close) {
    const b = this.buffer;
    // Braces inside strings and comments are not structure; reuse the
    // tokenizer so this agrees with what is drawn.
    const states = [];
    const state = { inBlockComment: false };
    for (let r = 0; r <= close.row; r += 1) {
      states[r] = state.inBlockComment;
      tokenize(b.line(r), state);
    }
    let depth = 0;
    for (let row = close.row; row >= 0; row -= 1) {
      const line = b.line(row);
      const isCode = new Array(line.length).fill(false);
      for (const t of tokenize(line, { inBlockComment: states[row] })) {
        const codeTok = t.type !== TOKEN.String && t.type !== TOKEN.Comment;
        for (let i = 0; i < t.length; i += 1) isCode[t.start + i] = codeTok;
      }
      const startCol = row === close.row ? close.col - 1 : line.length - 1;
      for (let c = Math.min(startCol, line.length - 1); c >= 0; c -= 1) {
        if (!isCode[c]) continue;
        if (line[c] === "}") depth += 1;
        else if (line[c] === "{") {
          if (depth === 0) return { row, col: c };
          depth -= 1;
        }
      }
    }
    return null;
  }

  _reindentClosingBrace() {
    const b = this.buffer;
    const row = this.cursor.row;
    const brace = this.cursor.col - 1;
    const line = b.line(row);
    if (brace < 0 || line[brace] !== "}") return;
    for (let i = 0; i < brace; i += 1) if (line[i] !== " " && line[i] !== "\t") return;
    const open = this._findMatchingOpenBrace({ row, col: brace });
    const desired = open ? this._indentWidthOf(b.line(open.row)) : Math.max(0, this._indentWidthOf(line) - INDENT_WIDTH);
    const ws = " ".repeat(desired);
    if (brace === desired && line.startsWith(ws)) return;
    const start = { row, col: 0 };
    const removed = b.getText(start, { row, col: brace });
    if (removed) {
      this.undo.recordDelete(start, removed);
      b.deleteRange(start, { row, col: brace });
    }
    if (ws) {
      this.undo.recordInsert(start, ws);
      b.insertText(row, 0, ws);
    }
    this.cursor.col = desired + 1;
  }

  /* ------------------------------------------------------------- snippets */

  wordBeforeCursor() {
    const line = this.buffer.line(this.cursor.row);
    const end = Math.min(this.cursor.col, line.length);
    let start = end;
    while (start > 0 && isIdentLike(line[start - 1])) start -= 1;
    return { word: line.slice(start, end), start };
  }

  snippetMatches() {
    if (this.hasSelection()) return [];
    const { word } = this.wordBeforeCursor();
    if (word.length < SNIPPET_MIN_PREFIX) return [];
    return SNIPPETS.filter((s) => s.trigger.toLowerCase().startsWith(word.toLowerCase()));
  }

  acceptSnippet(snippet) {
    const { start } = this.wordBeforeCursor();
    const b = this.buffer;
    this.undo.beginCompound();
    const wordStart = { row: this.cursor.row, col: start };
    this.undo.recordDelete(wordStart, b.getText(wordStart, this.cursor));
    b.deleteRange(wordStart, this.cursor);
    this.cursor = wordStart;
    const marker = snippet.body.indexOf("\u0001");
    const before = marker >= 0 ? snippet.body.slice(0, marker) : snippet.body;
    const after = marker >= 0 ? snippet.body.slice(marker + 1) : "";
    const rec = this.undo.recordInsert(this.cursor, before);
    const caret = b.insertText(this.cursor.row, this.cursor.col, before);
    if (after) {
      this.undo.recordInsert(caret, after);
      b.insertText(caret.row, caret.col, after);
    }
    this.undo.endCompound();
    this.cursor = caret;
    this.anchor = null;
    this._changed({ kind: "edit", op: "snippet", cost: b.lastCost, undo: rec });
  }

  /* ------------------------------------------------------------ undo/redo */

  performUndo() {
    const result = this.undo.undo();
    if (!result.valid) return false;
    for (const action of result.actions) {
      if (action.type === 0) {
        this.buffer.deleteRange(action.pos, advance(action.pos, action.text));
        this.cursor = { ...action.pos };
      } else {
        this.buffer.insertText(action.pos.row, action.pos.col, action.text);
        this.cursor = advance(action.pos, action.text);
      }
    }
    this.anchor = null;
    this._changed({ kind: "undo", actions: result.actions });
    return true;
  }

  performRedo() {
    const result = this.undo.redo();
    if (!result.valid) return false;
    for (const action of result.actions) {
      if (action.type === 0) {
        this.cursor = this.buffer.insertText(action.pos.row, action.pos.col, action.text);
      } else {
        this.buffer.deleteRange(action.pos, advance(action.pos, action.text));
        this.cursor = { ...action.pos };
      }
    }
    this.anchor = null;
    this._changed({ kind: "redo", actions: result.actions });
    return true;
  }

  paste(text) {
    if (this.hasSelection()) this.deleteSelection();
    const at = { ...this.cursor };
    const rec = this.undo.recordInsert(at, text);
    this.undo.forceNewGroup();
    this.cursor = this.buffer.insertText(at.row, at.col, text);
    this._changed({ kind: "edit", op: "insertText", at, cost: this.buffer.lastCost, undo: rec });
  }

  selectedText() {
    const range = this.selectionRange();
    return range ? this.buffer.getText(range[0], range[1]) : "";
  }
}
