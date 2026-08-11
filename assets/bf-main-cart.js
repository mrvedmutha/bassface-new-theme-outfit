/*
 * <bf-main-cart> — quantity and removal without leaving the page.
 *
 * Dawn's <cart-items> was not kept, for the same reason bf-quantity did not keep
 * <quantity-input>: the element is fine, its markup contract is not. It reaches
 * for `#Quantity-{line}`, `.cart-item`, `.cart-item__name`, `.loading__spinner`
 * and `.cart-item__error-text` by name, so using it means writing Dawn's class
 * vocabulary into a BEM block called `cart-line` and keeping the two in step
 * forever. It also renders two sections per change, because the stock bag splits
 * the items and the footer across a pair; this page is one section.
 *
 * THE WHOLE PAGE IS THE UNIT OF UPDATE. Every mutation asks the server to
 * re-render this section and the header, then swaps this element's contents
 * wholesale. Patching in place would be less markup over the wire and more
 * arithmetic in here — the line total, the subtotal, the discount rows, the
 * header count and the empty state are all things the server already computes,
 * and any of them recomputed here is a second implementation of Shopify's money
 * formatting waiting to disagree with the first.
 *
 * The header is asked for in the same round trip rather than swapped in: see
 * updateCartCount, which is bf-product-form.js's, for why the count is read out
 * of the response instead of the section being replaced with it.
 *
 * With this file absent the page still works — see the note in the section. The
 * three controls it takes over are a number input inside a real <form>, a submit
 * button, and a link to Shopify's own /cart/change URL.
 */

