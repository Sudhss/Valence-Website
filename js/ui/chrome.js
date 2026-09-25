/* The editor chrome the page wears: the gutter's line numbers, the tab strip,
 * and the status bar, all reporting where you are in the page the way
 * Valence's own status bar reports where you are in a file. */

const ROW = 28;

export function mountChrome({ fileOf }) {
  const gutter = document.getElementById("gutter");
  const stFile = document.getElementById("st-file");
  const stPos = document.getElementById("st-pos");
  const tabs = [...document.querySelectorAll(".tablist a")];
  const sections = [...document.querySelectorAll("[data-file]"), document.getElementById("canyon")];

  // Enough numbers to fill the column; they are re-labelled on scroll rather
  // than created, so the gutter is a fixed ~40 nodes however long the page.
  const rows = Math.ceil(window.innerHeight / ROW) + 2;
  const spans = [];
  for (let i = 0; i < rows; i += 1) {
    const s = document.createElement("span");
    gutter.appendChild(s);
    spans.push(s);
  }

  let current = null;
  function update() {
    const y = window.scrollY;
    const first = Math.floor(y / ROW);
    gutter.style.transform = `translateY(${-(y % ROW)}px)`;
    const caretRow = first + Math.floor(window.innerHeight / 2 / ROW);
    spans.forEach((s, i) => {
      const n = first + i + 1;
      s.textContent = n;
      s.classList.toggle("cur", n === caretRow + 1);
    });

    // Which section owns the middle of the screen.
    const mid = window.innerHeight * 0.45;
    let active = null;
    for (const sec of sections) {
      const r = sec.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) active = sec;
    }
    const custom = fileOf?.(active);
    let file = custom?.file || active?.dataset.file || "valence.md";
    let pos = custom?.pos || `Ln ${caretRow + 1}, Col 1`;
    stFile.textContent = file;
    stPos.textContent = pos;
    const id = active?.id === "canyon" ? "top" : active?.id === "get" ? "log" : active?.id;
    if (id !== current) {
      current = id;
      tabs.forEach((t) => t.setAttribute("aria-current", String(t.dataset.tab === id)));
    }
  }

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
  return { update };
}
