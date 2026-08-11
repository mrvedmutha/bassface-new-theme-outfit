/*
 * <bf-page-transition> — the router, and the curtain it hides the swap behind.
 *
 * Every same-origin link click is intercepted, the destination is fetched as a
 * whole HTML document, and <main> plus the header and footer groups are
 * replaced in place. The intro preloader therefore plays on a hard load and
 * only on a hard load, which is the whole point of the exercise.
 *
 * Timeline, in absolute seconds from the click. These are not invented: they
 * were sampled off the OUTFIT reference at 25ms through a real navigation, and
 * the cover curve fits quart.inOut to within a couple of percent at every
 * measured point (5% @280ms, 24% @400, 62% @520, 88% @640, 100% @950).
 *
 *   0.00  cover    clip-path inset(100% 0 0) -> inset(0), 0.95s quart.inOut
 *                  the panel's top edge travels from the bottom of the
 *                  viewport to the top: black rising from below
 *   0.45  letters  translateY 110%->0, 0.55s quart.out, stagger 0.05 from
 *                  random. They land at ~1.35, inside the hold
 *   0.95  hold     0.55s FLOOR, run against the fetch rather than after it, so
 *                  a prefetched page waits 0.55s and a cold one waits as long
 *                  as it needs
 *   1.50  swap     document replaced under the panel, scroll reset, scripts
 *                  re-run. Nothing of this is visible
 *   1.50  letters  translateY 0->-120%, 0.6s expo.inOut, stagger 0.04
 *   1.50  settle   0.4s before the panel moves, so the letters get a head start
 *                  and the two gestures overlap rather than queue
 *   1.90  reveal   clip-path inset(0) -> inset(0 0 100%), 0.55s quart.inOut
 *                  the bottom edge follows the top up and off: one continuous
 *                  upward wipe across the pair
 *
 * Total ~2.45s. The reference holds the same budget even when its data is
 * already cached, and that is a deliberate choice rather than a cost — the
 * pacing is the design.
 *
 * The letter rise is OURS, not the reference's — its transition panel carries a
 * static logotype. It is bf-preloader's gesture at a shorter duration, so the
 * intro and the transition read as the same brand at different volumes.
 *
 * NO GSAP, though it is vendored. This interpolates one property on one
 * element; a rAF loop with an easing function is smaller than the call into a
 * timeline would be, and it keeps the router working regardless of whether
 * gsap.min.js has loaded yet. bf-preloader.js makes the same call for the same
 * reason.
 *
 * WHAT IS DELIBERATELY NOT HANDLED. `content_for_header` cannot be re-executed
 * — it carries per-request Shopify state and injecting it twice breaks the web
 * pixel sandbox. So it stays from the first load, and the one thing that
 * genuinely depends on it, the page view event, is re-fired by hand from
 * theme.liquid off `bf:page-loaded`. Everything else in that block is
 * page-independent.
 */