if (!customElements.get('bf-main-cart')) {
  customElements.define(
    'bf-main-cart',
    class BfMainCart extends HTMLElement {
      /*
       * Which section renders the bag count. A literal, matching
       * bf-main-product.liquid: a section rendered from theme.liquid has its own
       * filename as its id, so there is nothing to pass through Liquid.
       */
      static HEADER_SECTION = 'bf-header';

      connectedCallback() {
        this.addEventListener('change', this.onChange.bind(this));
        this.addEventListener('click', this.onClick.bind(this));
        this.addEventListener('submit', this.onSubmit.bind(this));

        /*
         * Back out of the checkout and the browser restores this page from the
         * bfcache exactly as it was left — button mid-roll, "Checking out…"
         * showing, aria-disabled set. Nothing else fires on a restore, so the
         * one thing that does has to be the one that clears it.
         */
        this.resetOnRestore = (event) => {
          if (event.persisted) this.setCheckoutPending(false);
        };
        window.addEventListener('pageshow', this.resetOnRestore);
      }

      disconnectedCallback() {
        window.removeEventListener('pageshow', this.resetOnRestore);
      }

      get sectionId() {
        return this.dataset.sectionId;
      }

      get checkoutButton() {
        return this.querySelector('[name="checkout"]');
      }

      /* `change` bubbles from the number input whether the customer typed into
         it or bf-quantity stepped it, which is the point of listening here
         rather than binding each control. */
      onChange(event) {
        const input = event.target.closest('[data-quantity]');
        if (!input) return;

        const row = input.closest('[data-line]');
        if (!row) return;

        this.mutate(row, Number(input.value));
      }

      onClick(event) {
        const remove = event.target.closest('[data-remove]');
        if (!remove) return;

        const row = remove.closest('[data-line]');
        if (!row) return;

        /* Only now — with the row found and the request about to go out — is
           the link's own navigation cancelled. A click we cannot service is a
           click that should still reach /cart/change and reload the page. */
        event.preventDefault();
        this.mutate(row, 0);
      }

      /*
       * The checkout is NOT intercepted — the form posts to /cart and the
       * browser leaves, which is the behaviour with or without this file. All
       * that happens here is the button being told to say so: Shopify's answer
       * can take a second or two, and a button that reports nothing in that gap
       * gets pressed again, which is how a customer ends up back on /cart
       * wondering whether the first press did anything.
       *
       * The second press is refused outright rather than merely discouraged.
       * aria-disabled is an announcement, not an enforcement — only returning
       * false from here stops the submit.
       */
      onSubmit(event) {
        const button = this.checkoutButton;
        if (!button) return;

        if (button.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
          return;
        }

        this.setCheckoutPending(true);
      }

      setCheckoutPending(pending) {
        const button = this.checkoutButton;
        if (!button) return;

        if (pending) {
          button.dataset.state = 'pending';
          button.setAttribute('aria-disabled', 'true');
        } else {
          delete button.dataset.state;
          button.removeAttribute('aria-disabled');
        }
      }

      /*
       * One entry point for both controls, because they are the same request:
       * removal is a quantity of zero, which is what Shopify's own
       * `url_to_remove` asks for too.
       */
      mutate(row, quantity) {
        const line = row.dataset.line;
        if (!line || Number.isNaN(quantity)) return;

        row.classList.add('is-loading');
        this.setLineError(row);

        const sections = [this.sectionId, BfMainCart.HEADER_SECTION];

        const config = fetchConfig();
        config.body = JSON.stringify({
          line,
          quantity,
          sections,

          /*
           * sections_url is what the rendered sections are rendered AGAINST.
           * Left out, Shopify renders them for `/`, and the header's
           * current-page state would come back marked for the home page.
           */
          sections_url: window.location.pathname,
        });

        fetch(`${routes.cart_change_url}`, config)
          .then((response) => response.json())
          .then((state) => {
            /*
             * /cart/change.js answers 200 with the cart on success and 422 with
             * `errors` on refusal — a line that no longer exists, a quantity
             * past what is in stock. Neither rejects the promise, so this is the
             * only thing separating them.
             */
            if (state.errors) {
              row.classList.remove('is-loading');
              this.setLineError(row, state.errors);
              return;
            }

            this.updateCartCount(state.sections?.[BfMainCart.HEADER_SECTION]);
            this.render(state.sections?.[this.sectionId], line, quantity);

            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: this.localName,
              cartData: state,
            });
          })
          .catch(() => {
            row.classList.remove('is-loading');
            this.setLineError(row, this.dataset.errorMessage);
          });
      }

      /*
       * Swap this element's contents for the server's, then say what changed.
       *
       * Contents and not the element: replacing the whole
       * `#shopify-section-{id}` would tear down the element mid-callback and
       * hand the rest of this method a node that is no longer in the document.
       * Everything inside is stateless markup, so there is nothing in it worth
       * preserving across the swap.
       */
      render(html, line, requested) {
        if (!html) return;

        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const source = parsed.querySelector(this.localName);
        if (!source) return;

        /*
         * The entrance is dropped on the way in. The server sends the same
         * markup it sends on a page load, <bf-reveal> wrappers and all, and
         * those elements conceal themselves the moment they are connected — so
         * pressing + would send every row below the fold and climb it back up
         * again. The rise is how the bag ARRIVES; it did not arrive.
         *
         * Unwrapped rather than pre-revealed: a wrapper left in place keeps its
         * `overflow: hidden`, and there is no reason for a clip to outlive the
         * animation it was there for.
         */
        source.querySelectorAll('bf-reveal').forEach((wrapper) => {
          wrapper.replaceWith(...wrapper.childNodes);
        });

        this.innerHTML = source.innerHTML;

        /* The announcement is composed by Liquid, not assembled here — it is a
           translated string and a money-formatted total, and both belong to the
           server. It rides on the element rather than inside it, so the swap
           above leaves the live element holding the previous cart's figure. */
        this.dataset.updatedMessage = source.dataset.updatedMessage || '';

        /*
         * What actually happened, read back off the fresh markup rather than
         * assumed from what was asked for. Shopify grants less than the
         * requested quantity when stock runs short, and it is the granted figure
         * the customer needs told — the input now holds it, or the row is gone
         * because the line was removed.
         */
        const row = this.querySelector(`[data-line="${line}"]`);
        const granted = Number(row?.querySelector('[data-quantity]')?.value);

        if (row && requested > granted && window.cartStrings?.quantityError) {
          this.setLineError(row, window.cartStrings.quantityError.replace('[quantity]', granted));
        }

        this.announce(this.dataset.updatedMessage);
      }

      /*
       * Reads the count out of the re-rendered header rather than replacing the
       * header with it. Swapping the whole section would work and would also
       * throw away the live element's state — bf-header.js's scroll handling and
       * the open or closed nav drawer among it. Same call, and the same code, as
       * bf-product-form.js.
       */
      updateCartCount(sectionHtml) {
        if (!sectionHtml) return;

        const parsed = new DOMParser().parseFromString(sectionHtml, 'text/html');
        const count = parsed.querySelector('[data-cart-count]')?.textContent;
        if (count === undefined) return;

        document.querySelectorAll('[data-cart-count]').forEach((node) => {
          node.textContent = count;
        });
      }

      /* `message` absent clears the line. cartStrings.quantityError is
         translated HTML in Dawn's locales, so it is assigned as HTML rather than
         as text — everything else that reaches here is our own escaped setting. */
      setLineError(row, message) {
        const target = row.querySelector('[data-line-error]');
        if (!target) return;

        target.innerHTML = message || '';
        target.toggleAttribute('hidden', !message);
      }

      /*
       * A frame late, and that is the point. render() has just replaced the live
       * region with a fresh, empty one; a screen reader that is handed a
       * role="status" node with its text already in it treats that as initial
       * content and says nothing. Writing after the node has been observed makes
       * it the mutation it has to be to get read out.
       */
      announce(message) {
        requestAnimationFrame(() => {
          const target = this.querySelector('[data-cart-status]');
          if (target) target.textContent = message || '';
        });
      }
    }
  );
}
