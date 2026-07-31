const app = document.getElementById('app');
let state = { user: null, view: 'list', ticketId: null, filter: null };

// ---------- API helper ----------
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Errore');
  return data;
}

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Formatta minuti in "2g 3h 15m"
function fmtDuration(min) {
  if (min == null) return '—';
  if (min < 1) return '< 1 min';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [];
  if (d) parts.push(d + 'g');
  if (h) parts.push(h + 'h');
  if (m || parts.length === 0) parts.push(m + 'm');
  return parts.join(' ');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'Z');
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusClass(s) {
  return { 'Aperto': 'aperto', 'In lavorazione': 'lavorazione', 'Chiuso': 'chiuso' }[s] || 'aperto';
}

// ---------- Bootstrap ----------
async function boot() {
  try {
    const { user } = await api('/api/me');
    state.user = user;
  } catch { state.user = null; }
  render();
}

// ---------- AUTH VIEW ----------
function renderAuth(mode = 'login', error = '') {
  const isLogin = mode === 'login';
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1>${isLogin ? 'Accedi' : 'Crea un account'}</h1>
        <p class="sub">${isLogin ? 'Entra per gestire i tuoi ticket' : 'Registrati per aprire un ticket'}</p>
        ${error ? `<div class="error">${esc(error)}</div>` : ''}
        <form id="authForm">
          ${!isLogin ? `<div class="field"><label>Nome</label><input name="name" required></div>` : ''}
          <div class="field"><label>Email</label><input name="email" type="email" required></div>
          <div class="field"><label>Password</label><input name="password" type="password" required></div>
          <button class="btn" style="width:100%">${isLogin ? 'Accedi' : 'Registrati'}</button>
        </form>
        <div class="auth-toggle">
          ${isLogin ? 'Non hai un account?' : 'Hai già un account?'}
          <a id="toggleAuth">${isLogin ? 'Registrati' : 'Accedi'}</a>
        </div>
      </div>
    </div>`;

  document.getElementById('toggleAuth').onclick = () => renderAuth(isLogin ? 'register' : 'login');
  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      const user = await api(isLogin ? '/api/login' : '/api/register', { method: 'POST', body });
      state.user = user;
      state.view = 'list';
      render();
    } catch (err) {
      renderAuth(mode, err.message);
    }
  };
}

// ---------- TOPBAR ----------
function topbar() {
  return `
    <div class="topbar">
      <div class="brand"><span class="dot"></span> Helpdesk${state.user.role === 'admin' ? ' · Admin' : ''}<span id="topUnread" class="top-unread" style="display:none"></span></div>
      <div class="user">
        <span>${esc(state.user.name)}</span>
        <button class="btn ghost" id="logoutBtn">Esci</button>
      </div>
    </div>`;
}

function wireTopbar() {
  const b = document.getElementById('logoutBtn');
  if (b) b.onclick = async () => { await api('/api/logout', { method: 'POST' }); state.user = null; render(); };
  refreshUnread();
}

// Aggiorna il contatore di notifiche non lette nella barra in alto
async function refreshUnread() {
  try {
    const { unread } = await api('/api/unread-count');
    const el = document.getElementById('topUnread');
    if (!el) return;
    if (unread > 0) {
      el.textContent = unread;
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  } catch { /* ignora */ }
}

// ---------- LIST VIEW ----------
async function renderList() {
  app.innerHTML = topbar() + `<div class="container"><div class="spinner">Caricamento…</div></div>`;
  wireTopbar();

  const isAdmin = state.user.role === 'admin';
  let statsHtml = '';

  if (isAdmin) {
    const s = await api('/api/stats');
    statsHtml = `
      <div class="stats-grid">
        <div class="stat"><div class="label">Totale ticket</div><div class="value">${s.total}</div></div>
        <div class="stat"><div class="label">Aperti</div><div class="value">${s.byStatus['Aperto']}</div></div>
        <div class="stat"><div class="label">In lavorazione</div><div class="value">${s.byStatus['In lavorazione']}</div></div>
        <div class="stat"><div class="label">Chiusi</div><div class="value">${s.byStatus['Chiuso']}</div></div>
        <div class="stat"><div class="label">Tempo medio lavorazione</div><div class="value small">${fmtDuration(s.avgWorkMinutes)}</div></div>
        <div class="stat"><div class="label">Tempo medio risoluzione</div><div class="value small">${fmtDuration(s.avgResolutionMinutes)}</div></div>
      </div>`;

    // Tabella tempo di lavorazione per cliente
    if (s.workByClient && s.workByClient.length) {
      statsHtml += `
        <div class="work-table-wrap">
          <h3 class="work-table-title">Tempo di lavorazione per cliente</h3>
          <table class="work-table">
            <thead><tr><th>Cliente</th><th>Ticket chiusi</th><th>Tempo totale lavorazione</th></tr></thead>
            <tbody>
              ${s.workByClient.map(c => `
                <tr>
                  <td><b>${esc(c.client_name)}</b><br><span class="muted-sm">${esc(c.client_email)}</span></td>
                  <td>${c.tickets_chiusi}</td>
                  <td><b>${fmtDuration(c.total_work_minutes)}</b></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }
  }

  const q = state.filter ? `?status=${encodeURIComponent(state.filter)}` : '';
  const tickets = await api('/api/tickets' + q);

  const filters = ['Aperto', 'In lavorazione', 'Chiuso'];
  const filtersHtml = `
    <div class="filters">
      <span class="chip ${!state.filter ? 'active' : ''}" data-f="">Tutti</span>
      ${filters.map(f => `<span class="chip ${state.filter === f ? 'active' : ''}" data-f="${f}">${f}</span>`).join('')}
    </div>`;

  const listHtml = tickets.length ? tickets.map(t => `
    <div class="ticket" data-id="${t.id}">
      <div class="ticket-top">
        <div>
          <div class="ticket-title">${esc(t.title)}${t.unread > 0 ? ` <span class="unread-dot" title="Nuovi messaggi non letti">${t.unread}</span>` : ''}</div>
          <div class="ticket-meta">
            <span class="ticket-id">#${t.id}</span>
            ${isAdmin ? `<span>${esc(t.client_name)}</span>` : ''}
            <span>${t.category}</span>
            <span>Creato: ${fmtDate(t.created_at)}</span>
            ${t.status === 'Chiuso' ? `<span>Risolto in: <b>${fmtDuration(t.resolution_minutes)}</b></span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-direction:column;align-items:flex-end">
          <span class="badge ${statusClass(t.status)}">${t.status}</span>
          <span class="badge prio-${t.priority}">${t.priority}</span>
        </div>
      </div>
    </div>`).join('') : `<div class="empty">Nessun ticket ${state.filter ? 'con questo stato' : 'ancora'}.</div>`;

  app.innerHTML = topbar() + `
    <div class="container">
      <div class="page-head">
        <h2>${isAdmin ? 'Tutti i ticket' : 'I miei ticket'}</h2>
        <button class="btn" id="newBtn">+ Nuovo ticket</button>
      </div>
      ${statsHtml}
      ${filtersHtml}
      <div class="ticket-list">${listHtml}</div>
    </div>`;

  wireTopbar();
  const nb = document.getElementById('newBtn');
  if (nb) nb.onclick = () => { state.view = 'new'; render(); };
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => { state.filter = c.dataset.f || null; render(); });
  document.querySelectorAll('.ticket').forEach(t => t.onclick = () => { state.ticketId = t.dataset.id; state.view = 'detail'; render(); });
}

// ---------- NEW TICKET ----------
async function renderNew(error = '') {
  const isAdmin = state.user.role === 'admin';

  // Se admin, carica l'elenco clienti per il menu a tendina
  let clientSelectHtml = '';
  if (isAdmin) {
    let clients = [];
    try { clients = await api('/api/clients'); } catch { clients = []; }
    if (clients.length === 0) {
      clientSelectHtml = `<div class="field"><label>Cliente</label>
        <div style="color:var(--muted);font-size:13px">Nessun cliente registrato. Un cliente deve prima creare un account.</div></div>`;
    } else {
      clientSelectHtml = `<div class="field"><label>Cliente</label>
        <select name="clientId" required>
          <option value="">— Seleziona un cliente —</option>
          ${clients.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.email)})</option>`).join('')}
        </select></div>`;
    }
  }

  app.innerHTML = topbar() + `
    <div class="container">
      <div class="page-head"><h2>Nuovo ticket</h2><button class="btn ghost" id="backBtn">← Indietro</button></div>
      <div class="detail-card" style="max-width:640px">
        ${error ? `<div class="error">${esc(error)}</div>` : ''}
        <form id="newForm">
          ${clientSelectHtml}
          <div class="field"><label>Titolo del problema</label><input name="title" required placeholder="Es. Errore durante il login"></div>
          <div class="field"><label>Descrizione</label><textarea name="description" required rows="5" placeholder="Descrivi il problema nel dettaglio…"></textarea></div>
          <div style="display:flex;gap:14px">
            <div class="field" style="flex:1">
              <label>Categoria</label>
              <select name="category">
                <option>Generale</option><option>Tecnico</option><option>Fatturazione</option>
                <option>Account</option><option>Richiesta funzionalità</option>
              </select>
            </div>
            <div class="field" style="flex:1">
              <label>Priorità</label>
              <select name="priority"><option>Bassa</option><option selected>Media</option><option>Alta</option><option>Urgente</option></select>
            </div>
          </div>
          <button class="btn">Apri ticket</button>
        </form>
      </div>
    </div>`;
  wireTopbar();
  document.getElementById('backBtn').onclick = () => { state.view = 'list'; render(); };
  document.getElementById('newForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/tickets', { method: 'POST', body });
      state.view = 'list';
      render();
    } catch (err) { renderNew(err.message); }
  };
}

// ---------- DETAIL ----------
async function renderDetail() {
  app.innerHTML = topbar() + `<div class="container"><div class="spinner">Caricamento…</div></div>`;
  wireTopbar();
  const isAdmin = state.user.role === 'admin';
  const t = await api('/api/tickets/' + state.ticketId);

  const adminActions = isAdmin ? `
    <div class="admin-actions">
      <span class="lbl">Cambia stato:</span>
      ${t.status !== 'In lavorazione' ? `<button class="btn amber sm" data-status="In lavorazione">Prendi in carico</button>` : ''}
      ${t.status !== 'Chiuso' ? `<button class="btn green sm" data-status="Chiuso">Chiudi ticket</button>` : `<button class="btn secondary sm" data-status="Aperto">Riapri</button>`}
    </div>` : '';

  const timings = `
    <div class="detail-info">
      <span>Creato: <b>${fmtDate(t.created_at)}</b></span>
      ${t.first_response_at ? `<span>Prima risposta: <b>${fmtDate(t.first_response_at)}</b></span>` : ''}
      ${t.closed_at ? `<span>Chiuso: <b>${fmtDate(t.closed_at)}</b></span>` : ''}
      ${t.resolution_minutes != null ? `<span>Tempo di risoluzione: <b>${fmtDuration(t.resolution_minutes)}</b></span>` : ''}
      ${t.work_minutes != null ? `<span>Tempo di lavorazione: <b>${fmtDuration(t.work_minutes)}</b></span>` : ''}
    </div>`;

  const msgs = (t.messages || []).map(m => `
    <div class="msg ${m.author_role === 'admin' ? 'admin' : 'client'}">
      <div class="author">${esc(m.author_name)}${m.author_role === 'admin' ? ' (supporto)' : ''}</div>
      <div>${esc(m.body)}</div>
      <div class="time">${fmtDate(m.created_at)}</div>
    </div>`).join('');

  app.innerHTML = topbar() + `
    <div class="container">
      <div class="page-head"><h2>Ticket #${t.id}</h2><button class="btn ghost" id="backBtn">← Tutti i ticket</button></div>
      <div class="detail-card">
        <div class="detail-head">
          <h2>${esc(t.title)}</h2>
          <div style="display:flex;gap:6px">
            <span class="badge ${statusClass(t.status)}">${t.status}</span>
            <span class="badge prio-${t.priority}">${t.priority}</span>
          </div>
        </div>
        <div class="detail-info">
          ${isAdmin ? `<span>Cliente: <b>${esc(t.client_name)}</b> (${esc(t.client_email)})</span>` : ''}
          <span>Categoria: <b>${t.category}</b></span>
        </div>
        <div class="detail-desc">${esc(t.description)}</div>
        ${timings}
        ${adminActions}
        <div class="messages">
          <h3>Conversazione</h3>
          ${msgs || '<p style="color:var(--muted);font-size:14px">Nessun messaggio ancora.</p>'}
          <div class="reply-box">
            <textarea id="replyText" placeholder="Scrivi una risposta…"></textarea>
            <button class="btn" id="sendReply">Invia</button>
          </div>
        </div>
      </div>
    </div>`;

  wireTopbar();
  document.getElementById('backBtn').onclick = () => { state.view = 'list'; render(); };
  document.querySelectorAll('[data-status]').forEach(b => b.onclick = async () => {
    await api(`/api/tickets/${t.id}/status`, { method: 'PATCH', body: { status: b.dataset.status } });
    render();
  });
  document.getElementById('sendReply').onclick = async () => {
    const body = document.getElementById('replyText').value.trim();
    if (!body) return;
    await api(`/api/tickets/${t.id}/messages`, { method: 'POST', body: { body } });
    render();
  };
}

// ---------- ROUTER ----------
function render() {
  if (!state.user) return renderAuth('login');
  if (state.view === 'new') return renderNew();
  if (state.view === 'detail') return renderDetail();
  return renderList();
}

boot();
