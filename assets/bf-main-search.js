/*
 * <bf-main-search> — the search results page.
 *
 * Three jobs, all of them small: sort on change, clear the query, and Load More
 * through the Section Rendering API.
 *
 * LOAD MORE APPENDS, IT DOES NOT REPLACE. The button carries the next page's
 * URL, rendered by Liquid from `paginate.next`. Fetching that URL with
 * &section_id= returns this same section rendered for that page; the new cards
 * are moved into the existing grid and the button takes on whatever next-URL
 * the fetched page carried. No page arithmetic happens here — the server
 * already did it, and doing it again on the client is how off-by-one paging
 * bugs get written.
 *
 * The URL bar is deliberately NOT rewritten as pages load. It looks like the
 * courteous thing to do and it makes reloading worse: Shopify serves one page
 * per request, so a URL claiming ?page=3 restores only the third page — the
 * visitor loses pages 1 and 2 and lands mid-list with no way back to the top of
 * their own results. Leaving the URL alone restores the first page, which is at
 * least the beginning of what they asked for.
 */

/*
 * Wrapped in an IIFE so its top-level names stay private. Classic scripts share
 * one global lexical scope — see the longer note in bf-product-card.js.
 */

(() => {
  const GRID = '[data-results-grid]';
  const MORE = '[data-results-more]';
  const MORE_BUTTON = '[data-results-more-button]';
  const LOADING_CLASS = 'is-loading';

  class BFMainSearch extends HTMLElement {
    connectedCallback() {
      this.grid = this.querySelector(GRID);
      this.more = this.querySelector(MORE);
      this.moreButton = this.querySelector(MORE_BUTTON);
      this.sort = this.querySelector('[data-results-sort]');
      this.sortLabel = this.querySelector('[data-results-sort-label]');
      this.input = this.querySelector('[data-results-input]');
      this.clearButton = this.querySelector('[data-results-clear]');

      this.moreButton?.addEventListener('click', () => this.loadMore());

      /* Submitting the closest form would drop the sort, since the select lives
         outside it — navigating with the current URL keeps q, type and every
         active filter, and swaps only sort_by. */
      this.sort?.addEventListener('change', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('sort_by', this.sort.value);
        url.searchParams.delete('page');
        window.location.assign(url.toString());
      });

      this.clearButton?.addEventListener('click', () => {
        this.input.value = '';
        this.clearButton.hidden = true;
        this.input.focus();
      });

      this.input?.addEventListener('input', () => {
        this.clearButton.hidden = this.input.value.trim() === '';
      });
    }

    async loadMore() {
      const next = this.moreButton.dataset.nextUrl;
      if (!next || this.loading) return;

      this.loading = true;
      this.moreButton.classList.add(LOADING_CLASS);
      this.moreButton.disabled = true;

      try {
        const url = new URL(next, window.location.origin);
        url.searchParams.set('section_id', this.dataset.sectionId);

        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Load more failed: ${response.status}`);

        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
        this.append(parsed);
      } catch {
        /* Leave the button in place and enabled so the visitor can try again;
           a failed page is not a reason to strip the only way forward. */
        this.moreButton.dataset.failed = 'true';
      } finally {
        this.loading = false;
        this.moreButton.classList.remove(LOADING_CLASS);
        this.moreButton.disabled = false;
      }
    }

    append(parsed) {
      const incoming = parsed.querySelector(GRID);
      if (!incoming) return;

      /*
       * The first new card, captured before the move — `incoming.children` is a
       * live collection, so reading it after appending gives an empty list and
       * focus would have nowhere to go.
       */
      const first = incoming.firstElementChild;
      this.grid.append(...incoming.children);

      const nextButton = parsed.querySelector(MORE_BUTTON);
      const nextUrl = nextButton?.dataset.nextUrl;

      if (nextUrl) this.moreButton.dataset.nextUrl = nextUrl;
      else this.more.hidden = true;

      /*
       * Move focus to the first card that arrived. Without it a keyboard or
       * screen-reader user presses the button and nothing announces — the new
       * results are below their position in the document and there is no cue
       * that anything happened.
       */
      const link = first?.querySelector('a');
      if (link) {
        link.setAttribute('tabindex', '-1');
        link.focus({ preventScroll: true });
      }
    }
  }

  if (!customElements.get('bf-main-search')) {
    customElements.define('bf-main-search', BFMainSearch);
  }
})();
