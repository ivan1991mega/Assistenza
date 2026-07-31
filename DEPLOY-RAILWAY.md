# Mettere l'app online su Railway — guida passo passo

Segui questi passaggi in ordine. Alla fine avrai l'app raggiungibile da un link pubblico, con i dati salvati in modo permanente.

## Riepilogo di cosa faremo
1. Caricare il codice su Railway
2. Aggiungere un Volume (spazio permanente per il database)
3. Impostare 4 variabili d'ambiente
4. Generare l'indirizzo pubblico
5. Primo accesso e cambio password

---

## 1. Caricare il codice

### Metodo A — Railway CLI (senza GitHub, più semplice)
Sul TUO computer:
```bash
# installa lo strumento Railway (una volta sola)
npm install -g @railway/cli

# accedi al tuo account (si apre il browser)
railway login

# entra nella cartella dell'app
cd percorso/della/cartella/helpdesk

# crea il progetto e carica
railway init
railway up
```

### Metodo B — GitHub (aggiornamenti automatici)
1. Crea un repository su github.com e caricaci la cartella `helpdesk` (senza `node_modules`).
2. Su Railway: New Project → Deploy from GitHub repo → scegli il repository.
Da qui in poi, ogni volta che aggiorni il codice su GitHub, Railway si aggiorna da solo.

---

## 2. Aggiungere il Volume (IMPORTANTE)
Senza questo passaggio perdi tutti i ticket a ogni riavvio.

1. Nel cruscotto Railway apri il tuo servizio.
2. Aggiungi un **Volume** (tasto destro sul servizio → "Attach Volume", oppure Settings → Volumes).
3. Come **mount path** scrivi esattamente:
   ```
   /data
   ```

---

## 3. Variabili d'ambiente
Servizio → scheda **Variables** → aggiungi queste quattro:

| Nome            | Valore                         |
|-----------------|--------------------------------|
| `DB_PATH`       | `/data/helpdesk.db`            |
| `JWT_SECRET`    | (una stringa lunga e casuale)  |
| `ADMIN_EMAIL`   | la tua email                   |
| `ADMIN_PASSWORD`| una password robusta           |

Per generare una `JWT_SECRET`, sul tuo computer:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Copia il risultato come valore di `JWT_SECRET`.

> Nota: `NODE_ENV=production` è impostato in automatico da Railway, quindi i cookie sicuri (HTTPS) si attivano da soli.

### Attivare le notifiche email (opzionale ma consigliato)
L'app manda una email al cliente quando rispondi a un ticket e quando lo chiudi, e manda una email a te (all'indirizzo `ADMIN_EMAIL`) quando un cliente apre un nuovo ticket.
Per farlo funzionare serve un servizio di invio email: usiamo **Resend** (ha un piano gratuito).

1. Registrati su https://resend.com e crea una **API Key**.
2. Aggiungi queste variabili su Railway (scheda Variables):

| Nome             | Valore                                      |
|------------------|---------------------------------------------|
| `RESEND_API_KEY` | la chiave che ti dà Resend (inizia con `re_`) |
| `APP_URL`        | il link pubblico dell'app (vedi punto 4)    |
| `FROM_EMAIL`     | il mittente (vedi nota sotto)               |

**Sul mittente (`FROM_EMAIL`)**: per i primi test puoi lasciare stare — l'app usa un indirizzo di prova di Resend. Per andare in produzione con un mittente tuo (es. `supporto@tuazienda.it`) devi verificare il tuo dominio dentro Resend: è una procedura guidata dove aggiungi alcuni record DNS al tuo dominio. Finché non lo fai, le email partono da un indirizzo generico di Resend.

> Se NON imposti `RESEND_API_KEY`, l'app funziona lo stesso: le notifiche dentro l'app (il pallino rosso) restano attive, semplicemente non partono le email.


---

## 4. Indirizzo pubblico
Servizio → **Settings** → **Networking** → **Generate Domain**.
Otterrai un link tipo `iltuohelpdesk.up.railway.app`: è quello da dare ai clienti.

Se hai un dominio tuo (es. `supporto.tuazienda.it`), da qui puoi collegarlo con "Custom Domain" seguendo le istruzioni che Railway mostra.

---

## 5. Primo accesso
1. Apri il link pubblico.
2. Fai login con `ADMIN_EMAIL` e `ADMIN_PASSWORD` che hai impostato.
3. I clienti si registrano da soli cliccando "Registrati".

---

## Aggiornare l'app in futuro
- Con la CLI: rilancia `railway up` dalla cartella.
- Con GitHub: fai il push delle modifiche, Railway si aggiorna da solo.
I dati nel Volume restano al loro posto a ogni aggiornamento.

## Se qualcosa non va
- **L'app non parte**: guarda i log nel cruscotto Railway (scheda Deployments / Logs) e cerca il messaggio di errore.
- **Ho perso i ticket dopo un riavvio**: manca il Volume o `DB_PATH` non punta a `/data/helpdesk.db`.
- **Non riesco a fare login online**: assicurati di stare usando il link `https://...` (non http).
