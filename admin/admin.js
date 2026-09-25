/* Flamme Up — panneau des commandes : tableau en temps réel (sondage), menu, pause des commandes. */
(function () {
  const API = '../api/admin.php?action=';
  const POLL_MS = 8000;
  const COLUMNS = [
    { key: 'new', title: 'Nouvelles', color: '#ff6b3d', next: 'preparing', cta: 'Lancer sur le grill', btn: 'btn--primary' },
    { key: 'preparing', title: 'Sur le grill', color: '#f2b23a', next: 'ready', cta: 'Marquer prête', btn: 'btn--honey' },
    { key: 'ready', title: 'Prêtes', color: '#3f9b5a', next: 'picked_up', cta: 'Récupérée · payée', btn: 'btn--green' },
    { key: 'done', title: 'Terminées', color: 'rgba(18,15,13,.35)' },
  ];
  const PREV = { preparing: 'new', ready: 'preparing', picked_up: 'ready' };
  const CATS = { ailes: 'Ailes', combos: 'Combos', poulet: 'Poulet', accompagnements: 'Accompagnements', boissons: 'Boissons' };

  const $ = (s) => document.querySelector(s);
  const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const fmt = (c) => money.format(c / 100);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const hm = (dt) => dt.slice(11, 16).replace(':', ' h ');
  const parse = (dt) => new Date(dt.replace(' ', 'T'));

  const state = {
    csrf: null,
    orders: [],
    known: null,       // ids déjà vus → détecter les nouvelles
    fresh: new Set(),
    store: null,
    serverOffset: 0,   // heure serveur − heure locale
    sound: true,
    unseen: 0,
    timer: null,
  };
  try { state.sound = localStorage.getItem('flamme_admin_sound') !== '0'; } catch { /* */ }

  /* ---------------------------------------------------------------- Réseau */
  async function api(action, body) {
    const opts = body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: JSON.stringify(body) }
      : {};
    const res = await fetch(API + action, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && action !== 'login') { showLogin(); throw new Error('auth'); }
    if (!res.ok) throw new Error(data.error || 'Erreur réseau');
    return data;
  }

  let toastTimer;
  function toast(msg, error) {
    const el = $('#toast');
    el.classList.toggle('is-error', !!error);
    el.innerHTML = `${icon(error ? 'i-close' : 'i-check')}<span>${esc(msg)}</span>`;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  /* ---------------------------------------------------------------- Son */
  let audio;
  function chime() {
    if (!state.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime;
      [880, 1175, 1568].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.14);
        g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.14 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.5);
        o.connect(g).connect(audio.destination);
        o.start(now + i * 0.14); o.stop(now + i * 0.14 + 0.55);
      });
    } catch { /* navigateur sans audio */ }
  }
  function renderSound() {
    const b = $('#sound');
    b.setAttribute('aria-pressed', String(state.sound));
    b.innerHTML = icon(state.sound ? 'i-bell' : 'i-bell-off');
    b.title = state.sound ? 'Son activé' : 'Son coupé';
  }

  /* ---------------------------------------------------------------- Commandes */
  function relative(o) {
    const diff = Math.round((parse(o.pickup_at) - (Date.now() + state.serverOffset)) / 60000);
    if (['picked_up', 'cancelled'].includes(o.status)) return { text: '', cls: '' };
    if (diff < -1) return { text: `En retard de ${-diff} min`, cls: 'is-late' };
    if (diff <= 1) return { text: 'Maintenant', cls: 'is-soon' };
    if (diff <= 10) return { text: `Dans ${diff} min`, cls: 'is-soon' };
    if (diff < 60) return { text: `Dans ${diff} min`, cls: '' };
    return { text: `Dans ${Math.floor(diff / 60)} h ${String(diff % 60).padStart(2, '0')}`, cls: '' };
  }

  function orderCard(o) {
    const col = COLUMNS.find((c) => c.key === o.status);
    const rel = relative(o);
    const done = o.status === 'picked_up' || o.status === 'cancelled';
    return `
      <article class="order ${state.fresh.has(o.id) ? 'is-fresh' : ''} ${done ? 'is-done' : ''}" data-id="${o.id}">
        <div class="order__head">
          <div>
            <p class="order__num">n° ${esc(o.number)}</p>
            <p class="order__name">${esc(o.customer_name)}</p>
          </div>
          <div class="order__time">
            <span class="order__at">${icon('i-clock')}${o.asap ? 'Dès que possible' : hm(o.pickup_at)}</span>
            <span class="order__rel ${rel.cls}">${o.asap ? `vers ${hm(o.pickup_at)} · ` : ''}${rel.text}</span>
          </div>
        </div>
        <ul class="order__items">
          ${o.items.map((it) => `<li><span class="order__qty">${it.qty}×</span><span>${esc(it.name)}${it.sauce ? `<span class="order__sauce">Sauce ${esc(it.sauce)}</span>` : ''}</span></li>`).join('')}
        </ul>
        ${o.note ? `<p class="order__note">${icon('i-note')}<span>${esc(o.note)}</span></p>` : ''}
        <div class="order__meta">
          <a class="order__phone" href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${icon('i-phone')}${esc(o.phone)}</a>
          <span class="order__total">${fmt(o.total_cents)}</span>
        </div>
        ${done
          ? `<p class="order__status ${o.status === 'cancelled' ? 'order__status--x' : ''}">${icon(o.status === 'cancelled' ? 'i-close' : 'i-check')}${o.status === 'cancelled' ? 'Annulée' : 'Récupérée et payée'}</p>`
          : `<div class="order__actions">
              ${PREV[o.status] ? `<button type="button" class="icon-btn" data-move="${PREV[o.status]}" aria-label="Revenir à l’étape précédente" title="Étape précédente">${icon('i-undo')}</button>` : ''}
              <button type="button" class="btn ${col.btn}" data-move="${col.next}">${col.cta}</button>
              <button type="button" class="icon-btn" data-cancel aria-label="Annuler la commande n° ${esc(o.number)}" title="Annuler">${icon('i-close')}</button>
            </div>`}
      </article>`;
  }

  function renderBoard() {
    const byCol = { new: [], preparing: [], ready: [], done: [] };
    state.orders.forEach((o) => (byCol[['picked_up', 'cancelled'].includes(o.status) ? 'done' : o.status] || []).push(o));
    byCol.done.sort((a, b) => b.id - a.id);

    $('#board').innerHTML = COLUMNS.map((c) => `
      <section class="col" aria-label="${c.title}">
        <header class="col__head">
          <h2 class="col__title"><span class="col__dot" style="background:${c.color}"></span>${c.title}</h2>
          <span class="col__count">${byCol[c.key].length}</span>
        </header>
        ${byCol[c.key].length ? byCol[c.key].map(orderCard).join('') : `<p class="col__empty">${c.key === 'new' ? 'Aucune nouvelle commande. On attend le prochain coup de feu.' : 'Rien ici pour le moment.'}</p>`}
      </section>`).join('');

    // KPIs du jour
    const today = state.orders.filter((o) => o.status !== 'cancelled');
    const revenue = state.orders.filter((o) => o.status === 'picked_up').reduce((s, o) => s + o.total_cents, 0);
    const pending = state.orders.filter((o) => ['new', 'preparing', 'ready'].includes(o.status)).reduce((s, o) => s + o.total_cents, 0);
    $('#kpis').innerHTML = `
      <div class="kpi kpi--hot"><p class="kpi__label">À traiter</p><p class="kpi__value">${byCol.new.length + byCol.preparing.length}</p></div>
      <div class="kpi"><p class="kpi__label">Prêtes à récupérer</p><p class="kpi__value">${byCol.ready.length}</p></div>
      <div class="kpi"><p class="kpi__label">Commandes aujourd’hui</p><p class="kpi__value">${today.length}</p></div>
      <div class="kpi"><p class="kpi__label">Encaissé · en attente</p><p class="kpi__value" style="font-size:1.5rem;padding-top:.5rem">${fmt(revenue)} · ${fmt(pending)}</p></div>`;

    const badge = $('#badge-new');
    badge.textContent = byCol.new.length;
    badge.hidden = !byCol.new.length;
  }

  function updateTitle() {
    document.title = state.unseen ? `(${state.unseen}) Nouvelle commande — Flamme Up` : 'Flamme Up — Commandes';
  }

  async function loadOrders() {
    try {
      const data = await api('orders');
      state.serverOffset = parse(data.server_time) - Date.now();
      state.store = data.store;
      const ids = new Set(data.orders.map((o) => o.id));
      if (state.known) {
        const incoming = data.orders.filter((o) => !state.known.has(o.id) && o.status === 'new');
        if (incoming.length) {
          incoming.forEach((o) => state.fresh.add(o.id));
          state.unseen += incoming.length;
          chime();
          toast(incoming.length > 1 ? `${incoming.length} nouvelles commandes` : `Nouvelle commande n° ${incoming[0].number}`);
          setTimeout(() => { incoming.forEach((o) => state.fresh.delete(o.id)); }, 12000);
        }
      }
      state.known = ids;
      state.orders = data.orders;
      renderBoard();
      renderAccepting();
      updateTitle();
      $('#sync').textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })} · actualisation automatique`;
    } catch (e) {
      if (e.message !== 'auth') $('#sync').textContent = 'Connexion perdue, nouvelle tentative…';
    }
  }

  function startPolling() {
    clearInterval(state.timer);
    loadOrders();
    state.timer = setInterval(loadOrders, POLL_MS);
  }

  /* ---------------------------------------------------------------- Pause des commandes */
  function renderAccepting() {
    if (!state.store) return;
    $('#accepting').checked = state.store.accepting;
    $('#accepting-label').textContent = state.store.accepting ? 'Commandes ouvertes' : 'Commandes en pause';
  }

  /* ---------------------------------------------------------------- Menu */
  async function loadMenu() {
    const data = await api('menu');
    $('#products').innerHTML = data.products.map((p) => `
      <div class="row ${+p.available ? '' : 'is-off'}" data-product="${esc(p.id)}">
        <div><p class="row__name">${esc(p.name)}</p><p class="row__cat">${CATS[p.category] || ''}</p></div>
        <label class="price"><span>$</span><input class="input" type="text" inputmode="decimal" value="${(p.price_cents / 100).toFixed(2).replace('.', ',')}" aria-label="Prix de ${esc(p.name)}" data-price></label>
        <label class="switch"><input type="checkbox" role="switch" data-available ${+p.available ? 'checked' : ''} aria-label="${esc(p.name)} disponible"><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">${+p.available ? 'Disponible' : 'Épuisé'}</span></label>
      </div>`).join('');
    $('#sauces').innerHTML = data.sauces.map((s) => `
      <div class="row ${+s.available ? '' : 'is-off'}" data-sauce="${esc(s.id)}" style="grid-template-columns:1fr auto">
        <div><p class="row__name"><span class="swatch" style="background:${esc(s.color)}"></span>${esc(s.name)}</p></div>
        <label class="switch"><input type="checkbox" role="switch" data-available ${+s.available ? 'checked' : ''} aria-label="${esc(s.name)} disponible"><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">${+s.available ? 'Disponible' : 'Épuisée'}</span></label>
      </div>`).join('');
  }

  /* ---------------------------------------------------------------- Vues */
  function showLogin() {
    clearInterval(state.timer);
    $('#app').hidden = true;
    $('#login').hidden = false;
    setTimeout(() => $('#password').focus(), 50);
  }
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    renderSound();
    startPolling();
  }
  function selectTab(which) {
    const orders = which === 'orders';
    $('#tab-orders').setAttribute('aria-selected', String(orders));
    $('#tab-menu').setAttribute('aria-selected', String(!orders));
    $('#view-orders').hidden = !orders;
    $('#view-menu').hidden = orders;
    if (!orders) loadMenu().catch((e) => toast(e.message, true));
    if (orders) { state.unseen = 0; updateTitle(); }
  }

  /* ---------------------------------------------------------------- Événements */
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn'), err = $('#login-error');
    btn.disabled = true; err.hidden = true;
    try {
      const data = await api('login', { password: $('#password').value });
      state.csrf = data.csrf;
      showApp();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      $('#password').setAttribute('aria-invalid', 'true');
    } finally { btn.disabled = false; }
  });

  $('#pw-toggle').addEventListener('click', () => {
    const input = $('#password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#pw-toggle').innerHTML = icon(show ? 'i-eye-off' : 'i-eye');
    $('#pw-toggle').setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  });

  $('#tab-orders').addEventListener('click', () => selectTab('orders'));
  $('#tab-menu').addEventListener('click', () => selectTab('menu'));

  $('#sound').addEventListener('click', () => {
    state.sound = !state.sound;
    try { localStorage.setItem('flamme_admin_sound', state.sound ? '1' : '0'); } catch { /* */ }
    renderSound();
    if (state.sound) chime();
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('logout', {}); } catch { /* */ }
    state.csrf = null; state.known = null;
    showLogin();
  });

  $('#accepting').addEventListener('change', async (e) => {
    const on = e.target.checked;
    try {
      const data = await api('accepting', { accepting: on });
      state.store = data.store; renderAccepting();
      toast(on ? 'Les commandes en ligne sont ouvertes' : 'Commandes en ligne mises en pause');
    } catch (ex) { e.target.checked = !on; toast(ex.message, true); }
  });

  const confirmDlg = $('#confirm');
  $('#board').addEventListener('click', async (e) => {
    const card = e.target.closest('.order');
    if (!card) return;
    const id = Number(card.dataset.id);
    const o = state.orders.find((x) => x.id === id);
    const move = e.target.closest('[data-move]');
    let status = move ? move.dataset.move : null;

    if (e.target.closest('[data-cancel]')) {
      $('#confirm-title').textContent = `Annuler la commande n° ${o.number} ?`;
      $('#confirm-text').textContent = `Le client (${o.customer_name}, ${o.phone}) ne sera pas prévenu automatiquement. Pensez à l’appeler.`;
      confirmDlg.returnValue = '';
      confirmDlg.showModal();
      await new Promise((r) => confirmDlg.addEventListener('close', r, { once: true }));
      if (confirmDlg.returnValue !== 'yes') return;
      status = 'cancelled';
    }
    if (!status) return;

    // Optimiste : on déplace tout de suite, on resynchronise après.
    const prev = o.status;
    o.status = status;
    state.fresh.delete(id);
    renderBoard();
    try {
      await api('status', { id, status });
      if (status === 'ready') toast(`n° ${o.number} prête — ${o.customer_name} peut passer`);
      if (status === 'picked_up') toast(`n° ${o.number} récupérée · ${fmt(o.total_cents)}`);
    } catch (ex) {
      o.status = prev; renderBoard(); toast(ex.message, true);
    }
  });

  // Menu : disponibilité et prix.
  document.addEventListener('change', async (e) => {
    const row = e.target.closest('[data-product],[data-sauce]');
    if (!row) return;
    const isProduct = !!row.dataset.product;
    try {
      if (e.target.matches('[data-available]')) {
        const on = e.target.checked;
        await api(isProduct ? 'product' : 'sauce', { id: row.dataset.product || row.dataset.sauce, available: on });
        row.classList.toggle('is-off', !on);
        row.querySelector('.switch__label').textContent = on ? 'Disponible' : (isProduct ? 'Épuisé' : 'Épuisée');
        toast(on ? 'Remis en vente' : 'Marqué épuisé');
      } else if (e.target.matches('[data-price]')) {
        const cents = Math.round(parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, '')) * 100);
        if (!Number.isFinite(cents) || cents < 0) throw new Error('Prix invalide.');
        await api('product', { id: row.dataset.product, price_cents: cents });
        e.target.value = (cents / 100).toFixed(2).replace('.', ',');
        toast('Prix mis à jour');
      }
    } catch (ex) { toast(ex.message, true); if (e.target.matches('[data-available]')) e.target.checked = !e.target.checked; }
  });

  // Rafraîchit les « dans X min » chaque 30 s sans refaire d'appel réseau.
  setInterval(() => { if (!$('#app').hidden) renderBoard(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) { loadOrders(); } });

  /* ---------------------------------------------------------------- Démarrage */
  api('session').then((s) => {
    if (s.authenticated) { state.csrf = s.csrf; showApp(); } else showLogin();
  }).catch(showLogin);
})();
