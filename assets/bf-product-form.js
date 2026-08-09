/*
 * <bf-product-form> — add to bag, without a cart drawer.
 *
 * Dawn's own <product-form> is deliberately NOT used here, and the reason is
 * one branch in assets/product-form.js:
 *
 *   } else if (!this.cart) {
 *     window.location = window.routes.cart_url;
 *
 * `this.cart` is a <cart-notification> or a <cart-drawer>. This theme ships
 * neither by design — the decision was that adding to the bag updates the
 * counter in the header and nothing else — and Dawn reads that absence as "no
 * way to show the result", so it navigates to /cart. Keeping the stock element
 * would mean the one behaviour we ruled out is the one it does.
 *
 * What it still leans on: `subscribe`/`publish` from pubsub.js, `routes` from
 * theme.liquid, and Dawn's <product-info>, which owns variant switching. The
 * hidden id input is updated by product-info's own updateVariantInputs, keyed
 * off the form's id, so this file never touches it.
 */

if (!customElements.get('bf-product-form')) {
  customElements.define(
    'bf-product-form',
    class BfProductForm extends HTMLElement {
      variantChangeUnsubscriber = undefined;

      connectedCallback() {
        this.form = this.querySelector('form');
        this.form.addEventListener('submit', this.onSubmit.bind(this));

        /*
         * product-info re-renders this section server-side on every option
         * change and swaps a fixed list of ids — price, SKU, inventory — that
         * this element is not on. The variantChange event is the sanctioned
         * way to extend that list: it carries the parsed document, so the
         * button's new label and disabled state are read from the server's
         * answer rather than derived from a variant object out here.
         */
        this.variantChangeUnsubscriber = subscribe(PUB_SUB_EVENTS.variantChange, this.onVariantChange.bind(this));
      }

      disconnectedCallback() {
        this.variantChangeUnsubscriber?.();
      }

      get submitButton() {
        return this.querySelector('[type="submit"]');
      }

      onVariantChange({ data: { sectionId, html } }) {
        if (sectionId !== this.dataset.section) return;

        const source = html.querySelector(`bf-product-form[data-section="${sectionId}"] [data-cta]`);
        const destination = this.querySelector('[data-cta]');
        if (source && destination) destination.innerHTML = source.innerHTML;
      }

      onSubmit(event) {
        event.preventDefault();

        const button = this.submitButton;
        if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return;

        this.setError();
        button.setAttribute('aria-disabled', 'true');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const body = new FormData(this.form);

        /*
         * Ask for the header back in the same round trip. The alternative is a
         * second GET of /cart.js purely to learn the new item count, and the
         * count is a number the server is already computing to render the
         * header anyway. The section id comes from Liquid rather than being
         * written here, so this file knows nothing about which section draws
         * the bag.
         */
        const cartSection = this.dataset.cartSection;
        if (cartSection) body.append('sections', cartSection);

        config.body = body;

        fetch(routes.cart_add_url, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              this.setError(response.description || response.message);
              return;
            }

            this.updateCartCount(response.sections?.[cartSection]);

            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: 'bf-product-form',
              productVariantId: body.get('id'),
              cartData: response,
            });
          })
          .catch(() => {
            this.setError(window.cartStrings?.error);
          })
          .finally(() => {
            button.removeAttribute('aria-disabled');
          });
      }

      /*
       * Reads the count out of the re-rendered header rather than replacing the
       * header with it. Swapping the whole section would work and would also
       * throw away the live element's state — bf-header.js's scroll handling
       * and the open/closed nav drawer among it.
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

      setError(message) {
        const target = this.querySelector('[data-cart-error]');
        if (!target) return;

        target.textContent = message || '';
        target.toggleAttribute('hidden', !message);
      }
    }
  );
}
