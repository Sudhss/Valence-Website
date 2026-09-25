/**
 * The page runs JavaScript ports of Valence's tokenizer, undo manager and
 * judge comparator. These tests hold each port to the output of the real C++
 * -- compiled from ../src and run by tools/golden/make_golden.py -- on the
 * same inputs, including every one of the 6,586 lines of Valence's source.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { tokenize } from "../js/core/lexer.js";
import { UndoManager } from "../js/core/undo.js";
import { outputsMatch, firstDifferingLine } from "../js/core/judge.js";
import { SOURCE_LINES, SOURCE_FILES } from "../js/data/source.js";

const golden = (name) => JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), "utf8"));
const unhex = (h) => (h ? Buffer.from(h, "hex").toString("latin1") : "");

test("source data is the whole of src/", () => {
  assert.equal(SOURCE_FILES.length, 31);
  assert.equal(SOURCE_LINES.length, SOURCE_FILES.reduce((n, f) => n + f.lines, 0));
  assert.equal(SOURCE_LINES.length, 6586);
});

test("tokenizer matches cpp_highlighter.cpp on every golden line", () => {
  let lines = 0;
  for (const doc of golden("lexer")) {
    const state = { inBlockComment: false };
    doc.lines.forEach((line, i) => {
      const got = tokenize(line, state).map((t) => [t.type, t.start, t.length]);
      assert.deepEqual(got, doc.out[i].t, `${doc.name}:${i + 1}: ${line}`);
      assert.equal(state.inBlockComment, doc.out[i].b, `${doc.name}:${i + 1} block state`);
      lines += 1;
    });
  }
  assert.ok(lines > 6500, `only ${lines} golden lines`);
});

test("tokens tile the line exactly", () => {
  for (const line of SOURCE_LINES.slice(0, 2000)) {
    let at = 0;
    for (const t of tokenize(line, { inBlockComment: false })) {
      assert.equal(t.start, at);
      assert.ok(t.length > 0);
      at += t.length;
    }
    assert.equal(at, line.length);
  }
});

function replay(script) {
  let clock = 1000;
  const um = new UndoManager(() => clock);
  const ops = [];
  const toGolden = (r) => (r.valid ? r.actions.map((a) => [a.type, a.pos.row, a.pos.col, a.text]) : [null]);
  for (const line of script) {
    const [op, ...args] = line.split(" ");
    if (op === "I" || op === "D") {
      const [row, col, hex, dt] = args;
      clock += Number(dt);
      const text = hex === "-" ? "" : unhex(hex);
      if (op === "I") um.recordInsert({ row: Number(row), col: Number(col) }, text);
      else um.recordDelete({ row: Number(row), col: Number(col) }, text);
    } else if (op === "F") um.forceNewGroup();
    else if (op === "B") um.beginCompound();
    else if (op === "E") um.endCompound();
    else if (op === "U") ops.push(toGolden(um.undo()));
    else if (op === "R") ops.push(toGolden(um.redo()));
  }
  const drain = [];
  for (;;) {
    const r = um.undo();
    if (!r.valid) break;
    drain.push(toGolden(r));
  }
  return { ops, drain };
}

test("undo grouping matches undo_manager.cpp on every golden script", () => {
  for (const g of golden("undo")) {
    const got = replay(g.script);
    const want = {
      ops: g.out.ops.map((r) => (r[0] === null ? [null] : r.map(([t, row, col, h]) => [t, row, col, unhex(h)]))),
      drain: g.out.drain.map((r) => r.map(([t, row, col, h]) => [t, row, col, unhex(h)])),
    };
    assert.deepEqual(got, want, g.name);
  }
});

test("judge comparison matches judge.cpp on every golden pair", () => {
  for (const g of golden("judge")) {
    assert.equal(outputsMatch(g.actual, g.expected), g.match, JSON.stringify(g));
    assert.equal(firstDifferingLine(g.actual, g.expected), g.first, JSON.stringify(g));
  }
});
