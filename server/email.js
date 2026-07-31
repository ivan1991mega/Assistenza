// Modulo per l'invio email tramite Resend (https://resend.com).
// Se le variabili non sono impostate, l'app NON si rompe: salta l'invio e logga un avviso.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev'; // mittente
const APP_URL = process.env.APP_URL || ''; // es. https://iltuohelpdesk.up.railway.app

const emailEnabled = !!RESEND_API_KEY;

if (!emailEnabled) {
  console.log('>>> Email disattivate: RESEND_API_KEY non impostata. Le notifiche in-app funzionano comunque.');
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Invia una email. Non lancia mai eccezioni verso l'esterno: in caso di errore logga soltanto.
async function sendEmail({ to, subject, html }) {
  if (!emailEnabled) return { skipped: true };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('Errore invio email:', res.status, txt);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('Eccezione invio email:', err.message);
    return { ok: false };
  }
}

// Email al cliente quando l'admin risponde a un ticket.
function notifyClientNewReply({ clientEmail, clientName, ticketId, ticketTitle, replyBody }) {
  const link = APP_URL ? `${APP_URL}` : '';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1d21;">
      <h2 style="font-size: 18px;">Hai una nuova risposta al tuo ticket</h2>
      <p>Ciao ${esc(clientName)},</p>
      <p>Abbiamo risposto al tuo ticket <b>#${ticketId} — ${esc(ticketTitle)}</b>:</p>
      <div style="background: #f6f7f9; border-radius: 8px; padding: 14px 16px; margin: 14px 0; white-space: pre-wrap;">${esc(replyBody)}</div>
      ${link ? `<p><a href="${esc(link)}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 8px;">Vai al ticket</a></p>` : ''}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Questa è una notifica automatica, puoi rispondere accedendo all'app.</p>
    </div>`;
  return sendEmail({ to: clientEmail, subject: `Risposta al ticket #${ticketId}: ${ticketTitle}`, html });
}

// Email al cliente quando l'admin chiude il ticket.
function notifyClientClosed({ clientEmail, clientName, ticketId, ticketTitle }) {
  const link = APP_URL ? `${APP_URL}` : '';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1d21;">
      <h2 style="font-size: 18px;">Il tuo ticket è stato chiuso</h2>
      <p>Ciao ${esc(clientName)},</p>
      <p>Il ticket <b>#${ticketId} — ${esc(ticketTitle)}</b> è stato risolto e chiuso.</p>
      <p>Se il problema si ripresenta, puoi riaprirlo o aprirne uno nuovo.</p>
      ${link ? `<p><a href="${esc(link)}" style="display: inline-block; background: #059669; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 8px;">Vai all'app</a></p>` : ''}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Questa è una notifica automatica.</p>
    </div>`;
  return sendEmail({ to: clientEmail, subject: `Ticket #${ticketId} chiuso: ${ticketTitle}`, html });
}

// Email all'amministratore quando un cliente apre un nuovo ticket.
function notifyAdminNewTicket({ adminEmail, clientName, ticketId, ticketTitle, description, priority, category }) {
  const link = APP_URL ? `${APP_URL}` : '';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1d21;">
      <h2 style="font-size: 18px;">Nuovo ticket aperto</h2>
      <p>È stato aperto un nuovo ticket da <b>${esc(clientName)}</b>.</p>
      <p style="margin: 4px 0;"><b>#${ticketId} — ${esc(ticketTitle)}</b></p>
      <p style="margin: 4px 0; color: #6b7280; font-size: 13px;">Categoria: ${esc(category)} · Priorità: ${esc(priority)}</p>
      <div style="background: #f6f7f9; border-radius: 8px; padding: 14px 16px; margin: 14px 0; white-space: pre-wrap;">${esc(description)}</div>
      ${link ? `<p><a href="${esc(link)}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 8px;">Apri il pannello</a></p>` : ''}
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Questa è una notifica automatica.</p>
    </div>`;
  return sendEmail({ to: adminEmail, subject: `Nuovo ticket #${ticketId}: ${ticketTitle}`, html });
}

module.exports = { emailEnabled, notifyClientNewReply, notifyClientClosed, notifyAdminNewTicket };
