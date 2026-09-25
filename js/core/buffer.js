/* Valence's document model, ported from src/core/text_buffer.cpp.
 *
 * std::vector<std::string> lines_: one string per line, no newlines stored,
 * never empty. Every method mirrors its C++ counterpart, including the
 * clamping, so an out-of-range position behaves the same way in both.
 *
 * Each mutation also reports what it cost in the C++ original -- how many
 * bytes std::string::insert/erase had to shift and how many std::string
 * objects std::vector had to move -- because that cost is the whole argument
 * for (and against) a line array, and the page draws it.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** sizeof(std::string) with libstdc++ on 64-bit MinGW. */
export const STRING_OBJECT_BYTES = 32;

export class TextBuffer {
  constructor(text) {
    this.lines = [""];
    this.lastCost = null;
    if (text !== undefined) this.setText(text);
  }

  setText(text) {
    const lines = String(text).split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    this.lines = lines.length ? lines : [""];
  }

  text() {
    return this.lines.join("\n");
  }

  lineCount() {
    return this.lines.length;
  }

  line(row) {
    return row >= 0 && row < this.lines.length ? this.lines[row] : "";
  }

  lineLength(row) {
    return this.line(row).length;
  }

  _cost(op, row, bytesShifted, objectsMoved) {
    this.lastCost = { op, row, bytesShifted, objectsMoved };
  }

  insertChar(row, col, ch) {
    if (row < 0 || row >= this.lines.length) return;
    const l = this.lines[row];
    col = clamp(col, 0, l.length);
    this.lines[row] = l.slice(0, col) + ch + l.slice(col);
    this._cost("insertChar", row, l.length - col, 0);
  }

  deleteChar(row, col) {
    if (row < 0 || row >= this.lines.length) return;
    if (col <= 0) {
      this.mergeLines(row);
      return;
    }
    const l = this.lines[row];
    if (col <= l.length) {
      this.lines[row] = l.slice(0, col - 1) + l.slice(col);
      this._cost("deleteChar", row, l.length - col, 0);
    }
  }

  splitLine(row, col) {
    if (row < 0 || row >= this.lines.length) return;
    const l = this.lines[row];
    col = clamp(col, 0, l.length);
    this.lines.splice(row + 1, 0, l.slice(col));
    this.lines[row] = l.slice(0, col);
    this._cost("splitLine", row, 0, this.lines.length - row - 2);
  }

  mergeLines(row) {
    if (row <= 0 || row >= this.lines.length) return;
    const moved = this.lines.length - row - 1;
    this.lines[row - 1] += this.lines[row];
    this.lines.splice(row, 1);
    this._cost("mergeLines", row, 0, moved);
  }

  getText(start, end) {
    if (comparePos(start, end) > 0) [start, end] = [end, start];
    if (start.row === end.row) {
      const l = this.line(start.row);
      const s = clamp(start.col, 0, l.length);
      const e = clamp(end.col, 0, l.length);
      return l.slice(s, e);
    }
    let result = this.line(start.row).slice(start.col) + "\n";
    for (let r = start.row + 1; r < end.row; r += 1) result += this.lines[r] + "\n";
    const last = this.line(end.row);
    return result + last.slice(0, clamp(end.col, 0, last.length));
  }

  deleteRange(start, end) {
    if (comparePos(start, end) > 0) [start, end] = [end, start];
    if (start.row === end.row) {
      const l = this.line(start.row);
      const s = clamp(start.col, 0, l.length);
      const e = clamp(end.col, 0, l.length);
      this.lines[start.row] = l.slice(0, s) + l.slice(e);
      this._cost("deleteRange", start.row, l.length - e, 0);
      return;
    }
    const prefix = this.line(start.row).slice(0, start.col);
    const lastLine = this.line(end.row);
    const suffix = lastLine.slice(clamp(end.col, 0, lastLine.length));
    const moved = this.lines.length - end.row - 1;
    this.lines.splice(start.row, end.row - start.row + 1, prefix + suffix);
    this._cost("deleteRange", start.row, 0, moved);
  }

  /** Returns the cursor position after the inserted text, like the C++. */
  insertText(row, col, text) {
    if (!text) return { row, col };
    // std::getline splits on '\n' and drops a trailing empty field; the C++
    // then re-adds an empty line when the text ends with a newline.
    const parts = text.split("\n");
    if (parts.length && parts[parts.length - 1] === "") parts.pop();
    const newLines = parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    if (text.endsWith("\n")) newLines.push("");
    if (!newLines.length) return { row, col };

    const l = this.line(row);
    col = clamp(col, 0, l.length);
    const prefix = l.slice(0, col);
    const suffix = l.slice(col);

    if (newLines.length === 1) {
      this.lines[row] = prefix + newLines[0] + suffix;
      this._cost("insertText", row, suffix.length, 0);
      return { row, col: prefix.length + newLines[0].length };
    }
    const moved = this.lines.length - row - 1;
    const middle = newLines.slice(1, -1);
    const lastIdx = row + newLines.length - 1;
    this.lines.splice(row, 1, prefix + newLines[0], ...middle, newLines[newLines.length - 1] + suffix);
    this._cost("insertText", row, 0, moved);
    return { row: lastIdx, col: newLines[newLines.length - 1].length };
  }

  getLeadingWhitespace(row) {
    const l = this.line(row);
    let i = 0;
    while (i < l.length && (l[i] === " " || l[i] === "\t")) i += 1;
    return l.slice(0, i);
  }

  findWordBoundaryLeft(row, col) {
    if (col <= 0) return 0;
    const l = this.line(row);
    const alnum = (ch) => /[A-Za-z0-9]/.test(ch || "");
    const space = (ch) => /[ \t\n\v\f\r]/.test(ch || "");
    let i = col - 1;
    while (i > 0 && space(l[i])) i -= 1;
    if (i >= 0 && alnum(l[i])) {
      while (i > 0 && alnum(l[i - 1])) i -= 1;
    } else if (i >= 0) {
      while (i > 0 && !alnum(l[i - 1]) && !space(l[i - 1])) i -= 1;
    }
    return i;
  }

  findWordBoundaryRight(row, col) {
    const l = this.line(row);
    const len = l.length;
    if (col >= len) return len;
    const alnum = (ch) => /[A-Za-z0-9]/.test(ch || "");
    const space = (ch) => /[ \t\n\v\f\r]/.test(ch || "");
    let i = col;
    if (alnum(l[i])) {
      while (i < len && alnum(l[i])) i += 1;
    } else if (!space(l[i])) {
      while (i < len && !alnum(l[i]) && !space(l[i])) i += 1;
    }
    while (i < len && space(l[i])) i += 1;
    return i;
  }
}

export function comparePos(a, b) {
  return a.row - b.row || a.col - b.col;
}

/** Where the caret ends after `text` is laid down starting at `pos`. */
export function advance(pos, text) {
  let { row, col } = pos;
  for (const ch of text) {
    if (ch === "\n") {
      row += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return { row, col };
}
