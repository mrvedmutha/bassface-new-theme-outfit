/*
 * <bf-main-collection> — the collection page.
 *
 * Two ways the grid changes, and they are not the same operation:
 *
 *   LOAD MORE APPENDS. The button carries the next page's URL, rendered by
 *   Liquid from `paginate.next`. Fetching it with &section_id= returns this
 *   section rendered for that page; the new cards move into the existing grid
 *   and the button takes on whatever next-URL the fetched page carried. No page
 *   arithmetic happens here — the server already did it, and doing it again on
 *   the client is how off-by-one paging bugs get written.
 *
 *   FILTER AND SORT REPLACE. A different question has been asked, so the whole
 *   results region is swapped for the answer and page 1 starts again.
 *
 * Hence the history rule, which looks inconsistent and is not. Load More does
 * NOT touch the URL: Shopify serves one page per request, so a URL claiming
 * ?page=3 restores only the third page — the visitor loses pages 1 and 2 and
 * lands mid-list with no way back to the top of their own results. Filter and
 * sort DO push, because ?filter.v.availability=1 restores exactly the page it
 * describes, and it is a state worth bookmarking and sharing.
 *
 * Back after a filter change is left to bf-page-transition's popstate handler,
 * which swaps the whole document with no curtain. Handling it here as well
 * would mean two components racing to answer the same event.
 *
 * Wrapped in an IIFE so its top-level names stay private. Classic scripts share
 * one global lexical scope — see the longer note in bf-product-card.js.
 */

(() => {
  const RESULTS = '[data-results]';
  const GRID = '[data-results-grid]';
  const MORE = '[data-results-more]';
  const MORE_BUTTON = '[data-results-more-button]';
  const COUNT = '[data-results-count]';
  const LOADING_CLASS = 'is-loading';
  const SECTION_PARAM = 'section_id';
  const PAGE_PARAM = 'page';

  class BFMainCollection extends HTMLElement {
    connectedCallback() {
      this.results = this.querySelector(RESULTS);
      this.count = this.querySelector(COUNT);
      this.sort = this.querySelector('[data-results-sort]');
      this.sortLabel = this.querySelector('[data-results-sort-label]');

      /* Delegated, because the button is inside [data-results] and every filter
         or sort change replaces it — a listener bound to the element itself
         would be discarded with the first swap and Load More would go dead. */
      this.addEventListener('click', (event) => {
        if (event.target.closest(MORE_BUTTON)) this.loadMore();
      });

      this.sort?.addEventListener('change', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('sort_by', this.sort.value);
        this.apply(url);
      });
    }

    /*
     * Fetch this section as rendered for `url`. Returns a parsed document, or
     * null — callers decide what a failure means, because it means different
     * things: Load More leaves its button alive to be pressed again, while a
     * filter change has already moved the checkbox and has to put it back.
     */
    async fetchSection(url) {
      const request = new URL(url, window.location.origin);
      request.searchParams.set(SECTION_PARAM, this.dataset.sectionId);

      const response = await fetch(request.toString());
      if (!response.ok) throw new Error(`Section fetch failed: ${response.status}`);

      return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    async loadMore() {
      const button = this.querySelector(MORE_BUTTON);
      const next = button?.dataset.nextUrl;
      if (!next || this.loading) return;

      this.loading = true;
      button.classList.add(LOADING_CLASS);
      button.disabled = true;

      try {
        this.append(await this.fetchSection(next), button);
      } catch {
        /* Leave the button in place and enabled so the visitor can try again;
           a failed page is not a reason to strip the only way forward. */
        button.dataset.failed = 'true';
      } finally {
        this.loading = false;
        button.classList.remove(LOADING_CLASS);
        button.disabled = false;
      }
    }

    append(parsed, button) {
      const incoming = parsed.querySelector(GRID);
      if (!incoming) return;

      /*
       * The first new card, captured before the move — `incoming.children` is a
       * live collection, so reading it after appending gives an empty list and
       * focus would have nowhere to go.
       */
      const first = incoming.firstElementChild;
      this.querySelector(GRID).append(...incoming.children);

      const nextUrl = parsed.querySelector(MORE_BUTTON)?.dataset.nextUrl;
      if (nextUrl) button.dataset.nextUrl = nextUrl;
      else this.querySelector(MORE).hidden = true;

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

    /*
     * Apply a new filter or sort state. Public, because the filter drawer calls
     * it — this component owns the grid and the drawer owns the controls, so
     * the drawer hands over a URL and never touches a card.
     *
     * Resolves to the fetched document so a caller can read anything else off
     * the new page; the drawer uses it to re-render its own facet counts from
     * the same response rather than fetching twice.
     */
    async apply(url) {
      if (this.loading) return null;

      /* Page 1, always. A filtered list is a different list, and ?page=4 of it
         may not exist — Shopify answers that with an empty grid rather than an
         error, which reads as "no products match" and is a lie. */
      const target = new URL(url, window.location.origin);
      target.searchParams.delete(PAGE_PARAM);

      this.loading = true;
      this.results.classList.add(LOADING_CLASS);

      try {
        const parsed = await this.fetchSection(target);
        this.swap(parsed);

        /* Only after the swap succeeded. Pushing first would leave the URL
           describing a page the visitor is not looking at if the fetch threw. */
        window.history.pushState({ bfScroll: window.scrollY }, '', target.toString());
        return parsed;
      } catch {
        return null;
      } finally {
        this.loading = false;
        this.results.classList.remove(LOADING_CLASS);
      }
    }

    swap(parsed) {
      const incoming = parsed.querySelector(RESULTS);
      if (!incoming) return;

      this.results.replaceWith(incoming);
      this.results = incoming;

      /* The count lives outside [data-results] — see the note in the section on
         why the toolbar survives a swap — so it is updated by hand. */
      const count = parsed.querySelector(COUNT);
      if (count && this.count) this.count.textContent = count.textContent;

      /* The select is outside the swapped region too, so a sort arriving from
         the drawer's URL rather than from the select itself would leave the
         visible label disagreeing with the list. */
      const label = parsed.querySelector('[data-results-sort-label]');
      if (label && this.sortLabel) this.sortLabel.textContent = label.textContent;
    }
  }

  if (!customElements.get('bf-main-collection')) {
    customElements.define('bf-main-collection', BFMainCollection);
  }
})();
