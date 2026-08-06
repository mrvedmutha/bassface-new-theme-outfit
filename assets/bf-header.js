/*
 * Header behaviour that is not the drawer or the theme switcher.
 *
 * Currently one thing: the currency <select> is overlaid invisibly on its label
 * (see bf-header.liquid), so it needs to submit its own form on change. Doing
 * it here rather than with an inline onchange keeps the markup free of handler
 * attributes and survives a Section Rendering API re-render, since the listener
 * is delegated from the document.
 */

document.addEventListener('change', (event) => {
  const select = event.target.closest('.masthead__currency-select');

  if (select) select.form?.submit();
});
