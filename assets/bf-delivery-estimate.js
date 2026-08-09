/*
 * <bf-delivery-estimate> — "Order today, get it by 17–19 Aug 2026."
 *
 * Ported from the live theme, where this lived as a <script> pasted into a
 * custom_liquid block inside templates/product.json. Same arithmetic, same
 * numbers, same region model. Moving it into a file is the point of the port:
 * editor content is invisible to git, to linting and to search, and the only
 * way anyone found this one was by reading the template JSON.
 *
 * THE MODEL. Two windows, stacked, both counted in BUSINESS days:
 *
 *   earliest = today + processing.min + shipping[region].min
 *   latest   = today + processing.max + shipping[region].max
 *
 * Processing runs before shipping starts, which is why a Metro order is 8-10
 * calendar days rather than the 3-4 the shipping table alone suggests.
 *
 * Region comes from an IP lookup. It is a guess — the visitor's IP is not the
 * delivery address, and someone in Mumbai shipping to Assam is quoted Metro —
 * but it is a better guess than one national number, and the pincode that
 * would settle it does not exist until checkout.
 *
 * Three things this does that the pasted version did not:
 *
 *   1. Renders the fallback region SYNCHRONOUSLY, before the lookup. The
 *      original left an empty div until the network answered, so the line
 *      appeared late and pushed the page down when it did.
 *   2. Checks `data.error`. ipapi returns HTTP 200 with {error: true} when the
 *      free tier is exhausted; the original read city/region off that as
 *      undefined and classified it as Metro — the FASTEST bracket — so a quota
 *      failure silently quoted 8-10 days to an Islands customer facing 24-39.
 *   3. Caches the region for the page. The original refetched on every render.
 *
 * Not fixed, because it is a policy question rather than a bug: the fallback
 * is Metro, the most optimistic bracket, so an unrecognised location is quoted
 * the fastest timeline. `default_region` in the section settings changes it.
 * Public holidays are not modelled either — only weekends.
 */

/*
 * Wrapped, because the pasted original was not and that is a live hazard: it
 * declared PROCESSING, SHIPPING and the region names straight into global
 * scope, where a second copy of the script — or anything else claiming a name
 * as ordinary as METRO — throws on redeclaration and takes the whole file with
 * it. Same reason bf-cursor.js and bf-search.js are wrapped.
 */
(() => {
/* ------------------------------------------------------------------ config */

/* Business days. Edit here — these are fulfilment promises, not styling. */
const PROCESSING = { min: 3, max: 4 };

const METRO = 'Metro';
const SOUTH = 'South';
const NORTH_EAST_JK = 'NorthEast_JK';
const ISLANDS = 'Islands';

const SHIPPING = {
  [METRO]: { min: 3, max: 4 },
  [SOUTH]: { min: 5, max: 7 },
  [NORTH_EAST_JK]: { min: 7, max: 15 },
  [ISLANDS]: { min: 15, max: 25 },
};

const METRO_CITIES = ['mumbai', 'delhi', 'kolkata', 'chennai', 'bengaluru', 'bangalore'];

const SOUTH_STATES = ['tamil nadu', 'kerala', 'karnataka', 'andhra pradesh', 'telangana', 'puducherry'];

const NORTH_EAST_JK_STATES = [
  'arunachal pradesh',
  'assam',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'tripura',
  'sikkim',
  'jammu and kashmir',
  'jammu',
  'kashmir',
  'ladakh',
];

const GEO_ENDPOINT = 'https://ipapi.co/json/';
const LOCALE = 'en-GB';

/* One lookup per page load, shared by every instance and reused when the
   element is re-connected by a section re-render. */
let regionLookup;

/* ------------------------------------------------------------------- dates */

function addBusinessDays(start, days) {
  const result = new Date(start);
  let added = 0;

  while (added < days) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }

  return result;
}

/*
 * The month is printed only where it is needed to read the range correctly:
 *
 *   same month   12–14 Aug 2026
 *   same year    30 Aug – 2 Sep 2026
 *   over new year   30 Dec 2026 – 2 Jan 2027
 *
 * The middle case is the one the live theme's format could not express and the
 * first version of this on the new theme got wrong — it printed the month on
 * the second date only, so a range crossing a month end read "31–2 Sep 2026".
 */
function formatRange(from, to) {
  const dayOnly = { day: 'numeric' };
  const dayMonth = { day: 'numeric', month: 'short' };
  const full = { day: 'numeric', month: 'short', year: 'numeric' };

  if (from.getFullYear() !== to.getFullYear()) {
    return `${from.toLocaleDateString(LOCALE, full)} – ${to.toLocaleDateString(LOCALE, full)}`;
  }

  if (from.getMonth() !== to.getMonth()) {
    return `${from.toLocaleDateString(LOCALE, dayMonth)} – ${to.toLocaleDateString(LOCALE, full)}`;
  }

  return `${from.toLocaleDateString(LOCALE, dayOnly)}–${to.toLocaleDateString(LOCALE, full)}`;
}

function rangeFor(region) {
  const ship = SHIPPING[region] || SHIPPING[METRO];
  const today = new Date();

  return formatRange(
    addBusinessDays(addBusinessDays(today, PROCESSING.min), ship.min),
    addBusinessDays(addBusinessDays(today, PROCESSING.max), ship.max)
  );
}

/* ------------------------------------------------------------------ region */

function classify(city, state) {
  if (state.includes('andaman') || state.includes('nicobar')) return ISLANDS;
  if (METRO_CITIES.includes(city)) return METRO;
  if (SOUTH_STATES.some((name) => state.includes(name))) return SOUTH;
  if (NORTH_EAST_JK_STATES.some((name) => state.includes(name))) return NORTH_EAST_JK;
  return null;
}

function detectRegion() {
  if (regionLookup) return regionLookup;

  regionLookup = fetch(GEO_ENDPOINT)
    .then((response) => response.json())
    .then((data) => {
      /* Quota exhaustion is an HTTP 200 carrying {error: true}. Returning null
         keeps whatever the section was configured to fall back to. */
      if (!data || data.error) return null;
      return classify(String(data.city || '').toLowerCase(), String(data.region || '').toLowerCase());
    })
    .catch(() => null);

  return regionLookup;
}

/* ----------------------------------------------------------------- element */

if (!customElements.get('bf-delivery-estimate')) {
  customElements.define(
    'bf-delivery-estimate',
    class BfDeliveryEstimate extends HTMLElement {
      connectedCallback() {
        const fallback = this.dataset.region || METRO;

        this.textContent = rangeFor(fallback);

        if (this.dataset.detect !== 'true') return;

        detectRegion().then((region) => {
          if (!region || region === fallback || !this.isConnected) return;
          this.textContent = rangeFor(region);
        });
      }
    }
  );
}
})();
