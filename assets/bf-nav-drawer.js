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

class BFNavDrawer extends HTMLElement {
  connectedCallback() {
    this.toggles = document.querySelectorAll(`[aria-controls="${this.id}"]`);

    for (const toggle of this.toggles) toggle.addEventListener('click', this);

    this.addEventListener('click', this);
    document.addEventListener('keydown', this);
  }

  disconnectedCallback() {
    for (const toggle of this.toggles) toggle.removeEventListener('click', this);

    this.removeEventListener('click', this);
    document.removeEventListener('keydown', this);
    this.unlockScroll();
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
