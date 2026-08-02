import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

/**
 * Scope note
 * ----------
 * Dawn ships 36 stock JS files that predate this config and will not pass it.
 * They are listed under LEGACY below and excluded for now.
 *
 * This is a ratchet, not an amnesty: when we rewrite one of those files, delete
 * its entry from LEGACY in the same commit so it starts being linted. The list
 * should only ever get shorter.
 */
const LEGACY = [
  'assets/animations.js',
  'assets/cart-disclosure-modal.js',
  'assets/cart-disclosure-tooltip.js',
  'assets/cart-drawer.js',
  'assets/cart-notification.js',
  'assets/cart.js',
  'assets/constants.js',
  'assets/customer.js',
  'assets/details-disclosure.js',
  'assets/details-modal.js',
  'assets/disclosures.js',
  'assets/facets.js',
  'assets/global.js',
  'assets/localization-form.js',
  'assets/magnify.js',
  'assets/main-search.js',
  'assets/media-gallery.js',
  'assets/password-modal.js',
  'assets/pickup-availability.js',
  'assets/predictive-search.js',
  'assets/price-per-item.js',
  'assets/product-form.js',
  'assets/product-info.js',
  'assets/product-model.js',
  'assets/product-modal.js',
  'assets/pubsub.js',
  'assets/quantity-popover.js',
  'assets/quick-add-bulk.js',
  'assets/quick-add.js',
  'assets/quick-order-list.js',
  'assets/recipient-form.js',
  'assets/search-form.js',
  'assets/share.js',
  'assets/show-more.js',
  'assets/standard-actions-override.js',
  'assets/theme-editor.js',
];

/* Vendored third-party builds — never lint, never format. */
const VENDOR = ['assets/gsap.min.js', 'assets/lenis.min.js'];

export default [
  {
    ignores: ['node_modules/**', ...VENDOR, ...LEGACY],
  },

  js.configs.recommended,
  sonarjs.configs.recommended,

  /* Storefront code — browser globals, no bundler, classic scripts. */
  {
    files: ['assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Shopify: 'readonly',
        gsap: 'readonly',
        Lenis: 'readonly',
      },
    },
    rules: {
      /* Code smells — the reason sonarjs is here. */
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['warn', { threshold: 4 }],

      /* Correctness */
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      /* Keep functions small enough to reason about */
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
];
