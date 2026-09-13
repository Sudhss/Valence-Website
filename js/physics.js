/* Valence — a small deterministic rigid-body solver.
 *
 * Written rather than imported. The field never holds more than a couple of
 * hundred axis-aligned boxes, and for that a focused 200-line solver beats
 * pulling in a general engine: it is a fraction of the payload, it is
 * deterministic, and every constant in it can be tuned against how the
 * interaction should feel rather than against someone else's defaults.
 *
 * Integration is semi-implicit Euler on a FIXED timestep with an accumulator.
 * Variable-dt integration makes spring constants frame-rate dependent, which is
 * why so many web physics demos feel different on a 144Hz monitor.
 */

export const FIXED_DT = 1 / 120;      // seconds; two steps per 60Hz frame
const MAX_STEPS = 5;                  // ceiling per frame, so a stalled tab cannot spiral
const SLEEP_SPEED = 4;                // px/s below which a body is a sleep candidate
const SLEEP_FRAMES = 40;              // consecutive slow frames before sleeping

export class Body {
  constructor(opts) {
    this.x = opts.x; this.y = opts.y;           // centre, in field pixels
    this.vx = 0; this.vy = 0;
    this.w = opts.w; this.h = opts.h;
    this.invMass = opts.invMass ?? 1;
    this.restitution = opts.restitution ?? 0.24;
    this.friction = opts.friction ?? 0.72;

    // Spring target. When null the body is purely ballistic.
    this.target = null;
    this.stiffness = 0;
    this.damping = 0;

    this.sleeping = false;
    this._slowFrames = 0;
    this.data = opts.data ?? null;              // caller payload (the glyph node)
  }

  /** Pull toward a point with a critically-ish damped spring. */
  seek(tx, ty, stiffness, damping) {
    this.target = { x: tx, y: ty };
    this.stiffness = stiffness;
    this.damping = damping;
    this.wake();
  }

  release() { this.target = null; this.wake(); }

  wake() { this.sleeping = false; this._slowFrames = 0; }

  addImpulse(ix, iy) {
    this.vx += ix * this.invMass;
    this.vy += iy * this.invMass;
    this.wake();
  }
}

export class World {
  constructor(opts = {}) {
    this.bodies = [];
    this.gravity = opts.gravity ?? 2400;        // px/s^2
    this.drag = opts.drag ?? 0.6;               // per second, applied exponentially
    this.bounds = opts.bounds ?? null;          // {left,right,top,bottom} or null
    this.walls = [];                            // extra AABB floors: the bins
    this._acc = 0;
    this._cell = 34;                            // spatial hash cell, ~one glyph
    this._grid = new Map();
    this.enabled = true;
  }

  add(body) { this.bodies.push(body); return body; }
  clear() { this.bodies.length = 0; }

  setBounds(b) { this.bounds = b; }
  setWalls(walls) { this.walls = walls; }

  /** Advance by real elapsed seconds, consuming whole fixed steps. */
  step(dt) {
    if (!this.enabled) return;
    // Clamp: a backgrounded tab returns a huge dt, and replaying it would
    // teleport every body through its constraints.
    this._acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this._acc >= FIXED_DT && steps < MAX_STEPS) {
      this._integrate(FIXED_DT);
      this._acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this._acc = 0;
  }

