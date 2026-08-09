/*
 * <bf-sticky-column> — a sticky column that is allowed to be taller than the
 * viewport.
 *
 * Plain `position: sticky; top: X` only behaves when the box fits on screen.
 * When it does not, it pins at X and everything below the fold becomes
 * unreachable: the page scrolls, the box does not, and its last rows are never
 * shown at any scroll position. The product page's info column hits this on a
 * normal laptop — 1010px with every accordion closed against a 907px viewport,
 * 1481px with them open — so Shipping & Returns simply could not be read.
 *
 * `bottom` is not the fix. It holds an element up as you approach it from
 * below; it never pushes one down to follow the scroll. Setting both is not
 * either: when a sticky box cannot satisfy both offsets, top wins.
 *
 * The pattern that does work is `top: calc(100vh - own height)`. A negative top
 * lets the column scroll up until its LAST row meets the viewport floor, and
 * pin there — the whole column is reachable, and it still stays put for the
 * length of the gallery beside it. CSS cannot express "own height", so it is
 * measured here and handed back as a custom property.
 *
 * Everything else stays in CSS. This file decides one number.
 */

/* Wrapped so GAP and the property name stay out of global scope. */
(() => {
const STICKY_PROPERTY = '--main-product-sticky-top';
const GAP = 24;

if (!customElements.get('bf-sticky-column')) {
  customElements.define(
    'bf-sticky-column',
    class BfStickyColumn extends HTMLElement {
      resizeObserver = undefined;

      connectedCallback() {
        this.update = this.update.bind(this);

        /*
         * Observing the element itself, not just the window: the accordion
         * rows change its height on every open and close, and that is the
         * measurement this whole file exists to react to.
         */
        this.resizeObserver = new ResizeObserver(this.update);
        this.resizeObserver.observe(this);
        window.addEventListener('resize', this.update);

        this.update();
      }

      disconnectedCallback() {
        this.resizeObserver?.disconnect();
        window.removeEventListener('resize', this.update);
      }

      update() {
        /*
         * Clear first, then read. The CSS fallback resolves the offset the
         * column WANTS — the header height plus a gap, in rem — and reading
         * `top` back gets it in pixels already computed. Leaving a previous
         * override in place would make this read its own last answer.
         *
         * `top` is auto below the two-column breakpoint, where the CSS does not
         * make this sticky at all; parseFloat gives NaN, the offset falls to 0,
         * and whatever gets set is unused because the element is not sticky.
         */
        this.style.removeProperty(STICKY_PROPERTY);

        const offset = parseFloat(getComputedStyle(this).top) || 0;
        const height = this.offsetHeight;
        const fits = height + offset + GAP <= window.innerHeight;

        if (fits) return;

        this.style.setProperty(STICKY_PROPERTY, `${window.innerHeight - height - GAP}px`);
      }
    }
  );
}
})();
