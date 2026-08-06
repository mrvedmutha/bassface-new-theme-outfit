/*
 * <bf-nav-drawer> — the full-screen mobile navigation drawer.
 *
 * Open state lives on the element as `.is-open` plus `aria-expanded` on every
 * registered toggle. While open the drawer is a modal surface: focus is trapped
 * inside it, Escape closes, and the document behind it stops scrolling.
 *
 * The drawer's colours come entirely from `data-bf-invert` in the markup — see
 * bf-nav-drawer.css. Nothing here touches theme state.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const OPEN_CLASS = 'is-open';
const EXPANDED = 'aria-expanded';

/*
 * Height-wise fit, the counterpart to the masthead's width-wise one. A long
 * menu makes this column taller than the viewport; rather than let it open
 * already-scrolled, the vertical rhythm scales down until it fits.
 *
 * 0.6 floors the 60px links at 36px. Past that the drawer scrolls instead —
 * shrinking further would be illegible, and scrolling always keeps the footer
 * reachable, so there is no failure mode here, only a fallback.
 */
const SCALE_PROPERTY = '--nav-drawer-scale';

/*
 * The 68px drawer switcher is ~100px of the column once its padding is counted,
 * far too much to leave unscaled. bf-theme-switcher.css exposes this knob and
 * defaults it to 1; it is driven from here rather than from bf-nav-drawer.css
 * because a block may not declare another block's custom properties — the BEM
 * linter enforces that, correctly. Runtime state belongs here anyway, next to
 * the scale it mirrors.
 */
const SWITCHER_SCALE_PROPERTY = '--theme-switcher-scale';
const MIN_SCALE = 0.6;
const SCALE_STEP = 0.05;

class BFNavDrawer extends HTMLElement {
  connectedCallback() {
    this.toggles = document.querySelectorAll(`[aria-controls="${this.id}"]`);

    for (const toggle of this.toggles) toggle.addEventListener('click', this);

    this.addEventListener('click', this);
    document.addEventListener('keydown', this);

    /*
     * Observing the drawer itself is loop-safe, unlike the masthead's case: this
     * element is fixed at a viewport-derived height, so its box never responds
     * to its own contents and fit() cannot feed the observer its own output.
     * It catches the mobile URL bar collapsing, which changes dvh and fires no
     * resize event.
     */
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this);
  }

  disconnectedCallback() {
    for (const toggle of this.toggles) toggle.removeEventListener('click', this);

    this.removeEventListener('click', this);
    document.removeEventListener('keydown', this);
    this.observer?.disconnect();
    this.unlockScroll();
  }

  /*
   * Unlike the masthead row, `scrollHeight > clientHeight` IS the right test
   * here: `overflow-y: auto` makes this a real scroll container, so scrollHeight
   * reports the true overflow. The masthead is not one, which is why it has to
   * measure its content box by hand.
   */
  fit() {
    this.setScale(null);

    for (let scale = 1; scale > MIN_SCALE && this.scrollHeight > this.clientHeight + 1; ) {
      scale -= SCALE_STEP;
      this.setScale(scale.toFixed(2));
    }
  }

  /*
   * Always re-measured from full size, never ratcheted down: passing null here
   * restores the design's own sizes before each fit. So a menu that gets shorter
   * — or a viewport that gets taller — grows straight back to 100%. It never
   * grows PAST it: 1 is the design, and bigger than the design is not better.
   */
  setScale(value) {
    for (const property of [SCALE_PROPERTY, SWITCHER_SCALE_PROPERTY]) {
      if (value === null) this.style.removeProperty(property);
      else this.style.setProperty(property, value);
    }
  }

  handleEvent(event) {
    if (event.type === 'keydown') {
      this.onKeydown(event);
      return;
    }

    if (event.target.closest('[data-bf-drawer-close]')) {
      this.close();
      return;
    }

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

  /* Cycle focus at both ends so Tab cannot reach the page behind the drawer. */
  trapFocus(event) {
    const items = [...this.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
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
    this.fit();
    this.querySelector(FOCUSABLE)?.focus();
  }

  close() {
    this.classList.remove(OPEN_CLASS);
    this.setToggleState('false');
    this.unlockScroll();
    this.opener?.focus();
  }

  setToggleState(value) {
    for (const toggle of this.toggles) toggle.setAttribute(EXPANDED, value);
  }

  lockScroll() {
    document.body.style.overflow = 'hidden';
  }

  unlockScroll() {
    document.body.style.overflow = '';
  }
}

customElements.define('bf-nav-drawer', BFNavDrawer);
