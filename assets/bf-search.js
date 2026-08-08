/*
 * <bf-search> — the search overlay.
 *
 * Opened by anything carrying aria-controls="bf-search". While open it is a
 * modal surface: focus is trapped, Escape closes, and the page behind stops
 * scrolling — the nav drawer's conventions, reused rather than reinvented.
 *
 * Typing debounces, shows a skeleton, then swaps in HTML fetched from
 * sections/bf-predictive-search.liquid through the Section Rendering API. The
 * response is markup, not JSON, so the product and collection cards stay a
 * single Liquid definition instead of being reimplemented in client templates.
 *
 * Results are capped to one row of each type. The "show all" bar appears when
 * the section reports that it received more than it rendered — see the note in
 * render(). The idle collections, by contrast, ARE measured: they are trimmed
 * to whatever fits so the idle state fills the panel without scrolling before
 * anything has been typed.
 */

/*
 * Wrapped in an IIFE so its top-level names stay private. Classic scripts share
 * one global lexical scope — see the longer note in bf-product-card.js.
 */

(() => {
  /* Long enough that a normal typing rhythm produces one request per word
     rather than one per keystroke, short enough to feel answered. */
  const DEBOUNCE_MS = 250;

  /*
   * Always ask for Shopify's cap, however few are displayed. The section shows
   * one row and compares what it received against what it showed — request only
   * what is displayed and a store with exactly four matches becomes
   * indistinguishable from one with forty, so the "show all" button could never
   * be decided. Asking for ten costs the same request.
   */
  const REQUEST_LIMIT = 10;

  /* Under this the content is within a pixel of its box and the difference is a
     rounding artefact, not an overflow. */
  const OVERFLOW_SLACK = 2;

  const OPEN_CLASS = 'is-open';
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /* Fisher-Yates over the children, reinserted in the new order. */
  function shuffleChildren(container) {
    const items = [...container.children];

    for (let i = items.length - 1; i > 0; i--) {
      // eslint-disable-next-line sonarjs/pseudo-random -- shuffling display order, not a security context
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }

    for (const item of items) container.appendChild(item);
  }

  class BFSearch extends HTMLElement {
    connectedCallback() {
      this.panel = this.querySelector('.search__panel');
      this.input = this.querySelector('[data-search-input]');
      this.content = this.querySelector('[data-search-content]');
      this.mount = this.querySelector('[data-search-mount]');
      this.idle = this.querySelector('[data-search-idle]');
      this.skeleton = this.querySelector('[data-search-skeleton]');
      this.footer = this.querySelector('[data-search-footer]');
      this.allLink = this.querySelector('[data-search-all]');
      this.clearButton = this.querySelector('[data-search-clear]');
      this.status = this.querySelector('[data-search-status]');
      this.shuffleTarget = this.querySelector('[data-search-shuffle]');
      if (!this.input || !this.content) return;

      /*
       * Taken from the link Liquid already rendered, not from window.routes.
       * Dawn exposes only five routes to JS and search_url is not among them,
       * so reading it there yields undefined and builds "undefined?q=term".
       * The href is right here and is already correct in every locale and on
       * every shop with a custom search path.
       */
      this.searchUrl = this.allLink?.getAttribute('href') || '/search';
      this.onKeydown = this.onKeydown.bind(this);
      this.onResize = this.onResize.bind(this);

      this.querySelector('[data-search-close]')?.addEventListener('click', () => this.close());
      this.clearButton?.addEventListener('click', () => this.clear());

      this.input.addEventListener('input', () => {
        this.clearButton.hidden = this.input.value.trim() === '';
        this.search();
      });

      /* The form still submits to /search on Enter — that is the no-JS path and
         it stays the behaviour here too, so Enter always reaches the full
         results page rather than doing nothing. */
      for (const toggle of document.querySelectorAll(`[aria-controls="${this.id}"]`)) {
        toggle.addEventListener('click', (event) => {
          event.preventDefault();
          this.open(toggle);
        });
      }
    }

    disconnectedCallback() {
      this.releaseDocument();
    }

    open(opener) {
      if (this.classList.contains(OPEN_CLASS)) return;

      this.opener = opener;
      this.classList.add(OPEN_CLASS);
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this.onKeydown);
      addEventListener('resize', this.onResize, { passive: true });

      /* A different set every time it opens — see the note in bf-search.liquid
         on why this cannot be done in Liquid. */
      if (this.shuffleTarget) shuffleChildren(this.shuffleTarget);

      /* Layout has to settle before anything can be measured: the panel was
         visibility:hidden until the class landed one statement ago. */
      requestAnimationFrame(() => {
        this.fitIdle();
        this.input.focus();
      });
    }

    close() {
      if (!this.classList.contains(OPEN_CLASS)) return;

      this.classList.remove(OPEN_CLASS);
      this.releaseDocument();
      this.opener?.focus();
      this.opener = null;
    }

    releaseDocument() {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', this.onKeydown);
      removeEventListener('resize', this.onResize);
    }

    onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key === 'Tab') this.trapFocus(event);
    }

    /* Cycle at both ends so Tab cannot reach the page behind the panel. */
    trapFocus(event) {
      const items = [...this.querySelectorAll(FOCUSABLE)].filter(
        (el) => !el.hidden && el.offsetParent !== null
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const leavingStart = event.shiftKey && document.activeElement === first;
      const leavingEnd = !event.shiftKey && document.activeElement === last;
      if (!leavingStart && !leavingEnd) return;

      event.preventDefault();
      (leavingStart ? last : first).focus();
    }

    onResize() {
      this.fitIdle();
    }

    /*
     * Decides how many idle collections to show.
     *
     * Below 834 the answer is simply the configured count — four, as a 2x2.
     * Popular is hidden at that width, so there is room for exactly that and no
     * measuring is wanted: a phone should show the same tidy block every time,
     * not a number that shifts with the address bar.
     *
     * Above it, the grid fills whatever the Popular row leaves and then trims
     * back, WITH A FLOOR OF ONE FULL ROW. The floor is the whole point. Trimming
     * to zero looks correct — nothing overflows — but it reproduces the dead
     * band this block exists to fill: measured on a 907px-tall screen, Popular
     * leaves 155px and a collection card needs 309, so a strict fit hides every
     * card and restores the gap. One row that scrolls slightly is the better
     * trade; filling the space was the requirement, never scrolling was not.
     */
    fitIdle() {
      if (!this.shuffleTarget || this.idle.hidden) return;

      const group = this.shuffleTarget.closest('.search__group');
      const cells = [...this.shuffleTarget.children];
      if (cells.length === 0) return;

      group.hidden = false;

      const columns = getComputedStyle(this.shuffleTarget).gridTemplateColumns.split(' ').length;
      const idleCount = Number(this.shuffleTarget.dataset.idleCount) || columns;
      const compact = matchMedia('(width < 834px)').matches;
      const target = compact ? Math.min(idleCount, cells.length) : cells.length;

      cells.forEach((cell, i) => {
        cell.hidden = i >= target;
      });

      if (compact) return;

      /* Backwards, so the first card dropped is the last one on the grid, and
         never below one row. */
      for (let i = cells.length - 1; i >= columns && this.overflows(); i--) {
        cells[i].hidden = true;
      }
    }

    overflows() {
      return this.content.scrollHeight > this.content.clientHeight + OVERFLOW_SLACK;
    }

    clear() {
      this.input.value = '';
      this.clearButton.hidden = true;
      this.abort();
      this.showIdle();
      this.input.focus();
    }

    showIdle() {
      this.idle.hidden = false;
      this.skeleton.hidden = true;
      this.mount.replaceChildren();
      this.footer.hidden = true;
      this.setStatus('');
      this.fitIdle();
    }

    abort() {
      this.controller?.abort();
      this.controller = null;
    }

    search = debounce(() => this.run(), DEBOUNCE_MS);

    async run() {
      const term = this.input.value.trim();

      if (term === '') {
        this.showIdle();
        return;
      }

      this.abort();
      this.controller = new AbortController();

      /* Idle out, skeleton in, and the mount emptied — otherwise the previous
         query's results sit under the skeleton and both are on screen. */
      this.idle.hidden = true;
      this.mount.replaceChildren();
      this.skeleton.hidden = false;
      this.footer.hidden = true;
      this.setStatus('Searching');

      if (this.allLink) {
        this.allLink.href = `${this.searchUrl}?q=${encodeURIComponent(term)}`;
      }

      try {
        const url =
          `${window.routes.predictive_search_url}?q=${encodeURIComponent(term)}` +
          `&section_id=bf-predictive-search` +
          `&resources[type]=product,collection&resources[limit]=${REQUEST_LIMIT}`;

        const response = await fetch(url, { signal: this.controller.signal });
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);

        const markup = await response.text();
        this.render(markup, term);
      } catch (error) {
        /* An abort is the newer keystroke winning, not a failure. */
        if (error.name === 'AbortError') return;

        this.skeleton.hidden = true;
        this.showIdle();
        this.setStatus('Search is unavailable');
      }
    }

    render(markup, term) {
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      const results = parsed.querySelector('[data-search-results]');
      if (!results) return;

      this.skeleton.hidden = true;
      this.mount.replaceChildren(results);
      this.content.scrollTop = 0;

      const empty = results.dataset.resultsEmpty === 'true';
      this.setStatus(empty ? `No results for ${term}` : `Results for ${term}`);

      /*
       * Reported by the server, not measured here. The section asks Shopify for
       * ten of each and renders one row, so it — and only it — knows whether
       * anything was left over. Measuring the panel instead would answer a
       * different question: with the results capped to a single row they now
       * fit almost any screen, so an overflow test would hide the button
       * exactly when there are more results to see.
       */
      this.footer.hidden = empty || results.dataset.resultsMore !== 'true';
    }

    setStatus(text) {
      if (this.status) this.status.textContent = text;
    }
  }

  if (!customElements.get('bf-search')) {
    customElements.define('bf-search', BFSearch);
  }
})();
