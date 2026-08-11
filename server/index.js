const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { db, init } = require('./db');
const email = require('./email');

init();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-questa-chiave-segreta-in-produzione';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Helper autenticazione ----------
// In produzione (Railway imposta NODE_ENV=production) i cookie viaggiano solo su HTTPS.
const PROD = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 24 * 60 * 60 * 1000 };

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(required = true, adminOnly = false) {
  return (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
      if (required) return res.status(401).json({ error: 'Non autenticato' });
      req.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (adminOnly && payload.role !== 'admin') {
        return res.status(403).json({ error: 'Accesso riservato all\'amministratore' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Sessione scaduta, effettua di nuovo il login' });
    }
  };
}

// Calcola differenza in minuti tra due timestamp SQLite (UTC)
function minutesBetween(startIso, endIso) {
  const s = new Date(startIso + 'Z').getTime();
  const e = new Date(endIso + 'Z').getTime();
  return Math.round((e - s) / 60000);
}

// ---------- AUTH ----------
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Compila tutti i campi' });
  if (password.length < 6) return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email già registrata' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'client')"
  ).run(name.trim(), email.toLowerCase().trim(), hash);

  const user = { id: info.lastInsertRowid, role: 'client', name: name.trim() };
  res.cookie('token', makeToken(user), COOKIE_OPTS);
  res.json({ id: user.id, name: user.name, role: user.role });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Email o password non corretti' });
  }
  res.cookie('token', makeToken(user), COOKIE_OPTS);
  res.json({ id: user.id, name: user.name, role: user.role });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth(false), (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: { id: req.user.id, name: req.user.name, role: req.user.role } });
});

