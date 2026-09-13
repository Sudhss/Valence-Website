/* Valence — the lexer field.
 *
 * THE IDEA
 * The site claims Valence tokenizes C++ in a single hand-written pass with no
 * regex. Rather than assert that in a paragraph, this section performs it: you
 * type a real line of C++, and on tokenize the line physically comes apart —
 * every character becomes a rigid body and falls into the bin for the token it
 * belongs to. What you are watching is the classification the editor actually
 * performs, at the speed a person can follow.
 *
 * It is not decoration. The lexer is the real one (js/lexer.js, ported from the
 * C++), the colours are the editor's own, and the bins are named after the
 * TokenType enum. Edit the line and the characters climb back out and
 * reassemble, because the tokenizer is a pure function of the text.
 *
 * DOM glyphs rather than WebGL, deliberately: this section is ABOUT text, and
 * real glyphs stay crisp, selectable by assistive tech, and correct at any zoom.
 * The Three.js scene earns its place elsewhere, where 10,000 instances make DOM
 * impossible.
 */

import { tokenizeLine } from './lexer.js';
import { World, Body } from './physics.js';

const BINS = [
  { kind: 'keyword',     label: 'keyword' },
  { kind: 'type',        label: 'type' },
  { kind: 'function',    label: 'function' },
  { kind: 'plain',       label: 'identifier' },
  { kind: 'number',      label: 'number' },
  { kind: 'string',      label: 'string' },
  { kind: 'comment',     label: 'comment' },
  { kind: 'punctuation', label: 'punct' },
];

const SAMPLES = [
  `for (int i = 0; i < n; i++) cout << a[i] << "\\n";`,
  `const int MOD = 1'000'000'007;  // digit separators are not quotes`,
  `vector<pair<int,int>> adj[N];`,
  `if (!(cin >> n)) return 0;`,
];

export class LexerField {
  constructor(root) {
    this.root = root;
    this.input = root.querySelector('[data-lex-input]');
    this.render = root.querySelector('[data-lex-render]');
    this.stage = root.querySelector('[data-lex-stage]');
    this.readout = root.querySelector('[data-lex-readout]');
    this.runBtn = root.querySelector('[data-lex-run]');
    this.binRow = root.querySelector('[data-lex-bins]');

    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.world = new World({ gravity: 2600, drag: 0.35 });
    this.glyphs = [];
    this.exploded = false;
    this.running = false;
    this.visible = false;
    this._raf = 0;
    this._last = 0;
    this._sampleIndex = 0;

    this._buildBins();
    this._bind();
    this.paint();
    this._observe();
  }

  // ── setup ──────────────────────────────────────────────────────────────

  _buildBins() {
    this.binEls = BINS.map((bin) => {
      const el = document.createElement('div');
      el.className = 'lex-bin';
      el.dataset.kind = bin.kind;
      el.innerHTML = `<span class="lex-bin-count" data-count>0</span>
                      <span class="lex-bin-label">${bin.label}</span>`;
      this.binRow.appendChild(el);
      return el;
    });
  }

  _bind() {
    this.input.addEventListener('input', () => {
      if (this.exploded) this.reassemble();
      this.paint();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.toggle(); }
    });
    this.runBtn.addEventListener('click', () => this.toggle());

    const cycle = this.root.querySelector('[data-lex-sample]');
    if (cycle) {
      cycle.addEventListener('click', () => {
        this._sampleIndex = (this._sampleIndex + 1) % SAMPLES.length;
        if (this.exploded) this.reassemble();
        this.input.value = SAMPLES[this._sampleIndex];
        this.paint();
      });
    }

