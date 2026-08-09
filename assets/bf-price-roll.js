/*
 * <bf-price-roll> — the price as a set of reels, one per digit.
 *
 * Changing a variant rolls each digit to its new value like a fruit machine
 * coming to rest. The reference does this with `number-flow`; the mechanism it
 * uses is a column of 0-9 behind a one-character window, translated by a custom
 * property, and that is what is rebuilt here rather than vendored — the whole
 * of it is a stacked column and a transform, and the library carries a plugin
 * system, a spring solver and a React wrapper that nothing here would use.
 *
 * TWO CYCLES OF DIGITS, NOT ONE, and that is what makes it read as a reel. A
 * single 0-9 column travelling from 3 to 4 is a one-place nudge; travelling
 * from 3 to "the 4 in the second cycle" is a full revolution plus the delta, so
 * every change spins regardless of how small it is. The glyph at index 10+n is
 * the same character as the one at n, so the reel can simply stop there — no
 * reset frame, nothing to snap back.
 *
 * HOW IT SURVIVES THE VARIANT SWAP. product-info replaces the innerHTML of
 * `#price-<section>` with freshly rendered markup, which destroys this element
 * and constructs a new one already holding the new price. The old value is
 * therefore gone before anything here can read it — so the last value is kept
 * in a module-level map, and a new instance looks up what its predecessor was
 * showing. No previous value, or the same one, means it renders static: a page
 * load must not animate, and neither must a variant change that leaves the
 * price alone.
 *
 * Characters are matched from the RIGHT. "Rs. 1,099.00" becoming "Rs. 899.00"
 * loses a character from the front, and aligning from the left would roll the
 * decimals into the rupees and spin every position on the line.
 */

(() => {
  const DURATION = 900;
  const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const STAGGER = 55; /* per digit, left to right, so the reels settle in turn */
  const CYCLE = 10;

  const DIGIT = /\d/;
  const REEL_DIGITS = [...Array(CYCLE * 2).keys()].map((n) => n % CYCLE);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* Keyed by data-key, so the price and the compare-at price each track their
     own history and cannot roll to each other's figures. */
  const lastValues = new Map();

  function charSpan(className, text) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  /* One digit window: a masked box holding two stacked runs of 0-9. */
  function buildReel(from, to, index) {
    const reel = charSpan('price-roll__reel', '');
    const stack = charSpan('price-roll__stack', '');

    for (const n of REEL_DIGITS) stack.appendChild(charSpan('price-roll__digit', String(n)));

    /* Start on the old glyph, then hand the new one over on the next frame —
       set in the same frame the browser has no two values to interpolate. */
    stack.style.setProperty('--price-roll-index', from);

    if (from !== to) {
      stack.style.transition = `transform ${DURATION}ms ${EASE} ${index * STAGGER}ms`;
      requestAnimationFrame(() => {
        stack.style.setProperty('--price-roll-index', to + CYCLE);
      });
    }

    reel.appendChild(stack);
    return reel;
  }

  if (!customElements.get('bf-price-roll')) {
    customElements.define(
      'bf-price-roll',
      class BfPriceRoll extends HTMLElement {
        connectedCallback() {
          this.update(this.textContent.trim());
        }

        get key() {
          return this.dataset.key || 'price';
        }

        /*
         * Idempotent on purpose. It is called twice for every size click — once
         * optimistically from the local map, once when the server render
         * replaces this element — and the second call sees its own value in
         * lastValues, so it repaints without animating. That is what stops the
         * reels running the same change twice.
         */
        update(value) {
          if (!value) return;

          const previous = lastValues.get(this.key);
          if (previous === value && this.childElementCount) return;

          lastValues.set(this.key, value);
          this.render(value, reduceMotion.matches ? null : previous);
        }

        render(value, previous) {
          /*
           * THE PLAIN FIGURE GOES IN FIRST, and is only then replaced by reels.
           *
           * The price is information, the roll is decoration, and the two must
           * not share a failure. If anything below throws — a currency format
           * this does not expect, a browser missing something — the element is
           * already showing the correct price in plain text rather than sitting
           * empty. Same reason the server renders the money string as this
           * element's content: with the script blocked entirely, the price is
           * still on the page.
           */
          this.textContent = value;
          this.setAttribute('aria-label', value);

          const chars = [...value];
          const before = previous ? [...previous] : [];

          /* Right-aligned pairing: position i of the new string sits against
             the character the same distance from the end of the old one. */
          const offset = before.length - chars.length;

          const fragment = document.createDocumentFragment();
          let digitIndex = 0;

          chars.forEach((char, i) => {
            if (!DIGIT.test(char)) {
              fragment.appendChild(charSpan('price-roll__char', char));
              return;
            }

            const was = before[i + offset];
            const from = previous && DIGIT.test(was || '') ? Number(was) : Number(char);

            fragment.appendChild(buildReel(from, Number(char), digitIndex));
            digitIndex += 1;
          });

          /* aria-label was set above, before the spans went in: a screen reader
             would otherwise read the price as every digit of every reel. */
          this.replaceChildren(fragment);
        }
      }
    );
  }
  /* --------------------------------------------------- optimistic update --- */

  /*
   * Shopify builds variant.title by joining the option values with " / ", and
   * the radios are rendered one group per option in the same order — so reading
   * the checked ones in DOM order and joining them the same way reproduces the
   * key exactly. No variant matching is reimplemented; the server's own naming
   * is the lookup.
   */
  function selectedTitle(root) {
    return [...root.querySelectorAll('fieldset input:checked')].map((input) => input.value).join(' / ');
  }

  function priceMap(root) {
    const script = root.closest('product-info')?.querySelector('[data-bf-price-map]');
    if (!script) return null;

    try {
      return JSON.parse(script.textContent);
    } catch {
      /* A malformed map must not take the size selector down with it. The
         server render is still coming and is still authoritative. */
      return null;
    }
  }

  document.addEventListener('change', (event) => {
    const selects = event.target.closest('variant-selects');
    if (!selects) return;

    const entry = priceMap(selects)?.[selectedTitle(selects)];
    if (!entry) return;

    const scope = selects.closest('product-info') || document;
    scope.querySelector('bf-price-roll[data-key="price"]')?.update?.(entry.price);

    /*
     * The compare-at is only updated when both the element and the new value
     * exist. Going from a discounted variant to one at full price cannot remove
     * the struck figure from here — there is no element to hide once the server
     * has not rendered one — so that case is left to the section render a moment
     * later. Showing a stale discount for that moment would be worse than the
     * wait, which is why it hides rather than holds.
     */
    const compare = scope.querySelector('bf-price-roll[data-key="compare"]');
    const strike = compare?.closest('s');

    if (compare && strike) {
      strike.hidden = !entry.compare;
      if (entry.compare) compare.update(entry.compare);
    }
  });
})();