// ---------- TICKETS ----------
// Lista ticket: admin vede tutti (filtrabili per stato e/o cliente), cliente vede i suoi
app.get('/api/tickets', auth(), (req, res) => {
  const { status, clientId } = req.query;
  let rows;
  if (req.user.role === 'admin') {
    const base = `
      SELECT t.*, u.name AS client_name, u.email AS client_email
      FROM tickets t JOIN users u ON u.id = t.user_id
    `;
    // Costruisce le condizioni in modo che stato e cliente si possano combinare
    const conditions = [];
    const params = [];
    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (clientId) { conditions.push('t.user_id = ?'); params.push(clientId); }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    rows = db.prepare(base + where + ' ORDER BY t.created_at DESC').all(...params);
  } else {
    rows = status
      ? db.prepare(
          'SELECT * FROM tickets WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
        ).all(req.user.id, status)
      : db.prepare(
          'SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC'
        ).all(req.user.id);
  }

  // Per ogni ticket calcola se ci sono messaggi non letti per l'utente corrente.
  // "Non letto" = messaggio scritto da un altro utente dopo l'ultima lettura di questo ticket.
  const unreadStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    WHERE m.ticket_id = ?
      AND m.user_id != ?
      AND m.created_at > COALESCE(
        (SELECT last_read_at FROM ticket_reads WHERE user_id = ? AND ticket_id = ?),
        '1970-01-01'
      )
  `);
  rows = rows.map(t => {
    const { n } = unreadStmt.get(t.id, req.user.id, req.user.id, t.id);
    return { ...t, unread: n };
  });

  res.json(rows);
});

// Dettaglio ticket + messaggi
app.get('/api/tickets/:id', auth(), (req, res) => {
  const ticket = db.prepare(`
    SELECT t.*, u.name AS client_name, u.email AS client_email
    FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?
  `).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
  if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  const messages = db.prepare(`
    SELECT m.*, u.name AS author_name, u.role AS author_role
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id = ? ORDER BY m.created_at ASC
  `).all(req.params.id);

  // Segna il ticket come letto ADESSO per l'utente corrente (azzera il pallino)
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`
    INSERT INTO ticket_reads (user_id, ticket_id, last_read_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET last_read_at = excluded.last_read_at
  `).run(req.user.id, req.params.id, now);

  res.json({ ...ticket, messages });
});

// Creazione ticket. Il cliente crea per sé; l'admin può crearlo per un cliente scelto.
app.post('/api/tickets', auth(), (req, res) => {
  const { title, description, category, priority, clientId } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'Titolo e descrizione sono obbligatori' });

  // Determina l'intestatario del ticket
  let ownerId = req.user.id;
  if (req.user.role === 'admin') {
    if (!clientId) return res.status(400).json({ error: 'Seleziona un cliente' });
    const client = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'client'").get(clientId);
    if (!client) return res.status(404).json({ error: 'Cliente non trovato' });
    ownerId = client.id;
  }

  const info = db.prepare(`
    INSERT INTO tickets (user_id, title, description, category, priority)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    ownerId, title.trim(), description.trim(),
    category || 'Generale', priority || 'Media'
  );

  // Se il ticket lo apre un CLIENTE, avvisa l'admin via email.
  // La notifica va a NOTIFY_EMAIL se impostata, altrimenti all'email dell'account admin.
  if (req.user.role === 'client') {
    const admin = db.prepare("SELECT email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    const destinatario = process.env.NOTIFY_EMAIL || (admin && admin.email);
    if (destinatario) {
      email.notifyAdminNewTicket({
        adminEmail: destinatario,
        clientName: req.user.name,
        ticketId: info.lastInsertRowid,
        ticketTitle: title.trim(),
        description: description.trim(),
        priority: priority || 'Media',
        category: category || 'Generale'
      });
    }
  }

  res.json({ id: info.lastInsertRowid });
});

// Elenco clienti registrati (solo admin) — per aprire ticket per loro conto
app.get('/api/clients', auth(true, true), (req, res) => {
  const clients = db.prepare(
    "SELECT id, name, email FROM users WHERE role = 'client' ORDER BY name COLLATE NOCASE"
  ).all();
  res.json(clients);
});

// Aggiorna stato (admin) — gestisce la logica dei tempi
app.patch('/api/tickets/:id/status', auth(true, true), (req, res) => {
  const { status } = req.body || {};
  const valid = ['Aperto', 'In lavorazione', 'Chiuso'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Stato non valido' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let firstResponse = ticket.first_response_at;
  let closedAt = ticket.closed_at;
  let resolutionMinutes = ticket.resolution_minutes;
  let workMinutes = ticket.work_minutes;

  // Prima presa in carico: registra il primo tempo di risposta
  if (status === 'In lavorazione' && !firstResponse) {
    firstResponse = now;
  }
  // Chiusura: calcola il tempo totale (dalla creazione) e il tempo di lavorazione (dalla presa in carico)
  if (status === 'Chiuso') {
    if (!firstResponse) firstResponse = now;
    closedAt = now;
    resolutionMinutes = minutesBetween(ticket.created_at, now);
    workMinutes = minutesBetween(firstResponse, now);
  }
  // Riapertura: azzera la chiusura e i tempi calcolati
  if (status !== 'Chiuso' && ticket.status === 'Chiuso') {
    closedAt = null;
    resolutionMinutes = null;
    workMinutes = null;
  }

  db.prepare(`
    UPDATE tickets SET status = ?, first_response_at = ?, closed_at = ?, resolution_minutes = ?, work_minutes = ?
    WHERE id = ?
  `).run(status, firstResponse, closedAt, resolutionMinutes, workMinutes, req.params.id);

  // Notifica email al cliente alla chiusura (solo quando passa a Chiuso)
  if (status === 'Chiuso' && ticket.status !== 'Chiuso') {
    const client = db.prepare('SELECT name, email FROM users WHERE id = ?').get(ticket.user_id);
    if (client) {
      email.notifyClientClosed({
        clientEmail: client.email,
        clientName: client.name,
        ticketId: ticket.id,
        ticketTitle: ticket.title
      });
    }
  }

  res.json({ ok: true });
});

// Elimina un ticket (solo admin). Cancella anche messaggi e dati di lettura collegati (ON DELETE CASCADE).
app.delete('/api/tickets/:id', auth(true, true), (req, res) => {
  const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Aggiungi messaggio/risposta al ticket
app.post('/api/tickets/:id/messages', auth(), (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Messaggio vuoto' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
  if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  db.prepare('INSERT INTO messages (ticket_id, user_id, body) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.id, body.trim());

  // Se risponde l'admin per la prima volta, segna il primo tempo di risposta
  if (req.user.role === 'admin' && !ticket.first_response_at) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE tickets SET first_response_at = ? WHERE id = ?').run(now, req.params.id);
  }

  // Notifica email al cliente quando risponde l'admin (non blocca la risposta)
  if (req.user.role === 'admin') {
    const client = db.prepare('SELECT name, email FROM users WHERE id = ?').get(ticket.user_id);
    if (client) {
      email.notifyClientNewReply({
        clientEmail: client.email,
        clientName: client.name,
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        replyBody: body.trim()
      });
    }
  }

  res.json({ ok: true });
});

// Conteggio totale notifiche non lette per l'utente corrente (per il pallino in topbar)
app.get('/api/unread-count', auth(), (req, res) => {
  let ticketIds;
  if (req.user.role === 'admin') {
    ticketIds = db.prepare('SELECT id FROM tickets').all().map(r => r.id);
  } else {
    ticketIds = db.prepare('SELECT id FROM tickets WHERE user_id = ?').all(req.user.id).map(r => r.id);
  }
  const stmt = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    WHERE m.ticket_id = ? AND m.user_id != ?
      AND m.created_at > COALESCE(
        (SELECT last_read_at FROM ticket_reads WHERE user_id = ? AND ticket_id = ?), '1970-01-01')
  `);
  let total = 0;
  for (const id of ticketIds) {
    total += stmt.get(id, req.user.id, req.user.id, id).n;
  }
  res.json({ unread: total });
});

// ---------- STATISTICHE (admin) ----------
app.get('/api/stats', auth(true, true), (req, res) => {
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM tickets GROUP BY status
  `).all();

  const byStatus = { Aperto: 0, 'In lavorazione': 0, Chiuso: 0 };
  counts.forEach(r => { byStatus[r.status] = r.n; });

  const totals = db.prepare('SELECT COUNT(*) AS total FROM tickets').get();

  const avgRes = db.prepare(`
    SELECT AVG(resolution_minutes) AS avg_min,
           MIN(resolution_minutes) AS min_min,
           MAX(resolution_minutes) AS max_min
    FROM tickets WHERE status = 'Chiuso' AND resolution_minutes IS NOT NULL
  `).get();

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) AS n FROM tickets GROUP BY category ORDER BY n DESC
  `).all();

  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) AS n FROM tickets GROUP BY priority
  `).all();

  // Ticket chiusi negli ultimi 7 giorni
  const recentClosed = db.prepare(`
    SELECT COUNT(*) AS n FROM tickets
    WHERE status = 'Chiuso' AND closed_at >= datetime('now', '-7 days')
  `).get();

  // Tempo di lavorazione sommato per ogni cliente (solo ticket chiusi con tempo registrato)
  const workByClient = db.prepare(`
    SELECT u.name AS client_name, u.email AS client_email,
           COUNT(t.id) AS tickets_chiusi,
           SUM(t.work_minutes) AS total_work_minutes
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.status = 'Chiuso' AND t.work_minutes IS NOT NULL
    GROUP BY t.user_id
    ORDER BY total_work_minutes DESC
  `).all();

  // Media del tempo di lavorazione (in lavorazione -> chiusura)
  const avgWork = db.prepare(`
    SELECT AVG(work_minutes) AS avg_min
    FROM tickets WHERE status = 'Chiuso' AND work_minutes IS NOT NULL
  `).get();

  res.json({
    total: totals.total,
    byStatus,
    byCategory,
    byPriority,
    avgResolutionMinutes: avgRes.avg_min != null ? Math.round(avgRes.avg_min) : null,
    minResolutionMinutes: avgRes.min_min,
    maxResolutionMinutes: avgRes.max_min,
    avgWorkMinutes: avgWork.avg_min != null ? Math.round(avgWork.avg_min) : null,
    closedLast7Days: recentClosed.n,
    workByClient
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Helpdesk avviato su http://localhost:${PORT}\n`);
});
