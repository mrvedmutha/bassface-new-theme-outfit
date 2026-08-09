/*
 * <bf-reveal> — the product page's entrance, for images and for text.
 *
 * Two treatments, chosen by `type`, both waiting on the same two signals the
 * homepage cards wait on: the preloader handing over, and the element reaching
 * the viewport.
 *
 *   curtain  a solid panel slides off to the right while the image, pushed
 *            half its width left and scaled up, slides right to meet its
 *            place. Lifted wholesale from bf-product-card.css so a gallery
 *            image and a card image arrive the same way — the two are the same
 *            gesture and would read as a mistake if they differed.
 *
 *   rise     lines climb out from under a clip, staggered. The hero's
 *            movement, at the hero's numbers.
 *
 * WHY ONE ELEMENT AND NOT TWO. The waiting is the hard part and it is identical
 * for both: the preloader promise, an IntersectionObserver, prefers-reduced-
 * motion, and the rule that the resting state in CSS must be the VISIBLE one so
 * a script that never runs leaves a readable page. The two poses differ by a
 * class name.
 *
 * The gallery deliberately does NOT wait for its image to decode, where the
 * card does. A card is one of forty in a grid and uncovering an empty box is a
 * wasted gesture; the first gallery image is the LCP element with
 * fetchpriority="high", so it is already on its way, and holding the curtain
 * for it would delay the largest paint on the page to run an animation over it.
 */

(() => {
  const CONCEALED = 'is-concealed';
  const REVEALED = 'is-revealed';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * The handover, and BOTH HALVES ARE LOAD-BEARING — this is bf-product-card's
   * pattern, and the note there explains why the class test cannot be dropped:
   * the preloader releases synchronously on a repeat visit and under reduced
   * motion, before this file has been reached, so listening for the event alone
   * would miss it and leave everything concealed for good.
   *
   * The event is `preloader:complete`, dispatched by bf-preloader.js halfway
   * through its own wipe. Getting that string wrong fails in exactly the way
   * the class test is there to prevent, and it fails SILENTLY — the promise
   * simply never settles. It cost a debugging pass here; check the name against
   * bf-preloader.js rather than against memory.
   *
   * A FUNCTION, NOT A CONSTANT, and that is what makes it survive the router.
   * bf-page-transition swaps <main> without re-running this file, so a promise
   * captured once at load would still be the resolved one from the first page
   * and every element arriving on the second would reveal instantly — behind a
   * curtain that has not lifted yet. Two covers, same shape, evaluated fresh
   * each time an element asks.
   */
  const pageReady = () => {
    if (document.documentElement.classList.contains('is-preloading')) {
      return new Promise((resolve) => document.addEventListener('preloader:complete', resolve, { once: true }));
    }

    if (document.documentElement.classList.contains('is-navigating')) {
      return new Promise((resolve) => document.addEventListener('bf:page-revealed', resolve, { once: true }));
    }

    return Promise.resolve();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        entry.target.reveal();
        observer.unobserve(entry.target);
      }
    },
    /*
     * ANY pixel, where the cards use 0.1 — and the horizontal strip is why.
     *
     * Below 1024 the gallery turns into a row of 85vw images, so the next one
     * is deliberately left peeking at the right edge; that sliver is the only
     * thing telling anyone the row scrolls. At 0.1 the sliver is too small to
     * count as intersecting, so it sat behind its curtain and read as a flat
     * pink panel — a design element rather than a photograph.
     *
     * Zero suits the vertical gallery too. The card's own note argues for the
     * entrance already being under way by the time the image is properly in
     * view rather than starting as you watch it, and this is more of that.
     */
    { threshold: 0 }
  );

  if (!customElements.get('bf-reveal')) {
    customElements.define(
      'bf-reveal',
      class BfReveal extends HTMLElement {
        connectedCallback() {
          if (reduceMotion.matches) return;

          /* Priming happens here rather than in CSS so the unprimed page is
             the readable one. A stylesheet that hid these by default would
             leave the gallery behind panels the moment a script 404'd. */
          this.classList.add(CONCEALED);
          observer.observe(this);
        }

        disconnectedCallback() {
          observer.unobserve(this);
        }

        reveal() {
          pageReady().then(() => {
            this.classList.add(REVEALED);
          });
        }
      }
    );
  }
})();