  _integrate(dt) {
    const dragFactor = Math.exp(-this.drag * dt);

    // Gravity injects gravity*dt of closing velocity into every resting contact
    // BEFORE collision runs, so a stack at rest always presents a normal
    // velocity of about that much. Any impact threshold below it classifies
    // every resting contact as an impact. Everything slower than this is
    // resting: no restitution, no waking.
    this._restingV = this.gravity * dt * 2;

    for (const b of this.bodies) {
      if (b.sleeping) continue;

      if (b.target) {
        // F = -k·x - c·v, applied about the target.
        const dx = b.target.x - b.x;
        const dy = b.target.y - b.y;
        b.vx += (dx * b.stiffness - b.vx * b.damping) * dt;
        b.vy += (dy * b.stiffness - b.vy * b.damping) * dt;
      } else {
        b.vy += this.gravity * dt;
        b.vx *= dragFactor;
        b.vy *= dragFactor;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    this._collide();
    this._constrain();
    this._sleep(dt);
  }

  /** Broad phase: uniform spatial hash. Narrow phase: AABB, minimum translation. */
  _collide() {
    const grid = this._grid;
    grid.clear();
    const cell = this._cell;

    for (const b of this.bodies) {
      const cx = Math.floor(b.x / cell);
      const cy = Math.floor(b.y / cell);
      const key = cx * 73856093 ^ cy * 19349663;
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(b);
      b._cx = cx; b._cy = cy;
    }

    for (const b of this.bodies) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const key = (b._cx + ox) * 73856093 ^ (b._cy + oy) * 19349663;
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (const o of bucket) {
            if (o === b) continue;
            // Each unordered pair resolved once.
            if (o.x < b.x || (o.x === b.x && o.y <= b.y)) continue;
            this._resolvePair(b, o);
          }
        }
      }
    }
  }

  _resolvePair(a, b) {
    // Two settled bodies resting against each other need no work. Without this
    // a finished stack keeps resolving contacts forever.
    if (a.sleeping && b.sleeping) return;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ox = (a.w + b.w) * 0.5 - Math.abs(dx);
    if (ox <= 0) return;
    const oy = (a.h + b.h) * 0.5 - Math.abs(dy);
    if (oy <= 0) return;

    const invSum = a.invMass + b.invMass;
    if (invSum === 0) return;

    // Separate along the axis of least penetration.
    let nx = 0, ny = 0, pen = 0;
    if (ox < oy) { nx = dx < 0 ? -1 : 1; pen = ox; }
    else         { ny = dy < 0 ? -1 : 1; pen = oy; }

    const correction = pen / invSum * 0.8;      // slop factor keeps stacks calm
    a.x -= nx * correction * a.invMass;
    a.y -= ny * correction * a.invMass;
    b.x += nx * correction * b.invMass;
    b.y += ny * correction * b.invMass;

    // Impulse along the contact normal.
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn > 0) return;                          // already separating

    // Resting contacts get no bounce, so stacks do not shiver.
    const resting = -vn < this._restingV;
    const e = resting ? 0 : Math.min(a.restitution, b.restitution);
    const j = -(1 + e) * vn / invSum;
    a.vx -= j * nx * a.invMass;
    a.vy -= j * ny * a.invMass;
    b.vx += j * nx * b.invMass;
    b.vy += j * ny * b.invMass;

    // Coulomb-ish tangential friction, so stacks settle instead of sliding.
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const jt = -vt / invSum * Math.min(a.friction, b.friction);
    a.vx -= jt * tx * a.invMass;
    a.vy -= jt * ty * a.invMass;
    b.vx += jt * tx * b.invMass;
    b.vy += jt * ty * b.invMass;

    // Wake on a genuine impact only. Waking on every contact — including the
    // resting ones that hold a finished stack together — means each body is
    // roused by its neighbour every step, its sleep counter never advances, and
    // the simulation runs at full cost forever behind a picture that stopped
    // moving. Resting contacts have a normal velocity near zero; impacts do not.
    if (!resting) { a.wake(); b.wake(); }
  }

  _constrain() {
    const bb = this.bounds;
    // Below this downward speed a contact is resting, not bouncing. Gravity
    // injects gravity*dt of velocity every step, so a body sitting on the floor
    // is re-accelerated and re-reflected forever; reflecting that tiny value
    // produces a permanent micro-bounce that both looks like jitter and keeps
    // the body above any sane sleep threshold. Resting contacts absorb it.
    const restingV = this._restingV ?? (this.gravity * FIXED_DT * 2);

    for (const b of this.bodies) {
      const hw = b.w * 0.5, hh = b.h * 0.5;

      if (bb) {
        if (b.x - hw < bb.left)   { b.x = bb.left + hw;   b.vx = -b.vx * b.restitution; }
        if (b.x + hw > bb.right)  { b.x = bb.right - hw;  b.vx = -b.vx * b.restitution; }
        if (b.y - hh < bb.top)    { b.y = bb.top + hh;    b.vy = -b.vy * b.restitution; }
        if (b.y + hh > bb.bottom) {
          b.y = bb.bottom - hh;
          b.vy = b.vy > restingV ? -b.vy * b.restitution : 0;
          b.vx *= b.friction;
        }
      }

      // Bin floors and side walls. Only applied from above, so a body can fall
      // into a bin but never be pushed up through its own floor.
      for (const w of this.walls) {
        if (b.x + hw < w.left || b.x - hw > w.right) continue;
        if (b.y + hh > w.top && b.y < w.top + w.depth) {
          b.y = w.top - hh;
          if (b.vy > 0) {
            b.vy = b.vy > restingV ? -b.vy * b.restitution : 0;
            b.vx *= b.friction;
          }
        }
      }
    }
  }

  _sleep(dt) {
    for (const b of this.bodies) {
      if (b.sleeping || b.target) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < SLEEP_SPEED) {
        if (++b._slowFrames > SLEEP_FRAMES) {
          b.sleeping = true;
          b.vx = 0; b.vy = 0;                   // stop integrating it entirely
        }
      } else {
        b._slowFrames = 0;
      }
    }
  }

  get awakeCount() {
    let n = 0;
    for (const b of this.bodies) if (!b.sleeping) n++;
    return n;
  }
}