    this._onResize = () => { if (this.exploded) this.reassemble(); this._layout(); };
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  /** Only simulate while the section is actually on screen. */
  _observe() {
    const io = new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      if (this.visible && this.exploded) this._start();
      else this._stop();
    }, { threshold: 0.05 });
    io.observe(this.root);
    this._io = io;
  }

  // ── the highlighted line ───────────────────────────────────────────────

  paint() {
    const line = this.input.value;
    const { tokens } = tokenizeLine(line);

    this.render.innerHTML = '';
    for (const t of tokens) {
      const span = document.createElement('span');
      span.className = `tok tok-${t.kind}`;
      span.textContent = t.text;
      this.render.appendChild(span);
    }

    // A text summary of the same result. The physics is the memorable part, but
    // the information has to survive without it — for screen readers, for
    // reduced motion, and for anyone who never presses the button.
    const counts = new Map();
    for (const t of tokens) {
      if (t.kind === 'plain' && !t.text.trim()) continue;
      counts.set(t.kind, (counts.get(t.kind) || 0) + 1);
    }
    const parts = BINS
      .filter((b) => counts.get(b.kind))
      .map((b) => `${counts.get(b.kind)} ${b.label}${counts.get(b.kind) > 1 ? 's' : ''}`);
    this.readout.textContent = parts.length
      ? `${tokens.length} tokens — ${parts.join(', ')}`
      : 'empty line';

    for (const el of this.binEls) {
      el.querySelector('[data-count]').textContent = counts.get(el.dataset.kind) || 0;
    }
  }

  // ── the physical pass ──────────────────────────────────────────────────

  toggle() { this.exploded ? this.reassemble() : this.tokenizeApart(); }

  _layout() {
    const stageRect = this.stage.getBoundingClientRect();
    this.W = stageRect.width;
    this.H = stageRect.height;
    this.world.setBounds({ left: 0, right: this.W, top: -400, bottom: this.H });

    // Each bin contributes a floor and a pair of side walls, derived from where
    // the bin actually rendered rather than from assumed geometry.
    const walls = this.binEls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - stageRect.left,
        right: r.right - stageRect.left,
        top: r.top - stageRect.top,
        depth: 40,
      };
    });
    this.world.setWalls(walls);
    this._binRects = walls;
  }

  tokenizeApart() {
    if (this.exploded) return;
    const line = this.input.value;
    if (!line.trim()) return;

    const { tokens } = tokenizeLine(line);
    this._layout();

    // Measure where each character currently sits on the rendered line, so the
    // bodies are born exactly where their glyphs already are. Anything else
    // reads as a cut rather than a transformation.
    const stageRect = this.stage.getBoundingClientRect();
    const spans = [...this.render.children];
    const seeds = [];
    tokens.forEach((tok, ti) => {
      const span = spans[ti];
      if (!span) return;
      const r = span.getBoundingClientRect();
      const per = r.width / Math.max(1, tok.text.length);
      for (let ci = 0; ci < tok.text.length; ci++) {
        const ch = tok.text[ci];
        if (!ch.trim()) continue;                    // whitespace has no body
        seeds.push({
          ch,
          kind: tok.kind,
          x: r.left - stageRect.left + per * (ci + 0.5),
          y: r.top - stageRect.top + r.height * 0.5,
          w: Math.max(9, per),
          h: r.height,
        });
      }
    });
    if (!seeds.length) return;

    this.render.style.visibility = 'hidden';
    this.input.style.visibility = 'hidden';

    for (const seed of seeds) {
      const node = document.createElement('span');
      node.className = `lex-glyph tok-${seed.kind}`;
      node.textContent = seed.ch;
      node.setAttribute('aria-hidden', 'true');
      this.stage.appendChild(node);

      const body = new Body({
        x: seed.x, y: seed.y,
        w: seed.w, h: seed.h,
        restitution: 0.2,
        friction: 0.8,
        data: node,
      });

      const binIndex = BINS.findIndex((b) => b.kind === seed.kind);
      const rect = this._binRects[binIndex >= 0 ? binIndex : BINS.length - 1];
      body.bin = rect;

      // Launched, not teleported: a small upward kick plus lateral aim at the
      // bin, then gravity does the rest. Deterministic jitter keyed off the
      // character so a given line always behaves identically.
      const aim = rect ? (rect.left + rect.right) / 2 : this.W / 2;
      const jitter = ((seed.ch.charCodeAt(0) * 37) % 100) / 100 - 0.5;
      body.vx = (aim - seed.x) * 1.15 + jitter * 90;
      body.vy = -260 - Math.abs(jitter) * 220;

      this.world.add(body);
      this.glyphs.push(body);
    }

    this.exploded = true;
    this.runBtn.textContent = 'reassemble';
    this.runBtn.setAttribute('aria-pressed', 'true');
    this.root.dataset.state = 'exploded';
    if (this.visible) this._start();
  }

  reassemble() {
    if (!this.exploded) return;
    // Springs pull every glyph back to where it came from; once they are all
    // home the DOM line takes over again and the bodies are destroyed.
    for (const b of this.glyphs) {
      b.seek(b.homeX ?? b.x, b.homeY ?? b.y, 0, 0);
    }
    this._teardown();
  }

  _teardown() {
    for (const b of this.glyphs) b.data?.remove();
    this.glyphs.length = 0;
    this.world.clear();
    this.exploded = false;
    this.render.style.visibility = '';
    this.input.style.visibility = '';
    this.runBtn.textContent = 'tokenize';
    this.runBtn.setAttribute('aria-pressed', 'false');
    this.root.dataset.state = 'idle';
    this._stop();
  }

  // ── loop ───────────────────────────────────────────────────────────────

  _start() {
    if (this.running || this.reduced) return;
    this.running = true;
    this._last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = (now - this._last) / 1000;
      this._last = now;

      this.world.step(dt);

      // Writes only — no getBoundingClientRect in here. Reading layout inside
      // the loop is what turns a physics demo into a jank demo.
      for (const b of this.glyphs) {
        b.data.style.transform =
          `translate3d(${(b.x - b.w / 2).toFixed(1)}px, ${(b.y - b.h / 2).toFixed(1)}px, 0)`;
      }

      // Everything has settled: stop burning frames until something wakes it.
      if (this.world.awakeCount === 0) { this.running = false; return; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  destroy() {
    this._stop();
    this._io?.disconnect();
    window.removeEventListener('resize', this._onResize);
    for (const b of this.glyphs) b.data?.remove();
    this.glyphs.length = 0;
    this.world.clear();
  }
}

export function mountLexerField(root) {
  if (!root) return null;
  return new LexerField(root);
}
