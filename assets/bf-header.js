/*
 * Header behaviour that is not the drawer or the theme switcher.
 *
 * Two things:
 *
 * 1. The currency <select> is overlaid invisibly on its label, so it needs to
 *    submit its own form on change. Doing it here rather than with an inline
 *    onchange keeps the markup free of handler attributes and survives a
 *    Section Rendering API re-render, since the listener is delegated from the
 *    document.
 *
 *    The hook is an attribute, not a class, because the same control appears in
 *    two different blocks — the nav and the drawer — and a class would have to
 *    name one of them. One delegated listener serves both.
 *
 * 2. The header is fixed, so it occupies no space in the flow and nothing
 *    downstream can measure it in CSS. Its height is republished as
 *    --bf-header-height on <html>, which bf-base.css uses to offset the page
 *    content and to set scroll-padding, and bf-header.css uses to size the
 *    unblended overlay to the same box as the bar.
 *
 *    bf-base.css seeds the property with the design's own row height, so the
 *    layout is right before this runs and this only corrects for the real
 *    rendered box — a merchant's font-size setting, a long currency label.
 *
 * 3. The nav is one line and must stay one line. A merchant's menu can be
 *    longer than the width allows, and the alternatives are all worse than
 *    scaling: wrapping grows a FIXED bar downwards over the page, and
 *    overflowing pushes the switcher off-screen. So the row is measured and
 *    --masthead-scale lowered until the line fits.
 *
 *    CSS alone cannot do this: a media query knows the viewport width but not
 *    how many items the merchant put in the menu, which is the actual variable.
 */

const MASTHEAD_SELECTOR = '.masthead';
const BAR_SELECTOR = '.masthead__bar';
const INNER_SELECTOR = '.masthead__inner';
const HEIGHT_PROPERTY = '--bf-header-height';
const ROW_SCALE_PROPERTY = '--masthead-scale';

/* Floor, and step. 0.7 keeps the 24px labels at 16.8px — still comfortably
   legible; below that the header would be doing the menu a disservice and the
   merchant should shorten it. */
const ROW_MIN_SCALE = 0.7;
const ROW_SCALE_STEP = 0.05;

document.addEventListener('change', (event) => {
  const select = event.target.closest('[data-bf-currency-select]');

  if (select) select.form?.submit();
});

function publishHeight(bar) {
  document.documentElement.style.setProperty(HEIGHT_PROPERTY, `${bar.offsetHeight}px`);
}

/*
 * Pixels by which the row's content exceeds the space available to it.
 *
 * Deliberately NOT `scrollWidth > clientWidth`, which looks like the obvious
 * test and is wrong here: clientWidth includes the padding box, so the nav can
 * run right through the page padding and collide with the logo while that
 * comparison still cheerfully reports zero overflow. The row has to fit the
 * CONTENT box, so that is what gets measured.
 *
 * Summing the children works because none of them may shrink — see the
 * `min-width` note in bf-header.css — so each reports its natural width, and
 * `justify-content: space-between` adds no gaps of its own to account for.
 */
function rowOverflow(inner) {
  const style = getComputedStyle(inner);
  const available =
    inner.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);

  let needed = 0;
  for (const child of inner.children) needed += child.offsetWidth;

  return needed - available;
}

/*
 * Shrink the row a step at a time until the single line fits. Each iteration
 * forces a reflow, which is why it starts from 1 and stops at the first fitting
 * value rather than binary-searching: at a 0.05 step there are only six of them,
 * and the common case — a menu that fits — costs one measurement and no writes.
 *
 * If the floor is reached and it still does not fit, the row is left overflowing
 * rather than shrunk into illegibility. That is a menu the merchant needs to
 * shorten, and it should look like one.
 */
function fitRow(masthead) {
  const inner = masthead.querySelector(INNER_SELECTOR);

  if (!inner) return;

  masthead.style.removeProperty(ROW_SCALE_PROPERTY);

  /* 0.5 absorbs sub-pixel rounding, which would otherwise scale a row that fits. */
  for (let scale = 1; scale > ROW_MIN_SCALE && rowOverflow(inner) > 0.5; ) {
    scale -= ROW_SCALE_STEP;
    masthead.style.setProperty(ROW_SCALE_PROPERTY, scale.toFixed(2));
  }
}

