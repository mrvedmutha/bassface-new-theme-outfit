/*
 * <bf-preloader> — port of the OUTFIT intro.
 *
 * Timeline, in absolute seconds from the master start (which is itself delayed
 * 0.4s). The reference expresses these as GSAP relative-position labels
 * ("<90%", "<30%", "<50%"); they resolve against the previous tween's *total*
 * duration including its stagger, which is why the wipe starts at 3.03 and not
 * 2.88.
 *
 *   0.00  cards    scale 0->1 + rotate random(-20,20), 0.6s quart.out, stagger 0.2 from start
 *   0.00  letters  translateY 110%->0, 0.6s quart.out, stagger 0.2 from random
 *   0.00  counter  000 -> 100, 3s circ.inOut
 *   2.70  counter  translateY 0->-100% + fade, 1s circ.inOut
 *   2.70  letters  translateY 0->-120%, 1.2s expo.inOut, stagger 0.08 from random
 *   2.70  cards    scale 1->0 + new random rotate, 0.6s expo.inOut, stagger 0.1 from end
 *   3.03  panel    clip-path inset bottom 0->100%, 1.4s cubic.inOut
 *   3.73  release  scroll unlocks, <html> gets .preloader-done
 *
 * Total ~4.83s. GSAP is vendored in this theme but deliberately not used here —
 * the whole thing is one rAF loop, which costs nothing and keeps the preloader
 * independent of library load order.
 */

class BFPreloader extends HTMLElement {
  static TIMING = {
    delay: 0.4,
    intro: 0.6,
    cardStagger: 0.2,
    letterStagger: 0.2,
    count: 3,
    countOut: 1,
    lettersOut: 1.2,
    lettersOutStagger: 0.08,
    cardsOut: 0.6,
    cardsOutStagger: 0.1,
    wipe: 1.4,
  };

  /* GSAP's power ladder is power1=quad, power2=cubic, power3=quart, so the
     reference's power3.out is quartic-out — not cubic-out. */
  static EASE = {
    quartOut: (t) => 1 - (1 - t) ** 4,
    cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    circInOut: (t) =>
      t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2,
    expoInOut: (t) => {
      if (t === 0 || t === 1) return t;
      return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
    },
  };

