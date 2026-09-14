/* Valence — entry point.
 *
 * Everything here is progressive enhancement. The page is complete, readable
 * and fully navigable with this file absent or failed: the lexer field
 * degrades to a syntax-highlighted line plus a text readout, and the reveal
 * pass degrades to content simply being visible.
 */

import { mountLexerField } from './lexer-field.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ── The editor mockup in the hero ───────────────────────────────────────
 * Unchanged in behaviour from the original inline script: the same lines, the
 * same cursor row. Moved here so the markup stays markup.
 */
const HERO_LINES = [
  `<span class="cm">// Valence — text buffer core</span>`,
  `<span class="kw">#include</span> <span class="st">&lt;vector&gt;</span>`,
  `<span class="kw">#include</span> <span class="st">&lt;string&gt;</span>`,
  ``,
  `<span class="kw">class</span> <span class="ty">TextBuffer</span> {`,
  `<span class="kw">public</span>:`,
  `  <span class="kw">void</span> <span class="fn">insertChar</span>(<span class="ty">int</span> row, <span class="ty">int</span> col, <span class="ty">char</span> ch);`,
  `  <span class="kw">void</span> <span class="fn">deleteChar</span>(<span class="ty">int</span> row, <span class="ty">int</span> col);`,
  `  <span class="kw">void</span> <span class="fn">splitLine</span>(<span class="ty">int</span> row, <span class="ty">int</span> col);`,
  `  <span class="kw">void</span> <span class="fn">mergeLines</span>(<span class="ty">int</span> row);`,
  ``,
  `<span class="kw">private</span>:`,
  `  <span class="ty">std::vector</span>&lt;<span class="ty">std::string</span>&gt; <span class="nm">lines_</span>;`,
  `};`,
  ``,
  `<span class="cm">// cursor lives in EditorWidget, not the buffer</span>`,
  ``,
  `<span class="cm">// render only the visible viewport</span>`,
  `<span class="kw">void</span> <span class="fn">EditorWidget::paintEvent</span>(<span class="ty">QPaintEvent</span> <span class="pu">*</span>) {`,
  `  <span class="ty">int</span> <span class="nm">startRow</span> <span class="pu">=</span> scrollY <span class="pu">/</span> fontH;`,
];
const CURSOR_LINE = 6;

function buildHeroEditor() {
  const numEl = document.getElementById('line-nums');
  const codeEl = document.getElementById('code-area');
  if (!numEl || !codeEl) return;

  // One fragment, one insertion. The original appended inside the loop, which
  // is 40 separate mutations of a live tree.
  const nums = document.createDocumentFragment();
  const code = document.createDocumentFragment();

  HERO_LINES.forEach((line, i) => {
    const numSpan = document.createElement('span');
    numSpan.textContent = String(i + 1);
    if (i === CURSOR_LINE) numSpan.classList.add('active');
    nums.appendChild(numSpan);

    const lineDiv = document.createElement('div');
    lineDiv.className = 'code-line' + (i === CURSOR_LINE ? ' cursor-line' : '');
    lineDiv.innerHTML = (line || '&nbsp;') + (i === CURSOR_LINE ? '<span class="cursor"></span>' : '');
    code.appendChild(lineDiv);
  });

  numEl.appendChild(nums);
  codeEl.appendChild(code);
}

/* ── Reveal pass ─────────────────────────────────────────────────────────
 * The original faded and slid every one of forty elements upward on scroll.
 * The CSS now wipes them in horizontally instead — a paint pass, which is what
 * the editor this site is about actually does — and this only has to flip the
 * class. Elements already on screen at load are marked without animating, so
 * the first view is composed rather than assembling itself.
 */
function setupReveal() {
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  if (reduced.matches || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('visible', 'no-anim'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('visible');
      io.unobserve(e.target);            // one-shot; stop paying for it after
    }
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  // Anything at or above the fold is shown immediately and without animation.
  //
  // This is not a nicety. IntersectionObserver only reports elements that are
  // CURRENTLY intersecting, so landing directly on an anchor — /#benchmarks, or
  // any in-page link — left every element above that point permanently at
  // opacity 0, with no event ever coming to rescue them. The original page had
  // the same defect; it was just harder to notice behind a 0.7s fade.
  const fold = window.innerHeight;
  for (const el of targets) {
    if (el.getBoundingClientRect().top < fold) el.classList.add('visible', 'no-anim');
    else io.observe(el);
  }
}

/* ── Copy button on the code block ───────────────────────────────────────
 * Was a global function called from an inline onclick. Now delegated, and it
 * reports failure instead of silently doing nothing when the clipboard API is
 * unavailable (it is, on any page not served over a secure origin).
 */
function setupCopy() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-block-copy');
    if (!btn) return;
    const body = btn.closest('.tech-code-block')?.querySelector('.code-block-body');
    if (!body) return;

    const done = (msg) => {
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = 'copy'; }, 2000);
    };
    try {
      await navigator.clipboard.writeText(body.innerText);
      done('copied');
    } catch {
      done('copy failed');
    }
  });
}

/* ── Boot ────────────────────────────────────────────────────────────── */