/*
 * One observer, two jobs, and the width/height asymmetry is the important part.
 *
 * Refitting on a WIDTH change is safe and refitting on a height change is not.
 * The bar is fixed with `left: 0; right: 0`, so its width is the viewport's and
 * owes nothing to its contents — fitRow cannot change it, and feeding it back
 * cannot loop. Its height, by contrast, is exactly what fitRow moves, so acting
 * on that would be an infinite loop.
 *
 * Width is observed rather than left to a `resize` listener because the change
 * that matters most does not fire one: the vertical scrollbar appearing once
 * the page fills takes ~15px off the viewport AFTER the first fit has run. The
 * old code measured the pre-scrollbar width, concluded the row fitted, and left
 * the nav overlapping the switcher by precisely the scrollbar's width.
 *
 * IT IS RE-ENTRANT, and the disconnect below is the whole reason. Whoever
 * replaces the header — the theme editor, or bf-page-transition on every
 * navigation — leaves this observer holding the OLD bar, and a ResizeObserver
 * fires as its target detaches, reporting a height of zero. publishHeight then
 * writes `--bf-header-height: 0px`, the page content that is offset by that
 * property jumps up underneath the fixed bar, and the row refits against the
 * broken layout and collapses to its 0.7 floor — which is the header appearing
 * to clip and the theme switcher appearing to fall out of the row. Meanwhile
 * nothing observes the header that is actually on screen.
 */
let observer = null;

function observeHeader() {
  /* Before anything else, and before the early return: a header that has gone
     away must stop being measured whether or not a new one has arrived. */
  observer?.disconnect();
  observer = null;

  const masthead = document.querySelector(MASTHEAD_SELECTOR);
  const bar = masthead?.querySelector(BAR_SELECTOR);

  if (!bar) return;

  let lastWidth = 0;

  /* Assigned before observing, not chained off it — `observe` returns undefined,
     and chaining would leave nothing to disconnect on the next navigation. */
  observer = new ResizeObserver(() => {
    publishHeight(bar);

    if (bar.offsetWidth === lastWidth) return;

    lastWidth = bar.offsetWidth;
    refit();
  });

  observer.observe(bar);
}

/*
 * Coalesced into a frame, which does two jobs. It collapses a resize drag's
 * flood of events into one fit instead of dozens of forced reflows. And it
 * waits out the relayout after a font swap: `loadingdone` fires when the file
 * has loaded, which is BEFORE the text has been re-laid-out with it, so
 * measuring on the event itself reads stale fallback widths and lands a step
 * short of fitting.
 *
 * Cancel-and-reschedule, so the LATEST request wins. A plain "already pending,
 * skip" guard is wrong here: the fit scheduled at startup would win the frame
 * and the font-swap correction arriving moments later would be dropped, leaving
 * the row permanently one step short.
 */
let refitFrame = 0;

function refit() {
  cancelAnimationFrame(refitFrame);

  refitFrame = requestAnimationFrame(() => {
    const masthead = document.querySelector(MASTHEAD_SELECTOR);

    if (masthead) fitRow(masthead);
  });
}

observeHeader();

/*
 * Archivo swaps in after first paint and every label changes width with it, so
 * the first fit is measured against fallback metrics and lands a step short.
 *
 * Both hooks, because either one alone has a hole. This script is deferred, so
 * a font served from cache can finish BEFORE the listener is attached and
 * `loadingdone` never fires for it — `ready` covers that, settling immediately
 * when loading is already done. And `ready` settles only once, so a face that
 * loads later — an icon set, a section's own face — needs the event. Both funnel
 * through the frame above, so the pair still costs at most one fit.
 */
document.fonts?.addEventListener('loadingdone', refit);
document.fonts?.ready.then(refit);

/* The theme editor swaps the whole section, which discards the observed node. */
document.addEventListener('shopify:section:load', (event) => {
  if (event.target.querySelector(BAR_SELECTOR)) observeHeader();
});

/*
 * And so does bf-page-transition, for the same reason and far more often — the
 * header carries the cart count and the current-page state, so it is genuinely
 * replaced whenever those differ.
 *
 * This file has top-level side effects and a `src` the router deliberately does
 * NOT re-execute, so re-running the script is not the recovery path; rebinding
 * from an event is. The router fires this under the curtain, ~400ms before the
 * reveal starts, so the corrected height and fit are in place before anyone
 * sees the new page.
 */
document.addEventListener('bf:page-loaded', observeHeader);
