/*
 * Page scrolling — Lenis, and the lock every modal surface shares.
 *
 * Not a custom element, unlike everything else in assets/. There is no element
 * to attach to: this owns the document's scroll, which belongs to no component.
 * It is loaded once from theme.liquid and talks to the rest of the theme
 * through two events, the same way bf-preloader announces itself.
 *
 *   bf:scroll-lock     stop scrolling the page. Fired by the nav drawer and the
 *   bf:scroll-unlock   search overlay when they open and close.
 *
 *   bf:scroll-to       jump to detail.top with no animation. Fired by the page
 *                      transition router after it swaps the document — a new
 *                      page starts at the top, and a back navigation returns to
 *                      where the visitor left.
 *   bf:scroll-refresh  remeasure. The router fires this after the same swap:
 *                      Lenis caches the document height and would otherwise
 *                      clamp scrolling to the length of the page it replaced.
 *
 * WHY EVENTS AND NOT A GLOBAL. Every asset here is a classic script sharing one
 * global scope, so exporting `window.bfScroll` would be one more name for the
 * next component to collide with — which has already happened once in this
 * theme. Events cost nothing, need no load order, and a component that fires
 * one does not care whether smooth scrolling is switched on at all.
 *
 * THE LOCK IS COUNTED, not a boolean. Two surfaces can be open at once — the
 * drawer with the search overlay above it — and with a boolean, closing either
 * one would hand scrolling back to the page while the other was still covering
 * it. The count only releases on the last unlock.
 *
 * `lenis.stop()` is a genuinely stronger lock than the `body { overflow:
 * hidden }` it replaces: Lenis owns the scroll position, so stopping it stops
 * everything, and lenis.css puts `overflow: clip` on the root as well. The old
 * approach relied on overflow propagating from body to the viewport, which is
 * unreliable on iOS Safari and does not survive a programmatic scroll at all.
 */

(() => {
  const LOCK = 'bf:scroll-lock';
  const UNLOCK = 'bf:scroll-unlock';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let lenis = null;
  let locks = 0;

  /*
   * Smooth scrolling is skipped entirely under reduced motion rather than given
   * a shorter duration. Its whole nature is that the page keeps travelling
   * after the input stops, which is the sensation the setting exists to
   * suppress — a faster version of it is still that.
   *
   * The lock below still works: it falls back to clipping the root element, so
   * a visitor who never gets Lenis still cannot scroll the page behind a drawer.
   */
  if (window.Lenis && !reduceMotion.matches) {
    lenis = new window.Lenis({
      /* Slightly longer than Lenis's 1.2 default, to sit with the rest of the
         theme — the card entrance runs 940ms and the hero's rule 1.6s. */
      duration: 1.3,

      /* Exponential ease-out. The same shape as the expo.out used by every
         other movement in the theme, expressed as Lenis wants it. */
      easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),

      /* Touch devices keep their native scrolling. Momentum there is the
         platform's job, already tuned by the OS, and layering a second
         inertia model over it is what makes smooth-scroll libraries feel
         broken on phones. */
      smoothWheel: true,
      syncTouch: false,
    });

    const frame = (time) => {
      lenis.raf(time);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function lock() {
    locks += 1;
    if (locks > 1) return;

    if (lenis) lenis.stop();
    else document.documentElement.style.overflow = 'hidden';
  }

  function unlock() {
    /* Never below zero: an unlock without a matching lock — a component
       cleaning up defensively on disconnect, say — would otherwise put the
       count into debt and the NEXT genuine lock would not take. */
    locks = Math.max(0, locks - 1);
    if (locks > 0) return;

    if (lenis) lenis.start();
    else document.documentElement.style.overflow = '';
  }

  document.addEventListener(LOCK, lock);
  document.addEventListener(UNLOCK, unlock);

  /*
   * `force` is load-bearing. The router swaps the document while the page is
   * locked — that is the entire point of the curtain — and lenis.scrollTo is a
   * no-op against a stopped instance without it. Dropping it leaves every
   * transition landing on the new page at the old page's scroll offset.
   */
  document.addEventListener('bf:scroll-to', (event) => {
    const top = event.detail?.top || 0;

    if (lenis) lenis.scrollTo(top, { immediate: true, force: true });
    else window.scrollTo(0, top);
  });

  document.addEventListener('bf:scroll-refresh', () => lenis?.resize());
})();
