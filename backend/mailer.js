// Envoi d'emails via Resend (https://resend.com) : simple appel HTTPS, aucune dépendance.
// Variables d'environnement (Render) :
//   RESEND_API_KEY  clé d'API Resend (sans elle, les emails sont désactivés et le site fonctionne normalement)
//   MAIL_FROM       expéditeur, ex. « Kalchat <no-reply@ton-domaine.com> » (le domaine doit être vérifié dans Resend)
function isMailEnabled() {
  return !!process.env.RESEND_API_KEY;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailEnabled()) throw new Error('Service d\'email non configuré');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Kalchat <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status} : ${detail.slice(0, 300)}`);
  }
}

// Email du code de vérification (valable 15 minutes)
function verificationEmail({ code, firstName }) {
  const name = firstName ? escapeHtml(firstName) : '';
  return {
    subject: `${code} est ton code de vérification Kalchat`,
    text: `Salut${firstName ? ` ${firstName}` : ''} !\n\nTon code de vérification Kalchat : ${code}\n\nIl est valable 15 minutes. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.\n\nL'équipe Kalchat`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 12px">Vérifie ton adresse email</h2>
  <p style="margin:0 0 16px">Salut${name ? ` ${name}` : ''} ! Voici ton code de vérification Kalchat :</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f1eeff;border-radius:12px;padding:16px;text-align:center;margin:0 0 16px">${escapeHtml(code)}</p>
  <p style="margin:0 0 8px;font-size:14px;color:#555">Il est valable 15 minutes. Saisis-le dans l'application, page <b>Paramètres &rsaquo; Adresse email</b>.</p>
  <p style="margin:0;font-size:12px;color:#888">Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
</div>`,
  };
}

module.exports = { isMailEnabled, sendMail, verificationEmail };
