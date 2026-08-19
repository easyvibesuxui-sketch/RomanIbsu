/* ═══════════════════════════════════════════════════════════
   IBSU landing — scroll-owned motion
   ───────────────────────────────────────────────────────────
   The five background clips are contiguous slices of one
   master edit, so consecutive scenes line up frame-to-frame
   and the hand-off between them is invisible.

   Playback rule: this file NEVER calls video.play(). Frames
   advance only because scroll writes video.currentTime. Stop
   scrolling and the mosaic stops with you.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ── 1. scroll-driven stage ─────────────────────────────── */

  var chapters = [].slice.call(document.querySelectorAll('.chapter[data-scene]'));
  var scenes = [].slice.call(document.querySelectorAll('.scene'));
  var videos = scenes.map(function (s) { return s.querySelector('video'); });
  var railFill = document.getElementById('railFill');
  var railDots = [].slice.call(document.querySelectorAll('.rail__dots li'));

  // per-scene state
  var target = videos.map(function () { return 0; });   // where scroll wants the head
  var smooth = videos.map(function () { return 0; });   // eased head position
  var windows = [];                                     // [startPx, endPx] per scene
  var active = 0;
  var maxScroll = 0;

  function measure() {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    windows = chapters.map(function (ch, i) {
      var start = ch.offsetTop;
      var next = chapters[i + 1];
      // each scene owns the scroll band from its own top to the next chapter's
      // top; the last one runs out to the very bottom of the document.
      var end = next ? next.offsetTop : maxScroll;
      return [start, Math.max(start + 1, end)];
    });
  }

  // H.264 decodes in hardware almost everywhere, which matters for seeking;
  // VP9 covers the Chromium builds shipped without proprietary codecs.
  var pickFormat = (function () {
    var probe = document.createElement('video');
    return probe.canPlayType('video/mp4; codecs="avc1.42E01E"') ? 'mp4' : 'webm';
  })();

  // give a video its source only when it is nearly needed
  function ensureLoaded(i) {
    var v = videos[i];
    if (!v || v.src) return;
    var url = v.dataset[pickFormat] || v.dataset.mp4;
    if (!url) return;
    v.src = url;
    v.load();                       // loads data — does not start playback
  }

  function readScroll() {
    var y = window.scrollY || window.pageYOffset;
    var next = 0;

    for (var i = 0; i < windows.length; i++) {
      var w = windows[i];
      var p = clamp((y - w[0]) / (w[1] - w[0]), 0, 1);
      var v = videos[i];
      var dur = v && v.duration;
      target[i] = (dur && isFinite(dur) ? dur : 1) * p;
      if (y >= w[0]) next = i;
    }

    if (next !== active) {
      scenes[active].classList.remove('is-active');
      scenes[next].classList.add('is-active');
      railDots.forEach(function (d, i) { d.classList.toggle('on', i === next); });
      active = next;
    }

    // keep the neighbours warm so a scene is already on the right
    // frame by the time it fades in
    ensureLoaded(active);
    ensureLoaded(active + 1);
    ensureLoaded(active - 1);

    if (railFill) railFill.style.height = (clamp(y / maxScroll, 0, 1) * 100) + '%';
  }

  function scrub() {
    // only the visible scene and its immediate neighbours are worth seeking
    for (var i = Math.max(0, active - 1); i <= Math.min(videos.length - 1, active + 1); i++) {
      var v = videos[i];
      if (!v || !v.duration || v.readyState < 1) continue;

      smooth[i] += (target[i] - smooth[i]) * 0.16;

      // a queued seek is still in flight — writing again just thrashes the decoder
      if (v.seeking) continue;
      if (Math.abs(v.currentTime - smooth[i]) < 1 / 40) continue;

      try {
        v.currentTime = clamp(smooth[i], 0, v.duration - 0.001);
      } catch (e) { /* not seekable yet */ }
    }
  }

  /* ── 2. parallax numerals ───────────────────────────────── */

  var parallax = [].slice.call(document.querySelectorAll('[data-par]'));

  function drift() {
    var vh = window.innerHeight;
    parallax.forEach(function (el) {
      var host = el.closest('.chapter');
      if (!host) return;
      var r = host.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) return;
      var mid = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.transform = 'translate3d(0,' + (mid * parseFloat(el.dataset.par) * -170).toFixed(1) + 'px,0)';
    });
  }

  /* ── 3. frame loop ──────────────────────────────────────── */

  var queued = false;

  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      readScroll();
      if (!reduced) drift();
      nav.classList.toggle('is-stuck', (window.scrollY || 0) > 24);
    });
  }

  function loop() {
    if (!reduced) scrub();
    requestAnimationFrame(loop);
  }

  /* ── 4. navigation ──────────────────────────────────────── */

  var nav = document.getElementById('nav');
  var toggle = document.getElementById('navToggle');

  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('.nav__links a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── 5. reveals ─────────────────────────────────────────── */

  var revealTargets = [].slice.call(document.querySelectorAll('.reveal, .stagger'));

  if (reduced || !('IntersectionObserver' in window)) {
    revealTargets.forEach(function (el) { el.classList.add('in'); });
  } else {
    // stagger children get an incremental delay
    document.querySelectorAll('.stagger').forEach(function (group) {
      [].slice.call(group.children).forEach(function (child, i) {
        child.style.setProperty('--rd', (i * 110) + 'ms');
      });
    });
    document.querySelectorAll('.reveal[data-d]').forEach(function (el) {
      el.style.setProperty('--rd', el.dataset.d + 'ms');
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

    revealTargets.forEach(function (el) { io.observe(el); });
  }

  /* ── 6. cursor-tracked bloom on glass ───────────────────── */

  if (!reduced && window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.tilt').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ── 7. boot ────────────────────────────────────────────── */

  videos.forEach(function (v, i) {
    if (!v) return;
    v.addEventListener('loadedmetadata', function () {
      // land straight on the frame the current scroll position asks for
      readScroll();
      smooth[i] = target[i];
      try { v.currentTime = clamp(target[i], 0, v.duration - 0.001); } catch (e) {}
    });
  });

  measure();
  readScroll();
  drift();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); readScroll(); drift(); });
  window.addEventListener('load', function () { measure(); readScroll(); });

  requestAnimationFrame(loop);
})();
