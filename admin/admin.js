/* Flamme Up — espace équipe.
   Routes par hash : #tableau, #cuisine, #commandes, #menu (+ #commande/<id> ouvre la fiche).
   Les commandes du jour sont rafraîchies toutes les 8 s ; nouveau ticket = son + bandeau. */
(function () {
  const API = '../api/admin.php?action=';
  const POLL_MS = 8000;
  const ROUTES = {
    tableau: { title: 'Tableau de bord', crumb: 'Administration' },
    cuisine: { title: 'Cuisine', crumb: 'Service · en direct' },
    commandes: { title: 'Commandes', crumb: 'Service · historique' },
    menu: { title: 'Menu', crumb: 'Boutique' },
  };
  const STATUS = {
    new: { label: 'Nouvelle', color: '#b34a3c', next: 'preparing', cta: 'Lancer sur le grill', btn: 'btn--red' },
    preparing: { label: 'Sur le grill', color: '#f2b23a', next: 'ready', cta: 'Marquer prête', btn: 'btn--honey' },
    ready: { label: 'Prête', color: '#2f7d47', next: 'picked_up', cta: 'Récupérée et payée', btn: 'btn--ok' },
    picked_up: { label: 'Récupérée', color: '#a2978c' },
    cancelled: { label: 'Annulée', color: '#a2978c' },
  };
  const EVENT_LABEL = { new: 'Commande reçue', preparing: 'Lancée sur le grill', ready: 'Prête au comptoir', picked_up: 'Récupérée et payée', cancelled: 'Annulée' };
  const PREV = { preparing: 'new', ready: 'preparing', picked_up: 'ready' };
  const CATS = { ailes: 'Ailes & tenders', burgers: 'Burgers', tacos: 'Tacos', frites: 'Frites & poutine', combos: 'Combos', boissons: 'Boissons' };
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  const $ = (s, r = document) => r.querySelector(s);
  const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const money0 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const fmt = (c) => money.format(c / 100);
  const fmt0 = (c) => money0.format(c / 100);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const parse = (dt) => new Date(dt.replace(' ', 'T'));
  const hm = (dt) => dt.slice(11, 16).replace(':', ' h ');
  const img = (src) => (src ? '../' + src : '');
  const isActive = (o) => ['new', 'preparing', 'ready'].includes(o.status);
  const itemsCount = (o) => o.items.reduce((n, i) => n + i.qty, 0);

  const state = {
    csrf: null,
    today: [],          // commandes du jour + actives (sondage)
    history: [],        // selon la plage de la vue Commandes
    range: 'today',
    filters: { q: '', status: 'all' },
    menu: null,
    menuCat: 'tout',
    store: null,
    serverOffset: 0,
    known: null,
    shown: new Set(),   // tickets déjà affichés : seuls les nouveaux s'animent
    fresh: new Set(),
    sound: true,
    unseen: 0,
    route: 'tableau',
    drawerId: null,
    timer: null,
  };
  try { state.sound = localStorage.getItem('flamme_admin_sound') !== '0'; } catch { /* navigation privée */ }
  const now = () => Date.now() + state.serverOffset;
  const mins = (dt) => Math.round((parse(dt) - now()) / 60000);

  /* ---------------------------------------------------------------- Réseau */
  async function api(action, body, query = '') {
    const opts = body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: JSON.stringify(body) }
      : {};
    const res = await fetch(API + action + query, { credentials: 'same-origin', ...opts });
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
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2800);
  }

  /* ---------------------------------------------------------------- Son */
  let audio;
  function chime() {
    if (!state.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      [880, 1175, 1568].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.14);
        g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.14 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.5);
        o.connect(g).connect(audio.destination);
        o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.55);
      });
    } catch { /* pas d'audio */ }
  }
  function renderSound() {
    const b = $('#sound');
    b.setAttribute('aria-pressed', String(state.sound));
    b.innerHTML = icon(state.sound ? 'i-bell' : 'i-bell-off');
    b.title = state.sound ? 'Son activé' : 'Son coupé';
  }

  /* ---------------------------------------------------------------- Fragments */
  const pill = (s) => `<span class="pill pill--${s}">${STATUS[s].label}</span>`;
  function thumbs(o, max = 3) {
    const imgs = o.items.slice(0, max).map((it) => it.image ? `<img src="${img(it.image)}" alt="" loading="lazy">` : '<span></span>').join('');
    const more = o.items.length > max ? `<span>+${o.items.length - max}</span>` : '';
    return `<div class="thumbs">${imgs}${more}</div>`;
  }
  function relText(o) {
    if (!isActive(o)) return { text: '', cls: '' };
    const d = mins(o.pickup_at);
    if (d < -1) return { text: `En retard de ${-d} min`, cls: 'is-late' };
    if (d <= 1) return { text: 'Maintenant', cls: 'is-soon' };
    if (d < 60) return { text: `Dans ${d} min`, cls: d <= 10 ? 'is-soon' : '' };
    return { text: `Dans ${Math.floor(d / 60)} h ${String(d % 60).padStart(2, '0')}`, cls: '' };
  }
  function ageText(dt) {
    const d = Math.max(0, -mins(dt));
    if (d < 1) return 'à l’instant';
    if (d < 60) return `il y a ${d} min`;
    return `il y a ${Math.floor(d / 60)} h ${String(d % 60).padStart(2, '0')}`;
  }
  const itemsText = (o) => o.items.map((i) => `${i.qty}× ${i.name}`).join(', ');

  /* ================================================================ Tableau de bord */
  function renderDashboard() {
    const view = $('#view-tableau');
    const today = state.today.filter((o) => o.created_at.slice(0, 10) === serverDate());
    const valid = today.filter((o) => o.status !== 'cancelled');
    const sales = valid.reduce((s, o) => s + o.total_cents, 0);
    const cashed = today.filter((o) => o.status === 'picked_up').reduce((s, o) => s + o.total_cents, 0);
    const active = state.today.filter(isActive).sort((a, b) => parse(a.pickup_at) - parse(b.pickup_at));
    const toCook = active.filter((o) => o.status !== 'ready').length;
    const ready = active.filter((o) => o.status === 'ready').length;
    const cancelled = today.length - valid.length;
    const avg = valid.length ? Math.round(sales / valid.length) : 0;
    const itemsSold = valid.reduce((n, o) => n + itemsCount(o), 0);

    // Meilleures ventes du jour
    const tally = {};
    valid.forEach((o) => o.items.forEach((it) => {
      const k = it.name;
      tally[k] = tally[k] || { name: it.name, image: it.image, qty: 0, cents: 0 };
      tally[k].qty += it.qty; tally[k].cents += it.total_cents;
    }));
    const top = Object.values(tally).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const topMax = top[0] ? top[0].qty : 1;

    // Ventes par heure (heures d'ouverture du jour)
    const st = state.store;
    const h = st && st.hours[st.today];
    const open = h ? parseInt(h[0], 10) : 11;
    const close = h ? Math.ceil(parseInt(h[1], 10) + (h[1].endsWith(':00') ? 0 : 1)) : 23;
    const byHour = {};
    valid.forEach((o) => { const hr = parseInt(o.created_at.slice(11, 13), 10); byHour[hr] = (byHour[hr] || 0) + o.total_cents; });
    const hours = [];
    for (let x = Math.min(open, ...Object.keys(byHour).map(Number)); x < Math.max(close, ...Object.keys(byHour).map((n) => +n + 1)); x++) hours.push(x);
    const hourMax = Math.max(1, ...hours.map((x) => byHour[x] || 0));
    const nowHour = new Date(now()).getHours();

    view.innerHTML = `
      <div class="kpis">
        <div class="kpi ${toCook ? 'kpi--hot' : ''}">
          <p class="kpi__label">${icon('i-flame')}À préparer</p>
          <p class="kpi__value">${toCook}</p>
          <p class="kpi__sub">${ready} prête${ready > 1 ? 's' : ''} au comptoir · <a href="#cuisine">Ouvrir la cuisine</a></p>
        </div>
        <div class="kpi">
          <p class="kpi__label">${icon('i-receipt')}Commandes aujourd’hui</p>
          <p class="kpi__value">${valid.length}</p>
          <p class="kpi__sub">${itemsSold} article${itemsSold > 1 ? 's' : ''}${cancelled ? ` · ${cancelled} annulée${cancelled > 1 ? 's' : ''}` : ''}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">${icon('i-trend')}Ventes du jour</p>
          <p class="kpi__value">${fmt0(sales)}</p>
          <p class="kpi__sub">${fmt(cashed)} encaissés au comptoir</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">${icon('i-bag')}Panier moyen</p>
          <p class="kpi__value">${fmt(avg).replace(/\s\$/, ' $')}</p>
          <p class="kpi__sub">Taxes incluses</p>
        </div>
      </div>

      <div class="dash">
        <div class="dash__col">
          <section class="panel">
            <div class="panel__head">
              <div><h2 class="panel__title">En cours</h2><p class="panel__sub">Triées par heure de ramassage</p></div>
              <a class="btn btn--ghost btn--sm" href="#cuisine">Cuisine ${icon('i-arrow-right')}</a>
            </div>
            ${active.length ? `<div class="live-list">${active.slice(0, 8).map((o) => {
              const r = relText(o);
              return `
              <div class="live-row" data-open="${o.id}" role="button" tabindex="0" aria-label="Commande n° ${esc(o.number)}">
                <span class="live-row__num">${esc(o.number)}</span>
                <span class="live-row__who"><strong>${esc(o.customer_name)}</strong><span>${esc(itemsText(o))}</span></span>
                ${thumbs(o)}
                <span class="live-row__when">${hm(o.pickup_at)}<small class="${r.cls === 'is-late' ? 'is-late' : ''}">${pill(o.status).replace('pill ', 'pill ')}</small></span>
              </div>`;
            }).join('')}</div>` : `<div class="empty">${icon('i-flame')}<p>Aucune commande en cours.<br>Les prochaines arriveront ici en direct.</p></div>`}
          </section>

          <section class="panel">
            <div class="panel__head">
              <div><h2 class="panel__title">Ventes par heure</h2><p class="panel__sub">Aujourd’hui, taxes incluses</p></div>
            </div>
            <div class="panel__body">
              <div class="hours-chart">
                ${hours.map((x, i) => {
                  const v = byHour[x] || 0;
                  return `<div class="hours-chart__col"><div class="hours-chart__bar ${v ? 'has' : ''} ${x === nowHour ? 'is-now' : ''}" style="height:${Math.max(2, (v / hourMax) * 100)}%;animation-delay:${i * 30}ms" data-tip="${x} h · ${fmt(v)}"></div><span class="hours-chart__lbl">${x}h</span></div>`;
                }).join('')}
              </div>
            </div>
          </section>
        </div>

        <div class="dash__col">
          <section class="panel">
            <div class="panel__head"><div><h2 class="panel__title">Meilleures ventes</h2><p class="panel__sub">Aujourd’hui</p></div></div>
            <div class="panel__body">
              ${top.length ? `<div class="top-list">${top.map((t, i) => `
                <div class="top-item">
                  ${t.image ? `<img src="${img(t.image)}" alt="" loading="lazy">` : '<span></span>'}
                  <div><p class="top-item__name">${esc(t.name)}</p><div class="bar"><i style="width:${(t.qty / topMax) * 100}%;animation-delay:${i * 60}ms"></i></div></div>
                  <p class="top-item__qty">${t.qty}<small>${fmt0(t.cents)}</small></p>
                </div>`).join('')}</div>` : `<div class="empty">${icon('i-trend')}<p>Pas encore de ventes aujourd’hui.</p></div>`}
            </div>
          </section>

          <section class="panel">
            <div class="panel__head"><div><h2 class="panel__title">Boutique</h2><p class="panel__sub">Ce que voient les clients sur le site</p></div></div>
            <div class="panel__body facts">
              <div class="fact"><span>Commandes en ligne</span><strong style="color:${st && st.accepting ? 'var(--ok)' : 'var(--accent-strong)'}">${st && st.accepting ? 'Ouvertes' : 'En pause'}</strong></div>
              <div class="fact"><span>Heures du ${st ? DAYS[st.today] : ''}</span><strong>${h ? `${h[0].replace(':', ' h ')} – ${h[1].replace(':', ' h ')}` : 'Fermé'}</strong></div>
              <div class="fact"><span>Temps de préparation</span><strong>~${st ? st.prep_minutes : 20} min</strong></div>
              <div class="fact"><span>Prochain créneau</span><strong>${st && st.slots.length ? st.slots[0].replace(':', ' h ') : '—'}</strong></div>
            </div>
          </section>
        </div>
      </div>`;
  }

  function serverDate() {
    const d = new Date(now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ================================================================ Cuisine */
  function ticket(o) {
    const s = STATUS[o.status];
    const done = !isActive(o);
    const r = relText(o);
    // Barre de temps : de la réception jusqu'à l'heure de ramassage.
    const total = Math.max(1, parse(o.pickup_at) - parse(o.created_at));
    const pct = Math.min(100, Math.max(4, ((now() - parse(o.created_at)) / total) * 100));
    const chipCls = r.cls === 'is-late' ? 'chip--late' : r.cls === 'is-soon' ? 'chip--soon' : '';

    if (done) {
      return `
        <article class="ticket ticket--compact is-done" data-id="${o.id}">
          <div class="ticket__head" data-open="${o.id}">
            <div><p class="ticket__num">n° ${esc(o.number)}</p><p class="ticket__age">${esc(o.customer_name)} · ${fmt(o.total_cents)}</p></div>
            ${thumbs(o, 2)}
          </div>
          <p class="ticket__status ${o.status === 'cancelled' ? 'is-x' : ''}">${icon(o.status === 'cancelled' ? 'i-close' : 'i-check')}${o.status === 'cancelled' ? 'Annulée' : `Récupérée à ${hm(o.updated_at)}`}</p>
        </article>`;
    }
    return `
      <article class="ticket ${state.fresh.has(o.id) ? 'is-fresh' : ''} ${state.shown.has(o.id + o.status) ? '' : 'is-in'}" data-id="${o.id}">
        <div class="ticket__timer ${r.cls}" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <div class="ticket__head ticket__head--grid" data-open="${o.id}">
          <p class="ticket__num">n° ${esc(o.number)}</p>
          <span class="chip ${chipCls}">${icon('i-clock')}${hm(o.pickup_at)}</span>
          <div><p class="ticket__name">${esc(o.customer_name)}</p><p class="ticket__age">Reçue ${ageText(o.created_at)}</p></div>
          <span class="ticket__rel ${r.cls === 'is-late' ? 'is-late' : ''}">${o.asap ? 'Dès que possible<br>' : ''}${r.text}</span>
        </div>
        <ul class="lines">
          ${o.items.map((it) => `
            <li class="line">
              ${it.image ? `<img src="${img(it.image)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
              <span class="line__txt"><strong>${it.qty}×</strong>${esc(it.name)}${it.sauce ? `<small>Sauce ${esc(it.sauce)}</small>` : ''}</span>
            </li>`).join('')}
        </ul>
        ${o.note ? `<p class="ticket__note">${icon('i-note')}<span>${esc(o.note)}</span></p>` : ''}
        <div class="ticket__foot">
          <a class="ticket__phone" href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${icon('i-phone')}${esc(o.phone)}</a>
          <span class="ticket__total">${fmt(o.total_cents)}</span>
        </div>
        <div class="ticket__actions">
          ${PREV[o.status] ? `<button type="button" class="icon-btn" data-move="${PREV[o.status]}" aria-label="Revenir à l’étape précédente" title="Étape précédente">${icon('i-undo')}</button>` : ''}
          <button type="button" class="btn ${s.btn}" data-move="${s.next}">${s.cta}</button>
          <button type="button" class="icon-btn icon-btn--danger" data-cancel aria-label="Annuler la commande n° ${esc(o.number)}" title="Annuler">${icon('i-close')}</button>
        </div>
      </article>`;
  }

  function renderKitchen() {
    const cols = { new: [], preparing: [], ready: [], done: [] };
    const todayStr = serverDate();
    state.today.forEach((o) => {
      if (isActive(o)) cols[o.status].push(o);
      else if (o.updated_at.slice(0, 10) === todayStr) cols.done.push(o);
    });
    ['new', 'preparing', 'ready'].forEach((k) => cols[k].sort((a, b) => parse(a.pickup_at) - parse(b.pickup_at)));
    cols.done.sort((a, b) => parse(b.updated_at) - parse(a.updated_at));

    const def = [
      ['new', 'Nouvelles', STATUS.new.color, 'Aucune nouvelle commande. On attend le prochain coup de feu.'],
      ['preparing', 'Sur le grill', STATUS.preparing.color, 'Rien sur le grill pour le moment.'],
      ['ready', 'Prêtes', STATUS.ready.color, 'Aucune commande en attente au comptoir.'],
      ['done', 'Terminées aujourd’hui', STATUS.picked_up.color, 'Les commandes récupérées s’afficheront ici.'],
    ];
    const html = `
      <div class="board">
        ${def.map(([k, title, color, empty]) => `
          <section class="col" aria-label="${title}">
            <header class="col__head"><h2 class="col__title"><i style="background:${color}"></i>${title}</h2><span class="col__count">${cols[k].length}</span></header>
            ${cols[k].length ? cols[k].slice(0, k === 'done' ? 12 : 50).map(ticket).join('') : `<p class="col__empty">${empty}</p>`}
          </section>`).join('')}
      </div>`;
    $('#view-cuisine').innerHTML = html;
    state.shown = new Set(state.today.map((o) => o.id + o.status));
  }

  /* ================================================================ Commandes */
  function filteredHistory() {
    const q = state.filters.q.trim().toLowerCase();
    return state.history.filter((o) => {
      if (state.filters.status !== 'all' && o.status !== state.filters.status) return false;
      if (!q) return true;
      return [o.number, o.customer_name, o.phone, itemsText(o)].join(' ').toLowerCase().includes(q);
    });
  }

  function renderOrdersShell() {
    const v = $('#view-commandes');
    if (v.dataset.ready) return;
    v.dataset.ready = '1';
    v.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          <label class="search"><span class="sr-only">Rechercher</span>${icon('i-search')}<input class="input" id="q" type="search" placeholder="N°, client, téléphone, article…" autocomplete="off"></label>
          <select class="select" id="status-filter" aria-label="Statut">
            <option value="all">Tous les statuts</option>
            ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
          </select>
          <div class="seg" role="group" aria-label="Période">
            <button type="button" data-range="today" aria-pressed="true">Aujourd’hui</button>
            <button type="button" data-range="week" aria-pressed="false">7 jours</button>
            <button type="button" data-range="all" aria-pressed="false">Tout</button>
          </div>
          <button type="button" class="btn btn--ghost" id="export">${icon('i-download')}Exporter</button>
        </div>
        <div class="summary" id="summary"></div>
        <div class="table-wrap" id="orders-table"></div>
      </section>`;
    $('#q').addEventListener('input', (e) => { state.filters.q = e.target.value; renderOrdersTable(); });
    $('#status-filter').addEventListener('change', (e) => { state.filters.status = e.target.value; renderOrdersTable(); });
    v.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
      state.range = b.dataset.range;
      v.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      loadHistory();
    }));
    $('#export').addEventListener('click', exportCsv);
  }

  function renderOrdersTable() {
    const list = filteredHistory();
    const valid = list.filter((o) => o.status !== 'cancelled');
    const sales = valid.reduce((s, o) => s + o.total_cents, 0);
    $('#summary').innerHTML = `<span><strong>${list.length}</strong> commande${list.length > 1 ? 's' : ''}</span><span>Ventes <strong>${fmt(sales)}</strong></span><span>Panier moyen <strong>${fmt(valid.length ? Math.round(sales / valid.length) : 0)}</strong></span>`;
    $('#orders-table').innerHTML = list.length ? `
      <table class="table">
        <thead><tr><th>Commande</th><th>Client</th><th>Articles</th><th>Ramassage</th><th class="num">Total</th><th>Statut</th></tr></thead>
        <tbody>
          ${list.map((o) => `
            <tr data-open="${o.id}" tabindex="0">
              <td><span class="t-order"><strong>n° ${esc(o.number)}</strong><span>${o.created_at.slice(8, 10)}/${o.created_at.slice(5, 7)} · ${hm(o.created_at)}</span></span></td>
              <td><span class="t-client"><strong>${esc(o.customer_name)}</strong><span>${esc(o.phone)}</span></span></td>
              <td class="c-items"><span class="t-items">${thumbs(o)}<span>${esc(itemsText(o))}</span></span></td>
              <td class="c-when">${o.asap ? 'Dès que possible' : hm(o.pickup_at)}</td>
              <td class="num c-total"><strong>${fmt(o.total_cents)}</strong></td>
              <td>${pill(o.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty">${icon('i-receipt')}<p>Aucune commande pour ces filtres.</p></div>`;
  }

  async function loadHistory() {
    try {
      const data = await api('orders', undefined, `&range=${state.range}`);
      state.history = data.orders;
      if (state.route === 'commandes') renderOrdersTable();
    } catch (e) { if (e.message !== 'auth') toast(e.message, true); }
  }

  function exportCsv() {
    const rows = [['Numéro', 'Date', 'Heure', 'Client', 'Téléphone', 'Articles', 'Ramassage', 'Sous-total', 'Taxes', 'Total', 'Statut', 'Note']];
    filteredHistory().forEach((o) => rows.push([
      o.number, o.created_at.slice(0, 10), o.created_at.slice(11, 16), o.customer_name, o.phone,
      o.items.map((i) => `${i.qty}x ${i.name}${i.sauce ? ` (${i.sauce})` : ''}`).join(' / '),
      o.asap ? 'Dès que possible' : o.pickup_at.slice(11, 16),
      (o.subtotal_cents / 100).toFixed(2), (o.tax_cents / 100).toFixed(2), (o.total_cents / 100).toFixed(2), STATUS[o.status].label, o.note,
    ]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `flamme-up-commandes-${serverDate()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ================================================================ Menu */
  async function renderMenu() {
    const v = $('#view-menu');
    if (!state.menu) {
      v.innerHTML = `<div class="empty">Chargement du menu…</div>`;
      try { state.menu = await api('menu'); } catch (e) { if (e.message !== 'auth') toast(e.message, true); return; }
    }
    const { products, sauces } = state.menu;
    const cats = ['tout', ...Object.keys(CATS).filter((c) => products.some((p) => p.category === c))];
    const list = products.filter((p) => state.menuCat === 'tout' || p.category === state.menuCat);
    const off = products.filter((p) => !+p.available).length;
    v.innerHTML = `
      <div class="menu-grid">
        <section class="panel">
          <div class="panel__head">
            <div><h2 class="panel__title">Produits</h2><p class="panel__sub">${products.length} produits · ${off ? `${off} épuisé${off > 1 ? 's' : ''}` : 'tout est disponible'}. Les changements s’affichent aussitôt sur le site.</p></div>
          </div>
          <div class="chips" role="group" aria-label="Catégories">
            ${cats.map((c) => `<button type="button" data-cat="${c}" aria-pressed="${state.menuCat === c}">${c === 'tout' ? 'Tout' : CATS[c]}</button>`).join('')}
          </div>
          <div>
            ${list.map((p) => `
              <div class="prod ${+p.available ? '' : 'is-off'}" data-product="${esc(p.id)}">
                ${p.image ? `<img src="${img(p.image)}" alt="" loading="lazy">` : '<span></span>'}
                <div><p class="prod__name">${esc(p.name)}</p><p class="prod__meta">${CATS[p.category] || ''}${+p.has_sauce ? ' · sauce au choix' : ''}${+p.featured ? ' · en vedette' : ''}</p></div>
                <label class="price"><span>$</span><input class="input" type="text" inputmode="decimal" value="${(p.price_cents / 100).toFixed(2).replace('.', ',')}" aria-label="Prix de ${esc(p.name)}" data-price></label>
                <label class="switch"><input type="checkbox" role="switch" data-available ${+p.available ? 'checked' : ''} aria-label="${esc(p.name)} disponible"><span class="switch__track"><span class="switch__thumb"></span></span><small>${+p.available ? 'Disponible' : 'Épuisé'}</small></label>
              </div>`).join('')}
          </div>
        </section>
        <section class="panel">
          <div class="panel__head"><div><h2 class="panel__title">Sauces</h2><p class="panel__sub">Une sauce épuisée ne peut plus être choisie en ligne.</p></div></div>
          <div class="sauces">
            ${sauces.map((s) => `
              <div class="sauce ${+s.available ? '' : 'is-off'}" data-sauce="${esc(s.id)}">
                <span class="sauce__sw" style="background:${esc(s.color)}"></span>
                <div><p class="sauce__name">${esc(s.name)}</p><span class="heat" aria-label="Piquant ${s.heat} sur 5">${Array.from({ length: 5 }, (_, i) => `<svg class="${i < s.heat ? '' : 'off'}"><use href="#i-flame-solid"/></svg>`).join('')}</span></div>
                <label class="switch"><input type="checkbox" role="switch" data-available ${+s.available ? 'checked' : ''} aria-label="${esc(s.name)} disponible"><span class="switch__track"><span class="switch__thumb"></span></span></label>
              </div>`).join('')}
          </div>
        </section>
      </div>`;
  }

  /* ================================================================ Fiche commande */
  function findOrder(id) {
    return state.today.find((o) => o.id === id) || state.history.find((o) => o.id === id);
  }

  function renderDrawer() {
    const o = findOrder(state.drawerId);
    if (!o) return;
    const s = STATUS[o.status];
    const r = relText(o);
    const paid = o.status === 'picked_up';
    $('#drawer-inner').innerHTML = `
      <div class="drawer__head">
        <div>
          <p class="drawer__num" id="drawer-title">n° ${esc(o.number)}</p>
          <p class="drawer__meta">${pill(o.status)}<span>${o.created_at.slice(8, 10)}/${o.created_at.slice(5, 7)} · reçue ${hm(o.created_at)}</span></p>
        </div>
        <button type="button" class="icon-btn icon-btn--line" data-close-drawer aria-label="Fermer">${icon('i-close')}</button>
      </div>
      <div class="drawer__body">
        <div class="drawer__section">
          <h3>Client</h3>
          <div class="client">
            <div><strong>${esc(o.customer_name)}</strong><span>${esc(o.phone)}</span></div>
            <a class="btn btn--ghost btn--sm" href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${icon('i-phone')}Appeler</a>
          </div>
        </div>
        <div class="drawer__section">
          <h3>Ramassage</h3>
          <p><strong>${o.asap ? `Dès que possible · vers ${hm(o.pickup_at)}` : hm(o.pickup_at)}</strong>${r.text ? ` <span class="muted">· ${r.text}</span>` : ''}</p>
        </div>
        ${o.note ? `<div class="drawer__section"><h3>Note pour la cuisine</h3><p class="ticket__note">${icon('i-note')}<span>${esc(o.note)}</span></p></div>` : ''}
        <div class="drawer__section">
          <h3>Articles · ${itemsCount(o)}</h3>
          <div class="d-lines">
            ${o.items.map((it) => `
              <div class="d-line">
                ${it.image ? `<img src="${img(it.image)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
                <p class="d-line__name">${it.qty} × ${esc(it.name)}${it.sauce ? `<small>Sauce ${esc(it.sauce)}</small>` : ''}<small>${fmt(it.unit_cents)} l’unité</small></p>
                <p class="d-line__price">${fmt(it.total_cents)}</p>
              </div>`).join('')}
          </div>
          <div class="totals" style="margin-top:1rem">
            <div><span>Sous-total</span><span>${fmt(o.subtotal_cents)}</span></div>
            <div><span>Taxes (TPS + TVQ)</span><span>${fmt(o.tax_cents)}</span></div>
            <div class="grand"><span>Total</span><span>${fmt(o.total_cents)}</span></div>
          </div>
          ${o.status !== 'cancelled' ? `<p class="paid ${paid ? 'is-paid' : ''}">${icon(paid ? 'i-check' : 'i-cash')}${paid ? 'Payée au comptoir' : 'À payer au comptoir'}</p>` : ''}
        </div>
        <div class="drawer__section">
          <h3>Historique</h3>
          <div class="timeline">
            ${(o.events || []).map((e) => `<div class="tl" style="color:${(STATUS[e.status] || STATUS.new).color}"><i></i><span style="color:var(--fg)">${EVENT_LABEL[e.status] || e.status}</span><time>${hm(e.at)}</time></div>`).join('')}
          </div>
        </div>
      </div>
      ${isActive(o) ? `
        <div class="drawer__foot">
          <button type="button" class="btn ${s.btn}" data-move="${s.next}" data-id="${o.id}">${s.cta}</button>
          ${PREV[o.status] ? `<button type="button" class="icon-btn icon-btn--line" data-move="${PREV[o.status]}" data-id="${o.id}" aria-label="Étape précédente" title="Étape précédente">${icon('i-undo')}</button>` : ''}
          <button type="button" class="btn btn--danger" data-cancel data-id="${o.id}">Annuler</button>
        </div>` : ''}`;
  }

  function openDrawer(id) {
    state.drawerId = id;
    renderDrawer();
    const d = $('#drawer');
    d.hidden = false;
    requestAnimationFrame(() => { d.classList.add('is-open'); $('#drawer [data-close-drawer].icon-btn')?.focus(); });
  }
  function closeDrawer() {
    const d = $('#drawer');
    if (d.hidden) return;
    d.classList.remove('is-open');
    state.drawerId = null;
    setTimeout(() => { d.hidden = true; }, 360);
  }

  /* ================================================================ Données */
  function renderSide() {
    const active = state.today.filter(isActive).length;
    const b = $('#badge-active');
    b.textContent = active; b.hidden = !active;
    const st = state.store;
    if (!st) return;
    $('#accepting').checked = st.accepting;
    $('#accepting-label').textContent = st.accepting ? 'Commandes ouvertes' : 'Commandes en pause';
    $('#store-line').textContent = !st.accepting ? 'Le site n’accepte plus de commandes' : st.open_now ? `Ouvert · prêt en ~${st.prep_minutes} min` : 'Fermé · commandes pour plus tard';
  }

  function renderRoute() {
    if (state.route === 'tableau') renderDashboard();
    if (state.route === 'cuisine') renderKitchen();
    if (state.route === 'commandes') renderOrdersTable();
    if (state.drawerId) renderDrawer();
  }

  function updateTitle() {
    document.title = state.unseen ? `(${state.unseen}) Nouvelle commande | Flamme Up` : `${ROUTES[state.route].title} | Flamme Up`;
  }

  async function loadToday() {
    try {
      const data = await api('orders', undefined, '&range=today');
      state.serverOffset = parse(data.server_time) - Date.now();
      state.store = data.store;
      if (state.known) {
        const incoming = data.orders.filter((o) => !state.known.has(o.id) && o.status === 'new');
        if (incoming.length) {
          incoming.forEach((o) => state.fresh.add(o.id));
          if (document.hidden || state.route !== 'cuisine') state.unseen += incoming.length;
          chime();
          toast(incoming.length > 1 ? `${incoming.length} nouvelles commandes` : `Nouvelle commande n° ${incoming[0].number} · ${incoming[0].customer_name}`);
          setTimeout(() => { incoming.forEach((o) => state.fresh.delete(o.id)); if (state.route === 'cuisine') renderKitchen(); }, 12000);
          if (state.route === 'commandes') loadHistory();
        }
      }
      state.known = new Set(data.orders.map((o) => o.id));
      state.today = data.orders;
      renderSide(); renderRoute(); updateTitle();
      $('#live').classList.remove('is-off');
      $('#live-text').textContent = 'En direct';
    } catch (e) {
      if (e.message === 'auth') return;
      $('#live').classList.add('is-off');
      $('#live-text').textContent = 'Hors ligne';
    }
  }

  function startPolling() {
    clearInterval(state.timer);
    loadToday();
    state.timer = setInterval(loadToday, POLL_MS);
  }

  /* ================================================================ Navigation */
  function go() {
    const hash = location.hash.replace('#', '') || 'tableau';
    const [route, id] = hash.split('/');
    if (route === 'commande' && id) { openDrawer(Number(id)); return; }
    state.route = ROUTES[route] ? route : 'tableau';
    document.querySelectorAll('.view').forEach((v) => {
      v.hidden = v.dataset.view !== state.route;
      v.classList.remove('is-entering');
    });
    const cur = document.querySelector(`.view[data-view="${state.route}"]`);
    void cur.offsetWidth; cur.classList.add('is-entering');
    clearTimeout(go.t); go.t = setTimeout(() => cur.classList.remove('is-entering'), 1200);
    document.querySelectorAll('.side__link[data-route]').forEach((a) => a.classList.toggle('is-active', a.dataset.route === state.route));
    $('#page-title').textContent = ROUTES[state.route].title;
    $('#crumb').textContent = ROUTES[state.route].crumb;
    if (state.route === 'cuisine') state.unseen = 0;
    updateTitle();
    closeSide();
    if (state.route === 'commandes') { renderOrdersShell(); renderOrdersTable(); loadHistory(); }
    else if (state.route === 'menu') renderMenu();
    else renderRoute();
    window.scrollTo(0, 0);
  }

  function openSide() { $('#side').classList.add('is-open'); $('#side-backdrop').classList.add('is-open'); $('#burger').setAttribute('aria-expanded', 'true'); }
  function closeSide() { $('#side').classList.remove('is-open'); $('#side-backdrop').classList.remove('is-open'); $('#burger').setAttribute('aria-expanded', 'false'); }

  function showLogin() {
    clearInterval(state.timer);
    $('#app').hidden = true;
    $('#login').hidden = false;
    document.title = 'Espace équipe | Flamme Up';
  }
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    renderSound();
    go();
    startPolling();
  }

  /* ================================================================ Actions */
  async function setStatus(id, status) {
    const o = findOrder(id);
    if (!o) return;
    if (status === 'cancelled') {
      const dlg = $('#confirm');
      $('#confirm-title').textContent = `Annuler la commande n° ${o.number} ?`;
      $('#confirm-text').textContent = `${o.customer_name} (${o.phone}) ne sera pas prévenu automatiquement. Pensez à l’appeler.`;
      dlg.returnValue = '';
      dlg.showModal();
      await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
      if (dlg.returnValue !== 'yes') return;
    }
    const prev = { status: o.status, updated_at: o.updated_at, events: o.events };
    const stamp = new Date(now());
    const at = `${serverDate()} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}:00`;
    // Optimiste : l'interface bouge tout de suite, le serveur confirme ensuite.
    [state.today, state.history].forEach((list) => list.filter((x) => x.id === id).forEach((x) => {
      x.status = status; x.updated_at = at; x.events = [...(x.events || []), { status, at }];
    }));
    state.fresh.delete(id);
    renderSide(); renderRoute();
    try {
      const res = await api('status', { id, status });
      [state.today, state.history].forEach((list) => list.filter((x) => x.id === id).forEach((x) => { x.events = res.events; }));
      if (state.drawerId === id) renderDrawer();
      if (status === 'ready') toast(`n° ${o.number} prête : ${o.customer_name} peut passer`);
      else if (status === 'picked_up') toast(`n° ${o.number} récupérée · ${fmt(o.total_cents)} encaissés`);
      else if (status === 'cancelled') toast(`n° ${o.number} annulée`);
    } catch (e) {
      [state.today, state.history].forEach((list) => list.filter((x) => x.id === id).forEach((x) => Object.assign(x, prev)));
      renderSide(); renderRoute();
      if (e.message !== 'auth') toast(e.message, true);
    }
  }

  document.addEventListener('click', (e) => {
    const move = e.target.closest('[data-move]');
    const cancel = e.target.closest('[data-cancel]');
    if (move || cancel) {
      const holder = e.target.closest('[data-id]');
      const id = Number((move || cancel).dataset.id || (holder && holder.dataset.id));
      setStatus(id, move ? move.dataset.move : 'cancelled');
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open && !e.target.closest('a')) { openDrawer(Number(open.dataset.open)); return; }
    if (e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) { state.menuCat = cat.dataset.cat; renderMenu(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); closeSide(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); openDrawer(Number(e.target.dataset.open)); }
  });

  // Menu : disponibilité et prix.
  document.addEventListener('change', async (e) => {
    const row = e.target.closest('[data-product],[data-sauce]');
    if (!row || !state.menu) return;
    const isProduct = !!row.dataset.product;
    const id = row.dataset.product || row.dataset.sauce;
    const rec = (isProduct ? state.menu.products : state.menu.sauces).find((x) => x.id === id);
    try {
      if (e.target.matches('[data-available]')) {
        const on = e.target.checked;
        await api(isProduct ? 'product' : 'sauce', { id, available: on });
        rec.available = on ? 1 : 0;
        row.classList.toggle('is-off', !on);
        const small = row.querySelector('.switch small'); if (small) small.textContent = on ? 'Disponible' : 'Épuisé';
        toast(on ? `${rec.name} remis en vente` : `${rec.name} marqué épuisé`);
      } else if (e.target.matches('[data-price]')) {
        const cents = Math.round(parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, '')) * 100);
        if (!Number.isFinite(cents) || cents < 0) throw new Error('Prix invalide.');
        await api('product', { id, price_cents: cents });
        rec.price_cents = cents;
        e.target.value = (cents / 100).toFixed(2).replace('.', ',');
        toast(`Prix de ${rec.name} : ${fmt(cents)}`);
      }
    } catch (ex) {
      if (e.target.matches('[data-available]')) e.target.checked = !e.target.checked;
      if (ex.message !== 'auth') toast(ex.message, true);
    }
  });

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
      state.store = data.store; renderSide(); renderRoute();
      toast(on ? 'Les commandes en ligne sont ouvertes' : 'Commandes en ligne mises en pause');
    } catch (ex) { e.target.checked = !on; if (ex.message !== 'auth') toast(ex.message, true); }
  });

  $('#demo-order').addEventListener('click', async () => {
    const b = $('#demo-order');
    b.disabled = true;
    try { await api('demo_order', {}); await loadToday(); }
    catch (ex) { if (ex.message !== 'auth') toast(ex.message, true); }
    finally { b.disabled = false; }
  });

  $('#burger').addEventListener('click', openSide);
  $('#side-backdrop').addEventListener('click', closeSide);
  window.addEventListener('hashchange', () => { if (!$('#app').hidden) go(); });

  // Horloges relatives (« dans 12 min ») sans nouvel appel réseau.
  setInterval(() => { if (!$('#app').hidden && ['tableau', 'cuisine'].includes(state.route)) renderRoute(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) loadToday(); });

  /* ================================================================ Démarrage */
  api('session').then((s) => {
    if (s.authenticated) { state.csrf = s.csrf; showApp(); } else showLogin();
  }).catch(showLogin);
})();