/* ── The buffer scene ────────────────────────────────────────────────────
 * Loaded only when its section is near the viewport. Three.js is ~690KB and
 * the section sits well down the page; paying for it during the initial load
 * would slow the part of the page everyone sees for the sake of a part many
 * people never reach.
 */
function setupBufferScene() {
  const section = document.querySelector('#viewport');
  const canvas = document.querySelector('[data-buffer-canvas]');
  if (!section || !canvas) return;

  const rangeEl = document.querySelector('[data-vp-range]');
  const drawnEl = document.querySelector('[data-vp-drawn]');
  const skipEl = document.querySelector('[data-vp-skipped]');
  const fmt = (n) => n.toLocaleString('en-US');

  let scene = null;
  let scrollBound = false;

  const readProgress = () => {
    const r = section.getBoundingClientRect();
    const travel = r.height - window.innerHeight;
    if (travel <= 0) return 0;
    return Math.min(1, Math.max(0, -r.top / travel));
  };

  const paintReadout = () => {
    if (!scene) return;
    const b = scene.bandInfo;
    if (rangeEl) rangeEl.textContent = `${fmt(b.first)}–${fmt(b.last)}`;
    if (drawnEl) drawnEl.textContent = fmt(b.drawn);
    if (skipEl) skipEl.textContent = fmt(b.total - b.drawn);
  };

  // rAF-coalesced: scroll fires far more often than the screen refreshes, and
  // doing work per event rather than per frame is how scroll handlers become
  // the reason a page stutters.
  let queued = false;
  const onScroll = () => {
    if (queued || !scene) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scene.setProgress(readProgress());
      paintReadout();
    });
  };

  const onPointer = (e) => {
    if (!scene) return;
    scene.setPointer(
      (e.clientX / window.innerWidth) * 2 - 1,
      (e.clientY / window.innerHeight) * 2 - 1,
    );
  };

  const load = async () => {
    // Under 560px the canvas is too small for the file to read as anything but
    // texture, and the download is not worth spending someone's data on.
    //
    // Marking the section is the important half. Without it the canvas went
    // away but the 240vh scroll runway stayed, so a phone scrolled through two
    // full screens of nothing between the copy and the next section — which
    // looks exactly like the page has broken.
    if (window.innerWidth < 560) {
      canvas.remove();
      section.classList.add('vp-no-scene');
      return;
    }

    const narrow = window.innerWidth < 1024;
    const { createBufferScene } = await import('./buffer-scene.js');
    scene = createBufferScene(canvas, {
      maxLines: narrow ? 1400 : Infinity,
      dprCap: narrow ? 1.5 : 2,
    });
    if (!scene) {                              // no WebGL: leave the section as copy
      canvas.remove();
      section.classList.add('vp-no-scene');
      return;
    }

    scene.setProgress(readProgress());
    paintReadout();

    if (reduced.matches) { scene.renderStatic(); return; }

    if (!scrollBound) {
      scrollBound = true;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('pointermove', onPointer, { passive: true });
    }
    scene.start();
  };

  // Two observers: one to fetch the module ahead of time, one to run the loop
  // only while the section is actually on screen.
  const preload = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    preload.disconnect();
    load().catch((err) => console.warn('[valence] buffer scene failed:', err));
  }, { rootMargin: '600px 0px' });
  preload.observe(section);

  // Re-frame on orientation change. The scene keeps its geometry — rebuilding
  // 112k instances on a rotate would be far worse than the reframe — but the
  // camera and the section's scroll runway both have to follow.
  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      if (!scene) return;
      scene.resize();
      scene.setProgress(readProgress());
      paintReadout();
      if (!scene._running && !reduced.matches) scene.renderOnce();
    });
  }, { passive: true });

  const runner = new IntersectionObserver((entries) => {
    if (!scene || reduced.matches) return;
    if (entries[0].isIntersecting) scene.start(); else scene.stop();
  }, { threshold: 0 });
  runner.observe(section);
}

/* ── Mobile navigation ───────────────────────────────────────────────────
 * Below 900px the link list is a panel rather than a row. One list, one set of
 * hrefs — a second hidden copy for mobile is how the two drift apart.
 */
function setupNav() {
  const nav = document.querySelector('nav');
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.querySelector('#nav-menu');
  if (!nav || !toggle || !menu) return;

  const setOpen = (open) => {
    // The class goes on the list itself rather than on an ancestor: one
    // element, one state, and no dependence on a parent attribute selector.
    menu.classList.toggle('is-open', open);
    nav.dataset.open = open ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  };
  setOpen(false);

  toggle.addEventListener('click', () => {
    setOpen(nav.dataset.open !== 'true');
  });

  // Following a link should close the panel — every link here is an in-page
  // anchor, so without this the menu stays over the section it just jumped to.
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.dataset.open === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // Returning to a desktop width must not leave the panel state stuck on.
  const wide = window.matchMedia('(min-width: 901px)');
  wide.addEventListener('change', (e) => { if (e.matches) setOpen(false); });
}

function boot() {
  setupNav();
  buildHeroEditor();
  setupReveal();
  setupCopy();
  setupBufferScene();

  const field = document.querySelector('[data-lex-field]');
  if (field) mountLexerField(field);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
