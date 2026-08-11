/*
 * <bf-split-lines> — wraps each VISUAL line of its own text in a <bf-reveal>, so
 * a display paragraph climbs out one line after another instead of arriving as
 * a slab.
 *
 * There is no CSS selector for "a line". Line boxes are a layout RESULT, not a
 * tree structure, so the only way to address one is to measure where the browser
 * actually broke the text and rebuild around that: wrap every word, group the
 * words by the offsetTop they land on, then replace the lot with one element per
 * group.
 *
 * IT ANIMATES NOTHING ITSELF. The wrappers it builds are <bf-reveal
 * class="reveal reveal--rise">, so the entrance is bf-reveal.js's — the
 * preloader handover, the page-transition router, the IntersectionObserver and
 * the reduced-motion opt-out all come for free, and this file stays a DOM
 * surgeon with no timing of its own. --reveal-index is set per line, which is
 * what turns a set of simultaneous rises into a stagger.
 *
 * THE RESTING STATE IS THE VISIBLE ONE, as everywhere else in this theme: the
 * markup ships as a plain paragraph and is only ever rewritten by a script that
 * has already run. A blocked asset leaves readable text.
 *
 * bf-hero.js has a `splitLines` of its own and this is deliberately not shared
 * with it. The measuring loop is the same twelve lines, but the two differ in
 * everything around it — the hero drives WAAPI against a timeline it composes
 * from four other movements and restores when the whole thing settles, where
 * this hands off to CSS and never learns what happened. Extracting the middle
 * would leave a helper with two callers and two shapes. Worth revisiting if a
 * third caller turns up.
 *
 * Attributes:
 *   data-line-class  required. Applied to each <bf-reveal> alongside `reveal
 *                    reveal--rise`. `reveal--rise-display` is the variant built
 *                    for this — it carries the slower timing, the descender
 *                    padding the clip needs at display size, and the nowrap on
 *                    the moving child. Required rather than defaulted so the
 *                    element stays inert until a caller has said how the lines
 *                    should be clipped; a wrong guess here hides text.
 */

(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * Grouping by the top edge is what identifies a line: every word the browser
   * put on the same line shares one. Reading offsetTop off each probe in turn
   * costs a single forced layout for the whole set, because nothing between the
   * reads writes to the DOM.
   */
  const groupByLine = (probes) => {
    const groups = [];
    let top = null;

    for (const probe of probes) {
      if (probe.offsetTop !== top) {
        top = probe.offsetTop;
        groups.push([]);
      }

      groups[groups.length - 1].push(probe.textContent);
    }

    return groups;
  };

  if (!customElements.get('bf-split-lines')) {
    customElements.define(
      'bf-split-lines',
      class BfSplitLines extends HTMLElement {
        connectedCallback() {
          if (reduceMotion.matches) return;
          if (!this.dataset.lineClass) return;

          /* Captured before anything is touched, and it is what every restore
             below puts back. */
          this.source = this.textContent;

          /*
           * FONTS FIRST, and this is not optional. Archivo loads with
           * `font-display: swap`, so measuring before it arrives groups the
           * words against the fallback's metrics and the lines break in the
           * wrong places the moment the real face lands.
           */
          document.fonts.ready.then(() => {
            if (!this.isConnected) return;

            this.width = this.clientWidth;
            this.split();

            /*
             * The split markup is wrong for anything that outlives the width it
             * was measured at — the line breaks are frozen, and the text is
             * `nowrap` inside a clip, so a narrower container would cut the end
             * off every line. Re-measure instead.
             */
            this.resizeObserver = new ResizeObserver(() => {
              if (this.clientWidth === this.width) return;

              this.width = this.clientWidth;
              this.split();
            });

            this.resizeObserver.observe(this);
          });
        }

        disconnectedCallback() {
          this.resizeObserver?.disconnect();
          this.resizeObserver = null;
        }

        /*
         * Back to a plain paragraph once the last line has landed. Not
         * tidiness: from here on the text has to reflow like text, and leaving
         * the frozen line boxes in place would mean holding the ResizeObserver
         * open for the life of the page to keep correcting them.
         */
        settle() {
          this.disconnectedCallback();
          this.textContent = this.source;
        }

        split() {
          const words = this.source.trim().split(/\s+/).filter(Boolean);
          if (words.length === 0) return;

          this.textContent = '';
          const probes = words.map((word, index) => {
            const probe = document.createElement('span');
            /* The leading space belongs INSIDE the probe, so a word that ends a
               line carries no trailing gap into the measurement. */
            probe.textContent = index === 0 ? word : ` ${word}`;
            this.appendChild(probe);
            return probe;
          });

          const groups = groupByLine(probes);

          this.textContent = '';
          let last = null;

          groups.forEach((group, index) => {
            const line = document.createElement('bf-reveal');
            line.className = `reveal reveal--rise ${this.dataset.lineClass}`;
            line.style.setProperty('--reveal-index', index);

            const text = document.createElement('span');
            text.className = 'reveal__line';
            text.textContent = group.join('').trim();

            line.appendChild(text);
            this.appendChild(line);
            last = text;
          });

          /*
           * `transform` is the only property in flight, so the last line's
           * transitionend is the whole entrance finishing. It never fires if the
           * paragraph is never scrolled to, which is correct — there is nothing
           * to put back until something has moved.
           */
          last?.addEventListener('transitionend', () => this.settle(), { once: true });
        }
      }
    );
  }
})();
