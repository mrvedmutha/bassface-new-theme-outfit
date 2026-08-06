/*
 * <bf-theme-switcher> — the three-circle page theme control.
 *
 * Appears twice on a mobile page (nav and open drawer), so the source of truth
 * is `data-bf-theme` on <html>, not the element. Every instance reflects that
 * attribute and a change from one broadcasts to the others over a document
 * event; nothing here holds its own copy of the state.
 *
 * The attribute is set by a blocking inline script in theme.liquid, not here.
 * By the time a deferred module runs, the page has already painted, and a
 * returning dark-theme visitor would see a frame of cream first.
 *
 * Which circle carries the ring and which carries the active dot is entirely a
 * CSS concern — see bf-theme-switcher.css. This file only moves the attribute.
 */

const STORAGE_KEY = 'bf-theme';
const THEME_ATTRIBUTE = 'data-bf-theme';
const THEME_EVENT = 'bf:themechange';
const THEMES = ['red', 'light', 'dark'];
const DEFAULT_THEME = 'red';
const VALUE_SELECTOR = '[data-bf-theme-value]';

function currentTheme() {
  const active = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return THEMES.includes(active) ? active : DEFAULT_THEME;
}

function applyTheme(theme) {
  if (!THEMES.includes(theme) || theme === currentTheme()) return;

  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);

  /* Safari in private mode throws on write rather than failing quietly. A
     visitor who cannot persist the choice should still get the theme. */
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* Not persisted; the choice still applies for this page view. */
  }

  document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme } }));
}

class BFThemeSwitcher extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', this);
    document.addEventListener(THEME_EVENT, this);
    this.reflect();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this);
    document.removeEventListener(THEME_EVENT, this);
  }

  handleEvent(event) {
    if (event.type !== 'click') {
      this.reflect();
      return;
    }

    const button = event.target.closest(VALUE_SELECTOR);
    if (button && this.contains(button)) applyTheme(button.dataset.bfThemeValue);
  }

  /* aria-pressed is both the accessible state and the CSS hook the active dot
     hangs off, so there is exactly one thing to keep in sync. */
  reflect() {
    const active = currentTheme();

    for (const button of this.querySelectorAll(VALUE_SELECTOR)) {
      button.setAttribute('aria-pressed', String(button.dataset.bfThemeValue === active));
    }
  }
}

customElements.define('bf-theme-switcher', BFThemeSwitcher);
