/* The benchmark section: one keystroke's work against the frame budget.
 *
 * Two measurements, both compiled against Valence's real TextBuffer,
 * UndoManager and CppHighlighter on 26 September 2026:
 *
 *   data/benchmark-2026-09-26.txt   benchmark/benchmark.cpp, whose keystroke
 *                                   model re-tokenizes every line -- the
 *                                   editor as it was before V3
 *   data/keystroke-v3-2026-09-26.json  tools/bench/keystroke_v3.cpp, V3's
 *                                   incremental rebuildCommentState, typical
 *                                   and worst case, median of three runs
 *
 * Logic only; QPainter's drawing time is in neither.
 */

const FRAME_US = 1e6 / 60;

// Benchmark 7 totals (us). At 50,000 lines benchmark 7 did not run; benchmark
// 4's full-document tokenization, the rebuild on its own, measured 30,320 us.
const BEFORE = { 100: 64.4, 500: 234.0, 1000: 436.6, 5000: 2580.3, 10000: 8704.5, 50000: 30320 };
// keystroke_v3 medians (us).
const V3 = {
  100: { typical: 20.1, worst: 12.5 },
  500: { typical: 28.6, worst: 45.6 },
  1000: { typical: 19.3, worst: 52.5 },
  5000: { typical: 27.0, worst: 311.6 },
  10000: { typical: 31.3, worst: 547.5 },
  50000: { typical: 18.7, worst: 3569.3 },
};
const SIZES = [100, 500, 1000, 5000, 10000, 50000];

const FACTS = [
  ["11", "ns", "to type one character: TextBuffer::insertChar, measured over 100,000 keystrokes."],
  ["27", "µs", "to split a line in the middle of a 50,000-line file, the worst case for a line array."],
  ["17", "ms", "to load a 50,000-line file from disk into the buffer (median of ten)."],
  ["2.0", "M", "lines tokenized per second: about 500 ns a line, single-threaded, no regex."],
  ["3.4", "MB", "for 50,000 lines in memory: text plus one 32-byte std::string each. A lower bound."],
  ["1.5", "ms", "to undo every group left after recording 50,000 actions: 4,000 of them, the history's cap."],
];

// Log scale from 10 us to 100 ms.
const LO = Math.log10(10);
const HI = Math.log10(100000);
const pos = (us) => `${((Math.log10(Math.max(10, us)) - LO) / (HI - LO)) * 100}%`;
const fmt = (us) => (us < 1000 ? `${Math.round(us)} µs` : `${(us / 1000).toFixed(us < 10000 ? 2 : 1)} ms`);

export function mountBench() {
  const sizes = document.getElementById("budget-sizes");
  const chart = document.getElementById("budget-chart");
  const note = document.getElementById("budget-note");

  const rows = [
    { key: "before", label: "Before V3: every line, every keystroke" },
    { key: "worst", label: "V3, worst case: typing /* on line 1" },
    { key: "typical", label: "V3, an ordinary keystroke" },
  ];
  chart.innerHTML = `
    <div class="bars">
      ${rows.map((r) => `<div class="brow brow-${r.key}"><span class="blabel">${r.label}</span><div class="btrack"><i class="bfill"></i><b class="bval"></b></div></div>`).join("")}
      <div class="boverlay"><div class="bbudget" style="left:${pos(FRAME_US)}"><span>16.6 ms · one 60 Hz frame</span></div></div>
    </div>
    <div class="baxis">${[10, 100, 1000, 10000, 100000].map((v) => `<span style="left:${pos(v)}">${fmt(v)}</span>`).join("")}</div>`;
  const fills = rows.map((r) => chart.querySelector(`.brow-${r.key} .bfill`));
  const vals = rows.map((r) => chart.querySelector(`.brow-${r.key} .bval`));

  function show(i) {
    const n = SIZES[i];
    [...sizes.children].forEach((b, j) => b.setAttribute("aria-checked", String(j === i)));
    const values = [BEFORE[n], V3[n].worst, V3[n].typical];
    values.forEach((us, k) => {
      fills[k].style.width = pos(us);
      fills[k].classList.toggle("over", us > FRAME_US);
      vals[k].textContent = fmt(us);
      // Near the right edge the value sits inside the bar instead of past it.
      const at = parseFloat(pos(us));
      vals[k].style.left = at > 78 ? `calc(${at}% - 86px)` : pos(us);
      vals[k].classList.toggle("inside", at > 78);
    });
    const lines = n.toLocaleString();
    if (BEFORE[n] > FRAME_US) {
      note.textContent = `${lines} lines. Before V3, tokenizing the whole file on each keystroke took ${fmt(BEFORE[n])} and missed the frame; the benchmark printed "WILL DROP FRAMES". V3 rescans from the edited line and stops when the comment state converges: ${fmt(V3[n].typical)} for an ordinary keystroke, ${fmt(V3[n].worst)} even when an opened comment changes every line below it.`;
    } else {
      note.textContent = `${lines} lines. An ordinary keystroke in V3 costs ${fmt(V3[n].typical)} of logic, most of it tokenizing the visible rows. Before V3 it was ${fmt(BEFORE[n])}, growing with the file.`;
    }
  }

  SIZES.forEach((n, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.textContent = `${n.toLocaleString()} lines`;
    b.addEventListener("click", () => show(i));
    sizes.append(b);
  });
  show(SIZES.length - 1);

  const facts = document.getElementById("facts");
  for (const [num, unit, text] of FACTS) {
    const d = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = num;
    const small = document.createElement("small");
    small.textContent = unit;
    dt.append(small);
    const dd = document.createElement("dd");
    dd.textContent = text;
    d.append(dt, dd);
    facts.append(d);
  }
}
