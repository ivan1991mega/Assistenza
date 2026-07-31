# Helpdesk — Sistema di gestione ticket

App completa per far aprire ticket ai clienti, gestirli e chiuderli, con calcolo automatico dei tempi di risoluzione e statistiche.

## Cosa fa

- I **clienti** si registrano, effettuano il login e aprono ticket (titolo, descrizione, categoria, priorità).
- Tu (**admin**) vedi tutti i ticket, li prendi in carico, rispondi nella conversazione e li chiudi.
- L'app registra automaticamente: quando è stato creato, quando l'hai preso in carico (prima risposta) e quando l'hai chiuso, calcolando il **tempo di risoluzione**.
- La **dashboard admin** mostra: totale ticket, quanti aperti/in lavorazione/chiusi, tempo medio di risoluzione, ticket chiusi negli ultimi 7 giorni, distribuzione per categoria e priorità.
- **Notifiche**: un pallino rosso segnala i messaggi non letti (al cliente quando rispondi, a te quando il cliente scrive). Se configuri un servizio email, il cliente riceve anche una email quando rispondi o chiudi il ticket, e tu ricevi una email quando un cliente apre un nuovo ticket. Vedi `DEPLOY-RAILWAY.md` per attivarle.
- **Apertura ticket da parte dell'admin**: dal pannello puoi aprire un ticket per conto di un cliente registrato (utile se ti contattano per telefono o di persona). Clicca "+ Nuovo ticket" e scegli il cliente dall'elenco.

## Requisiti

- Node.js 18 o superiore (verifica con `node --version`).

## Avvio in locale

```bash
# 1. Entra nella cartella
cd helpdesk

# 2. Installa le dipendenze (solo la prima volta)
npm install

# 3. Avvia
npm start
```

Poi apri il browser su **http://localhost:3000**

### Primo accesso admin

Al primo avvio viene creato un account amministratore. Le credenziali di default sono:

- Email: `admin@helpdesk.local`
- Password: `admin123`

**Cambiale subito.** Puoi impostarle prima del primo avvio con delle variabili d'ambiente:

```bash
ADMIN_EMAIL=tua@email.it ADMIN_PASSWORD=unaPasswordSicura npm start
```

(Se il database è già stato creato, l'admin esiste già: cancella il file `helpdesk.db` per rigenerarlo, oppure aggiorna la password direttamente nel database.)

## Come si usa

1. **Cliente**: apre http://localhost:3000, clicca "Registrati", crea l'account e apre un ticket.
2. **Tu (admin)**: fai login con le credenziali admin. Vedi tutti i ticket e le statistiche in alto.
3. Apri un ticket → **Prendi in carico** (registra il tempo di prima risposta) → rispondi nella conversazione → **Chiudi ticket** (calcola il tempo totale).
4. Se serve, puoi **riaprire** un ticket chiuso.

## Struttura del progetto

```
helpdesk/
├── package.json
├── server/
│   ├── index.js      # server + API (Express)
│   └── db.js         # database e schema (SQLite)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js        # interfaccia (login, cliente, admin)
└── helpdesk.db       # database (creato automaticamente al primo avvio)
```

## Sicurezza — da fare prima di andare online

Questo è un progetto pronto ma pensato per partire. Prima di usarlo con clienti veri su internet:

1. **Cambia `JWT_SECRET`**: imposta la variabile d'ambiente con una stringa lunga e casuale.
   ```bash
   JWT_SECRET="stringa-lunga-e-casuale-qui" npm start
   ```
2. **Usa HTTPS**: aggiungi il flag `secure: true` ai cookie in `server/index.js` (nelle chiamate `res.cookie`) quando servi il sito su HTTPS.
3. **Password admin robusta**: vedi sopra.

## Metterlo online

Il modo più semplice: un servizio come **Railway**, **Render** o **Fly.io** (hanno piani gratuiti/economici e supportano Node.js con pochi click).

- Il database SQLite (`helpdesk.db`) è un singolo file: assicurati che il servizio offra uno **storage persistente**, altrimenti i dati si perdono ad ogni riavvio.
- Quando cresci (molti ticket, più operatori), si migra facilmente a **PostgreSQL** cambiando solo il file `db.js`.

## Come estenderlo

Idee per quando vorrai far crescere l'app: notifiche email all'apertura/chiusura, allegati ai ticket, tag e ricerca, assegnazione a più operatori, SLA con avvisi sui tempi, esportazione in Excel delle statistiche. Chiedimi pure quando vuoi aggiungerne una.
