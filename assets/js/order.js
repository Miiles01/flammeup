/* Flamme Up — commande en ligne, paiement au comptoir.
   Charge le menu depuis l'API, rend les cartes, gère le panier, le formulaire
   et le suivi de la commande. Aucune donnée de paiement ne transite ici. */
(function () {
  const API = 'api/';
  const CART_KEY = 'flamme_cart_v1';
  const LAST_KEY = 'flamme_last_order_v1';

  const CATEGORIES = {
    ailes: 'Ailes & tenders',
    burgers: 'Burgers',
    tacos: 'Tacos',
    frites: 'Frites & poutine',
    combos: 'Combos',
    boissons: 'Boissons',
  };

  // Photo d'un produit : « unsplash:<id> » (CDN Unsplash) ou chemin local (assets/img/…).
  const photo = (src, w) => {
    if (!src) return '';
    if (src.startsWith('unsplash:')) return `https://images.unsplash.com/${src.slice(9)}?auto=format&fit=crop&w=${w}&q=70`;
    return src;
  };
  const imgTag = (src, w, alt, cls = '') => src
    ? `<img class="${cls}" src="${photo(src, w)}" srcset="${photo(src, w)} 1x, ${photo(src, w * 2)} 2x" alt="${esc(alt)}" loading="lazy" decoding="async">`
    : '';
  const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const STATUS_STEPS = [
    ['new', 'Reçue'],
    ['preparing', 'Sur le grill'],
    ['ready', 'Prête'],
  ];

  const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const fmt = (cents) => money.format(cents / 100);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const heatIcons = (n) => Array.from({ length: 5 }, (_, i) => `<svg aria-hidden="true" class="${i < n ? '' : 'off'}"><use href="#i-flame-solid"/></svg>`).join('');
  const timeFr = (hhmm) => hhmm.replace(':', ' h ');
  const isDark = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  };

  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée */ } },
  };

  const state = {
    menu: null,
    cart: store.get(CART_KEY, []),
    filter: 'tout',
    step: 'cart',
    sheet: null,
    form: { name: '', phone: '', pickup: '', note: '' },
    submitting: false,
    error: null,
    fieldErrors: {},
    tracking: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const productById = (id) => state.menu.products.find((p) => p.id === id);
  const sauceById = (id) => state.menu.sauces.find((s) => s.id === id);

  /* ---------------------------------------------------------------- Toast */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.innerHTML = `${icon('i-check')}<span>${esc(msg)}</span>`;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2400);
  }

  /* ---------------------------------------------------------------- Rendu menu */
  function addButton(p, variant) {
    const label = p.available ? `Ajouter ${p.name}` : `${p.name} — épuisé`;
    if (variant === 'ring') {
      return `<button type="button" class="ring ring--add" data-add="${p.id}" aria-label="${esc(label)}" ${p.available ? '' : 'disabled'}>${icon('i-plus')}</button>`;
    }
    return p.available
      ? `<button type="button" class="btn btn--primary add-btn" data-add="${p.id}" aria-label="${esc(label)}">${icon('i-plus')}<span>Ajouter</span></button>`
      : `<span class="btn btn--ghost add-btn" aria-disabled="true">Épuisé</span>`;
  }

  function renderTrack() {
    const track = $('#track');
    const featured = state.menu.products.filter((p) => p.featured);
    const variants = ['ember', 'ink', 'ember', 'ink', 'ember'];
    track.insertAdjacentHTML('beforeend', featured.map((p, i) => {
      const v = p.image ? 'photo' : variants[i % variants.length];
      return `
        <article class="card card--${v}">
          ${p.image ? imgTag(p.image, 520, '') : '<span class="card__glow" aria-hidden="true"></span>'}
          <div class="card__top">
            <p class="card__index">${String(i + 2).padStart(2, '0')}</p>
            <h3 class="card__title">${esc(p.name)}</h3>
            <p class="card__desc">${esc(p.description)}</p>
          </div>
          <div class="card__bottom">
            <p class="card__price"><small>${p.available ? (p.has_sauce ? 'Sauce au choix' : 'À emporter') : 'Épuisé aujourd’hui'}</small>${fmt(p.price_cents)}</p>
            ${addButton(p, 'ring')}
          </div>
        </article>`;
    }).join(''));
  }

  function renderFilters() {
    const cats = ['tout', ...Object.keys(CATEGORIES).filter((c) => state.menu.products.some((p) => p.category === c))];
    $('#filters').innerHTML = cats.map((c) => `
      <button type="button" role="tab" class="filter" data-filter="${c}" aria-selected="${state.filter === c}">${c === 'tout' ? 'Tout le menu' : CATEGORIES[c]}</button>`).join('');
  }

  function renderGrid() {
    const list = state.menu.products.filter((p) => state.filter === 'tout' || p.category === state.filter);
    $('#menu-grid').innerHTML = list.length ? list.map((p) => `
      <article class="item ${p.available ? '' : 'is-soldout'}">
        ${p.image ? `<div class="item__media">${imgTag(p.image, 480, p.name)}</div>` : ''}
        <div class="item__text">
          <p class="item__cat">${CATEGORIES[p.category] || ''}${p.has_sauce ? ' · sauce au choix' : ''}</p>
          <h3 class="item__name">${esc(p.name)}</h3>
          <p class="item__desc">${esc(p.description)}</p>
        </div>
        <div class="item__foot">
          <p class="item__price">${fmt(p.price_cents)}</p>
          ${addButton(p)}
        </div>
      </article>`).join('') : '<p class="menu-empty">Rien dans cette catégorie pour le moment.</p>';
  }

  function renderSauces() {
    const more = document.querySelector('.sauce-more');
    more.insertAdjacentHTML('beforebegin', state.menu.sauces.map((s, i) => `
      <article class="sauce ${isDark(s.color) ? 'is-dark' : ''}" style="background:${esc(s.color)}">
        <span class="sauce__drop" aria-hidden="true"></span>
        <div>
          <p class="sauce__num">${String(i + 1).padStart(2, '0')}</p>
          <h3 class="sauce__name" style="margin-top:1.5rem">${esc(s.name)}</h3>
          <p class="sauce__desc">${esc(s.description)}</p>
        </div>
        <div class="sauce__plate">
          <span>${s.available ? 'Piquant' : 'Épuisée aujourd’hui'}</span>
          <span class="heat" aria-label="Piquant ${s.heat} sur 5">${heatIcons(s.heat)}</span>
        </div>
      </article>`).join(''));

    $('#hero-chips').innerHTML = state.menu.sauces.slice(0, 5).map((s) => `<li>${esc(s.name)}</li>`).join('');
  }

  function renderStore() {
    const st = state.menu.store;
    const el = $('#store-status');
    el.classList.remove('is-open', 'is-closed');
    let text;
    if (!st.accepting) { text = 'Commandes en ligne en pause — appelez-nous'; el.classList.add('is-closed'); }
    else if (st.open_now) { text = `Ouvert · prêt en ~${st.prep_minutes} min`; el.classList.add('is-open'); }
    else if (st.slots.length) { text = `Fermé pour l’instant · commandez pour ${timeFr(st.slots[0])} ou plus tard`; el.classList.add('is-closed'); }
    else { text = 'Fermé pour aujourd’hui · à bientôt'; el.classList.add('is-closed'); }
    el.lastElementChild.textContent = text;

    // Heures, lundi en premier.
    const order = [1, 2, 3, 4, 5, 6, 0];
    $('#hours').innerHTML = order.map((d) => {
      const h = st.hours[d];
      return `<li class="${d === st.today ? 'is-today' : ''}"><span>${DAYS[d]}</span><span>${h ? `${timeFr(h[0])} – ${timeFr(h[1])}` : 'Fermé'}</span></li>`;
    }).join('');
  }

  /* ---------------------------------------------------------------- Panier */
  const cartCount = () => state.cart.reduce((n, l) => n + l.qty, 0);
  const cartLines = () => state.cart.map((l) => ({ ...l, product: productById(l.id), sauce: l.sauce ? sauceById(l.sauce) : null })).filter((l) => l.product);
  const subtotal = () => cartLines().reduce((s, l) => s + l.product.price_cents * l.qty, 0);

  let lastCount = null;
  function saveCart() {
    store.set(CART_KEY, state.cart);
    const n = cartCount();
    const bump = lastCount !== null && n > lastCount;
    lastCount = n;
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.classList.toggle('is-visible', n > 0);
      el.classList.remove('is-bump');
      if (bump) { void el.offsetWidth; el.classList.add('is-bump'); }
    });
  }

  function addToCart(id, sauce, qty) {
    const key = `${id}|${sauce || ''}`;
    const line = state.cart.find((l) => `${l.id}|${l.sauce || ''}` === key);
    if (line) line.qty = Math.min(20, line.qty + qty);
    else state.cart.push({ id, sauce: sauce || null, qty });
    saveCart();
    const p = productById(id);
    toast(`${qty} × ${p.name} ajouté${qty > 1 ? 's' : ''}`);
    if (state.step !== 'done' && isOpen('#drawer')) renderDrawer();
  }

  /* ---------------------------------------------------------------- Overlays */
  let lastFocus = null;
  const isOpen = (sel) => $(sel).classList.contains('is-open');

  function openOverlay(sel, focusSel) {
    const el = $(sel);
    lastFocus = document.activeElement;
    el.hidden = false;
    document.body.classList.add('is-locked');
    window.FlammeScroll && window.FlammeScroll.pause(true);
    requestAnimationFrame(() => {
      el.classList.add('is-open');
      const f = el.querySelector(focusSel || 'button, input, select');
      f && f.focus({ preventScroll: true });
    });
  }
  function closeOverlay(sel) {
    const el = $(sel);
    if (el.hidden) return;
    el.classList.remove('is-open');
    setTimeout(() => {
      el.hidden = true;
      if ($('#drawer').hidden && $('#sheet').hidden) {
        document.body.classList.remove('is-locked');
        window.FlammeScroll && window.FlammeScroll.pause(false);
      }
    }, 380);
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- Choix de sauce */
  function openSheet(id) {
    const p = productById(id);
    state.sheet = { id, qty: 1, sauce: null };
    $('#sheet-title').textContent = p.name;
    $('#sheet-desc').textContent = p.description;
    $('#sheet-qty').textContent = '1';
    const legend = '<legend class="visually-hidden">Sauce</legend>';
    $('#sauce-pick').innerHTML = legend + state.menu.sauces.map((s) => `
      <div class="sauce-opt">
        <input type="radio" name="sauce" id="s-${s.id}" value="${s.id}" ${s.available ? '' : 'disabled'}>
        <label for="s-${s.id}">
          <span class="sauce-opt__swatch" style="background:${esc(s.color)}"></span>
          <span><span class="sauce-opt__name">${esc(s.name)}</span><span class="sauce-opt__desc">${s.available ? esc(s.description) : 'Épuisée aujourd’hui'}</span></span>
          <span class="heat" aria-label="Piquant ${s.heat} sur 5">${heatIcons(s.heat)}</span>
        </label>
      </div>`).join('');
    updateSheetButton();
    openOverlay('#sheet', 'input[name="sauce"]:not(:disabled)');
  }

  function updateSheetButton() {
    const s = state.sheet;
    const p = productById(s.id);
    const btn = $('#sheet-add');
    btn.disabled = !s.sauce;
    btn.textContent = s.sauce ? `Ajouter · ${fmt(p.price_cents * s.qty)}` : 'Choisissez une sauce';
  }

  /* ---------------------------------------------------------------- Tiroir */
  function stepsBar(n) {
    return `<div class="steps-bar" aria-hidden="true">${[1, 2, 3].map((i) => `<span class="${i <= n ? 'is-on' : ''}"></span>`).join('')}</div>`;
  }

  function totalsHtml() {
    const sub = subtotal();
    const rate = state.menu.store.tax_rate;
    const tax = Math.round(sub * rate);
    return `
      <div class="totals">
        <div><span>Sous-total</span><span>${fmt(sub)}</span></div>
        ${rate ? `<div><span>Taxes (TPS + TVQ)</span><span>${fmt(tax)}</span></div>` : ''}
        <div class="totals__grand"><span>Total à payer au comptoir</span><span>${fmt(sub + tax)}</span></div>
      </div>`;
  }

  function renderDrawer() {
    const body = $('#drawer-body');
    const title = $('#drawer-title');

    if (state.step === 'done' && state.tracking) { title.textContent = 'Merci !'; body.innerHTML = doneHtml(); return; }

    const lines = cartLines();
    if (!lines.length) {
      state.step = 'cart';
      title.textContent = 'Ma commande';
      const last = store.get(LAST_KEY, null);
      body.innerHTML = `
        <div class="empty">
          <span class="empty__icon">${icon('i-bag')}</span>
          <p>Votre commande est vide. Ajoutez des ailes, on s’occupe du feu.</p>
          <a href="#commander" class="btn btn--primary" data-close-cart data-scroll>Voir le menu</a>
          ${last ? '<button type="button" class="line__remove" data-view-last>Suivre ma dernière commande</button>' : ''}
        </div>`;
      return;
    }

    if (state.step === 'cart') {
      title.textContent = 'Ma commande';
      body.innerHTML = `
        ${stepsBar(1)}
        <div class="drawer__section">
          ${lines.map((l, i) => `
            <div class="line">
              <div>
                <p class="line__name">${esc(l.product.name)}</p>
                ${l.sauce ? `<p class="line__sauce">Sauce ${esc(l.sauce.name)}</p>` : ''}
              </div>
              <p class="line__price">${fmt(l.product.price_cents * l.qty)}</p>
              <div class="line__ctrl">
                <div class="stepper stepper--sm" aria-label="Quantité de ${esc(l.product.name)}">
                  <button type="button" class="stepper__btn" data-line="${i}" data-delta="-1" aria-label="Retirer un">${icon('i-minus')}</button>
                  <output class="stepper__val">${l.qty}</output>
                  <button type="button" class="stepper__btn" data-line="${i}" data-delta="1" aria-label="Ajouter un">${icon('i-plus')}</button>
                </div>
                <button type="button" class="line__remove" data-remove="${i}">Retirer</button>
              </div>
            </div>`).join('')}
        </div>
        <div class="drawer__foot">
          ${totalsHtml()}
          <p class="pay-note">${icon('i-clock')}<span>Aucun paiement en ligne. Vous payez au comptoir en récupérant votre commande.</span></p>
          <button type="button" class="btn btn--primary btn--block" data-next="details" ${state.menu.store.accepting ? '' : 'disabled'}>${state.menu.store.accepting ? 'Continuer' : 'Commandes en ligne en pause'}</button>
        </div>`;
      return;
    }

    // Étape coordonnées + heure de ramassage.
    title.textContent = 'Ramassage';
    const st = state.menu.store;
    const f = state.form;
    const fe = state.fieldErrors;
    if (!f.pickup) f.pickup = st.asap_available ? 'asap' : (st.slots[0] || '');
    const later = f.pickup !== 'asap';
    const noSlots = !st.asap_available && !st.slots.length;

    body.innerHTML = `
      ${stepsBar(2)}
      <form class="form" id="checkout" novalidate>
        ${state.error ? `<p class="form-error" role="alert">${esc(state.error)}</p>` : ''}
        <div class="field">
          <label for="f-name">Prénom</label>
          <input class="input" id="f-name" name="name" autocomplete="given-name" required maxlength="60" value="${esc(f.name)}" ${fe.name ? 'aria-invalid="true" aria-describedby="e-name"' : ''}>
          ${fe.name ? `<p class="field__error" id="e-name">${esc(fe.name)}</p>` : ''}
        </div>
        <div class="field">
          <label for="f-phone">Téléphone</label>
          <input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required value="${esc(f.phone)}" ${fe.phone ? 'aria-invalid="true" aria-describedby="e-phone"' : 'aria-describedby="h-phone"'}>
          ${fe.phone ? `<p class="field__error" id="e-phone">${esc(fe.phone)}</p>` : '<p class="field__hint" id="h-phone">Seulement pour vous joindre au besoin.</p>'}
        </div>
        <fieldset class="field">
          <legend>Heure de ramassage</legend>
          ${noSlots ? '<p class="form-error">Plus de créneaux aujourd’hui. Revenez demain !</p>' : `
          <div class="pickup-opts" style="margin-top:.5rem">
            <div class="pickup-opt">
              <input type="radio" name="when" id="w-asap" value="asap" ${!later ? 'checked' : ''} ${st.asap_available ? '' : 'disabled'}>
              <label for="w-asap"><span>Dès que possible</span><small>${st.asap_available ? `~${st.prep_minutes} min` : 'Fermé en ce moment'}</small></label>
            </div>
            <div class="pickup-opt">
              <input type="radio" name="when" id="w-later" value="later" ${later ? 'checked' : ''} ${st.slots.length ? '' : 'disabled'}>
              <label for="w-later"><span>Plus tard</span><small>Aujourd’hui</small></label>
            </div>
          </div>
          <select class="input" id="f-slot" name="slot" aria-label="Choisir l’heure" style="margin-top:.5rem" ${later ? '' : 'hidden'}>
            ${st.slots.map((s) => `<option value="${s}" ${f.pickup === s ? 'selected' : ''}>${timeFr(s)}</option>`).join('')}
          </select>`}
          ${fe.pickup ? `<p class="field__error">${esc(fe.pickup)}</p>` : ''}
        </fieldset>
        <div class="field">
          <label for="f-note">Note pour la cuisine <span class="opt">(facultatif)</span></label>
          <textarea class="input" id="f-note" name="note" maxlength="280" rows="2" placeholder="Allergies, sauce à part…">${esc(f.note)}</textarea>
        </div>
      </form>
      <div class="drawer__foot">
        ${totalsHtml()}
        <button type="submit" form="checkout" class="btn btn--primary btn--block" ${state.submitting || noSlots ? 'disabled' : ''}>${state.submitting ? 'Envoi…' : 'Confirmer · payer au comptoir'}</button>
        <button type="button" class="btn btn--ghost btn--block" data-next="cart">Retour au panier</button>
      </div>`;
  }

  function doneHtml() {
    const o = state.tracking;
    const at = o.pickup_at ? o.pickup_at.slice(11, 16) : '';
    const idx = STATUS_STEPS.findIndex(([k]) => k === o.status);
    const statusLine = o.status === 'cancelled'
      ? '<p class="form-error">Cette commande a été annulée. Appelez-nous pour toute question.</p>'
      : o.status === 'picked_up'
        ? '<p class="pay-note">' + icon('i-check') + '<span>Commande récupérée. Bon appétit !</span></p>'
        : `<ol class="track-status" aria-label="Suivi">${STATUS_STEPS.map(([k, label], i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}">${label}</li>`).join('')}</ol>`;

    return `
      ${stepsBar(3)}
      <div class="done">
        <div class="done__ticket">
          <p class="done__label">Votre numéro de commande</p>
          <p class="done__number">n° ${esc(o.number)}</p>
          <p class="done__when">${o.asap ? `Prête vers ${timeFr(at)}` : `Ramassage à ${timeFr(at)}`} · au nom de ${esc(o.customer_name)}</p>
        </div>
        ${statusLine}
        <div class="done__lines">
          ${(o.items || []).map((it) => `<div><span>${it.qty} × ${esc(it.name)}${it.sauce ? ` · ${esc(it.sauce)}` : ''}</span><span>${fmt(it.total_cents)}</span></div>`).join('')}
          <div style="font-weight:600;padding-top:.375rem"><span>Total à payer au comptoir</span><span>${fmt(o.total_cents)}</span></div>
        </div>
        <p class="pay-note">${icon('i-pin')}<span>Donnez votre numéro au comptoir et payez sur place : comptant, débit ou crédit.</span></p>
        <button type="button" class="btn btn--secondary btn--block" data-new-order>Nouvelle commande</button>
      </div>`;
  }

  /* ---------------------------------------------------------------- Envoi */
  async function submitOrder() {
    const f = state.form;
    state.fieldErrors = {};
    if (f.name.trim().length < 2) state.fieldErrors.name = 'Indiquez votre prénom.';
    if (f.phone.replace(/\D/g, '').length < 10) state.fieldErrors.phone = 'Entrez un numéro à 10 chiffres.';
    if (Object.keys(state.fieldErrors).length) {
      state.error = null; renderDrawer();
      const first = $('#drawer [aria-invalid="true"]'); first && first.focus();
      return;
    }

    state.submitting = true; state.error = null; renderDrawer();
    try {
      const res = await fetch(API + 'order.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, phone: f.phone, note: f.note, pickup: f.pickup, items: state.cart }),
      });
      const data = await res.json();
      if (!res.ok) {
        state.error = data.error || 'Une erreur est survenue.';
        state.fieldErrors = data.fields || {};
        if (res.status === 409) refreshMenu();
        return;
      }
      store.set(LAST_KEY, { token: data.token, at: Date.now() });
      state.cart = []; saveCart();
      state.form.note = ''; state.form.pickup = '';
      state.step = 'done';
      await loadTracking(data.token);
    } catch {
      state.error = 'Connexion impossible. Vérifiez votre réseau et réessayez.';
    } finally {
      state.submitting = false;
      renderDrawer();
      $('#drawer-body').scrollTop = 0;
    }
  }

  let pollTimer;
  async function loadTracking(token) {
    try {
      const res = await fetch(`${API}order.php?t=${encodeURIComponent(token)}`);
      if (!res.ok) return false;
      state.tracking = await res.json();
      clearTimeout(pollTimer);
      if (['new', 'preparing', 'ready'].includes(state.tracking.status)) {
        pollTimer = setTimeout(async () => { if (state.step === 'done') { await loadTracking(token); renderDrawer(); } }, 15000);
      }
      return true;
    } catch { return false; }
  }

  async function refreshMenu() {
    try {
      const res = await fetch(API + 'menu.php');
      state.menu = await res.json();
      state.cart = state.cart.filter((l) => productById(l.id));
      saveCart(); renderGrid(); renderStore(); renderDrawer();
    } catch { /* garde l'état courant */ }
  }

  /* ---------------------------------------------------------------- Événements */
  function bind() {
    document.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-add],[data-open-cart],[data-close-cart],[data-close-sheet],[data-filter],[data-step],[data-line],[data-remove],[data-next],[data-new-order],[data-view-last]');
      if (!t) return;

      if (t.dataset.add) {
        const p = productById(t.dataset.add);
        if (!p || !p.available) return;
        if (p.has_sauce) openSheet(p.id); else addToCart(p.id, null, 1);
      } else if (t.hasAttribute('data-open-cart')) {
        if (state.step === 'done' && !state.cart.length) { /* garde la confirmation */ } else if (state.step === 'done') state.step = 'cart';
        renderDrawer(); openOverlay('#drawer', '.drawer__head button');
      } else if (t.hasAttribute('data-close-cart')) {
        closeOverlay('#drawer');
      } else if (t.hasAttribute('data-close-sheet')) {
        closeOverlay('#sheet');
      } else if (t.dataset.filter) {
        state.filter = t.dataset.filter; renderFilters(); renderGrid();
        window.FlammeAnim && window.FlammeAnim.staggerGrid();
      } else if (t.dataset.step) {
        state.sheet.qty = Math.max(1, Math.min(20, state.sheet.qty + Number(t.dataset.step)));
        $('#sheet-qty').textContent = state.sheet.qty; updateSheetButton();
      } else if (t.dataset.line) {
        const line = state.cart[Number(t.dataset.line)];
        line.qty += Number(t.dataset.delta);
        if (line.qty < 1) state.cart.splice(Number(t.dataset.line), 1);
        if (line.qty > 20) line.qty = 20;
        saveCart(); renderDrawer();
      } else if (t.dataset.remove) {
        state.cart.splice(Number(t.dataset.remove), 1); saveCart(); renderDrawer();
      } else if (t.dataset.next) {
        state.step = t.dataset.next; state.error = null; renderDrawer();
        const first = $('#drawer-body input, #drawer-body button'); first && first.focus({ preventScroll: true });
      } else if (t.hasAttribute('data-new-order')) {
        state.step = 'cart'; state.tracking = null; closeOverlay('#drawer');
        window.FlammeScroll && window.FlammeScroll.to('#commander');
      } else if (t.hasAttribute('data-view-last')) {
        const last = store.get(LAST_KEY, null);
        if (last && await loadTracking(last.token)) { state.step = 'done'; renderDrawer(); }
      }
    });

    $('#sauce-pick').addEventListener('change', (e) => { state.sheet.sauce = e.target.value; updateSheetButton(); });
    $('#sheet-add').addEventListener('click', () => {
      const s = state.sheet;
      if (!s.sauce) return;
      addToCart(s.id, s.sauce, s.qty);
      closeOverlay('#sheet');
    });

    $('#drawer').addEventListener('input', (e) => {
      const { name, value } = e.target;
      if (name in state.form) state.form[name] = value;
      if (name === 'slot') state.form.pickup = value;
    });
    $('#drawer').addEventListener('change', (e) => {
      if (e.target.name === 'when') {
        state.form.pickup = e.target.value === 'asap' ? 'asap' : ($('#f-slot')?.value || state.menu.store.slots[0]);
        const sel = $('#f-slot'); if (sel) sel.hidden = e.target.value === 'asap';
      }
    });
    $('#drawer').addEventListener('submit', (e) => { e.preventDefault(); submitOrder(); });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#sheet').hidden) closeOverlay('#sheet');
      else if (!$('#drawer').hidden) closeOverlay('#drawer');
    });

    // Piège de focus simple dans les panneaux ouverts.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const open = !$('#sheet').hidden ? $('#sheet .sheet__panel') : !$('#drawer').hidden ? $('#drawer .drawer__panel') : null;
      if (!open) return;
      const items = [...open.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([hidden]), textarea')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------------------------------------------------------------- Init */
  const ready = (async () => {
    bind();
    saveCart();
    try {
      const res = await fetch(API + 'menu.php');
      if (!res.ok) throw new Error();
      state.menu = await res.json();
    } catch {
      $('#store-status').lastElementChild.textContent = 'Menu indisponible pour le moment. Réessayez dans un instant.';
      return null;
    }
    state.cart = state.cart.filter((l) => productById(l.id));
    saveCart();
    renderTrack(); renderFilters(); renderGrid(); renderSauces(); renderStore();
    return state.menu;
  })();

  window.FlammeOrder = { ready, photo, get menu() { return state.menu; } };
})();
