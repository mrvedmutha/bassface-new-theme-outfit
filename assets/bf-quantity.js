/*
 * <bf-quantity> — the minus / value / plus stepper.
 *
 * Dawn's <quantity-input> was used first and replaced, because its markup
 * contract drags its appearance along with it. The element itself is fine; the
 * three classes it needs are not:
 *
 *   .quantity        { color: rgba(var(--color-foreground)); width: 14rem; }
 *   .quantity::before, ::after   — the box and its inset shadow
 *   .quantity__button{ color: rgb(var(--color-foreground)); width: 4.5rem; }
 *   .quantity__input { opacity: 0.85; font-weight: 500; flex-grow: 1; }
 *
 * `--color-foreground` is Dawn's own palette, set from the section colour
 * scheme. It is not --bf-ink, so the stepper stayed #121212 in all three
 * Bassface themes while everything around it followed the switcher — the
 * boxed dark control against red-on-cream. Overriding it meant re-declaring
 * about fifteen properties and keeping that list correct against a stock file
 * we do not own.
 *
 * What is given up: Dawn's per-variant quantity rules, which read data-min,
 * data-max and data-cart-quantity off the input. Nothing rendered those
 * attributes, so nothing is lost today — but a future "only 3 left" rule wants
 * them, and this is the file that would grow.
 *
 * stepUp/stepDown rather than arithmetic on the value: they respect min, max
 * and step from the markup, so the clamping is the browser's and there is no
 * second copy of the bounds in here.
 */

if (!customElements.get('bf-quantity')) {
  customElements.define(
    'bf-quantity',
    class BfQuantity extends HTMLElement {
      connectedCallback() {
        this.input = this.querySelector('input');
        if (!this.input) return;

        this.addEventListener('click', this.onClick.bind(this));
        this.input.addEventListener('change', this.syncButtons.bind(this));
        this.syncButtons();
      }

      onClick(event) {
        const button = event.target.closest('[data-step]');
        if (!button) return;

        event.preventDefault();

        if (button.dataset.step === 'up') {
          this.input.stepUp();
        } else {
          this.input.stepDown();
        }

        this.input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      /*
       * A real disabled attribute, not a class. The floor is already expressed
       * by the input's min, so at quantity 1 the minus does nothing when
       * clicked — leaving it live means a control that looks operable and
       * silently is not.
       */
      syncButtons() {
        const value = Number(this.input.value);
        const min = Number(this.input.min);
        const max = Number(this.input.max);

        const down = this.querySelector('[data-step="down"]');
        const up = this.querySelector('[data-step="up"]');

        if (down && this.input.min !== '') down.disabled = value <= min;
        if (up && this.input.max !== '') up.disabled = value >= max;
      }
    }
  );
}