  connectedCallback() {
    this.panel = this.querySelector('.preloader');
    this.cardWrap = this.querySelector('.preloader__cards');
    this.mark = this.querySelector('.preloader__mark');
    this.counter = this.querySelector('.preloader__counter');
    if (!this.panel || !this.counter) return;

    this.cards = Array.from(this.querySelectorAll('.preloader__card'));
    this.letters = Array.from(this.querySelectorAll('.preloader__mark-letter'));
    this.tracks = [];
    this.calls = [];

    if (this.dataset.oncePerSession === 'true' && this.#alreadySeen()) {
      this.#release();
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#release();
      return;
    }

    this.#reset();
    this.#whenCardsReady().then(() => {
      setTimeout(() => this.#run(), BFPreloader.TIMING.delay * 1000);
    });
  }

  disconnectedCallback() {
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  #alreadySeen() {
    try {
      return sessionStorage.getItem('bf-preloaded') === '1';
    } catch {
      return false;
    }
  }

  /* Wait for the cards to decode, capped, so none pops in as an empty box. */
  #whenCardsReady() {
    const pending = this.cards.map((el) =>
      el.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            el.addEventListener('load', resolve, { once: true });
            el.addEventListener('error', resolve, { once: true });
          })
    );
    const cap = new Promise((resolve) => setTimeout(resolve, 2000));
    return Promise.race([Promise.all(pending), cap]);
  }

  #reset() {
    document.documentElement.classList.add('is-preloading');
    this.cardWrap?.classList.add('is-hidden');
    this.mark?.classList.add('is-hidden');
    this.cards.forEach((el) => this.#setCard(el, 0, 0));
    this.letters.forEach((el) => {
      el.style.transform = 'translateY(110%)';
    });
    this.counter.textContent = '000';
    window.scrollTo(0, 0);
  }

  #setCard(el, scale, rotate) {
    el.style.transform = `scale(${scale}) rotate(${rotate}deg)`;
  }

  #to(start, duration, ease, onUpdate) {
    this.tracks.push({ start, duration, ease, onUpdate, done: false });
    this.duration = Math.max(this.duration || 0, start + duration);
  }

  #call(start, fn) {
    this.calls.push({ start, fn, fired: false });
    this.duration = Math.max(this.duration || 0, start);
  }

  #run() {
    const T = BFPreloader.TIMING;
    const E = BFPreloader.EASE;
    // eslint-disable-next-line sonarjs/pseudo-random -- visual jitter on card tilt, not a security context
    const rand = (min, max) => Math.random() * (max - min) + min;
    const lerp = (a, b, p) => a + (b - a) * p;

    /* GSAP's `from: "random"` shuffles which element gets which stagger slot,
       not the spacing between slots. */
    const shuffled = (n) => {
      const a = Array.from({ length: n }, (_, i) => i);
      for (let i = a.length - 1; i > 0; i--) {
        // eslint-disable-next-line sonarjs/pseudo-random -- shuffles stagger order, not a security context
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const rotIn = this.cards.map(() => rand(-20, 20));
    const rotOut = this.cards.map(() => rand(-20, 20));

    const EXIT = T.count * 0.9;
    const cardsOutTotal = T.cardsOut + Math.max(this.cards.length - 1, 0) * T.cardsOutStagger;
    const wipeStart = EXIT + cardsOutTotal * 0.3;

    this.#call(0, () => {
      this.cardWrap?.classList.remove('is-hidden');
      this.mark?.classList.remove('is-hidden');
    });

    this.cards.forEach((el, i) => {
      this.#to(i * T.cardStagger, T.intro, E.quartOut, (e) =>
        this.#setCard(el, lerp(0, 1, e), lerp(0, rotIn[i], e))
      );
    });

    shuffled(this.letters.length).forEach((idx, slot) => {
      const el = this.letters[idx];
      this.#to(slot * T.letterStagger, T.intro, E.quartOut, (e) => {
        el.style.transform = `translateY(${lerp(110, 0, e)}%)`;
      });
    });

    this.#to(0, T.count, E.circInOut, (e) => {
      this.counter.textContent = String(Math.round(lerp(0, 100, e))).padStart(3, '0');
    });

    this.#to(EXIT, T.countOut, E.circInOut, (e) => {
      this.counter.style.transform = `translateY(${lerp(0, -100, e)}%)`;
      this.counter.style.opacity = String(lerp(1, 0, e));
    });

    shuffled(this.letters.length).forEach((idx, slot) => {
      const el = this.letters[idx];
      this.#to(EXIT + slot * T.lettersOutStagger, T.lettersOut, E.expoInOut, (e) => {
        el.style.transform = `translateY(${lerp(0, -120, e)}%)`;
      });
    });

    Array.from({ length: this.cards.length }, (_, i) => this.cards.length - 1 - i).forEach(
      (idx, slot) => {
        const el = this.cards[idx];
        this.#to(EXIT + slot * T.cardsOutStagger, T.cardsOut, E.expoInOut, (e) =>
          this.#setCard(el, lerp(1, 0, e), lerp(rotIn[idx], rotOut[idx], e))
        );
      }
    );

    this.#to(wipeStart, T.wipe, E.cubicInOut, (e) => {
      this.panel.style.clipPath = `inset(0 0 ${lerp(0, 100, e)}% 0)`;
    });

    this.#call(wipeStart + T.wipe * 0.5, () => this.#release());
    this.#call(this.duration, () => {
      this.panel.style.visibility = 'hidden';
      this.panel.style.pointerEvents = 'none';
    });

    this.#play();
  }

  #play() {
    let t0 = null;
    const frame = (now) => {
      if (t0 === null) t0 = now;
      const t = (now - t0) / 1000;

      for (const track of this.tracks) {
        if (t < track.start || track.done) continue;
        const p = track.duration > 0 ? Math.min((t - track.start) / track.duration, 1) : 1;
        track.onUpdate(track.ease(p));
        if (p === 1) track.done = true;
      }
      for (const call of this.calls) {
        if (!call.fired && t >= call.start) {
          call.fired = true;
          call.fn();
        }
      }

      if (t < this.duration) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  #release() {
    document.documentElement.classList.remove('is-preloading');
    document.documentElement.classList.add('preloader-done');
    try {
      sessionStorage.setItem('bf-preloaded', '1');
    } catch {
      /* private browsing — the preloader simply replays, which is harmless */
    }
    document.dispatchEvent(new CustomEvent('preloader:complete'));
  }
}

if (!customElements.get('bf-preloader')) {
  customElements.define('bf-preloader', BFPreloader);
}