(() => {
  const PANEL = '.page-transition';
  const NAVIGATING = 'is-navigating';
  const PARKED = 'inset(100% 0 0 0)';

  const LETTER = '.page-transition__letter';

  /* Below its own slot, which is where a letter rests when it is not on screen. */
  const DOWN = 110;
  const UP = -120;

  /* Seconds. See the timeline above before changing any of them. */
  const TIMING = {
    cover: 0.95,
    hold: 0.55,
    settle: 0.4,
    reveal: 0.55,
    lettersInDelay: 0.45,
    lettersIn: 0.55,
    lettersInStagger: 0.05,
    lettersOut: 0.6,
    lettersOutStagger: 0.04,
  };

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * Routes that must reach the server as a real navigation.
   *
   * Checkout and the account area are served outside the theme entirely, so
   * there is no <main> to swap and a fetch would hand back a document this
   * router cannot read. /apps, /tools and /services are proxy mounts that
   * belong to whatever app owns them. The numeric prefix catches the
   * `/12345/checkouts/...` and `/12345/orders/...` forms.
   */
  const OPAQUE = /^\/(?:checkout|account|apps|tools|services|\d+\/(?:checkouts|orders))(?:\/|$)/;

  /* `type` values a re-inserted <script> should actually run — the trailing `?`
     is the common no-attribute case. Everything else — application/json for the
     product payload, ld+json for structured data, text/template — is data and
     must be left exactly where it is. */
  const RUNNABLE = /^(?:text\/javascript|application\/javascript|module)?$/i;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* GSAP's power ladder is power1=quad, power2=cubic, power3=quart, so the
     reference's power3.inOut is quartic — the same note applies in
     bf-preloader.js, and getting it wrong reads as a visibly lazier wipe.
     The other two are the preloader's, so the letters here move in the
     vocabulary the intro already established. */
  const EASE = {
    quartInOut: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
    quartOut: (t) => 1 - (1 - t) ** 4,
    expoInOut: (t) => {
      if (t === 0 || t === 1) return t;
      return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
    },
  };

  /* Fisher-Yates. GSAP's `from: "random"` shuffles which element gets which
     stagger slot, not the spacing between slots — bf-preloader.js makes the
     same distinction, and the letters read as scattered rather than swept
     because of it. */
  function shuffled(n) {
    const order = Array.from({ length: n }, (_, i) => i);

    for (let i = order.length - 1; i > 0; i--) {
      // eslint-disable-next-line sonarjs/pseudo-random -- picks a stagger slot, not a security context
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    return order;
  }

  /*
   * A HIDDEN TAB MUST STILL FINISH, and this is not a theoretical concern —
   * requestAnimationFrame does not fire in a background tab at all. Without the
   * visibility escape, a visitor who clicks a link and immediately switches tab
   * or app comes back to a black panel frozen mid-wipe: the tween never
   * resolves, so the swap never runs, the scroll stays locked and the router
   * stays busy for the rest of the session. Snapping to the end state instead
   * completes the whole navigation while nobody is watching, which is exactly
   * what should happen — the animation had no audience.
   *
   * It was caught by driving a real click in an unfocused tab. Any change to
   * this loop wants testing the same way.
   */
  function tween(seconds, ease, onUpdate) {
    return new Promise((resolve) => {
      let start = null;
      let raf = 0;

      const finish = () => {
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVisibility);
        onUpdate(1);
        resolve();
      };

      const onVisibility = () => {
        if (document.hidden) finish();
      };

      const frame = (now) => {
        if (start === null) start = now;

        const p = Math.min((now - start) / (seconds * 1000), 1);
        if (p < 1) {
          onUpdate(ease(p));
          raf = requestAnimationFrame(frame);
        } else {
          finish();
        }
      };

      if (document.hidden) {
        finish();
        return;
      }

      document.addEventListener('visibilitychange', onVisibility);
      raf = requestAnimationFrame(frame);
    });
  }

  const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  /*
   * THE SCROLLBAR STAYS PUT FOR THE LENGTH OF A NAVIGATION.
   *
   * Without this it vanishes on the first frame of the cover and returns after
   * the reveal, and the whole page steps 15px wider and back again with it —
   * measured on classic scrollbars, the root is 1441px at rest and 1456px for
   * every frame of a transition.
   *
   * The cause is one declaration in the vendored lenis.css:
   *
   *   .lenis:not(.lenis-autoToggle).lenis-stopped { overflow: clip; }
   *
   * `overflow: clip` does not make a scroll container, and `scrollbar-gutter`
   * reserves a gutter only on one — so bf-base.css's `scrollbar-gutter: stable`,
   * which exists precisely to stop this jump, does not apply while Lenis is
   * stopped. It was written against the `overflow: hidden` fallback, which IS a
   * scroll container and where the gutter does hold.
   *
   * AN INLINE STYLE, NOT A STYLESHEET, for two reasons. The rule being beaten is
   * in a file we do not edit and is loaded after this component's CSS, so a
   * selector would have to out-specify it — and the only one that does
   * (`html.lenis.lenis-stopped.is-navigating`) is exactly what the BEM linter
   * exists to reject. The router already writes `is-navigating` to <html> and
   * drives clip-path inline frame by frame; this belongs to the same moment.
   *
   * Scrolling is not handed back with it in any way that matters: the curtain is
   * over the page, Lenis still swallows the wheel, and #apply resets the scroll
   * position at the swap — so the most a dragged scrollbar can do is move a page
   * nobody can see.
   */
  const holdScrollbar = () => {
    document.documentElement.style.overflowY = 'scroll';
  };

  const releaseScrollbar = () => {
    document.documentElement.style.overflowY = '';
  };

  /* ---------------------------------------------------------------- links -- */

  /* Takes anything with the URL shape — an <a> exposes protocol, origin and
     pathname exactly as a URL object does, so both callers share this. */
  function routable(url) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.origin !== location.origin) return false;
    return !OPAQUE.test(url.pathname);
  }

  function eligible(link) {
    if (link.hasAttribute('download')) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.closest('[data-no-transition]')) return false;
    return routable(link);
  }

  /* Same document, different anchor — the browser's own in-page jump is
     correct there and hijacking it would scroll to the top of the page the
     visitor is already reading. */
  const samePage = (url) => url.pathname === location.pathname && url.search === location.search;

  function linkFor(event) {
    if (event.defaultPrevented || event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

    const link = event.target.closest?.('a[href]');
    return link && eligible(link) ? link : null;
  }

  /* -------------------------------------------------------------- fetching -- */

  /*
   * Prefetch on intent, so the 0.55s hold usually absorbs the network entirely
   * and the transition costs its animation and nothing more. The reference does
   * the same thing through Next's <Link>, which is why its hold collapses to
   * near zero on a hovered link.
   *
   * Capped and FIFO-evicted. An unbounded map on a long browsing session would
   * hold every parsed document a visitor hovered, which on a collection page of
   * forty cards is forty detached DOM trees.
   */
  const CACHE_LIMIT = 12;
  const cache = new Map();

  function request(href) {
    const key = href.split('#')[0];
    const hit = cache.get(key);
    if (hit) return hit;

    const pending = fetch(key, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return Promise.all([response.text(), response.url]);
      })
      .then(([html, url]) => ({ doc: new DOMParser().parseFromString(html, 'text/html'), url }));

    /* A failed prefetch must not poison the entry — the click that follows
       should get a fresh attempt, and then a hard navigation if that fails too. */
    pending.catch(() => cache.delete(key));

    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, pending);
    return pending;
  }

  /* -------------------------------------------------------------- swapping -- */

  const STYLESHEET = 'link[rel~="stylesheet"][href]';

  /* A stylesheet that will not load must not hold the curtain open forever. */
  const STYLE_TIMEOUT = 1500;

  const HEAD_TAGS = [
    ['link[rel="canonical"]', 'href'],
    ['meta[name="description"]', 'content'],
  ];

  /*
   * Move the incoming document's stylesheets into <head> BEFORE anything is
   * swapped, and take them out of the fragment so the swap cannot disturb them.
   *
   * THIS IS THE WHOLE REASON PAGE TRANSITIONS LOOKED BROKEN. Dawn — and this
   * theme — load section CSS from inside the section:
   *
   *     sections/bf-header.liquid
   *       {{ 'bf-header.css' | asset_url | stylesheet_tag }}
   *
   * so the <link> is a CHILD of the node being replaced. Replacing the header
   * removed its stylesheet from the document, which unstyles matching elements
   * in the same frame, and the re-inserted copy only re-applies once the
   * browser has processed it again. In that gap the header rendered unstyled:
   * the nav ballooned to its intrinsic width, the row wrapped, fitRow measured
   * the wreckage and ratcheted --masthead-scale to its 0.7 floor, and the menu
   * showed at the wrong size in the wrong face. All of it survived the gap
   * because fitRow's result is sticky.
   *
   * Two rules, and both matter:
   *
   *   already in the document — drop the tag from the fragment entirely. The
   *   sheet is live and correct; re-inserting it is the bug.
   *
   *   genuinely new — the product template's CSS arriving from a collection
   *   page — append to <head> and WAIT for it. Swapping first would paint the
   *   new page unstyled for a frame or two.
   *
   * Awaiting is free here: it happens under the curtain, inside the hold the
   * transition already budgets for the fetch.
   */
  function adoptStyles(doc) {
    /*
     * HOIST FIRST, and this ordering is the whole correctness argument.
     *
     * The sheets at risk are the ones sitting INSIDE <main> and inside the
     * header section — exactly the nodes about to be replaced. Deduping before
     * hoisting looks right and is precisely wrong: the incoming copy is dropped
     * as redundant because a live copy exists, and then the swap deletes that
     * live copy, so the sheet is gone from the document altogether. That is
     * strictly worse than doing nothing, and it is what left the header
     * unstyled with every stacked child at full width.
     *
     * Moving a <link> to <head> does not re-fetch or re-apply it — it is the
     * same node and the same CSSOM sheet, just parented somewhere the swap
     * cannot reach. Once hoisted it is permanent.
     */
    for (const link of [...document.body.querySelectorAll(STYLESHEET)]) {
      document.head.append(link);
    }

    const present = new Set([...document.querySelectorAll(STYLESHEET)].map((link) => link.href));
    const pending = [];

    for (const link of [...doc.querySelectorAll(STYLESHEET)]) {
      /* DOMParser gives the parsed document no base URL, so its .href does not
         resolve. Resolve against this page instead. */
      const href = new URL(link.getAttribute('href'), location.href).href;
      link.remove();

      if (present.has(href)) continue;
      present.add(href);

      const copy = document.createElement('link');
      copy.rel = 'stylesheet';
      copy.href = href;
      pending.push(new Promise((resolve) => copy.addEventListener('load', resolve, { once: true })));
      pending.push(new Promise((resolve) => copy.addEventListener('error', resolve, { once: true })));
      document.head.append(copy);
    }

    return pending.length ? Promise.race([Promise.all(pending), wait(STYLE_TIMEOUT)]) : null;
  }

  function swapHead(doc) {
    document.title = doc.title;

    for (const [selector, attribute] of HEAD_TAGS) {
      const next = doc.head.querySelector(selector);
      const current = document.head.querySelector(selector);
      if (next && current) current.setAttribute(attribute, next.getAttribute(attribute) || '');
    }
  }

  /*
   * The header and footer groups are direct children of <body>, siblings of
   * <main>, and are byte-identical between most pages. Comparing before
   * replacing is not an optimisation: replacing the header on every click would
   * tear down an upgraded <bf-nav-drawer> and re-run its script for nothing,
   * twenty times a session. It still swaps when it must — the cart count lives
   * in there.
   */
  function swapShell(doc) {
    const replaced = [];

    for (const next of doc.querySelectorAll('body > [id^="shopify-section"]')) {
      const current = document.getElementById(next.id);
      if (!current || current.innerHTML === next.innerHTML) continue;

      current.replaceWith(next);
      replaced.push(next);
    }

    return replaced;
  }

  /*
   * A <script> inserted as parsed HTML never runs — the HTML spec marks it
   * already-started. Cloning it into a fresh element is the only way, and it is
   * why sections carrying inline JS work at all after a swap.
   *
   * External sources are deduped against everything the document has ever
   * loaded. Re-running global.js or bf-product-card.js would re-register custom
   * elements (guarded, so merely wasteful) and re-attach every document-level
   * listener inside them (not guarded, and the reason a naive router leaks a
   * handler per navigation).
   */
  const loadedSrc = new Set();

  function runScripts(root) {
    if (!root) return;

    for (const old of root.querySelectorAll('script')) {
      if (!RUNNABLE.test(old.getAttribute('type') || '')) continue;
      if (old.src && loadedSrc.has(old.src)) continue;
      if (old.src) loadedSrc.add(old.src);

      const script = document.createElement('script');
      for (const { name, value } of old.attributes) script.setAttribute(name, value);
      script.textContent = old.textContent;
      old.replaceWith(script);
    }
  }

  /*
   * Every modal surface closes before the curtain drops. Leaving the nav drawer
   * open across a swap would strand it over a page it no longer belongs to, and
   * its scroll lock with it.
   *
   * Guarded on the open class rather than called unconditionally: bf-nav-drawer
   * documents that its close() has no open-check, so an unmatched call would
   * both steal focus and put bf-scroll's counted lock into debt.
   */
  function closeOverlays() {
    for (const el of document.querySelectorAll('bf-nav-drawer, bf-search, cart-drawer')) {
      if (el.classList.contains('is-open') || el.classList.contains('active')) el.close?.();
    }
  }

  /* ------------------------------------------------------------------- el -- */

  class BFPageTransition extends HTMLElement {
    connectedCallback() {
      this.panel = this.querySelector(PANEL);

      /*
       * The theme editor is left alone entirely. It reloads the preview through
       * its own channel and reaches into the document to highlight sections; a
       * router swapping <main> underneath it makes section selection point at
       * detached nodes, which reads to the merchant as the editor being broken.
       */
      if (!this.panel || window.Shopify?.designMode) return;

      for (const script of document.querySelectorAll('script[src]')) loadedSrc.add(script.src);

      /* Ours to restore, now that the swap and the scroll are both ours. */
      history.scrollRestoration = 'manual';

      document.addEventListener('click', this.onClick);
      document.addEventListener('submit', this.onSubmit);
      addEventListener('popstate', this.onPopState);

      /* pointerover rather than pointerenter: it bubbles, so one listener on the
         document covers every link on every page including the ones swapped in
         later. touchstart is the phone's equivalent of hovering — it fires a
         couple of hundred milliseconds before the click it becomes. */
      for (const type of ['pointerover', 'focusin', 'touchstart']) {
        document.addEventListener(type, this.onIntent, { passive: true });
      }
    }

    onIntent = (event) => {
      const link = event.target.closest?.('a[href]');
      if (link && eligible(link) && !samePage(new URL(link.href))) request(link.href);
    };

    onClick = (event) => {
      const link = linkFor(event);
      if (!link || samePage(new URL(link.href))) return;

      event.preventDefault();
      this.navigate(link.href);
    };

    /*
     * GET forms — the search box, chiefly — go through the router too, so a
     * search reads as a transition rather than a hard load with the intro
     * preloader on top of it.
     *
     * POST is never touched: cart mutations, customer login and the newsletter
     * all need a real submission. Dawn's facet form already fetches its own
     * results and calls preventDefault to say so, which the first test here
     * honours.
     */
    onSubmit = (event) => {
      const form = event.target;
      if (event.defaultPrevented || form.method?.toLowerCase() !== 'get') return;

      const url = new URL(form.action || location.href, location.href);
      url.search = new URLSearchParams(new FormData(form)).toString();
      if (!routable(url)) return;

      event.preventDefault();
      this.navigate(url.href);
    };

    /* The reference gives back and forward no curtain at all — the swap is
       instant, and from cache it usually is. Matched here deliberately. */
    onPopState = (event) => {
      this.navigate(location.href, {
        push: false,
        curtain: false,
        top: event.state?.bfScroll || 0,
      });
    };

    async navigate(url, options = {}) {
      if (this.busy) return;
      this.busy = true;

      try {
        await this.#run(url, options);
      } finally {
        this.busy = false;
      }
    }

    async #run(url, { push = true, curtain = true, top = 0 }) {
      const pending = request(url);
      const animated = curtain && !reduceMotion.matches;
      const departed = window.scrollY;

      closeOverlays();
      document.documentElement.classList.add(NAVIGATING);
      fire('bf:scroll-lock');

      /* Immediately after the lock, because the lock is what takes the scrollbar
         away — see holdScrollbar. */
      holdScrollbar();

      if (animated) await this.#cover();

      /* The hold runs ALONGSIDE the fetch, not after it. Sequencing them would
         add 0.55s to every cold navigation for no reason. */
      const [payload] = await Promise.all([
        pending.catch(() => null),
        animated ? wait(TIMING.hold * 1000) : null,
      ]);

      /* Network gone, 404, or a response this router cannot parse. Hand the URL
         to the browser: the panel is already covering, so the reload that
         follows is the least visible way to fail. */
      if (!payload?.doc.querySelector('main')) {
        location.assign(url);
        return;
      }

      /* Stylesheets first, and awaited — see adoptStyles. Nothing may be
         swapped into a document whose CSS for it has not arrived. */
      await adoptStyles(payload.doc);

      this.#apply(payload, { push, top, departed });

      if (animated) {
        this.#lettersOut();
        await wait(TIMING.settle * 1000);
        await this.#reveal();
      }

      document.documentElement.classList.remove(NAVIGATING);

      /* Before the unlock, not after: the unlock restores the root's own
         overflow and the gutter with it, so releasing first would leave one
         frame with neither this nor `scrollbar-gutter` holding the space. */
      releaseScrollbar();
      fire('bf:scroll-unlock');
      fire('bf:page-revealed');
    }

    #apply({ doc, url }, { push, top, departed }) {
      if (push) {
        /* Stamp the departing scroll onto the entry being left, so coming back
           to it lands where the visitor was rather than at the top. */
        history.replaceState({ ...history.state, bfScroll: departed }, '');
        history.pushState({ bfScroll: 0 }, '', url);
      }

      swapHead(doc);
      document.body.className = doc.body.className;

      const main = doc.querySelector('main');
      document.querySelector('main').replaceWith(main);
      const shell = swapShell(doc);

      /* Scripts only inside what was actually inserted. Running them over the
         whole body would re-execute theme.liquid's window.routes block. */
      runScripts(main);
      for (const node of shell) runScripts(node);

      fire('bf:scroll-to', { top });
      fire('bf:scroll-refresh');

      /* <main> carries tabindex="-1" for the skip link, which makes it a valid
         focus target — and moving focus is what tells a screen reader the page
         changed at all, since no document load happened. */
      main.focus({ preventScroll: true });

      window.initializeScrollAnimationTrigger?.(main);
      fire('bf:page-loaded', { url: location.href });
    }

    /*
     * The wordmark climbs out of its mask a letter at a time, and leaves the
     * same way — the intro preloader's gesture at a shorter duration, so the
     * two read as the same brand doing the same thing at different volumes.
     *
     * NOT AWAITED by the caller. The letters land at ~1.35s and the cover
     * finishes at 0.95s; making the cover wait for them would stretch the black
     * hold by 400ms every navigation. They simply run inside the window the
     * panel is already covering.
     */
    #letters(from, to, seconds, stagger, ease) {
      const letters = [...this.panel.querySelectorAll(LETTER)];

      const move = (letter) => (e) => {
        letter.style.transform = `translateY(${from + (to - from) * e}%)`;
      };

      const run = (index, slot) =>
        wait(slot * stagger * 1000).then(() => tween(seconds, ease, move(letters[index])));

      return Promise.all(shuffled(letters.length).map(run));
    }

    #cover() {
      /* Reset before showing, not after hiding: a transition abandoned by a
         hard navigation leaves the letters wherever they stopped, and the next
         one has to start from a known pose. */
      for (const letter of this.panel.querySelectorAll(LETTER)) {
        letter.style.transform = `translateY(${DOWN}%)`;
      }

      this.panel.style.visibility = 'visible';
      this.panel.style.clipPath = PARKED;

      wait(TIMING.lettersInDelay * 1000).then(() =>
        this.#letters(DOWN, 0, TIMING.lettersIn, TIMING.lettersInStagger, EASE.quartOut)
      );

      return tween(TIMING.cover, EASE.quartInOut, (e) => {
        this.panel.style.clipPath = `inset(${100 - e * 100}% 0 0 0)`;
      });
    }

    /* Started at the top of the settle window rather than with the reveal, so
       the letters are most of the way gone by the time the panel starts moving
       and the two gestures overlap instead of queueing. */
    #lettersOut() {
      return this.#letters(0, UP, TIMING.lettersOut, TIMING.lettersOutStagger, EASE.expoInOut);
    }

    async #reveal() {
      await tween(TIMING.reveal, EASE.quartInOut, (e) => {
        this.panel.style.clipPath = `inset(0 0 ${e * 100}% 0)`;
      });

      /* Back to the parked state rather than left where the reveal ended, so
         the next cover always starts from the bottom edge. Clearing the inline
         visibility hands the element back to the stylesheet's `hidden`. */
      this.panel.style.clipPath = PARKED;
      this.panel.style.visibility = '';
    }
  }

  if (!customElements.get('bf-page-transition')) {
    customElements.define('bf-page-transition', BFPageTransition);
  }
})();
