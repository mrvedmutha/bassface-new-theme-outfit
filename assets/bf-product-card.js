/*
 * <bf-product-card> — the title marquee, the entrance, and arming the hover
 * image.
 *
 * Both animations are declared in bf-product-card.css; what this file owns is
 * WHEN they are allowed to run, which is the part CSS cannot answer:
 *
 *   entrance    the card is put into its starting pose here rather than in the
 *               stylesheet, so a card whose script never arrives renders
 *               normally instead of staying behind a curtain — see conceal().
 *   hover image whether the second image is downloaded at all, and whether it
 *               has decoded far enough to be worth revealing — see
 *               armAltImage().
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
/*
 * Everything below is wrapped in an IIFE, and it is not decoration.
 *
 * The theme uses classic scripts by design — no bundler, no modules — which
 * means every `const` at the top level of every asset lands in ONE shared
 * global lexical scope. Two files declaring the same name is not a shadowing
 * warning, it is a SyntaxError that kills whichever file parses second,
 * outright and silently apart from a console entry.
 *
 * That is not hypothetical: this file and bf-cursor.js both wanted
 * `reduceMotion` and `canHover`, and the collision took out the marquee, the
 * entrance and the hover image all at once. An IIFE per file is what makes a
 * new component safe to add without auditing every name already in the theme.
 */

