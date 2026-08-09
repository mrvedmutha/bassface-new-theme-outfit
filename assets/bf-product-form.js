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
 *
 * Because there is no drawer and no notification, the only thing a successful
 * add moves is a digit in the header — off-screen on a phone, and easy to miss
 * anywhere. So the button reports its own progress and its own result, as one
 * strip of faces turning behind it:
 *
 *   idle -> pending -> added -> idle
 *                   -> error -> idle
 *
 * The whole contract with bf-main-product.css is data-state on the button
 * holding one of those names, or being absent for idle. Every string and the
 * length of the hold come from section settings, through data attributes;
 * nothing the customer reads lives here.
 */

if (!customElements.get('bf-product-form')) {
  /*
   * The floor under the pending face, and the one number in here that has to
   * stay in step with a stylesheet: bf-main-product.css rolls a face in over
   * 380ms. A cart add on a good connection answers in less than that, and
   * without a floor the "Adding…" face would be caught halfway up the window
   * and sent straight back down — a flicker that reads as a fault rather than
   * as progress. Waiting the roll out costs nothing the customer notices and
   * buys a state they can actually see.
   */
  const MINIMUM_PENDING = 420;

  customElements.define(
    'bf-product-form',
    class BfProductForm extends HTMLElement {
      variantChangeUnsubscriber = undefined;
      resetTimer = undefined;

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
        clearTimeout(this.resetTimer);
      }

      get submitButton() {
        return this.querySelector('[type="submit"]');
      }

      /* Authored in seconds in the section settings; already milliseconds by the
         time Liquid writes the attribute. */
      get feedbackDuration() {
        return Number(this.dataset.feedbackDuration) || 2000;
      }

      onVariantChange({ data: { sectionId, html } }) {
        if (sectionId !== this.dataset.section) return;

        const source = html.querySelector(`bf-product-form[data-section="${sectionId}"] [data-cta]`);
        const destination = this.querySelector('[data-cta]');
        if (!source || !destination) return;

        /*
         * The swap discards the button the hold was running against, so the
         * timer has to go with it — otherwise it fires later and writes state
         * onto the replacement, or onto nothing. Cancelling first also means
         * the fresh markup arrives in its resting pose, which is the only
         * correct one for a variant the customer has not tried to add yet.
         */
        clearTimeout(this.resetTimer);
        destination.innerHTML = source.innerHTML;
        this.announce();
      }

      onSubmit(event) {
        event.preventDefault();

        const button = this.submitButton;
        if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return;

        /*
         * Clearing before setting matters when the customer adds again during
         * the hold: it cancels the timer that would otherwise fire mid-request
         * and drop the button back to idle while it is still working. Both
         * writes land in the same frame, so what is seen is one roll from the
         * old result to pending, not a return to idle and back out again.
         */
        this.resetFeedback();
        button.setAttribute('aria-disabled', 'true');
        button.dataset.state = 'pending';

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

        const request = fetch(routes.cart_add_url, config).then((response) => response.json());
        const floor = new Promise((resolve) => {
          setTimeout(resolve, MINIMUM_PENDING);
        });

        /*
         * allSettled rather than all, because the floor has to hold on the
         * failure path too — a request that is refused instantly deserves the
         * same visible pending state as one that is granted instantly, and
         * `all` would reject the moment the fetch did and skip straight past
         * it. Nothing here rejects, so the finally below always runs last.
         */
        Promise.allSettled([request, floor])
          .then(([outcome]) => {
            if (outcome.status === 'rejected') {
              this.showResult('error');
              return;
            }

            /*
             * /cart/add.js answers 200 with a body on success and a body
             * carrying `status` on refusal — an out-of-stock line, a quantity
             * over what is left. Neither is a rejected promise, so this branch
             * is the only thing separating the two.
             */
            const response = outcome.value;

            if (response.status) {
              this.showResult('error', response.description || response.message);
              return;
            }

            this.updateCartCount(response.sections?.[cartSection]);
            this.showResult('added');

            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: 'bf-product-form',
              productVariantId: body.get('id'),
              cartData: response,
            });
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

      /*
       * The one entry point for "the request answered". `state` is the face the
       * button rolls to and is the whole of the CSS contract — bf-main-product.css
       * matches on data-state and nothing else, so there is no second class to
       * keep in step with it.
       */
      showResult(state, message) {
        const button = this.submitButton;
        if (!button) return;

        if (state === 'error') {
          this.setError(message || this.dataset.errorMessage);
        } else {
          this.announce(this.dataset.addedMessage);
        }

        button.dataset.state = state;

        clearTimeout(this.resetTimer);
        this.resetTimer = setTimeout(this.resetFeedback.bind(this), this.feedbackDuration);
      }

      /* Back to the resting pose: the idle face, no error line, nothing left in
         the live region to be re-read. */
      resetFeedback() {
        clearTimeout(this.resetTimer);
        this.resetTimer = undefined;

        const button = this.submitButton;
        if (button) delete button.dataset.state;

        this.setError();
        this.announce();
      }

      setError(message) {
        const target = this.querySelector('[data-cart-error]');
        if (!target) return;

        target.textContent = message || '';
        target.toggleAttribute('hidden', !message);
      }

      announce(message) {
        const target = this.querySelector('[data-cart-status]');
        if (target) target.textContent = message || '';
      }
    }
  );
}
