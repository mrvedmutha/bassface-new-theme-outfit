/*
 * <bf-hero> — the homepage entrance, played once the preloader hands over.
 *
 * Four movements, overlapping. Read off the reference's shipped bundle rather
 * than guessed from watching it:
 *
 *   letters   yPercent 110 -> 0, 1.4s power4.out, stagger 0.06 from "random"
 *   rule      scaleX 0 -> 1,     1.6s expo.out,   at 20% into the letters
 *   meta      y 32 -> 0 + fade,  1.4s expo.out,   stagger 0.2 from "start"
 *   statement lines yPercent 100 -> 0, 1.8s expo.out, stagger 0.15
 *
 * THE OVERLAPS ARE THE POINT, and they are the part that is easy to get wrong.
 * The reference places these with GSAP's relative labels — "<20%", "<", "<15%"
 * — which resolve against the previous tween's TOTAL duration, stagger
 * included, not its per-element duration. So the rule does not start 20% into
 * 1.4s; it starts 20% into 1.4 + 7x0.06 = 1.82s. Every start time below is
 * derived that way, from the live element counts, so adding a nav link or
 * changing the wordmark keeps the shape instead of quietly drifting.
 *
 * WEB ANIMATIONS, NOT GSAP, and not the preloader's rAF engine either. Every
 * value here is a transform or an opacity moving between two fixed endpoints,
 * which is precisely what WAAPI does natively with a delay and an easing. The
 * preloader needs its own engine because it interpolates a NUMBER — the 000 to
 * 100 counter — which no CSS or WAAPI primitive can express. Nothing here does.
 */

/*
 * Wrapped in an IIFE so its top-level names stay private. Classic scripts share
 * one global lexical scope, so a `const` here would collide with the same name
 * in any other asset — see the longer note in bf-product-card.js, which is
 * where that bit.
 */

