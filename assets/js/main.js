/* Flamme Up — mise en scène (port GSAP des springs de Dantora). */
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof window.gsap !== 'undefined';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  document.getElementById('year').textContent = new Date().getFullYear();

  if (hasGsap) gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

  /* ---------------------------------------------------------------- Scroll */
  let smoother = null;
  const headerOffset = () => (window.innerWidth >= 1024 ? 0 : 0);

  window.FlammeScroll = {
    pause(on) { if (smoother) smoother.paused(on); },
    to(target) {
      const el = typeof target === 'string' ? $(target) : target;
      if (!el) return;
      const go = () => {
        if (smoother) smoother.scrollTo(el, true, `top ${headerOffset()}px`);
        else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
      };
      // Laisse le temps à un panneau ouvert de se fermer (le scroll y est en pause).
      document.body.classList.contains('is-locked') ? setTimeout(go, 420) : go();
    },
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-scroll]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (!id || !id.startsWith('#')) return;
    e.preventDefault();
    closeMobileMenu();
    window.FlammeScroll.to(id);
  });

  /* ---------------------------------------------------------------- Menu mobile */
  const burger = $('#burger');
  const mobileMenu = $('#mobile-menu');
  function closeMobileMenu() {
    if (mobileMenu.hidden) return;
    mobileMenu.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Ouvrir le menu');
  }
  burger.addEventListener('click', () => {
    const open = mobileMenu.hidden;
    mobileMenu.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#mobile-menu, #burger')) closeMobileMenu(); });

  /* ---------------------------------------------------------------- Texte mot à mot */
  function splitWords(el) {
    if (el.dataset.split) return $$('.wi', el);
    el.dataset.split = '1';
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const i = document.createElement('span'); i.className = 'wi'; i.textContent = part;
            w.appendChild(i); frag.appendChild(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1) walk(child);
      });
    };
    walk(el);
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    return $$('.wi', el);
  }

  const WORD_FROM = { yPercent: 110, opacity: 0, filter: 'blur(10px)' };
  const WORD_TO = { yPercent: 0, opacity: 1, filter: 'blur(0px)', ease: 'power3.out' };

  function wordTween(el, delay = 0) {
    const words = splitWords(el);
    const heading = /^H[1-3]$/.test(el.tagName);
    gsap.set(words, WORD_FROM);
    return gsap.to(words, { ...WORD_TO, duration: heading ? 1 : 0.8, stagger: heading ? 0.055 : 0.02, delay, paused: true });
  }

  function setupReveals() {
    // Titres et paragraphes (hors hero, qui attend le rideau).
    $$('[data-words]').filter((el) => !el.closest('[data-hero]')).forEach((el) => {
      const tw = wordTween(el);
      ScrollTrigger.create({ trigger: el, start: 'top 88%', onEnter: () => tw.play(), onLeaveBack: () => tw.reverse() });
    });
    $$('[data-reveal]').forEach((el) => {
      gsap.set(el, { opacity: 0, y: 20, filter: 'blur(10px)' });
      ScrollTrigger.create({
        trigger: el, start: 'top 90%',
        onEnter: () => gsap.to(el, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease: 'power3.out' }),
        onLeaveBack: () => gsap.to(el, { opacity: 0, y: 20, filter: 'blur(10px)', duration: 0.4 }),
      });
    });
  }

  function heroEntrance() {
    const words = $$('[data-hero] [data-words]');
    words.forEach((el, i) => wordTween(el, i * 0.12).play());
    $$('[data-hero-el]').forEach((el) => {
      gsap.fromTo(el, { opacity: 0, y: 20, filter: 'blur(10px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: 'power3.out', delay: Number(el.dataset.heroEl) / 1000 + 0.15 });
    });
  }

  /* ---------------------------------------------------------------- Rail du menu (épinglé) */
  function setupTrack() {
    const runway = $('#track-runway');
    const stage = $('#track-stage');
    const track = $('#track');
    const OVERLAY = 1, DWELL = 1; // viewports : La maison glisse par-dessus pendant le dernier

    ScrollTrigger.create({ trigger: runway, start: 'top top', end: 'bottom bottom', pin: stage, pinSpacing: false });

    gsap.to(track, {
      x: () => -Math.max(track.scrollWidth - (stage.clientWidth - track.offsetLeft), 0),
      ease: 'none',
      scrollTrigger: {
        trigger: runway,
        start: 'top top',
        end: () => `+=${runway.offsetHeight - window.innerHeight * (1 + OVERLAY + DWELL)}`,
        scrub: 0.8,
        invalidateOnRefresh: true,
      },
    });
  }

  /* ---------------------------------------------------------------- Vidéo qui s'agrandit */
  function setupReel() {
    const video = $('#reel-video');
    const frame = $('#reel-frame');
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    video.src = mobile ? video.dataset.srcMobile : video.dataset.srcDesktop;

    // Lecture seulement quand la section est visible (batterie, données mobiles).
    video.muted = true;
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) video.play().catch(() => {}); else video.pause();
    }, { threshold: 0.05 }).observe(frame);

    if (!hasGsap || reduced) return;

    const from = mobile ? 'inset(24% 8% 24% 8% round 24px)' : 'inset(22% 28% 22% 28% round 24px)';
    const tl = gsap.timeline({
      scrollTrigger: { trigger: '#reel-stage', start: 'top top', end: '+=140%', pin: true, scrub: 0.6, anticipatePin: 1 },
    });
    tl.fromTo(frame, { clipPath: from }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', duration: 1 })
      .fromTo(video, { scale: 1.18 }, { scale: 1, ease: 'none', duration: 1 }, 0)
      .fromTo('#reel-caption', { opacity: 0, y: 30 }, { opacity: 1, y: 0, ease: 'power2.out', duration: 0.3 }, 0.75)
      .to({}, { duration: 0.25 }); // petite pause en plein écran avant de reprendre le scroll
  }

  /* ---------------------------------------------------------------- Bannière parallaxe */
  function setupBanner() {
    gsap.fromTo('#about-banner-inner', { yPercent: -12 }, {
      yPercent: 12, ease: 'none',
      scrollTrigger: { trigger: '#about-banner', start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }

  /* ---------------------------------------------------------------- Compteurs */
  function setupCounters() {
    $$('[data-count]').forEach((el) => {
      const m = /^(\D*)(\d+)(.*)$/.exec(el.dataset.count);
      if (!m) return;
      const [, pre, num, suf] = m;
      const obj = { v: 0 };
      el.setAttribute('aria-label', el.dataset.count);
      const render = () => { el.textContent = `${pre}${Math.round(obj.v)}${suf}`; };
      render();
      ScrollTrigger.create({
        trigger: el, start: 'top 90%',
        onEnter: () => gsap.to(obj, { v: Number(num), duration: 1.8, ease: 'power2.out', onUpdate: render }),
        onLeaveBack: () => gsap.to(obj, { v: 0, duration: 0.6, onUpdate: render }),
      });
    });
  }

  /* ---------------------------------------------------------------- Rail des sauces */
  function setupRail() {
    const rail = $('#rail');
    const fill = $('#rail-fill');
    const MIN = 0.3;
    let dragging = false, moved = false, startX = 0, startScroll = 0, target = null, vel = 0, lastX = 0, raf = 0;

    const sync = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max > 0) fill.style.transform = `scaleX(${MIN + (1 - MIN) * (rail.scrollLeft / max)})`;
    };
    const clamp = (v) => Math.min(Math.max(v, 0), rail.scrollWidth - rail.clientWidth);
    const loop = () => {
      raf = 0;
      if (target === null) return;
      const d = target - rail.scrollLeft;
      if (!dragging && Math.abs(d) < 0.5) { target = null; return; }
      rail.scrollLeft += d * 0.18;
      raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

    rail.addEventListener('scroll', sync, { passive: true });
    rail.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      dragging = true; moved = false;
      startX = lastX = e.clientX; startScroll = rail.scrollLeft; target = rail.scrollLeft; vel = 0;
      rail.setPointerCapture(e.pointerId); rail.classList.add('is-dragging');
      kick();
    });
    rail.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      vel = lastX - e.clientX; lastX = e.clientX;
      target = clamp(startScroll - dx);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false; rail.classList.remove('is-dragging');
      if (rail.hasPointerCapture(e.pointerId)) rail.releasePointerCapture(e.pointerId);
      target = clamp((target ?? rail.scrollLeft) + vel * 14);
      kick();
    };
    rail.addEventListener('pointerup', end);
    rail.addEventListener('pointercancel', end);
    rail.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    // Molette verticale → défilement horizontal seulement pendant un geste horizontal (trackpad).
    sync();

    if (hasGsap) {
      // Section épinglée : « Nous trouver » glisse par-dessus, comme dans Dantora.
      ScrollTrigger.create({ trigger: '#sauces', start: 'top top', end: '+=100%', pin: true, pinSpacing: false });
    }
  }

  /* ---------------------------------------------------------------- Traînée du curseur */
  /* ---------------------------------------------------------------- En-tête CTA */
  function setupHeaderCta() {
    const cta = $('.header-cta');
    new IntersectionObserver(([e]) => cta.classList.toggle('is-hidden', e.isIntersecting), { threshold: 0.35 }).observe($('#nous-trouver'));
  }

  function staggerGrid() {
    if (!hasGsap || reduced) return;
    gsap.fromTo('#menu-grid .item', { opacity: 0, y: 16, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.05, ease: 'back.out(1.4)', clearProps: 'transform' });
  }
  window.FlammeAnim = { staggerGrid };

  /* ---------------------------------------------------------------- Preloader */
  const pre = $('#preloader');
  const ring = $('#preloader-progress');
  const fillMark = $('#preloader-fill');
  const pct = $('#preloader-pct');
  const CIRC = 2 * Math.PI * 180;
  const prog = { v: 0 };
  const paint = () => {
    ring.style.strokeDashoffset = CIRC * (1 - prog.v);
    fillMark.style.clipPath = `inset(${(1 - prog.v) * 100}% 0 0 0)`;
    pct.textContent = `${Math.round(prog.v * 100)}%`;
  };
  document.body.classList.add('is-locked');
  const creep = hasGsap ? gsap.to(prog, { v: 0.85, duration: 2.6, ease: 'power1.out', onUpdate: paint }) : null;

  let firstFrame;
  const flameReady = new Promise((r) => { firstFrame = r; });
  $$('canvas[data-flame]').forEach((c) => {
    const isHero = c.dataset.flame === 'hero';
    // Canvas masqué (mobile) : pas de contexte WebGL, rien à rendre.
    if (!c.offsetParent) { if (isHero) firstFrame(); return; }
    const scene = window.FlameScene && window.FlameScene.createFlame(c, {
      scale: isHero ? 0.82 : 0.75,
      onFirstFrame: isHero ? firstFrame : null,
    });
    if (isHero && !scene) firstFrame();
  });

  const timeout = new Promise((r) => setTimeout(r, 3500));
  const loaded = Promise.all([window.FlammeOrder.ready, flameReady, document.fonts ? document.fonts.ready : null]);

  Promise.race([loaded, timeout]).then(async () => {
    const menu = window.FlammeOrder.menu;

    if (hasGsap) {
      // Smooth scroll sur toute la landing (bureau, tablette et mobile), sauf si l'utilisateur réduit les animations.
      if (!reduced) {
        smoother = ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1.2, effects: false, smoothTouch: 0.1 });
      }
      setupReel();
      setupTrack();
      setupBanner();
      setupCounters();
      setupReveals();
    }
    setupRail();
    setupHeaderCta();
    if (hasGsap) ScrollTrigger.refresh();

    // Deep link (#commander, etc.) une fois tout mesuré.
    if (location.hash && $(location.hash)) setTimeout(() => window.FlammeScroll.to(location.hash), 50);

    if (!hasGsap) { pre.remove(); document.body.classList.remove('is-locked'); return; }
    creep && creep.kill();
    gsap.to(prog, {
      v: 1, duration: 0.5, ease: 'power2.out', onUpdate: paint,
      onComplete: () => {
        let released = false;
        gsap.to(pre, {
          clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'power3.inOut', delay: 0.25,
          onUpdate() { if (!released && this.progress() > 0.45) { released = true; document.body.classList.remove('is-locked'); heroEntrance(); } },
          onComplete: () => pre.remove(),
        });
      },
    });
  });
})();
