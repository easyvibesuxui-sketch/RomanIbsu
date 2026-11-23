/* ═══════════════════════════════════════════════════════════
   ვეფხისტყაოსანი — B version · a deck of pinned films
   ───────────────────────────────────────────────────────────
   Every act is a card on a sticky pin, all pins in one parent:

     rise   the card scrolls up from below, its film settling from
            a little large to rest as it comes
     hold   the card pins; its parts arrive one by one and a band of
            light crosses it, while scroll runs its film
     cover  the next card rises over it; it settles back and dims

   The pinning is the browser's own position:sticky — this script only
   sizes the holds and reads the scroll. Films NEVER play on their own:
   scroll writes video.currentTime, and nothing here calls play().
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── content ───────────────────────────────────────────── */
  // hold: how long the act stays pinned, in viewport heights of scroll
  // dust: how thick the gold motes hang over it
  // amb:  the page around the card, top and bottom
  var ACTS = [
    { hold: 2.0, dust: .35, amb: [[108,141,160], [141,124, 99]] },
    { hold: 2.2, dust: .45, amb: [[141,127, 99], [110, 91, 59]] },
    { hold: 2.2, dust: .60, amb: [[111,114,112], [114, 95, 65]] },
    { hold: 2.2, dust: .85, amb: [[146,147,145], [174,147,107]] },
    { hold: 1.4, dust: .20, amb: [[160,167,164], [160,160,157]] },
    { hold: 2.2, dust: .50, amb: [[110,111,111], [ 76, 81, 77]] },
    { hold: 2.2, dust: .40, amb: [[123,136,153], [131,120,105]] },
    { hold: 2.2, dust: .75, amb: [[107,109,112], [ 86, 84, 69]] },
    { hold: 2.2, dust: .95, amb: [[158,148,121], [118, 97, 58]] },
    { hold: 2.0, dust: .40, amb: [[136,156,170], [140,129,116]] },
    { hold: 0.6, dust: 0,   amb: [[226,210,178], [212,193,160]], paper: true }
  ];
  var ROMAN  = ['I', 'II', 'III', 'IV', 'IV', 'V', 'VI', 'VII', 'VIII', 'VIII', 'VIII'];
  var NAV_OF = [0, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7];   // act → nav button

  /* ── dom ───────────────────────────────────────────────── */
  var pins = [].slice.call(document.querySelectorAll('.pin'));
  var gaps = [].slice.call(document.querySelectorAll('.gap'));
  var hud = document.getElementById('hud');
  var hudFrame = document.getElementById('hudFrame');
  var meterFill = document.getElementById('meterFill');
  var actNow = document.getElementById('actNow');
  var navBtns = [].slice.call(document.querySelectorAll('.acts button'));
  var motes = document.getElementById('motes');
  var mctx = motes.getContext('2d');

  var N = pins.length;
  var cards = pins.map(function (pin) {
    var card = pin.querySelector('.card');
    var act = card.querySelector('.act');
    return {
      card: card,
      film: card.querySelector('.film'),
      flare: card.querySelector('.flare'),
      dim: card.querySelector('.dim'),
      parts: [].slice.call(act.querySelectorAll('[data-o]')).map(prepPart),
      loaded: false, want: 0, ease: 0
    };
  });

  /* ── helpers ───────────────────────────────────────────── */
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* ── geometry ──────────────────────────────────────────── */
  // One unit = one viewport height, held steady through mobile URL-bar
  // resizes so the page doesn't jump as the bar slides away.
  // top[i] is card i's natural place in the stack — the scroll position
  // at which it reaches the top of the screen and pins. It rises into
  // view over the one pin-height of scroll before that.
  var unit = 0, lastW = 0, pinH = 0, top = [], maxScroll = 1;
  function measure(force) {
    var w = innerWidth, h = innerHeight;
    if (force || w !== lastW || Math.abs(h - unit) >= 120) {
      lastW = w; unit = Math.max(h, 480);
      gaps.forEach(function (g, i) { g.style.height = Math.round(ACTS[i].hold * unit) + 'px'; });
    }
    pinH = pins[0].offsetHeight;
    var y = 0;
    for (var i = 0; i < N; i++) {
      top[i] = y;
      y += pinH + gaps[i].offsetHeight;
    }
    maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    sizeMotes();
  }
  function rise(i, y) { return i === 0 ? 1 : clamp01((y - (top[i] - pinH)) / pinH); }
  function holdLocal(i, y) { return (y - top[i]) / gaps[i].offsetHeight; }

  /* ── films ─────────────────────────────────────────────── */
  // H.264 decodes in hardware almost everywhere, which matters for
  // seeking; VP9 covers Chromium builds shipped without it.
  var VFMT = (function () {
    var v = document.createElement('video');
    if (v.canPlayType('video/mp4; codecs="avc1.640028"')) return 'mp4';
    if (v.canPlayType('video/webm; codecs="vp9"')) return 'webm';
    return null;
  })();
  var small = Math.min(innerWidth, innerHeight * 16 / 9) <= 760;

  // the still painting is the film's first frame: it holds the card
  // until the film has data, and is all that reduced motion shows
  cards.forEach(function (c) {
    if (c.film) c.film.poster = 'assets/img/' + c.film.dataset.name + (small ? '-m' : '') + '.webp';
  });

  function ensure(i) {
    var c = cards[i];
    if (!c || !c.film || c.loaded || reduced || !VFMT) return;
    c.loaded = true;
    c.film.preload = 'auto';
    c.film.src = 'assets/video/' + c.film.dataset.name + '.' + VFMT;
    c.film.addEventListener('seeked', kick);
    c.film.addEventListener('loadedmetadata', kick);
    c.film.load();                              // fetches data — never starts playback
  }

  // a film runs across the card's whole time on screen: from the moment
  // it starts to rise until the next card has fully covered it
  function filmProgress(i, y) {
    var a = i === 0 ? 0 : top[i] - pinH;
    var b = i < N - 1 ? top[i + 1] : top[i] + gaps[i].offsetHeight;
    return clamp01((y - a) / (b - a));
  }
  function scrub(i, y) {
    var c = cards[i], v = c.film;
    if (!v || !c.loaded || !v.duration || !isFinite(v.duration)) return false;
    c.want = filmProgress(i, y) * (v.duration - 0.05);
    c.ease += (c.want - c.ease) * 0.3;
    if (Math.abs(c.want - c.ease) < 0.004) c.ease = c.want;
    // a queued seek is still in flight — writing again just thrashes the decoder
    if (!v.seeking && Math.abs(v.currentTime - c.ease) >= 1 / 48) {
      try { v.currentTime = c.ease; } catch (e) { /* not seekable yet */ }
    }
    return c.ease !== c.want;
  }

  /* ── the words ─────────────────────────────────────────── */
  // An act's parts arrive once its card has pinned, in data-o order,
  // each with its own entrance (data-fx):
  //   rise     lifts in            num      settles out of a blur
  //   draw     a rule drawn L→R    blur     focuses in
  //   lines    each verse line rises out of its own line box
  //   letters  each glyph arrives on its own
  function prepPart(el) {
    var fx = el.dataset.fx || 'rise', subs = [];
    if (fx === 'lines') {
      var lines = el.innerHTML.split(/<br\s*\/?>/i);
      el.innerHTML = lines.map(function (h) { return '<span class="ln"><i>' + h.trim() + '</i></span>'; }).join('');
      subs = [].slice.call(el.querySelectorAll('.ln > i'));
    } else if (fx === 'letters') {
      var text = el.textContent;
      el.textContent = '';
      var sr = document.createElement('span');
      sr.className = 'sr'; sr.textContent = text;
      el.appendChild(sr);
      Array.from(text).forEach(function (ch) {
        var sp = document.createElement('span');
        sp.className = 'ch'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = ch;
        el.appendChild(sp); subs.push(sp);
      });
    }
    return { el: el, o: +el.dataset.o, fx: fx, subs: subs };
  }

  var bootT0 = performance.now();
  var START = 0.02, STEP = 0.065, WIN = 0.18;    // in units of the act's hold

  function setWords(i, clock) {
    var parts = cards[i].parts;
    for (var j = 0; j < parts.length; j++) {
      var P = parts[j], el = P.el;
      if (reduced) { el.style.opacity = '1'; continue; }
      var s0 = START + P.o * STEP;
      var a = smooth(s0, s0 + WIN, clock);

      if (P.fx === 'num') {
        el.style.opacity = (a * 0.92).toFixed(3);
        el.style.transform = 'translate3d(0,' + ((1 - a) * 12).toFixed(2) + 'px,0) scale(' + (1.08 - 0.08 * a).toFixed(4) + ')';
        el.style.filter = a < 0.999 ? 'blur(' + ((1 - a) * 9).toFixed(2) + 'px)' : '';
      } else if (P.fx === 'draw') {
        el.style.opacity = Math.min(1, a * 4).toFixed(3);
        el.style.transform = 'scaleX(' + easeOut(a).toFixed(4) + ')';
      } else if (P.fx === 'blur') {
        el.style.opacity = a.toFixed(3);
        el.style.transform = 'translate3d(0,' + ((1 - a) * 6).toFixed(2) + 'px,0)';
        el.style.filter = a < 0.999 ? 'blur(' + ((1 - a) * 5).toFixed(2) + 'px)' : '';
      } else if (P.fx === 'lines') {
        el.style.opacity = a > 0 ? '1' : '0';
        for (var li = 0; li < P.subs.length; li++) {
          var l0 = s0 + li * 0.06, la = smooth(l0, l0 + WIN, clock);
          P.subs[li].style.transform = 'translate3d(0,' + ((1 - easeOut(la)) * 108).toFixed(2) + '%,0)';
          P.subs[li].style.opacity = la.toFixed(3);
        }
      } else if (P.fx === 'letters') {
        el.style.opacity = a > 0 ? '1' : '0';
        var n = P.subs.length, per = n > 1 ? (WIN * 1.6) / (n - 1) : 0;
        for (var ci = 0; ci < n; ci++) {
          var c0 = s0 + ci * per, ca = smooth(c0, c0 + WIN * 0.8, clock);
          P.subs[ci].style.opacity = ca.toFixed(3);
          P.subs[ci].style.transform = 'translate3d(0,' + ((1 - ca) * 0.42).toFixed(3) + 'em,0)';
        }
      } else {
        el.style.opacity = a.toFixed(3);
        el.style.transform = 'translate3d(0,' + ((1 - a) * 14).toFixed(2) + 'px,0)';
      }
    }
  }

  /* ── one card's state ──────────────────────────────────── */
  // returns false when the card is fully covered and needn't be drawn
  function setCard(i, y) {
    var c = cards[i];
    var r = rise(i, y);                          // 0 → 1 as it comes up
    var cover = i < N - 1 ? rise(i + 1, y) : 0;  // 0 → 1 as the next one covers it
    var gone = cover >= 1 || r <= 0;
    c.card.classList.toggle('is-gone', gone);
    if (gone) return false;

    if (!reduced) {
      // settling back under the next card
      var k = easeOut(cover);
      c.card.style.transform = cover > 0
        ? 'translate3d(0,' + (-k * 2.2).toFixed(3) + '%,0) scale(' + (1 - 0.075 * k).toFixed(4) + ')'
        : '';
      c.dim.style.opacity = (cover * 0.62).toFixed(3);
      // the film settles as the card rises: a window, not a sticker
      if (c.film) {
        var e = easeOut(r);
        c.film.style.transform = r < 1
          ? 'translate3d(0,' + (-(1 - e) * 5).toFixed(3) + '%,0) scale(' + (1 + 0.14 * (1 - e)).toFixed(4) + ')'
          : '';
      }
      // once pinned, a band of light crosses the card
      if (c.flare) {
        var f = i === 0 ? -1 : holdLocal(i, y) / 0.5;
        if (f > 0 && f < 1) {
          c.flare.style.opacity = Math.sin(Math.PI * f).toFixed(3);
          c.flare.style.transform = 'translate3d(' + lerp(-110, 230, f).toFixed(1) + '%,0,0) skewX(-12deg)';
        } else c.flare.style.opacity = '0';
      }
    }

    // words: the prologue greets the reader on load; every other act
    // starts once its card is pinned
    var clock = i === 0 ? (performance.now() - bootT0) / 4200 : holdLocal(i, y);
    setWords(i, clock);
    return true;
  }

  /* ── ambient ground + chrome ───────────────────────────── */
  var root = document.documentElement.style;
  function pastel(c, k) { return [lerp(c[0], 248, k), lerp(c[1], 243, k), lerp(c[2], 236, k)]; }
  function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  // the top card (the one rising, or pinned) and how far it has risen
  function topCard(y) {
    for (var i = N - 1; i > 0; i--) { var r = rise(i, y); if (r > 0) return [i, r]; }
    return [0, 1];
  }

  var lastNav = -1;
  function setChrome(y) {
    var tc = topCard(y), i = tc[0], q = smooth(0.1, 0.9, tc[1]);
    var from = ACTS[Math.max(i - 1, 0)], to = ACTS[i];
    root.setProperty('--amb-top', rgb(pastel(mix(from.amb[0], to.amb[0], q), 0.52)));
    root.setProperty('--amb-bot', rgb(pastel(mix(from.amb[1], to.amb[1], q), 0.46)));

    var now = tc[1] > 0.5 ? i : Math.max(i - 1, 0);
    hud.classList.toggle('is-paper', !!ACTS[now].paper);
    var navI = NAV_OF[now];
    if (navI !== lastNav) {
      lastNav = navI;
      navBtns.forEach(function (b, k) { b.setAttribute('aria-current', k === navI ? 'true' : 'false'); });
      actNow.textContent = ROMAN[now];
    }
    meterFill.style.width = (clamp01(y / maxScroll) * 100).toFixed(2) + '%';
    return lerp(from.dust, to.dust, q);
  }

  /* ── gold motes ────────────────────────────────────────── */
  // Drawn over the pinned card's frame and carried by scroll, at two
  // depths — the near ones travel faster. They move only when you do.
  var MOTES = [];
  (function seed() {
    var s = 7;
    function rnd() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    for (var i = 0; i < 70; i++) {
      var near = i < 22;
      MOTES.push({ x: rnd(), y: rnd(), r: near ? 1.4 + rnd() * 1.8 : 0.7 + rnd() * 0.9,
                   v: near ? 0.55 + rnd() * 0.3 : 0.22 + rnd() * 0.15, ph: rnd() * 6.28, a: 0.35 + rnd() * 0.65 });
    }
  })();
  var mdpr = 1;
  function sizeMotes() {
    mdpr = Math.min(devicePixelRatio || 1, 2);
    motes.width = Math.round(innerWidth * mdpr);
    motes.height = Math.round(innerHeight * mdpr);
  }
  function drawMotes(y, dust) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, motes.width, motes.height);
    if (reduced || dust <= 0.01) return;
    var fr = hudFrame.getBoundingClientRect();
    mctx.setTransform(mdpr, 0, 0, mdpr, 0, 0);
    mctx.save();
    mctx.beginPath(); mctx.rect(fr.left, fr.top, fr.width, fr.height); mctx.clip();
    var t = y / unit;
    for (var i = 0; i < MOTES.length; i++) {
      var m = MOTES[i];
      var my = ((m.y - t * m.v * 0.35) % 1 + 1) % 1;
      var mx = m.x + Math.sin(t * 1.3 + m.ph) * 0.012;
      var px = fr.left + mx * fr.width, py = fr.top + my * fr.height;
      var a = m.a * dust * 0.75;
      var g = mctx.createRadialGradient(px, py, 0, px, py, m.r * 4);
      g.addColorStop(0, 'rgba(255,232,180,' + a.toFixed(3) + ')');
      g.addColorStop(0.25, 'rgba(255,214,140,' + (a * 0.45).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      mctx.fillStyle = g;
      mctx.fillRect(px - m.r * 4, py - m.r * 4, m.r * 8, m.r * 8);
    }
    mctx.restore();
  }

  /* ── loop ──────────────────────────────────────────────── */
  var raf = 0;
  function frame(now) {
    raf = 0;
    var y = scrollY, busy = false;
    var tc = topCard(y);

    // keep the films around the top card loaded, and scrub the ones on screen
    for (var k = tc[0] - 1; k <= tc[0] + 2; k++) ensure(k);
    for (var i = 0; i < N; i++) {
      if (setCard(i, y) && scrub(i, y)) busy = true;
    }
    drawMotes(y, setChrome(y));

    if (y < top[1] && now - bootT0 < 4400) busy = true;   // the prologue's own entrance
    if (busy) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ── navigation ────────────────────────────────────────── */
  function jumpTo(i) {
    var y = i === 0 ? 0 : top[i] + gaps[i].offsetHeight * 0.5;
    scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-jump]');
    if (!el) return;
    e.preventDefault();
    jumpTo(+el.dataset.jump);
  });

  /* ── boot ──────────────────────────────────────────────── */
  measure(true);
  ensure(0); ensure(1);
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', function () { measure(false); kick(); });
  addEventListener('load', function () { measure(false); kick(); });
  kick();

  // test hook: lets an automated check find each act's place
  window.__B = {
    top: function () { return top.slice(); }, pinH: function () { return pinH; },
    hold: function (i) { return gaps[i].offsetHeight; },
    state: function () {
      var y = scrollY, tc = topCard(y), c = cards[tc[0]], v = c.film;
      return { y: y, top: tc[0], rise: +tc[1].toFixed(3), fmt: VFMT,
               ft: v && c.loaded ? +v.currentTime.toFixed(3) : null, want: +c.want.toFixed(3) };
    }
  };
})();
