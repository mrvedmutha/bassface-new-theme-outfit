/*
 * <bf-accordion> — gives <details> the open and close it does not have.
 *
 * The element toggles instantly by design: `open` is a boolean attribute and
 * the content is either in the layout or it is not. There is no state between
 * the two for CSS to transition, which is why the snippet shipped without this
 * file and snapped.
 *
 * So the panel is animated by hand and the attribute is moved at the right end
 * of it. Opening sets `open` FIRST, then plays 0 -> height, because the panel
 * has no height to measure while it is still closed. Closing plays first and
 * clears `open` only when the animation finishes, because removing it up front
 * would take the content out of the layout and leave nothing to animate.
 *
 * WEB ANIMATIONS, NOT A CSS TRANSITION, for one reason: `height: auto` is not
 * an interpolable value, so the target has to be measured in script and handed
 * over as a pixel figure. Once script is doing the measuring it may as well own
 * the playback, and WAAPI gives back a finished promise and a cancel that a
 * transition would need transitionend plumbing to match.
 *
 * `interpolate-size: allow-keywords` with `::details-content` does all of this
 * in four lines of CSS and is the right answer in a year or two. Chrome has it,
 * Safari and Firefox do not, and an accordion that only animates in one browser
 * is worse than one that animates everywhere.
 *
 * The summary's own click is cancelled — that is what would flip the attribute
 * early — and the same handler re-issues it at the correct moment.
 */

(() => {
  const DURATION = 520;
  const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const PANEL_SELECTOR = '.accordion__panel';
  const BODY_SELECTOR = '.accordion__body';
  const CLOSING_CLASS = 'is-closing';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  if (!customElements.get('bf-accordion')) {
    customElements.define(
      'bf-accordion',
      class BfAccordion extends HTMLElement {
        animation = undefined;

        connectedCallback() {
          this.details = this.querySelector('details');
          this.summary = this.querySelector('summary');
          this.panel = this.querySelector(PANEL_SELECTOR);
          this.body = this.querySelector(BODY_SELECTOR);

          if (!this.details || !this.summary || !this.panel || !this.body) return;

          this.summary.addEventListener('click', this.onClick.bind(this));
        }

        onClick(event) {
          if (reduceMotion.matches) return;

          event.preventDefault();

          /*
           * Mid-flight clicks are the interesting case. The live height is read
           * BEFORE cancelling, because cancelling snaps the panel back to its
           * unanimated size — read after, a reversal would start from the wrong
           * place. Cancel rather than finish so it resumes from where the eye
           * last saw it rather than from an endpoint.
           */
          const current = this.animation ? this.panel.getBoundingClientRect().height : null;
          this.animation?.cancel();

          if (this.details.open) this.collapse(current);
          else this.expand(current);
        }

        play(from, to) {
          this.animation = this.panel.animate(
            { height: [`${from}px`, `${to}px`], opacity: [from ? 1 : 0, to ? 1 : 0] },
            { duration: DURATION, easing: EASE }
          );

          return this.animation.finished;
        }

        /*
         * A CLOSED PANEL CANNOT BE MEASURED, and measuring it is the obvious
         * thing to write. Chrome hides `::details-content` with
         * `content-visibility: hidden`, which skips rendering the contents but
         * leaves the element's box in layout — so getBoundingClientRect on a
         * closed panel returns its full OPEN height. The first version read
         * `from` that way, got 115px against a `to` of 115px, and played a
         * perfectly healthy animation across no distance at all. It reported
         * playState "running" the whole time, which is what made it puzzling.
         *
         * So the closed height is asserted as 0 rather than asked for. The only
         * time expanding starts anywhere else is a reversal, where the caller
         * has already read the live height off a moving panel.
         */
        expand(current) {
          /* Reversing out of a close: the mark is mid-way back to a plus and has
             to turn forward again. */
          this.details.classList.remove(CLOSING_CLASS);
          this.details.open = true;

          this.play(current ?? 0, this.body.offsetHeight).then(() => {
            this.animation = undefined;
          }, ignoreCancel);
        }

        /* Open, so this one measures honestly. */
        collapse(current) {
          const from = current ?? this.body.offsetHeight;

          /*
           * The mark has to start turning back NOW, not when the panel finishes.
           * `open` cannot be cleared yet — that would take the content out of
           * the layout and there would be nothing left to animate — so the
           * intent is marked instead, and bf-accordion.css keys the toggle off
           * this in preference to the attribute. Set before play(), so the
           * class and the first animated frame land together.
           */
          this.details.classList.add(CLOSING_CLASS);

          this.play(from, 0).then(() => {
            this.details.open = false;
            this.details.classList.remove(CLOSING_CLASS);
            this.animation = undefined;
          }, ignoreCancel);
        }
      }
    );
  }

  /* A cancelled WAAPI animation rejects its finished promise. That is the
     normal path here — every reversal cancels one — so it is swallowed rather
     than left to surface as an unhandled rejection in the console. */
  function ignoreCancel() {}
})();