(() => {
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
const READY_CLASS = 'is-ready';
const CONCEALED_CLASS = 'is-concealed';
const REVEALED_CLASS = 'is-revealed';
const TITLE_SELECTOR = '.product-card__title';
const TEXT_SELECTOR = '.product-card__title-text';
const ALT_IMAGE_SELECTOR = '.product-card__image--alt';
const PRIMARY_IMAGE_SELECTOR = '.product-card__image--primary';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/*
 * Resolves when the preloader has handed the page over, or immediately if there
 * was never one in the way.
 *
 * Without this the top band plays its whole entrance behind the preloader
 * panel: those cards are in the viewport from the first frame, so they
 * intersect, reveal, and are finished and static by the time the panel lifts.
 * The visitor never sees it. Everything below the fold was fine, which is what
 * made it look like a first-row-only bug.
 *
 * `is-preloading` is the signal rather than the presence of a <bf-preloader>
 * element, because it is set by an inline script in the document head and is
 * therefore already correct by the time this file is evaluated. It covers all
 * three cases in one test: preloader disabled in theme settings, preloader
 * present and running, and preloader that released SYNCHRONOUSLY — which it
 * does on a repeat visit or under reduced motion, before this script has even
 * been reached. Listening for the event alone would miss that last one and
 * leave the cards concealed forever.
 *
 * bf-preloader.js fires this halfway through its own wipe, so the cards start
 * arriving while the panel is still clearing — which is the handoff the
 * reference uses too, rather than waiting for a fully clean screen.
 *
 * The second cover is the router's. bf-page-transition puts `is-navigating` on
 * <html> for the length of a transition and fires `bf:page-revealed` as its
 * curtain clears — the same contract, for the same reason, one page later.
 *
 * IT IS A FUNCTION rather than the constant it used to be, because the router
 * swaps <main> WITHOUT re-running this file. A promise captured once at load
 * stays resolved from the first page forever, and every card fetched after that
 * would reveal behind a curtain still on its way up.
 */
const pageReady = () => {
  if (document.documentElement.classList.contains('is-preloading')) {
    return new Promise((resolve) => {
      document.addEventListener('preloader:complete', resolve, { once: true });
    });
  }

  if (document.documentElement.classList.contains('is-navigating')) {
    return new Promise((resolve) => {
      document.addEventListener('bf:page-revealed', resolve, { once: true });
    });
  }

  return Promise.resolve();
};

/* Both halves matter. `hover: hover` alone is true for a stylus, which reports a
   hover it cannot sustain; `pointer: fine` alone is true for a phone paired with
   a mouse only once that mouse is the primary pointer. Together they mean a
   pointer that can rest on a card and hold it there. */
const canHover = matchMedia('(hover: hover) and (pointer: fine)');

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

/*
 * Resolves once an <img> has actually painted, or has definitively failed.
 *
 * NOT img.decode(), which was the first attempt and was wrong: on an image with
 * loading="lazy" that the browser has not started fetching, decode() returns a
 * promise that simply never settles. Every card on the page was left holding
 * one, so nothing was ever marked ready — and awaiting one by hand hung the tab
 * outright. The load event has no such trap.
 *
 * `complete && naturalWidth` is the cached case: an image already in the HTTP
 * cache can be finished before this ever runs, and waiting for a load event
 * that has already fired would hang just as badly.
 *
 * Errors resolve rather than reject. Callers decide what a broken image means —
 * for the entrance it must still reveal, or a 404 would hide the card forever.
 */
function whenPainted(img) {
  /* Not an <img> at all is the placeholder case: with no collection chosen the
     card renders Shopify's inline <svg>, which has no `complete` and fires no
     load event. Waiting on one would leave every placeholder card in the theme
     editor stuck behind its curtain. */
  if (!(img instanceof HTMLImageElement)) return Promise.resolve(false);
  if (img.complete) return Promise.resolve(img.naturalWidth > 0);

  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(true), { once: true });
    img.addEventListener('error', () => resolve(false), { once: true });
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
    this.conceal();
    enterObserver.observe(this);

    this.titleEl = this.querySelector(TITLE_SELECTOR);
    this.textEl = this.querySelector(TEXT_SELECTOR);
    if (!this.titleEl || !this.textEl) return;

    cards.add(this);
    this.measure();
    observer.observe(this);
  }

  /*
   * Promotes the hover image from data-src to a real src, and only on a pointer
   * that can hover.
   *
   * This is not something Liquid can decide: the server has no idea what is
   * pointing at the page, so a plain src would have every phone download a
   * second image per card for an effect it can never trigger — four bands of
   * three or four cards is a dozen wasted requests on the slowest connections.
   *
   * Cheap to call more than once. The src guard makes it idempotent, which is
   * what lets the media-query listener re-run it wholesale.
   */
  armAltImage() {
    const img = this.querySelector(ALT_IMAGE_SELECTOR);
    if (!img || !this.entered || img.hasAttribute('src') || !canHover.matches) return;

    /* srcset first: setting src on an element that already has a srcset would
       start the wrong fetch for one frame before the candidate is picked. */
    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
    img.src = img.dataset.src;

    /*
     * The hover reveal stays off until the pixels are actually here.
     *
     * Without this the effect breaks in the window before the image lands: the
     * wipe runs against an empty box, finishes, and THEN the image appears —
     * fully revealed, in one frame, with no wipe at all. The visitor sees a
     * jump cut instead of the transition.
     *
     * A broken image deliberately leaves .is-ready off, so a card whose second
     * image 404s simply has no hover effect. That is the right degradation
     * here, and the opposite of the entrance's — nothing is hidden by getting
     * this wrong.
     */
    whenPainted(img).then((ok) => {
      if (ok) img.classList.add(READY_CLASS);
    });
  }

  disconnectedCallback() {
    enterObserver.unobserve(this);
    observer.unobserve(this);
    cards.delete(this);
    inView.delete(this);
    this.stop();
  }

  /*
   * Puts the card into its starting pose.
   *
   * The pose is set from JS rather than declared in the stylesheet on purpose,
   * and the reason is the failure case: primed in CSS, a card whose script
   * never arrived would sit behind an opaque curtain forever, and one failed
   * asset request would take the whole catalogue's imagery with it. Priming
   * here means the worst case is a card that renders normally without an
   * entrance, which nobody will notice.
   *
   * Under reduced motion nothing is primed at all, so the card is simply
   * visible from the start — no curtain, no counter-move, nothing to undo.
   */
  conceal() {
    if (reduceMotion.matches) return;

    this.classList.add(CONCEALED_CLASS);
  }

  /*
   * The card has reached the viewport for the first time. Both of the things
   * that wait for that happen here, which is why there is one observer and not
   * two: downloading the hover image, and running the entrance.
   *
   * Arming here rather than on connect is what replaced loading="lazy" on that
   * image — see the note in bf-product-card.liquid. It also means a page of
   * forty cards fetches second images as they are approached rather than all at
   * once on load.
   */
  enter() {
    this.entered = true;
    this.armAltImage();

    if (!reduceMotion.matches) this.reveal();
  }

  /*
   * Waits for the image before pulling the curtain, which is the whole point of
   * having a curtain. Uncovering an empty box and letting the image appear
   * underneath it a moment later is worse than no entrance at all — the motion
   * finishes on nothing and the product then pops in unannounced.
   *
   * This matters most for the top band, where the cards are in view from the
   * first frame and the intersection fires long before any image has arrived.
   *
   * A failed image still reveals: whenPainted resolves either way and the
   * result is ignored here, because a card that will never have an image must
   * not be left behind a panel forever.
   *
   * Both waits have to clear, and they are independent — an image that is
   * already cached still waits for the preloader, and a card that outlasts the
   * preloader still waits for its image. Racing them would let either one
   * through on its own.
   */
  reveal() {
    const painted = whenPainted(this.querySelector(PRIMARY_IMAGE_SELECTOR));

    Promise.all([pageReady(), painted]).then(() => {
      this.classList.add(REVEALED_CLASS);
    });
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

/*
 * First arrival, and a separate observer from the marquee's on purpose: they
 * ask different questions. The marquee wants "is this comfortably on screen,
 * right now", and flips back and forth for as long as the card lives. This one
 * wants "has this arrived, ever" — it fires once per card and lets go.
 *
 * A low threshold, because the entrance should already be running by the time
 * the card is properly in view; waiting for half of it means the visitor
 * watches it start rather than catching it having started.
 */
const enterObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      entry.target.enter();
      enterObserver.unobserve(entry.target);
    }
  },
  { threshold: 0.1 }
);

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

/* A tablet that gets a mouse plugged in, or a laptop switching to its trackpad
   after touch input, flips this mid-session. The cards are already on the page
   by then, so they have to be told to arm rather than waiting for a reload. */
canHover.addEventListener('change', () => {
  for (const card of cards) card.armAltImage();
});

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
})();
