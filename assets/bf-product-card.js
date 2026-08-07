/*
 * <bf-product-card> — the title marquee.
 *
 * Long product titles truncate to one line with an ellipsis. When the page has
 * settled and the card is in view, a title that ACTUALLY overflows sweeps its
 * hidden tail into view once, snaps back to the truncated state, waits, and
 * repeats for as long as both conditions hold. Titles that fit never animate,
 * and nothing animates while the visitor is scrolling.
 *
 * Two shared signals drive every card on the page, and they are deliberately
 * page-level rather than per-instance:
 *
 *   settled  one passive scroll listener, debounced. A collection page can hold
 *            forty cards; forty scroll listeners to compute one boolean is
 *            forty times the work for the same answer.
 *   in view  one IntersectionObserver with all cards registered on it. Same
 *            reasoning — an observer per element is the expensive way to ask
 *            the question the API is designed to answer in bulk.
 *
 * A card runs only when it is in the in-view set AND the page is settled, so
 * both signals gate the same cycle and either one dropping cancels it.
 *
 * The sweep is Web Animations, not GSAP. It is one linear translate with a
 * cancel path; the theme vendors GSAP for work that earns it, and this does not.
 */

/* Scroll is considered stopped after this long without a scroll event. Long
   enough not to fire mid-flick on momentum scrolling, short enough that a
   deliberate stop feels answered. */
const SETTLE_MS = 300;

/* The pause before the first sweep and between repeats — the "wait ms" either
   side of the loop. Long enough to read the truncated title first. */
const DWELL_MS = 1400;

/* Held at the far end so the tail is readable before it snaps back. Without it
   the end of the title is on screen for a single frame. */
const HOLD_MS = 900;

/* Sweep speed in px/sec, so a long title takes proportionally longer than a
   short one and every card reads at the same pace. A fixed duration would make
   the longest titles unreadably fast. */
const SPEED = 55;

/* Under a pixel of overflow is a rounding artefact, not a truncated title. */
const MIN_OVERFLOW = 1;

const MARQUEE_CLASS = 'is-marqueeing';
const TRUNCATED_CLASS = 'is-truncated';
const TITLE_SELECTOR = '.product-card__title';
const TEXT_SELECTOR = '.product-card__title-text';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* Every connected card, not just the visible ones: the ellipsis is drawn from
   this class (see bf-product-card.css), so a card has to know it is truncated
   long before it is ever in view or eligible to sweep. */
const cards = new Set();
const inView = new Set();
let settled = false;
let settleTimer = 0;

/* Settles on either the timer or the abort, whichever lands first, and detaches
   itself both ways — a cycle can loop for minutes, so a listener left behind per
   iteration is a leak that grows with dwell time. */
function wait(ms, signal) {
  return new Promise((resolve) => {
    let timer = 0;

    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };

    timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/* Re-measured every sweep rather than cached: the card is fluid, so a resize,
   a font swap or a theme change can all change the answer. */
function overflowOf(titleEl, textEl) {
  return textEl.offsetWidth - titleEl.clientWidth;
}

class BFProductCard extends HTMLElement {
  /*
   * `titleEl`, not `title`: HTMLElement.prototype.title is an accessor
   * reflecting the title content attribute, so assigning an element to it would
   * stringify it into a tooltip on every card. Same reasoning behind `textEl`.
   */
  connectedCallback() {
    this.titleEl = this.querySelector(TITLE_SELECTOR);
    this.textEl = this.querySelector(TEXT_SELECTOR);
    if (!this.titleEl || !this.textEl) return;

    cards.add(this);
    this.measure();
    observer.observe(this);
  }

  disconnectedCallback() {
    observer.unobserve(this);
    cards.delete(this);
    inView.delete(this);
    this.stop();
  }

  /* Drives the drawn ellipsis. Skipped mid-sweep: the text is translated then,
     so the measurement is still valid but the class is not being read, and
     toggling it would only cause needless style invalidation. */
  measure() {
    if (this.titleEl.classList.contains(MARQUEE_CLASS)) return;

    const overflows = overflowOf(this.titleEl, this.textEl) >= MIN_OVERFLOW;
    this.titleEl.classList.toggle(TRUNCATED_CLASS, overflows);
  }

  /* Idempotent: both signals call it whenever they change, and the common case
     is that the card is already in the state being asked for. */
  sync() {
    const shouldRun = settled && inView.has(this) && !reduceMotion.matches;

    if (shouldRun) this.start();
    else this.stop();
  }

  start() {
    if (this.controller) return;

    this.controller = new AbortController();
    this.cycle(this.controller.signal);
  }

  stop() {
    if (!this.controller) return;

    this.controller.abort();
    this.controller = null;
    this.reset();
  }

  reset() {
    if (this.animation) {
      this.animation.cancel();
      this.animation = null;
    }

    this.titleEl.classList.remove(MARQUEE_CLASS);
  }

  async cycle(signal) {
    while (!signal.aborted) {
      await wait(DWELL_MS, signal);
      if (signal.aborted) return;

      await this.sweep(signal);
      if (signal.aborted) return;

      this.reset();
    }
  }

  async sweep(signal) {
    const distance = overflowOf(this.titleEl, this.textEl);
    if (distance < MIN_OVERFLOW) return;

    this.titleEl.classList.add(MARQUEE_CLASS);
    this.animation = this.textEl.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${-distance}px)` }],
      { duration: (distance / SPEED) * 1000, easing: 'linear', fill: 'forwards' }
    );

    /* A cancelled animation rejects its finished promise; that is the stop path,
       not an error. */
    await this.animation.finished.catch(() => {});
    if (signal.aborted) return;

    await wait(HOLD_MS, signal);
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target);
      else inView.delete(entry.target);

      entry.target.sync();
    }
  },
  /* Half the card visible. A title sliding past at the very edge of the
     viewport is motion the visitor did not ask to follow. */
  { threshold: 0.5 }
);

function syncAll() {
  for (const card of inView) card.sync();
}

function onScroll() {
  if (settled) {
    settled = false;
    syncAll();
  }

  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settled = true;
    syncAll();
  }, SETTLE_MS);
}

/* A resize changes the answer to "does this overflow?" for every card at once —
   the cards are fluid and the type ramps with the viewport above 1440 — so this
   re-measures the whole set, not just the visible ones. */
function onResize() {
  for (const card of cards) card.measure();
  onScroll();
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onResize, { passive: true });
reduceMotion.addEventListener('change', syncAll);

/* Archivo loads with font-display: swap, so the first measurement runs against
   the fallback face and can be wrong in either direction. Re-measure once the
   real face is in. */
if (document.fonts) document.fonts.ready.then(onResize);

/* Nothing has scrolled yet on first paint, so the page is already settled —
   without this the top band would wait for a scroll that may never come. */
settleTimer = setTimeout(() => {
  settled = true;
  syncAll();
}, SETTLE_MS);

customElements.define('bf-product-card', BFProductCard);
