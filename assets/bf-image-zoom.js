/*
 * <bf-image-zoom> — a gallery image, full screen, over a scrim.
 *
 * BUILT ON <dialog> AND showModal(), which is the entire argument for this
 * being short. The platform already provides everything the hand-rolled
 * version of this reimplements badly: focus is trapped inside, the rest of the
 * page is made inert, Escape closes, focus returns to whatever opened it, and
 * ::backdrop paints the scrim in the top layer so no z-index has to be
 * negotiated with the fixed header. A <div class="modal"> gives up all of it.
 *
 * ONE DIALOG, NOT ONE PER IMAGE. A product can carry a dozen photographs and
 * they are all shown the same way, so the dialog holds a single <img> whose src
 * is swapped as it opens. It also means the full-size file is only ever
 * requested for the image actually opened.
 *
 * The scroll lock is the theme's shared one, fired as an event — see the note
 * at the top of bf-scroll.js. It is counted, so this cannot strand the page in
 * a locked state by closing while the nav drawer is still open above it.
 *
 * Animated with WAAPI rather than CSS. A dialog moving into the top layer
 * cannot be transitioned without `@starting-style` and `transition-behavior:
 * allow-discrete`, which Chrome has and the others are still catching up on;
 * the accordion made the same call for the same reason.
 */

(() => {
  const DURATION = 320;
  const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const TRIGGER_SELECTOR = '[data-zoom-src]';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  if (!customElements.get('bf-image-zoom')) {
    customElements.define(
      'bf-image-zoom',
      class BfImageZoom extends HTMLElement {
        connectedCallback() {
          this.dialog = this.querySelector('dialog');
          this.image = this.querySelector('[data-zoom-image]');

          if (!this.dialog || !this.image) return;

          /*
           * Delegated from the section rather than bound per image. The gallery
           * is re-rendered whenever product-info swaps a variant, so handlers
           * attached to the images themselves would be thrown away with them
           * and never reattached.
           */
          this.scope = this.closest('product-info') || document;
          this.scope.addEventListener('click', this.onClick.bind(this));

          /* A click that lands on the dialog itself is a click on the padding
             around the picture — the backdrop is not clickable, being a
             pseudo-element, so this is what makes "click outside to close"
             work. Clicks on the image bubble to here too, hence the target
             test. */
          this.dialog.addEventListener('click', (event) => {
            if (event.target === this.dialog) this.close();
          });

          /* Escape is handled by the dialog itself and fires `cancel` before
             `close`; both routes end up here, so the lock is released exactly
             once however it was dismissed. */
          this.dialog.addEventListener('close', this.onClose.bind(this));

          this.querySelector('[data-zoom-close]')?.addEventListener('click', () => this.close());
        }

        onClick(event) {
          const trigger = event.target.closest(TRIGGER_SELECTOR);
          if (!trigger) return;

          event.preventDefault();
          this.open(trigger.dataset);
        }

        open({ zoomSrc, zoomAlt, zoomWidth, zoomHeight }) {
          if (!zoomSrc || this.dialog.open) return;

          /* Dimensions before src, so the box is the right shape from the first
             frame rather than reflowing once the file decodes. */
          if (zoomWidth) this.image.width = zoomWidth;
          if (zoomHeight) this.image.height = zoomHeight;

          this.image.src = zoomSrc;
          this.image.alt = zoomAlt || '';

          this.dialog.showModal();
          document.dispatchEvent(new CustomEvent('bf:scroll-lock'));

          if (reduceMotion.matches) return;

          this.dialog.animate(
            { opacity: [0, 1], transform: ['scale(0.96)', 'scale(1)'] },
            { duration: DURATION, easing: EASE }
          );
        }

        close() {
          if (!this.dialog.open) return;

          if (reduceMotion.matches) {
            this.dialog.close();
            return;
          }

          /*
           * The dialog is closed only when the fade has finished, or it would
           * leave the top layer on the first frame and the animation would play
           * on something already invisible.
           *
           * `fill: forwards` is not decoration. A WAAPI animation reverts to
           * the element's own styles the instant it ends, so without it the
           * dialog snapped back to full opacity for the frame between the fade
           * finishing and close() running — measured, and clearly visible.
           * onClose cancels it, or the next open would inherit opacity 0.
           */
          this.animation = this.dialog.animate(
            { opacity: [1, 0], transform: ['scale(1)', 'scale(0.98)'] },
            { duration: DURATION, easing: EASE, fill: 'forwards' }
          );

          this.animation.finished.then(
            () => this.dialog.close(),
            () => this.dialog.close()
          );
        }

        onClose() {
          this.animation?.cancel();
          this.animation = undefined;

          document.dispatchEvent(new CustomEvent('bf:scroll-unlock'));

          /* Dropping the src frees the decoded full-size bitmap, which on a
             2000px product photograph is worth more than the empty attribute
             costs. The next open sets it again. */
          this.image.removeAttribute('src');
        }
      }
    );
  }
})();
