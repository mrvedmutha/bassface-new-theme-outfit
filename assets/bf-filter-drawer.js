/*
 * <bf-filter-drawer> — the collection page's filter panel.
 *
 * Open state is `.is-open` on the host plus `aria-expanded` on every toggle
 * that names it in aria-controls, matching bf-nav-drawer. While open it is a
 * modal surface: focus is trapped, Escape closes, the page behind stops
 * scrolling.
 *
 * FILTERS APPLY ON CHANGE, NOT ON "SHOW RESULTS". The board puts a live count
 * on that button — "Show Results (12)" — and the only way to know that number
 * is to ask the server. Once the server has answered, painting the grid it
 * answered with costs nothing, so the button is a close control and the list
 * behind the drawer is always current. Show Results then promises exactly what
 * it delivers, which a deferred apply cannot.
 *
 * THIS COMPONENT NEVER TOUCHES A CARD. It owns the controls and turns them into
 * a URL; <bf-main-collection> owns the grid and is handed that URL through its
 * apply(). Two components writing to one grid is how a filter change and a Load
 * More end up interleaved in the DOM.
 *
 * The panel is not re-rendered when results change, which is what keeps this
 * simple — see the note in bf-filter-drawer.liquid on why there are no
 * per-option counts. Only the number on Show Results is written back.
 *
 * Wrapped in an IIFE so its top-level names stay private. Classic scripts share
 * one global lexical scope — bf-nav-drawer.js and bf-header.js once collided on
 * three constant names and took each other out.
 */

