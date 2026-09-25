/* Valence's undo history, ported from src/core/undo_manager.cpp.
 *
 * Command pattern: every edit is recorded as an action; actions are grouped so
 * Ctrl+Z undoes a word rather than a character. The grouping rule is the C++
 * shouldGroup(), branch for branch. The one addition is that the port can say
 * *why* a new group started, which the page shows as you type.
 *
 * The clock is injectable so tests can replay the golden scripts produced by
 * running the real undo_manager.cpp against a fake steady_clock.
 */

export const INSERT = 0;
export const DELETE = 1;
export const GROUP_TIMEOUT_MS = 400;
export const MAX_GROUPS = 4000;

const isSpace = (s) => s === " " || s === "\t";

export class UndoManager {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.undoStack = [];
    this.redoStack = [];
    this.forceNext = false;
    this.compoundDepth = 0;
    this.compoundStarted = false;
    this.lastReason = null;
  }

  /** shouldGroup(), returning the reason it would not group (or null if it would). */
  groupBreak(action) {
    if (this.forceNext) return "forced";
    if (!this.undoStack.length || !this.undoStack[this.undoStack.length - 1].length) return "first";
    const group = this.undoStack[this.undoStack.length - 1];
    const last = group[group.length - 1];
    if (last.type !== action.type) return "kind";
    if (last.text.length !== 1 || action.text.length !== 1) return "length";
    if (isSpace(last.text[0]) !== isSpace(action.text[0])) return "whitespace";
    // duration_cast<milliseconds> truncates, so 400.9 ms still counts as 400.
    if (Math.trunc(action.time - last.time) > GROUP_TIMEOUT_MS) return "timeout";
    if (action.type === INSERT) {
      if (action.pos.row !== last.pos.row) return "adjacency";
      if (action.pos.col !== last.pos.col + last.text.length) return "adjacency";
    } else if (action.pos.row !== last.pos.row) {
      return "adjacency";
    }
    return null;
  }

  recordInsert(pos, text) {
    return this._record({ type: INSERT, pos: { ...pos }, text, time: this.now() });
  }

  recordDelete(pos, text) {
    return this._record({ type: DELETE, pos: { ...pos }, text, time: this.now() });
  }

  _record(action) {
    this.redoStack.length = 0;
    return this._push(action);
  }

  _push(action) {
    let reason;
    if (this.compoundDepth > 0 && this.compoundStarted && this.undoStack.length) {
      this.undoStack[this.undoStack.length - 1].push(action);
      reason = "compound";
    } else {
      reason = this.groupBreak(action);
      if (reason === null) {
        this.undoStack[this.undoStack.length - 1].push(action);
      } else {
        this.undoStack.push([action]);
        if (this.undoStack.length > MAX_GROUPS) this.undoStack.splice(0, this.undoStack.length - MAX_GROUPS);
      }
    }
    if (this.compoundDepth > 0) this.compoundStarted = true;
    this.forceNext = false;
    // null means the action joined the previous group.
    this.lastReason = reason === "compound" ? null : reason;
    return { action, joined: this.lastReason === null, reason: this.lastReason };
  }

  beginCompound() {
    if (this.compoundDepth++ === 0) {
      this.forceNext = true;
      this.compoundStarted = false;
    }
  }

  endCompound() {
    if (this.compoundDepth > 0 && --this.compoundDepth === 0) {
      this.compoundStarted = false;
      this.forceNext = true;
    }
  }

  forceNewGroup() {
    this.forceNext = true;
  }

  /** { valid, actions } with actions in reverse order, as the C++ returns them. */
  undo() {
    if (!this.undoStack.length) return { valid: false, actions: [] };
    const group = this.undoStack.pop();
    this.redoStack.push(group);
    return { valid: true, actions: group.slice().reverse() };
  }

  redo() {
    if (!this.redoStack.length) return { valid: false, actions: [] };
    const group = this.redoStack.pop();
    this.undoStack.push(group);
    return { valid: true, actions: group.slice() };
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.forceNext = false;
  }
}

export const BREAK_REASONS = {
  first: "first edit",
  forced: "structural edit -- always its own step",
  kind: "insert after delete (or the reverse)",
  length: "multi-character edit",
  whitespace: "word boundary: space vs. letter",
  timeout: `more than ${GROUP_TIMEOUT_MS} ms since the last keystroke`,
  adjacency: "not next to the previous edit",
};
