# Bassface theme — working rules

Dawn 15.5.0, redesigned against the OUTFIT® by ++hellohello reference.
Design source of truth lives outside this repo in `new-design/` (`bassface-new-design.pen`,
`DESIGN-STATUS.md`, `templates/` HTML prototypes).

## Architecture — do not add a framework

This theme is vanilla **Web Components + Shopify's Section Rendering API**. Dawn already defines
30 custom elements (`<cart-drawer>`, `<modal-dialog>`, `<slider-component>`, `<variant-selects>`…)
and `assets/pubsub.js` for cross-component events.

- **No HTMX.** The Section Rendering API already returns HTML fragments, and the cart AJAX
  endpoints return JSON, which HTMX cannot consume natively.
- **No Alpine, React, Vue.** They fight the Web Component model already in place.
- New interactive UI is a custom element registered in its own `assets/*.js` file.

Third-party libraries are **vendored into `assets/`, never loaded from a CDN**. A cross-origin
request costs DNS + TCP + TLS before a single byte, Lighthouse flags it under third-party code,
and cross-origin HTTP cache partitioning (Chrome, 2020) means a shared CDN copy is never reused
across sites anyway.

Currently vendored:

| File                  | Version | Global         | Gzip   |
| --------------------- | ------- | -------------- | ------ |
| `assets/gsap.min.js`  | 3.15.0  | `window.gsap`  | ~28KB  |
| `assets/lenis.min.js` | 1.3.25  | `window.Lenis` | ~5KB   |
| `assets/lenis.css`    | 1.3.25  | —              | ~0.3KB |

**No ScrollTrigger.** Dawn's `assets/animations.js` already does IntersectionObserver-based scroll
reveals with `prefers-reduced-motion` handling, wired into 8+ sections via `scroll-trigger`
attributes. Use that before reaching for a plugin.

## CSS — BEM, enforced

`block`, `block__element`, `block--modifier`. Kebab-case within each part.

```css
/* @define preloader */
.preloader {
}
.preloader__card {
}
.preloader__card--active {
}
```

- **One block per file**, named after the file: `bf-preloader.css` defines `preloader`.
- The `/* @define <block> */` comment at the top of the file is what **turns BEM linting on** for
  that file. No comment, no enforcement — so always add it.
- State classes are exempt and must be `.is-*` or `.has-*` (`.is-open`, `.has-error`).
- Max nesting depth 2. No ID selectors.

**What is not automated:** nothing can validate the `class="…"` strings inside `.liquid` — they're
just text to a linter. Stylelint catches the CSS side only. Markup discipline is on review.

## JS

- Classic scripts, no bundler, no modules. `const`/`let`, never `var`.
- One custom element per file, filename matches the tag: `<bf-preloader>` → `assets/bf-preloader.js`.
- `eslint-plugin-sonarjs` enforces the code-smell rules: cognitive complexity ≤ 15, no identical
  functions, no duplicated string literals (4+). Cyclomatic complexity ≤ 12, max depth 4,
  functions ≤ 80 lines — these are warnings; treat them as a prompt to extract, not to silence.
- Never `// eslint-disable` without a comment on the line above saying why.

## The legacy ratchet

Dawn's 36 stock JS files and 66 stock CSS files predate these rules and are excluded in
`eslint.config.mjs` (`LEGACY`), `.stylelintrc.json` (`ignoreFiles`) and `.prettierignore`.

**When you rewrite one of those files, delete its entry from the ignore lists in the same commit.**
The lists only ever get shorter. Never add to them.

## Commands

```bash
npm run lint          # everything: js, css, liquid, formatting
npm run lint:js       # eslint
npm run lint:css      # stylelint (incl. BEM)
npm run lint:liquid   # shopify theme check
npm run fix           # autofix js + css + formatting
```

## Git flow

There is **no CI** on this repo, by choice. Commits and deploys are done by hand.

```
git commit → husky pre-commit → lint-staged on staged files only (~2-5s)
git push   → nothing runs
```

Two consequences worth being honest about:

1. The pre-commit hook is the **only** automated gate, and it is bypassable with `--no-verify`.
   Nothing catches a bypassed commit afterwards.
2. `lint-staged` only sees **staged files**. Theme Check and the full-tree sweep never run
   automatically. Run them yourself before anything ships:

   ```bash
   npm run lint          # js + css + liquid + formatting, whole tree
   ```

### Deploying

By hand, via the Shopify CLI. Push to a **fixed theme ID**, never `--unpublished` — that flag
creates a brand new theme on every run and you'll hit the 20-theme limit fast.

```bash
shopify theme push --theme <DEV_THEME_ID> --path .
```