(() => {
  /* GSAP's power ladder is power1=quad, power2=cubic, power3=quart, so power4
     is quintic — but the reference's own comment ladder and the shape of the
     curve are the quart family. These are the standard easings.net beziers. */
  const EASE_QUART_OUT = 'cubic-bezier(0.25, 1, 0.5, 1)';
  const EASE_EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

  const LETTER_DURATION = 1400;
  const LETTER_STAGGER = 60;
  const RULE_DURATION = 1600;
  const RULE_AT = 0.2; /* of the letters' total, per "<20%" */
  const META_DURATION = 1400;
  const META_STAGGER = 200;
  const LINE_DURATION = 1800;
  const LINE_STAGGER = 150;
  const LINE_AT = 0.15; /* of the meta run's total, per "<15%" */

  const META_RISE = 32; /* px, the reference's y:32 */

  const CONCEALED_CLASS = 'is-concealed';
  const LETTER_SELECTOR = '.hero__mark-letter';
  const RULE_SELECTOR = '.hero__rule';
  const COPY_SELECTOR = '.hero__copy';

  /* Source order IS the stagger order — the reference's `from: "start"`. */
  const META_SELECTOR = '.hero__tagline, .hero__label, .hero__link, .hero__copyright';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * Resolves when the preloader hands the page over, or immediately if none is
   * in the way. Same three cases and the same reasoning as bf-product-card.js:
   * the `is-preloading` class is written by an inline script in the head, so it
   * is already correct here, and it catches the synchronous release on a repeat
   * visit that a bare event listener would sleep through.
   *
   * Deliberately recomputed rather than shared with the card. The two files are
   * separately scoped by design, and a shared global would be one more name to
   * collide on for the sake of reading one class.
   */
  const preloaderDone = document.documentElement.classList.contains('is-preloading')
    ? new Promise((resolve) => {
        document.addEventListener('preloader:complete', resolve, { once: true });
      })
    : Promise.resolve();

  /* Fisher-Yates. GSAP's `from: "random"` shuffles which element gets which
     stagger slot, not the spacing between slots — so the letters land in a
     scrambled order at an even cadence, which is what makes it read as a
     flicker rather than a wave. */
  function shuffled(length) {
    const order = Array.from({ length }, (_, i) => i);

    for (let i = order.length - 1; i > 0; i--) {
      // eslint-disable-next-line sonarjs/pseudo-random -- stagger order, not a security context
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    return order;
  }

  /*
   * Wraps each visual line of a paragraph so it can be moved on its own, and
   * hands back a function that puts the markup back exactly as it was.
   *
   * There is no CSS selector for "a line" — line boxes are a layout result, not
   * a tree structure — so the only way to address one is to measure where the
   * browser actually broke the text and rebuild around that. Words are wrapped,
   * grouped by the offsetTop they end up at, then replaced by one element per
   * group.
   *
   * The restore is not tidiness, it is the safety net. The split markup is
   * wrong for anything that outlives the animation: it fixes the line breaks at
   * the width they were measured, so a resize would leave the paragraph broken
   * mid-sentence. The reference reverts too, for the same reason.
   */
  function splitLines(el) {
    const original = el.innerHTML;
    const restore = () => {
      el.innerHTML = original;
    };

    const words = el.textContent.trim().split(/\s+/);
    if (words.length === 0) return { lines: [], restore };

    el.textContent = '';
    const probes = words.map((word, i) => {
      const probe = document.createElement('span');
      probe.textContent = i === 0 ? word : ` ${word}`;
      el.appendChild(probe);
      return probe;
    });

    /* One forced layout, then read every offsetTop against it. Grouping by the
       top edge is what identifies a line: every word the browser put on the
       same line shares one. */
    const groups = [];
    let top = null;

    for (const probe of probes) {
      if (probe.offsetTop !== top) {
        top = probe.offsetTop;
        groups.push([]);
      }
      groups[groups.length - 1].push(probe.textContent);
    }

    el.textContent = '';
    const lines = groups.map((words_) => {
      const line = document.createElement('span');
      line.className = 'hero__line';

      const text = document.createElement('span');
      text.className = 'hero__line-text';
      text.textContent = words_.join('').trim();

      line.appendChild(text);
      el.appendChild(line);
      return text;
    });

    return { lines, restore };
  }

  class BFHero extends HTMLElement {
    connectedCallback() {
      if (reduceMotion.matches) return;

      this.classList.add(CONCEALED_CLASS);
      preloaderDone.then(() => this.play());
    }

    play() {
      const letters = [...this.querySelectorAll(LETTER_SELECTOR)];
      const rule = this.querySelector(RULE_SELECTOR);
      const meta = [...this.querySelectorAll(META_SELECTOR)];
      const copy = this.querySelector(COPY_SELECTOR);

      /* Split before anything animates: it rewrites the paragraph and forces a
         layout, and doing that mid-flight would stutter every other movement. */
      const split = copy ? splitLines(copy) : { lines: [], restore: () => {} };

      const animations = [
        ...this.playLetters(letters),
        ...this.playRule(rule, letters.length),
        ...this.revealCopy(copy, letters.length),
        ...this.playMeta(meta, letters.length),
        ...this.playLines(split.lines, letters.length, meta.length),
      ];

      /*
       * Hold the animated values until every movement has landed, then drop the
       * starting pose and release them in the same task. Order matters: cancel
       * first and the concealed class would snap everything back for one frame
       * before the class came off.
       */
      Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(() => {
        this.classList.remove(CONCEALED_CLASS);
        for (const animation of animations) animation.cancel();
        split.restore();
      });
    }

    playLetters(letters) {
      /* Shuffled slots, even spacing — see shuffled(). */
      return shuffled(letters.length).map((index, slot) =>
        letters[index].animate(
          [{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }],
          {
            duration: LETTER_DURATION,
            delay: slot * LETTER_STAGGER,
            easing: EASE_QUART_OUT,
            fill: 'both',
          }
        )
      );
    }

    playRule(rule, letterCount) {
      if (!rule) return [];

      return [
        rule.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
          duration: RULE_DURATION,
          delay: ruleStart(letterCount),
          easing: EASE_EXPO_OUT,
          fill: 'both',
        }),
      ];
    }

    /*
     * Uncovers the statement's CONTAINER, so that the lines inside it have
     * something visible to rise into. This is the reference's
     * `.set('#hero-paragraph', {autoAlpha: 1}, '<')`, and dropping it is a
     * silent failure rather than a loud one: the lines still animate perfectly,
     * inside a parent at opacity 0, and the whole paragraph then appears at
     * once when the starting pose comes off at the end. It reads as no
     * animation at all.
     *
     * Nothing is visible in the gap this opens, because each line is still
     * translated fully below its own clipping wrapper until playLines moves it.
     *
     * A zero-length animation with `fill: 'forwards'` is the exact equivalent
     * of a GSAP `.set()` at a position: it applies nothing before its delay
     * elapses — leaving the CSS starting pose in charge — and holds afterwards.
     * `fill: 'both'` would be wrong here, since backwards-filling opacity 1
     * would uncover the paragraph from the very first frame.
     */
    revealCopy(copy, letterCount) {
      if (!copy) return [];

      return [
        copy.animate([{ opacity: 1 }, { opacity: 1 }], {
          duration: 0,
          delay: ruleStart(letterCount),
          fill: 'forwards',
        }),
      ];
    }

    playMeta(meta, letterCount) {
      /* Shares the rule's start — the reference's bare "<". */
      const start = ruleStart(letterCount);

      return meta.map((el, i) =>
        el.animate(
          [
            { opacity: 0, transform: `translateY(${META_RISE}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: META_DURATION,
            delay: start + i * META_STAGGER,
            easing: EASE_EXPO_OUT,
            fill: 'both',
          }
        )
      );
    }

    playLines(lines, letterCount, metaCount) {
      const metaTotal = META_DURATION + Math.max(metaCount - 1, 0) * META_STAGGER;
      const start = ruleStart(letterCount) + LINE_AT * metaTotal;

      return lines.map((line, i) =>
        line.animate(
          [
            { opacity: 0, transform: 'translateY(100%)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: LINE_DURATION,
            delay: start + i * LINE_STAGGER,
            easing: EASE_EXPO_OUT,
            fill: 'both',
          }
        )
      );
    }
  }

  /* 20% into the letters' TOTAL run, stagger included — see the file header. */
  function ruleStart(letterCount) {
    const lettersTotal = LETTER_DURATION + Math.max(letterCount - 1, 0) * LETTER_STAGGER;
    return RULE_AT * lettersTotal;
  }

  if (!customElements.get('bf-hero')) {
    customElements.define('bf-hero', BFHero);
  }
})();
