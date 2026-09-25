/* The history: every commit on a time axis, the three release tags, and what
 * each release shipped. Commits come from js/data/history.js (git log). */

import { COMMITS, TAGS } from "../data/history.js";

const RELEASES = [
  {
    tag: "v1.0",
    name: "V1 · the editor",
    items: [
      "Custom QPainter rendering with viewport culling; no QTextEdit",
      "Line-array buffer and command-pattern undo with 400 ms grouping",
      "Single-pass C++ highlighter",
      "Tabs, file explorer, embedded PowerShell, F5 build and run",
    ],
  },
  {
    tag: "v2.0",
    name: "V2 · the workflow",
    items: [
      "Smart indentation and brace expansion",
      "Inline file and folder creation, F2 rename",
      "Workspace-aware saving and C++ boilerplate",
      "Terminal rebuilt to behave like a real one",
    ],
  },
  {
    tag: "v3.0",
    name: "V3 · the judge",
    items: [
      "Built-in judge: AC, WA, TLE, RE, CE, a 3 s limit, never blocking",
      "Incremental highlighting, clipped repaints, eased scrolling",
      "Compound undo, zoom, snippets, auto-save, a persisted layout",
      "Separate UI and code typefaces and a depth pass on the interface",
    ],
  },
];

export function mountHistory() {
  const host = document.getElementById("history");
  const day = (d) => new Date(`${d}T00:00:00Z`).getTime();
  const start = day("2026-02-01");
  const end = day("2026-09-30");
  const W = 1000;
  const H = 150;
  const x = (d) => 20 + ((day(d) - start) / (end - start)) * (W - 40);

  // Stack commits made on the same day.
  const perDay = new Map();
  const dots = COMMITS.map((c) => {
    const n = perDay.get(c.d) || 0;
    perDay.set(c.d, n + 1);
    return { ...c, n };
  });

  const months = ["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${COMMITS.length} commits from February to September 2026, with releases v1.0 on ${TAGS["v1.0"]}, v2.0 on ${TAGS["v2.0"]} and v3.0 on ${TAGS["v3.0"]}">`;
  svg += `<line x1="20" y1="112" x2="${W - 20}" y2="112" stroke="rgba(255,255,255,0.14)" />`;
  months.forEach((m, i) => {
    const mx = x(`2026-${String(i + 2).padStart(2, "0")}-01`);
    svg += `<line x1="${mx}" y1="108" x2="${mx}" y2="116" stroke="rgba(255,255,255,0.2)"/><text x="${mx + 4}" y="136" fill="rgba(233,236,241,0.45)" font-family="JetBrains Mono, monospace" font-size="11">${m}</text>`;
  });
  for (const d of dots) {
    const cx = x(d.d);
    const cy = 104 - d.n * 7;
    svg += `<circle cx="${cx}" cy="${cy}" r="${d.tag ? 5 : 2.6}" fill="${d.tag ? "#2fe0a0" : "rgba(233,236,241,0.55)"}"><title>${d.d} · ${d.s.replace(/[<&"]/g, "")}</title></circle>`;
  }
  for (const [tag, d] of Object.entries(TAGS)) {
    const tx = x(d);
    svg += `<line x1="${tx}" y1="18" x2="${tx}" y2="104" stroke="rgba(47,224,160,0.45)" stroke-dasharray="3 3"/><text x="${tx + 6}" y="26" fill="#5cf0ba" font-family="JetBrains Mono, monospace" font-size="12" font-weight="700">${tag}</text><text x="${tx + 6}" y="42" fill="rgba(233,236,241,0.5)" font-family="JetBrains Mono, monospace" font-size="11">${d}</text>`;
  }
  svg += `</svg>`;
  host.innerHTML = svg;

  const grid = document.createElement("div");
  grid.className = "releases";
  RELEASES.forEach((r, i) => {
    const d = document.createElement("div");
    d.className = `release${i === RELEASES.length - 1 ? " cur" : ""}`;
    const h = document.createElement("h4");
    h.textContent = r.name;
    const t = document.createElement("time");
    t.dateTime = TAGS[r.tag];
    t.textContent = `${r.tag} · ${TAGS[r.tag]}`;
    const ul = document.createElement("ul");
    for (const item of r.items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.append(li);
    }
    d.append(h, t, ul);
    grid.append(d);
  });
  host.append(grid);
}
