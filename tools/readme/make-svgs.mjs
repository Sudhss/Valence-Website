/* Animated SVGs for the README, generated from the site's own code and data.
 *
 *   node tools/readme/make-svgs.mjs
 *
 * GitHub renders SVG animation (SMIL) in README images, so these move without
 * any script. Every colour, token and verdict comes from the same modules the
 * site uses: the tokenizer port colours the code, the judge port decides the
 * verdicts from the recorded runs, the benchmark numbers are the recorded ones.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { tokenize, TOKEN } from "../../js/core/lexer.js";
import { verdictFor } from "../../js/core/judge.js";
import { JUDGE_RUNS } from "../../js/data/judge-runs.js";

const OUT = new URL("../../readme/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const MONO = "'JetBrains Mono','Cascadia Code',Consolas,'DejaVu Sans Mono',monospace";
const UI = "'Segoe UI',Inter,system-ui,sans-serif";
const C = {
  base: "#0b0c10", chrome: "#101218", surface: "#15171d", raised: "#1b1e26", overlay: "#22262f",
  accent: "#2fe0a0", accentHot: "#5cf0ba", text: "#e9ecf1", text3: "#7c828d", text4: "#50555e",
  ok: "#7ed38d", bad: "#f07178", warn: "#ffb74d",
};
const TOKEN_FILL = {
  [TOKEN.Plain]: "#e9ecf1", [TOKEN.Keyword]: "#56d1ff", [TOKEN.Type]: "#82aaff", [TOKEN.String]: "#c3e88d",
  [TOKEN.Comment]: "#6d7178", [TOKEN.Number]: "#ffb74d", [TOKEN.Preprocessor]: "#c792ea",
  [TOKEN.Function]: "#82e787", [TOKEN.Punctuation]: "#a4a8ae",
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CH = 9.6; // advance of a 16px monospace glyph

function coloured(line, x, y, extra = "") {
  const spans = tokenize(line, { inBlockComment: false })
    .map((t) => `<tspan fill="${TOKEN_FILL[t.type]}">${esc(line.substr(t.start, t.length)).replace(/ /g, "&#160;")}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="16" ${extra}>${spans}</text>`;
}

function frame(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<rect width="${w}" height="${h}" rx="12" fill="${C.surface}" stroke="#2a2e37"/>
<rect width="${w}" height="36" rx="12" fill="${C.chrome}"/><rect y="24" width="${w}" height="12" fill="${C.chrome}"/>
<line x1="0" y1="36" x2="${w}" y2="36" stroke="#23262e"/>
${body}
</svg>
`;
}

/* ---------------------------------------------------------------- header */
// Valence's own cppmain snippet: type the trigger, the popup offers it, it
// expands, and the caret lands inside main() where the tagline gets typed.
function header() {
  const W = 960;
  const H = 330;
  const gx = 64;
  const lineY = (i) => 78 + i * 28;
  const tpl = ["#include <bits/stdc++.h>", "using namespace std;", "", "int main() {", "    ", "    return 0;", "}"];
  const typed = "// Write code at the speed of thought.";
  const trigger = "cppm";
  const tType = 0.5;
  const step = 0.11;
  const tPopup = tType + trigger.length * step;
  const tExpand = tPopup + 0.9;
  const tTag = tExpand + 0.5;
  const tagStep = 0.055;
  const tDone = tTag + typed.length * tagStep;

  let body = `<rect x="16" y="0" width="150" height="36" fill="${C.surface}"/><rect x="16" y="34" width="150" height="2" fill="${C.accent}"/>
<text x="34" y="23" font-family="${MONO}" font-size="13" fill="${C.text}">scratch.cpp</text>
<text x="${W - 24}" y="23" font-family="${UI}" font-size="12" text-anchor="end" fill="${C.text3}">Valence · C++17 · Qt 6</text>`;
  // gutter
  for (let i = 0; i < 7; i += 1) {
    body += `<text x="${gx - 22}" y="${lineY(i)}" font-family="${MONO}" font-size="14" text-anchor="end" fill="${C.text4}">${i + 1}</text>`;
  }
  // the trigger being typed on line 1, then removed at expansion
  const trig = trigger
    .split("")
    .map((ch, i) => `<tspan opacity="0">${ch}<set attributeName="opacity" to="1" begin="${(tType + i * step).toFixed(2)}s" fill="freeze"/></tspan>`)
    .join("");
  body += `<g><text x="${gx}" y="${lineY(0)}" font-family="${MONO}" font-size="16" fill="${C.text}">${trig}</text><set attributeName="opacity" to="0" begin="${tExpand}s" fill="freeze"/></g>`;
  // popup
  body += `<g opacity="0"><set attributeName="opacity" to="1" begin="${tPopup}s"/><set attributeName="opacity" to="0" begin="${tExpand}s" fill="freeze"/>
<rect x="${gx - 6}" y="${lineY(0) + 10}" width="300" height="38" rx="6" fill="${C.overlay}" stroke="#3a3f4a"/>
<rect x="${gx - 2}" y="${lineY(0) + 14}" width="292" height="30" rx="4" fill="rgba(47,224,160,0.13)"/>
<text x="${gx + 8}" y="${lineY(0) + 34}" font-family="${MONO}" font-size="14" fill="${C.text}">cppmain</text>
<text x="${gx + 282}" y="${lineY(0) + 34}" font-family="${UI}" font-size="12" text-anchor="end" fill="${C.text3}">C++ template · Tab</text></g>`;
  // the template, appearing at expansion
  body += `<g opacity="0"><set attributeName="opacity" to="1" begin="${tExpand}s" fill="freeze"/>`;
  tpl.forEach((l, i) => {
    if (l.trim()) body += coloured(l, gx, lineY(i));
  });
  body += `</g>`;
  // the tagline typed on line 5
  const chars = typed
    .split("")
    .map((ch, i) => `<tspan opacity="0">${esc(ch).replace(/ /g, "&#160;")}<set attributeName="opacity" to="1" begin="${(tTag + i * tagStep).toFixed(3)}s" fill="freeze"/></tspan>`)
    .join("");
  body += `<text x="${gx + 4 * CH}" y="${lineY(4)}" font-family="${MONO}" font-size="16" fill="${TOKEN_FILL[TOKEN.Comment]}">${chars}</text>`;
  // current-line wash follows the caret
  body += `<rect x="${gx - 8}" y="${lineY(0) - 19}" width="${W - gx - 12}" height="27" fill="rgba(255,255,255,0.045)">
<set attributeName="y" to="${lineY(4) - 19}" begin="${tExpand}s" fill="freeze"/></rect>`;
  // caret: moves while typing, then blinks every 500 ms like the editor's
  const caretXs = [];
  const caretTimes = [];
  trigger.split("").forEach((_, i) => {
    caretXs.push(gx + (i + 1) * CH);
    caretTimes.push(tType + i * step);
  });
  caretXs.push(gx + 4 * CH);
  caretTimes.push(tExpand);
  typed.split("").forEach((_, i) => {
    caretXs.push(gx + (4 + i + 1) * CH);
    caretTimes.push(tTag + i * tagStep);
  });
  const moves = caretXs.map((x, i) => `<set attributeName="x" to="${(x - gx).toFixed(1)}" begin="${caretTimes[i].toFixed(3)}s" fill="freeze"/>`).join("");
  body += `<svg x="0" y="0" overflow="visible">${moves}<g><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1s" begin="${tDone}s" repeatCount="indefinite"/>
<g><set attributeName="transform" to="translate(0 ${lineY(4) - lineY(0)})" begin="${tExpand}s" fill="freeze"/>
<rect x="${gx - 1}" y="${lineY(0) - 18}" width="7" height="24" fill="rgba(47,224,160,0.28)"/><rect x="${gx + 1}" y="${lineY(0) - 18}" width="2.4" height="24" fill="${C.accent}"/></g></g></svg>`;
  // status bar
  body += `<rect y="${H - 30}" width="${W}" height="30" fill="${C.chrome}"/><rect y="${H - 30}" width="${W}" height="18" rx="0" fill="${C.chrome}"/>
<line x1="0" y1="${H - 30}" x2="${W}" y2="${H - 30}" stroke="#23262e"/>
<circle cx="20" cy="${H - 15}" r="4" fill="${C.accent}"/>
<text x="34" y="${H - 11}" font-family="${UI}" font-size="12" fill="${C.text3}">scratch.cpp</text>
<text x="130" y="${H - 11}" font-family="${UI}" font-size="12" fill="${C.text3}">Ln 1, Col 5<set attributeName="opacity" to="0" begin="${tExpand}s" fill="freeze"/></text>
<text x="130" y="${H - 11}" font-family="${UI}" font-size="12" fill="${C.text3}" opacity="0">Ln 5, Col ${5 + typed.length}<set attributeName="opacity" to="1" begin="${tDone}s" fill="freeze"/></text>
<text x="${W - 20}" y="${H - 11}" font-family="${UI}" font-size="12" text-anchor="end" fill="${C.text3}">C++ · UTF-8 · LF</text>`;
  return frame(W, H, "Valence expanding its cppmain snippet and typing: Write code at the speed of thought.", body);
}

