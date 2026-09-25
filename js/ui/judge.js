/* The judge panel, replaying real runs.
 *
 * Browsers cannot compile C++, so the runs were made ahead of time by
 * tools/judge/record_runs.py: each solution compiled with the judge's flags
 * and every case piped through the binary under its 3,000 ms limit. This
 * replays them at their recorded speed -- a TLE really does sit there for
 * three seconds -- and decides every verdict here, from the recorded output,
 * with js/core/judge.js, the port of Judge::outputsMatch. The order of checks
 * is the judge's: crash or non-zero exit first, then the limit, then output.
 */

import { JUDGE_RUNS } from "../data/judge-runs.js";
import { verdictFor, normalizeOutput, firstDifferingLine, outputsMatch } from "../core/judge.js";
import { tokenize, TOKEN } from "../core/lexer.js";

const COLOR = {
  [TOKEN.Keyword]: "var(--syn-keyword)",
  [TOKEN.Type]: "var(--syn-type)",
  [TOKEN.String]: "var(--syn-string)",
  [TOKEN.Comment]: "var(--syn-comment)",
  [TOKEN.Number]: "var(--syn-number)",
  [TOKEN.Preprocessor]: "var(--syn-pre)",
  [TOKEN.Function]: "var(--syn-func)",
  [TOKEN.Punctuation]: "var(--syn-punct)",
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function highlight(pre, source) {
  pre.replaceChildren();
  const state = { inBlockComment: false };
  for (const line of source.replace(/\n$/, "").split("\n")) {
    const row = el("span", "ln");
    for (const t of tokenize(line, state)) {
      const text = line.substr(t.start, t.length);
      if (COLOR[t.type]) {
        const s = el("span", null, text);
        s.style.color = COLOR[t.type];
        row.append(s);
      } else row.append(document.createTextNode(text));
    }
    row.append(document.createTextNode("\n"));
    pre.append(row);
  }
}

/** Output with the first differing line (under the judge's rule) marked. */
function outputWithDiff(text, other) {
  const pre = el("pre");
  const lines = String(text).replace(/\n$/, "").split("\n");
  const diff = firstDifferingLine(text, other);
  lines.forEach((line, i) => {
    const span = el("span", i === diff ? "diff" : null, line.length ? line : " ");
    pre.append(span, document.createTextNode("\n"));
  });
  if (diff >= lines.length && diff >= 0) pre.append(el("span", "diff", "← missing line"));
  return pre;
}

export function mountJudge({ reduced }) {
  const tabs = document.getElementById("cph-tabs");
  const code = document.getElementById("cph-code");
  const list = document.getElementById("cph-cases");
  const summary = document.getElementById("cph-summary");
  const compile = document.getElementById("cph-compile");
  const runBtn = document.getElementById("cph-run");
  const { problem, cases, solutions } = JUDGE_RUNS;
  document.getElementById("cph-problem").textContent = `${problem.title}. ${problem.statement}`;
  document.getElementById("cph-limits").textContent = `${problem.limits} · time limit ${JUDGE_RUNS.timeLimitMs.toLocaleString()} ms`;
  document.getElementById("cph-provenance").textContent = `Recorded ${JUDGE_RUNS.recorded} with ${JUDGE_RUNS.compiler.replace(/^g\+\+(\.exe)? /, "g++ ")}, ${JUDGE_RUNS.flags}. Times are wall-clock and include process start-up on Windows.`;

  let current = 0;
  let running = false;
  let runId = 0;

  function select(i) {
    if (running) return;
    current = i;
    [...tabs.children].forEach((b, j) => b.setAttribute("aria-selected", String(j === i)));
    highlight(code, solutions[i].source);
    resetCards();
    summary.textContent = `${solutions[i].title}. Run it.`;
    compile.hidden = true;
  }

  solutions.forEach((s, i) => {
    const b = el("button", null, s.file);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.title = s.title;
    b.addEventListener("click", () => select(i));
    tabs.append(b);
  });

  const cards = [];
  function resetCards() {
    list.replaceChildren();
    cards.length = 0;
    cases.forEach((c) => {
      const li = el("li", "case");
      const row = el("div", "case-row");
      const verdict = el("span", "verdict", "—");
      const name = el("span", "case-name", c.name);
      const time = el("span", "case-time", "");
      row.append(verdict, name, time);
      const meter = el("div", "case-meter");
      const bar = el("i");
      meter.append(bar);
      const body = el("div", "case-body");
      body.hidden = true;
      li.append(row, meter, body);
      list.append(li);
      cards.push({ li, verdict, time, bar, body });
    });
  }

  function setVerdict(card, v) {
    card.verdict.className = `verdict ${v}`;
    card.verdict.textContent = v;
  }

  function expand(card, c, run, v) {
    card.body.replaceChildren();
    const box = (label, node) => {
      const d = el("div");
      d.append(el("span", null, label), node);
      return d;
    };
    const input = el("pre", null, c.input.length > 400 ? c.input.slice(0, 400) + "…" : c.input);
    card.body.append(box("input", input));
    if (v === "WA") {
      card.body.append(box("expected", outputWithDiff(c.expected, run.stdout)));
      card.body.append(box("your output", outputWithDiff(run.stdout, c.expected)));
    } else {
      card.body.append(box("expected", el("pre", null, c.expected)));
    }
    if (v === "RE") {
      const err = box(`stderr · exit code ${run.exitCode}`, el("pre", null, run.stderr || "(empty)"));
      err.className = "err";
      card.body.append(err);
    }
    if (v === "TLE") {
      const err = box("killed", el("pre", null, `Exceeded ${JUDGE_RUNS.timeLimitMs.toLocaleString()} ms. The process was killed; the editor never waited on it.`));
      err.className = "err";
      card.body.append(err);
    }
    card.body.hidden = false;
  }

  async function run() {
    if (running) return;
    running = true;
    const id = ++runId;
    runBtn.disabled = true;
    const s = solutions[current];
    resetCards();
    compile.hidden = false;
    compile.className = "cph-compile busy";
    compile.textContent = `$ g++ ${JUDGE_RUNS.flags} -o solution.exe ${s.file}`;
    summary.textContent = "Compiling…";
    await sleep(reduced ? 0 : s.compileMs);
    if (id !== runId) return;

    if (!s.compileOk) {
      compile.className = "cph-compile";
      compile.textContent = `$ g++ ${JUDGE_RUNS.flags} -o solution.exe ${s.file}\n${s.compilerOutput}`;
      cards.forEach((card) => setVerdict(card, "CE"));
      summary.replaceChildren(el("b", "bad", "CE"), document.createTextNode(` · the translation unit never built; every case is a compile error.`));
      running = false;
      runBtn.disabled = false;
      return;
    }
    compile.hidden = true;

    let passed = 0;
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i];
      const r = s.runs[i];
      const card = cards[i];
      setVerdict(card, "RUN");
      summary.textContent = `Running case ${i + 1} of ${cases.length}…`;
      const limit = JUDGE_RUNS.timeLimitMs;
      const start = performance.now();
      const duration = reduced ? 0 : r.elapsedMs;
      card.bar.classList.toggle("warn", r.timedOut);
      await new Promise((resolve) => {
        const tick = () => {
          const ms = Math.min(duration, performance.now() - start);
          card.bar.style.width = `${(Math.min(r.elapsedMs, ms) / limit) * 100}%`;
          card.time.textContent = `${Math.round(ms).toLocaleString()} ms`;
          if (ms >= duration) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      if (id !== runId) return;
      const v = verdictFor({ timedOut: r.timedOut, exitCode: r.exitCode, stdout: r.stdout }, c.expected);
      card.time.textContent = `${r.elapsedMs.toLocaleString()} ms`;
      card.bar.style.width = `${(r.elapsedMs / limit) * 100}%`;
      setVerdict(card, v);
      if (v === "AC") passed += 1;
      else expand(card, c, r, v);
    }
    const all = passed === cases.length;
    summary.replaceChildren(el("b", all ? "ok" : "bad", `${passed} / ${cases.length}`), document.createTextNode(all ? " passed · Accepted" : " passed"));
    running = false;
    runBtn.disabled = false;
  }

  runBtn.addEventListener("click", run);
  document.getElementById("cph").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });
  select(0);

  // ---- the rule playground ---------------------------------------------------
  const actual = document.getElementById("rule-actual");
  const expected = document.getElementById("rule-expected");
  const verdict = document.getElementById("rule-verdict");
  actual.value = "1 2 3   \n4 5 6\n\n\n";
  expected.value = "1 2 3\n4 5 6";
  function judgeRule() {
    verdict.replaceChildren();
    if (outputsMatch(actual.value, expected.value)) {
      const b = el("b", null, "AC");
      b.style.color = "var(--ok)";
      verdict.append(b, document.createTextNode("the outputs match under the judge's rule."));
      return;
    }
    const line = firstDifferingLine(actual.value, expected.value);
    const a = normalizeOutput(actual.value)[line];
    const e = normalizeOutput(expected.value)[line];
    const b = el("b", null, "WA");
    b.style.color = "var(--bad)";
    const show = (s) => (s === undefined ? "(no line)" : JSON.stringify(s));
    verdict.append(b, document.createTextNode(`first difference at line ${line + 1}: ${show(a)} vs ${show(e)}.`));
  }
  actual.addEventListener("input", judgeRule);
  expected.addEventListener("input", judgeRule);
  judgeRule();
}