(() => {
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const OPEN_CLASS = 'is-open';
  const CLOSE_HOOK = '[data-bf-drawer-close]';
  const NUMBER_TYPE = 'number';
  const RANGE_TYPE = 'range';
  const FILTER_PREFIX = 'filter.';

  /* Long enough that typing "1500" is one request rather than four, short
     enough that the count does not feel detached from the keystroke. */
  const RANGE_DEBOUNCE = 400;

  class BFFilterDrawer extends HTMLElement {
    connectedCallback() {
      this.form = this.querySelector('[data-filter-form]');
      this.total = this.querySelector('[data-filter-total]');
      this.toggles = document.querySelectorAll(`[aria-controls="${this.id}"]`);

      for (const toggle of this.toggles) toggle.addEventListener('click', this);

      this.addEventListener('click', this);
      document.addEventListener('keydown', this);

      /* Checkboxes and chips only. The number fields debounce on `input`
         below, and the range handles are driven by initSlider() — both would
         otherwise be scheduled twice for one gesture. */
      this.form?.addEventListener('change', (event) => {
        const kind = event.target.type;
        if (kind !== NUMBER_TYPE && kind !== RANGE_TYPE) this.schedule(0);
      });

      this.form?.addEventListener('input', (event) => {
        if (event.target.type === NUMBER_TYPE) this.schedule(RANGE_DEBOUNCE);
      });

      /* The no-JS path submits this form and navigates. With the script here
         the values are already applied, so submitting would reload the page to
         show what is on screen — the button's real job is to close. */
      this.form?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.close();
      });

      this.querySelector('[data-filter-clear]')?.addEventListener('click', () => this.clear());

      this.initSlider();
    }

    disconnectedCallback() {
      for (const toggle of this.toggles) toggle.removeEventListener('click', this);

      this.removeEventListener('click', this);
      document.removeEventListener('keydown', this);
      clearTimeout(this.timer);
      this.unlockScroll();
    }

    /* ------------------------------------------------------------ open --- */

    handleEvent(event) {
      if (event.type === 'keydown') {
        this.onKeydown(event);
        return;
      }

      if (event.target.closest(CLOSE_HOOK)) {
        this.close();
        return;
      }

      /* A click that reached this element but is not on the panel came from a
         toggle outside it — the scrim is handled by the close hook above. */
      if (!this.contains(event.target)) this.toggle();
    }

    onKeydown(event) {
      if (!this.isOpen) return;

      if (event.key === 'Escape') {
        this.close();
        return;
      }

      if (event.key === 'Tab') this.trapFocus(event);
    }

    /* Cycle focus at both ends so Tab cannot reach the page behind the panel. */
    trapFocus(event) {
      const items = [...this.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el.type === 'checkbox'
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const wrapForward = !event.shiftKey && document.activeElement === last;
      const wrapBackward = event.shiftKey && document.activeElement === first;

      if (!wrapForward && !wrapBackward) return;

      event.preventDefault();
      (wrapForward ? first : last).focus();
    }

    get isOpen() {
      return this.classList.contains(OPEN_CLASS);
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    open() {
      this.opener = document.activeElement;
      this.classList.add(OPEN_CLASS);
      this.setToggleState('true');
      this.lockScroll();

      /* The X, specifically — NOT the first [data-bf-drawer-close], which is
         the scrim. A div is not focusable, so focus() on it silently did
         nothing and the panel opened with focus still on <body>: Tab then
         started from the top of the document, outside the trap. */
      this.querySelector(`button${CLOSE_HOOK}`)?.focus();
    }

    close() {
      this.classList.remove(OPEN_CLASS);
      this.setToggleState('false');
      this.unlockScroll();
      this.opener?.focus();
    }

    setToggleState(value) {
      for (const toggle of this.toggles) toggle.setAttribute('aria-expanded', value);
    }

    lockScroll() {
      if (this.holdsScroll) return;

      this.holdsScroll = true;
      document.dispatchEvent(new CustomEvent('bf:scroll-lock'));
    }

    /* Only releases a lock this drawer actually took — the page lock is
       counted, so an unmatched unlock decrements someone else's. */
    unlockScroll() {
      if (!this.holdsScroll) return;

      this.holdsScroll = false;
      document.dispatchEvent(new CustomEvent('bf:scroll-unlock'));
    }

    /* ---------------------------------------------------------- filter --- */

    schedule(delay) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.apply(), delay);
    }

    /*
     * The current URL with every filter rewritten from the form. Built by
     * subtraction rather than from scratch so that sort_by — which lives in the
     * toolbar, outside this form — and anything else on the URL survives.
     */
    buildUrl() {
      const url = new URL(window.location.href);

      /* Spread first: deleting from a live iterator skips entries, which on a
         two-value filter leaves the second one behind. */
      for (const key of [...url.searchParams.keys()]) {
        if (key.startsWith(FILTER_PREFIX)) url.searchParams.delete(key);
      }

      for (const [key, value] of new FormData(this.form)) {
        /* An empty price field means "no bound", not "bound at nothing" —
           sending filter.v.price.gte= matches zero products. */
        if (value !== '') url.searchParams.append(key, value);
      }

      return url;
    }

    async apply() {
      const results = this.closest('bf-main-collection');
      if (!results) return;

      const parsed = await results.apply(this.buildUrl());
      if (parsed) this.setTotal(parsed);
    }

    /*
     * Read off the count element's data attribute rather than parsed out of its
     * text. The text is "12 products" in English and something else in every
     * other locale, so a digit-scraping regex is a translation bug waiting for
     * the first storefront that writes its numerals differently.
     */
    setTotal(parsed) {
      const value = parsed.querySelector('[data-results-count]')?.dataset.resultsTotal;
      if (value !== undefined && this.total) this.total.textContent = value;
    }

    clear() {
      for (const input of this.form.querySelectorAll('input')) {
        if (input.type === NUMBER_TYPE) input.value = '';
        else if (input.type !== RANGE_TYPE) input.checked = false;
      }

      /* The handles go back to the ends of the track, not to zero-width. */
      if (this.slider) {
        this.handleMin.value = this.handleMin.min;
        this.handleMax.value = this.handleMax.max;
        this.paintSlider();
      }

      this.schedule(0);
    }

    /* ---------------------------------------------------------- slider --- */

    initSlider() {
      this.slider = this.querySelector('[data-filter-slider]');
      if (!this.slider) return;

      this.handleMin = this.querySelector('[data-filter-slider-min]');
      this.handleMax = this.querySelector('[data-filter-slider-max]');
      this.fill = this.querySelector('[data-filter-slider-fill]');
      this.fieldMin = this.querySelector('[data-filter-price-min]');
      this.fieldMax = this.querySelector('[data-filter-price-max]');

      for (const handle of [this.handleMin, this.handleMax]) {
        /* `input` fires continuously through a drag: repaint and mirror into
           the fields, but do NOT fetch — that would be one request per pixel. */
        handle.addEventListener('input', () => this.onSlide());

        /* `change` fires once, on release. That is the request. */
        handle.addEventListener('change', () => this.schedule(0));
      }

      /* Typing in a field moves the handle under it. */
      for (const field of [this.fieldMin, this.fieldMax]) {
        field.addEventListener('input', () => this.syncFromFields());
      }

      this.paintSlider();
    }

    /*
     * Handles cannot cross. Clamping the moved one against the other is what
     * keeps min <= max without swapping them mid-drag, which feels like the
     * thumb jumping out from under the cursor.
     */
    onSlide() {
      const low = Number(this.handleMin.value);
      const high = Number(this.handleMax.value);

      if (low > high) {
        if (document.activeElement === this.handleMin) this.handleMin.value = high;
        else this.handleMax.value = low;
      }

      /*
       * A handle parked at the end of its track means "no bound", so the field
       * is emptied rather than set to the extreme. Sending price.gte=0 matches
       * everything and buys nothing but a longer URL.
       */
      this.fieldMin.value = this.handleMin.value === this.handleMin.min ? '' : this.handleMin.value;
      this.fieldMax.value = this.handleMax.value === this.handleMax.max ? '' : this.handleMax.value;

      this.paintSlider();
    }

    syncFromFields() {
      if (!this.slider) return;

      this.handleMin.value = this.fieldMin.value === '' ? this.handleMin.min : this.fieldMin.value;
      this.handleMax.value = this.fieldMax.value === '' ? this.handleMax.max : this.fieldMax.value;

      this.paintSlider();
    }

    paintSlider() {
      const ceiling = Number(this.handleMax.max);
      if (!ceiling) return;

      const low = (Number(this.handleMin.value) / ceiling) * 100;
      const high = (Number(this.handleMax.value) / ceiling) * 100;

      this.fill.style.left = `${low}%`;
      this.fill.style.right = `${100 - high}%`;
    }
  }

  if (!customElements.get('bf-filter-drawer')) {
    customElements.define('bf-filter-drawer', BFFilterDrawer);
  }
})();