/* ------------------------------------------------------------- tokenizer */
function tokenizerSvg() {
  const line = "const long long MOD = 1'000'000'007; // prime";
  const W = 960;
  const H = 210;
  const x0 = 40;
  const y = 104;
  const speed = 22; // chars per second
  const tokens = tokenize(line, { inBlockComment: false });
  let body = `<text x="24" y="23" font-family="${MONO}" font-size="13" fill="${C.text}">cpp_highlighter.cpp</text>
<text x="${W - 24}" y="23" font-family="${UI}" font-size="12" text-anchor="end" fill="${C.text3}">one pass · no regex · no backtracking</text>`;
  let spans = "";
  tokens.forEach((t) => {
    const at = ((t.start + t.length) / speed + 0.4).toFixed(2);
    const text = esc(line.substr(t.start, t.length)).replace(/ /g, "&#160;");
    spans += `<tspan fill="#3b3f47">${text}<set attributeName="fill" to="${TOKEN_FILL[t.type]}" begin="${at}s" fill="freeze"/></tspan>`;
  });
  body += `<text x="${x0}" y="${y}" font-family="${MONO}" font-size="16" style="font-size:16px">${spans}</text>`;
  // token boundaries appear as ticks when each token closes
  tokens.forEach((t) => {
    const at = ((t.start + t.length) / speed + 0.4).toFixed(2);
    const x = x0 + (t.start + t.length) * CH;
    body += `<line x1="${x}" y1="${y + 12}" x2="${x}" y2="${y + 22}" stroke="${TOKEN_FILL[t.type]}" stroke-width="2" opacity="0"><set attributeName="opacity" to="0.9" begin="${at}s" fill="freeze"/></line>`;
  });
  const end = (line.length / speed + 0.4).toFixed(2);
  body += `<rect x="${x0 - 2}" y="${y - 20}" width="3" height="30" fill="${C.accent}"><animate attributeName="x" from="${x0 - 2}" to="${x0 + line.length * CH}" begin="0.4s" dur="${(line.length / speed).toFixed(2)}s" fill="freeze"/><set attributeName="opacity" to="0" begin="${end}s" fill="freeze"/></rect>`;
  const kinds = [...new Set(tokens.map((t) => t.type))];
  const names = ["plain", "keyword", "type", "string", "comment", "number", "preprocessor", "function", "punctuation"];
  let lx = x0;
  let legend = "";
  kinds.forEach((k) => {
    const n = tokens.filter((t) => t.type === k).length;
    const label = `${names[k]} ${n}`;
    legend += `<rect x="${lx}" y="${y + 50}" width="10" height="10" rx="2" fill="${TOKEN_FILL[k]}"/><text x="${lx + 16}" y="${y + 59}" font-family="${MONO}" font-size="13" fill="${C.text3}">${label}</text>`;
    lx += 26 + label.length * 8.2;
  });
  body += `<g opacity="0"><set attributeName="opacity" to="1" begin="${end}s" fill="freeze"/>${legend}
<text x="${x0}" y="${y + 92}" font-family="${UI}" font-size="13" fill="${C.text3}">${tokens.length} tokens. The digit separators stay inside the number, the same as in Valence's C++.</text></g>`;
  return frame(W, H, `Valence's tokenizer making one pass over: ${line}`, body);
}

