const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// Su Railway il DB va scritto nel Volume persistente.
// Imposta DB_PATH nelle variabili (es. /data/helpdesk.db). In locale usa il file nella cartella.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'helpdesk.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',   -- 'client' oppure 'admin'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Generale',
      priority TEXT NOT NULL DEFAULT 'Media',  -- Bassa / Media / Alta / Urgente
      status TEXT NOT NULL DEFAULT 'Aperto',   -- Aperto / In lavorazione / Chiuso
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      first_response_at TEXT,                  -- quando l'admin lo prende in carico
      closed_at TEXT,                          -- quando viene chiuso
      resolution_minutes INTEGER,              -- tempo totale (creazione -> chiusura)
      work_minutes INTEGER,                    -- tempo di lavorazione (in lavorazione -> chiusura)
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);

    -- Traccia quando ogni utente ha letto l'ultima volta un ticket,
    -- per mostrare i pallini "novità non lette".
    CREATE TABLE IF NOT EXISTS ticket_reads (
      user_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, ticket_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );
  `);

  // Migrazione: aggiunge la colonna work_minutes ai database già esistenti (senza toccare i dati).
  const cols = db.prepare("PRAGMA table_info(tickets)").all();
  if (!cols.some(c => c.name === 'work_minutes')) {
    db.exec('ALTER TABLE tickets ADD COLUMN work_minutes INTEGER');
    console.log('>>> Migrazione: aggiunta colonna work_minutes alla tabella tickets.');
  }

  // Crea l'utente admin di default se non esiste nessun admin
  const adminExists = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get();
  if (adminExists.c === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@helpdesk.local';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')"
    ).run('Amministratore', adminEmail, hash);
    console.log(`\n>>> Admin creato: ${adminEmail} / password: ${adminPass}`);
    console.log('>>> CAMBIA questa password dopo il primo accesso.\n');
  }
}

module.exports = { db, init };

