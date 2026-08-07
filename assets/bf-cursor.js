/*
 * <bf-cursor> — the trailing pointer dot.
 *
 * A dot follows the pointer at a lag and grows into a labelled disc over
 * anything carrying `data-cursor`. Layout-level, rendered once from
 * theme.liquid; the real OS pointer is left visible (see bf-cursor.css).
 *
 * THE FOLLOW IS A LERP, NOT A TWEEN, and that is what the reference does too.
 * Sampled across a 900px jump on the live site, the remaining distance falls by
 * a constant ratio the whole way down — 0.65 every 50ms, holding to within a
 * couple of percent over eight readings. A constant ratio is exponential decay,
 * which is the signature of `pos += (target - pos) * k` run per frame, not of
 * any eased tween. Reproducing it needs the same shape, not a duration.
 *
 * Targets are matched by delegation from the document rather than by binding
 * listeners to each card. Cards arrive and leave constantly through the Section
 * Rendering API — a re-rendered band would silently lose per-element listeners,
 * and the dot would stop responding on exactly the cards a visitor just
 * filtered into view.
 */
/*
 * Wrapped in an IIFE so its top-level names stay private. Classic scripts share
 * one global lexical scope, so a `const` here collides with the same name in
 * any other asset — see the longer note in bf-product-card.js, which this file
 * collided with over `reduceMotion` and `canHover`.
 */

(() => {
/*
 * Fraction of the remaining distance closed per frame at 60Hz, derived from the
 * measurement above: 0.65 over 50ms is 0.65^(1/3) per 16.7ms frame, leaving
 * 0.866 of the gap, so 0.134 of it is closed.
 */
const EASE_PER_FRAME = 0.134;

/* The frame the constant above is expressed in. Everything is rescaled from
   this, so a 120Hz display closes half as much per frame and arrives at the
   same moment in wall-clock time rather than twice as fast. */
const BASE_FRAME_MS = 1000 / 60;

/* Below this the dot is within half a pixel of the pointer and the loop has
   nothing left to do. Without a floor the lerp approaches forever and holds a
   rAF open for the life of the page. */
const SETTLED_PX = 0.5;

const TARGET_SELECTOR = '[data-cursor]';
const LABEL_ATTRIBUTE = 'data-cursor-label';
const VISIBLE_CLASS = 'is-visible';
const ACTIVE_CLASS = 'is-active';

/* Both halves, for the same reason as the product card's hover image: a stylus
   reports a hover it cannot sustain, and a phone paired with a mouse only
   counts once that mouse is the primary pointer. */
const canHover = matchMedia('(hover: hover) and (pointer: fine)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

class BFCursor extends HTMLElement {
  connectedCallback() {
    this.follow = this.querySelector('.cursor__follow');
    this.label = this.querySelector('.cursor__label');
    if (!this.follow) return;

    this.pointer = { x: 0, y: 0 };
    this.current = { x: 0, y: 0 };
    this.frame = 0;
    this.placed = false;

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerOver = this.onPointerOver.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.sync = this.sync.bind(this);

    canHover.addEventListener('change', this.sync);
    this.sync();
  }

  disconnectedCallback() {
    canHover.removeEventListener('change', this.sync);
    this.deactivate();
  }

  /* A tablet that gets a mouse plugged in mid-session should gain the dot, and
     one that goes back to touch should lose it. Idempotent both ways. */
  sync() {
    if (canHover.matches) this.activate();
    else this.deactivate();
  }

  activate() {
    if (this.listening) return;
    this.listening = true;

    document.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('pointerover', this.onPointerOver, { passive: true });

    /* On <html>, not document: pointerleave on the document fires when the
       pointer crosses into a child, which is constantly. On the root element it
       means what it says — the pointer has left the window. */
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave, {
      passive: true,
    });
  }

  deactivate() {
    if (!this.listening) return;
    this.listening = false;

    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerover', this.onPointerOver);
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);

    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.placed = false;
    this.classList.remove(VISIBLE_CLASS, ACTIVE_CLASS);
  }

  onPointerMove(event) {
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;

    /*
     * An unplaced dot is a jump cut, not a slide. It sits at the origin until
     * the pointer is first seen, so interpolating towards the real position
     * would fling it across the whole viewport from the top-left corner. The
     * same applies to re-entering the window, which is why onPointerLeave
     * clears the flag: coming back in at the far edge should not drag the dot
     * across the page to catch up.
     */
    if (!this.placed) {
      this.placed = true;
      this.current.x = this.pointer.x;
      this.current.y = this.pointer.y;
      this.draw();
    }

    /*
     * Outside the branch above, and that is the whole point. Nested inside it
     * the class was added exactly once per page: leave the window and come back
     * and the dot stayed at opacity 0 for good, because the only line that
     * could show it again sat behind a flag that was already spent.
     */
    this.classList.add(VISIBLE_CLASS);
    this.start();
  }

  onPointerOver(event) {
    /* closest(), because the pointer is nearly always over a descendant — the
       image or the title — rather than over the card element itself. */
    const target = event.target.closest?.(TARGET_SELECTOR);

    this.classList.toggle(ACTIVE_CLASS, Boolean(target));

    const custom = target?.getAttribute(LABEL_ATTRIBUTE);
    if (custom && this.label) this.label.textContent = custom;
  }

  /* Clearing `placed` is what makes the next entry snap rather than slide: the
     dot is faded out by then, so re-seating it is free, and the visitor never
     sees it travel from wherever they left. */
  onPointerLeave() {
    this.placed = false;
    this.classList.remove(VISIBLE_CLASS, ACTIVE_CLASS);
  }

  start() {
    if (this.frame) return;

    this.last = performance.now();
    this.frame = requestAnimationFrame(this.step.bind(this));
  }

  /*
   * Runs only while there is ground to cover and stops itself once there is
   * not, rather than idling at 60fps behind a still pointer. A move restarts it.
   */
  step(now) {
    const delta = now - this.last;
    this.last = now;

    /*
     * Frame-rate independence, and the exponent is the point. Closing a FIXED
     * fraction per frame would run at double speed on a 120Hz display and crawl
     * on a loaded page dropping frames. Raising the per-frame survival rate to
     * the power of however many 60Hz frames actually elapsed gives the same
     * curve in wall-clock time on any refresh rate.
     *
     * Under reduced motion the lag is skipped outright: the lag IS the motion
     * here, so easing it more gently would not help — the dot pins to the
     * pointer instead.
     */
    const ease = reduceMotion.matches
      ? 1
      : 1 - (1 - EASE_PER_FRAME) ** (delta / BASE_FRAME_MS);

    this.current.x += (this.pointer.x - this.current.x) * ease;
    this.current.y += (this.pointer.y - this.current.y) * ease;
    this.draw();

    const settled =
      Math.abs(this.pointer.x - this.current.x) < SETTLED_PX &&
      Math.abs(this.pointer.y - this.current.y) < SETTLED_PX;

    if (settled) {
      this.frame = 0;
      return;
    }

    this.frame = requestAnimationFrame(this.step.bind(this));
  }

  /* translate3d rather than translate: it keeps the element on its own
     compositor layer, so a move is a composite and never a repaint. */
  draw() {
    this.follow.style.transform = `translate3d(${this.current.x}px, ${this.current.y}px, 0)`;
  }
}

if (!customElements.get('bf-cursor')) {
  customElements.define('bf-cursor', BFCursor);
}
})();