/* ----------------------------------------------------------------- judge */
function judgeSvg() {
  const W = 960;
  const rowH = 46;
  const rows = JUDGE_RUNS.solutions;
  const H = 60 + rows.length * rowH + 40;
  let body = `<text x="24" y="23" font-family="${MONO}" font-size="13" fill="${C.text}">judge.cpp</text>
<text x="${W - 24}" y="23" font-family="${UI}" font-size="12" text-anchor="end" fill="${C.text3}">${esc(JUDGE_RUNS.problem.title)} · ${JUDGE_RUNS.cases.length} cases · ${JUDGE_RUNS.timeLimitMs} ms limit</text>`;
  let t = 0.4;
  const colour = { AC: C.ok, WA: C.bad, RE: C.bad, CE: C.bad, TLE: C.warn };
  rows.forEach((s, i) => {
    const y = 58 + i * rowH;
    body += `<rect x="20" y="${y}" width="${W - 40}" height="${rowH - 8}" rx="6" fill="${C.raised}"/>
<text x="36" y="${y + 24}" font-family="${MONO}" font-size="14" fill="${C.text}">${esc(s.file)}</text>
<text x="210" y="${y + 24}" font-family="${UI}" font-size="13" fill="${C.text3}">${esc(s.title)}</text>`;
    const verdicts = s.compileOk ? s.runs.map((r, k) => verdictFor(r, JUDGE_RUNS.cases[k].expected)) : JUDGE_RUNS.cases.map(() => "CE");
    verdicts.forEach((v, k) => {
      const bx = 520 + k * 104;
      const ms = s.compileOk ? s.runs[k].elapsedMs : 0;
      // Real durations, compressed 4x so the whole table plays in seconds.
      const dur = Math.max(0.12, (s.compileOk ? ms : 300) / 4000);
      body += `<rect x="${bx}" y="${y + 9}" width="92" height="20" rx="4" fill="rgba(255,255,255,0.04)"/>
<rect x="${bx}" y="${y + 9}" width="0" height="20" rx="4" fill="${colour[v]}" opacity="0.16"><animate attributeName="width" from="0" to="92" begin="${t.toFixed(2)}s" dur="${dur.toFixed(2)}s" fill="freeze"/></rect>
<text x="${bx + 46}" y="${y + 23}" font-family="${MONO}" font-size="12" font-weight="700" text-anchor="middle" fill="${colour[v]}" opacity="0">${v}${s.compileOk ? ` ${ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms"}` : ""}<set attributeName="opacity" to="1" begin="${(t + dur).toFixed(2)}s" fill="freeze"/></text>`;
      t += dur + 0.05;
    });
    t += 0.15;
  });
  body += `<text x="24" y="${H - 16}" font-family="${UI}" font-size="12" fill="${C.text3}">Real runs: g++ ${esc(JUDGE_RUNS.compiler.match(/\d+\.\d+\.\d+/)?.[0] || "")} ${JUDGE_RUNS.flags}, recorded ${JUDGE_RUNS.recorded}. Verdicts computed from the output by the port of Judge::outputsMatch.</text>`;
  return frame(W, H, "Five real solutions judged: Accepted, Wrong Answer, Time Limit Exceeded, Runtime Error, Compile Error", body);
}

/* ------------------------------------------------------------ keystrokes */
function budgetSvg() {
  const W = 960;
  const H = 250;
  const rows = [
    ["Before V3: every line, every keystroke", 30320, "#82aaff"],
    ["V3, worst case: typing /* on line 1", 3569.3, C.warn],
    ["V3, an ordinary keystroke", 18.7, C.accent],
  ];
  const left = 330;
  const right = W - 40;
  const pos = (us) => left + ((Math.log10(us) - 1) / 4) * (right - left);
  const fmt = (us) => (us < 1000 ? `${Math.round(us)} µs` : `${(us / 1000).toFixed(us < 10000 ? 2 : 1)} ms`);
  let body = `<text x="24" y="23" font-family="${MONO}" font-size="13" fill="${C.text}">bench.txt</text>
<text x="${W - 24}" y="23" font-family="${UI}" font-size="12" text-anchor="end" fill="${C.text3}">one keystroke in a 50,000-line file · logic only · log scale</text>`;
  rows.forEach(([label, us, col], i) => {
    const y = 64 + i * 46;
    body += `<text x="24" y="${y + 20}" font-family="${MONO}" font-size="13" fill="#b9bec7">${esc(label)}</text>
<rect x="${left}" y="${y}" width="${right - left}" height="30" rx="5" fill="${C.chrome}" stroke="#23262e"/>
<rect x="${left}" y="${y}" width="0" height="30" rx="5" fill="${col}"><animate attributeName="width" from="0" to="${(pos(us) - left).toFixed(1)}" begin="${0.3 + i * 0.25}s" dur="1.1s" calcMode="spline" keySplines="0.2 0.7 0.1 1" keyTimes="0;1" fill="freeze"/></rect>
<text x="${pos(us) + 10}" y="${y + 20}" font-family="${MONO}" font-size="13" font-weight="700" fill="${C.text}" opacity="0">${fmt(us)}<set attributeName="opacity" to="1" begin="${1.3 + i * 0.25}s" fill="freeze"/></text>`;
  });
  const fx = pos(16667);
  body += `<line x1="${fx}" y1="52" x2="${fx}" y2="206" stroke="${C.text}" stroke-width="2"/><text x="${fx - 8}" y="222" font-family="${MONO}" font-size="12" text-anchor="end" fill="${C.text}">16.6 ms · one 60 Hz frame</text>`;
  [10, 100, 1000, 10000, 100000].forEach((v) => {
    body += `<text x="${pos(v)}" y="240" font-family="${MONO}" font-size="11" text-anchor="middle" fill="${C.text4}">${fmt(v)}</text>`;
  });
  return frame(W, H, "Keystroke cost at 50,000 lines: 30.3 ms before V3, 3.57 ms worst case and 19 microseconds typical in V3", body);
}

const files = { "header.svg": header(), "tokenizer.svg": tokenizerSvg(), "judge.svg": judgeSvg(), "keystroke.svg": budgetSvg() };
for (const [name, svg] of Object.entries(files)) writeFileSync(new URL(name, OUT), svg);
console.log(Object.keys(files).join(", "));
