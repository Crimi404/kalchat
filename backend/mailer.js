// Envoi d'emails via Resend (https://resend.com) : simple appel HTTPS, aucune dépendance.
// Variables d'environnement (Render) :
//   RESEND_API_KEY  clé d'API Resend (sans elle, les emails sont désactivés et le site fonctionne comme avant)
//   MAIL_FROM       expéditeur, ex. « Kalchat <no-reply@kalchat.site> » (le domaine doit être vérifié dans Resend)
//   MAIL_REPLY_TO   (facultatif) adresse qui reçoit les réponses des membres, ex. l'adresse du support
//   PUBLIC_URL      (facultatif) adresse du site, par défaut https://kalchat.site
//
// Sans MAIL_FROM, Resend n'envoie qu'à l'adresse du compte Resend (mode test) : les fonctions email ne sont alors
// ouvertes qu'aux administrateurs, pour tester. Avec MAIL_FROM (domaine vérifié), elles sont ouvertes à tous.
function isMailEnabled() {
  return !!process.env.RESEND_API_KEY;
}

function isMailPublic() {
  return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
}

const siteUrl = () => (process.env.PUBLIC_URL || 'https://kalchat.site').replace(/\/$/, '');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailEnabled()) throw new Error("Service d'email non configuré");
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Kalchat <onboarding@resend.dev>',
      to: [to],
      ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
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

// ---------- Modèles d'emails ----------
function layout(title, bodyHtml) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#6d4fe0">Kalchat</p>
  <h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h2>
  ${bodyHtml}
  <p style="margin:24px 0 0;font-size:12px;color:#888">Cet email a été envoyé automatiquement par Kalchat. Besoin d'aide ? Réponds simplement à ce message.</p>
</div>`;
}

const hello = (firstName) => (firstName ? ` ${escapeHtml(firstName)}` : '');

const CODE_COPY = {
  signup: {
    subject: (code) => `${code} est ton code pour créer ton compte Kalchat`,
    title: 'Confirme ton adresse email',
    intro: 'Voici ton code pour finir la création de ton compte Kalchat :',
    where: "Saisis-le dans l'application pour terminer ton inscription.",
    ignore: "Si tu n'as pas demandé la création d'un compte, ignore simplement cet email.",
  },
  verify: {
    subject: (code) => `${code} est ton code de vérification Kalchat`,
    title: 'Vérifie ton adresse email',
    intro: 'Voici ton code de vérification Kalchat :',
    where: "Saisis-le dans l'application, page Paramètres › Adresse email.",
    ignore: "Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.",
  },
  reset: {
    subject: (code) => `${code} est ton code pour réinitialiser ton mot de passe Kalchat`,
    title: 'Réinitialise ton mot de passe',
    intro: 'Voici ton code pour choisir un nouveau mot de passe Kalchat :',
    where: "Saisis-le dans l'application, avec ton nouveau mot de passe.",
    ignore: "Si tu n'as pas demandé ce changement, ignore cet email : ton mot de passe actuel reste valable. Ne communique jamais ce code à personne.",
  },
};

/** Email contenant un code à 6 chiffres (valable 15 minutes). purpose : 'signup' | 'verify' | 'reset'. */
function codeEmail({ purpose, code, firstName }) {
  const c = CODE_COPY[purpose] || CODE_COPY.verify;
  return {
    subject: c.subject(code),
    text: `Salut${firstName ? ` ${firstName}` : ''} !\n\n${c.intro} ${code}\n\nIl est valable 15 minutes. ${c.where}\n\n${c.ignore}\n\nL'équipe Kalchat`,
    html: layout(
      c.title,
      `<p style="margin:0 0 16px">Salut${hello(firstName)} ! ${c.intro}</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f1eeff;border-radius:12px;padding:16px;text-align:center;margin:0 0 16px">${escapeHtml(code)}</p>
  <p style="margin:0 0 8px;font-size:14px;color:#555">Il est valable 15 minutes. ${escapeHtml(c.where)}</p>
  <p style="margin:0;font-size:13px;color:#888">${escapeHtml(c.ignore)}</p>`
    ),
  };
}

function welcomeEmail({ firstName, username }) {
  const url = siteUrl();
  return {
    subject: 'Bienvenue sur Kalchat 🎉',
    text: `Bienvenue${firstName ? ` ${firstName}` : ''} !\n\nTon compte @${username} est prêt. Retrouve ta communauté : ${url}\n\nTu peux te connecter avec ton pseudo ou avec cette adresse email, et récupérer ton mot de passe par email si tu l'oublies.\n\nL'équipe Kalchat`,
    html: layout(
      'Bienvenue sur Kalchat 🎉',
      `<p style="margin:0 0 12px">Bienvenue${hello(firstName)} ! Ton compte <b>@${escapeHtml(username)}</b> est prêt.</p>
  <p style="margin:0 0 16px;font-size:14px;color:#555">Tu peux te connecter avec ton pseudo ou avec cette adresse email, et récupérer ton mot de passe par email si tu l'oublies.</p>
  <p style="margin:0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#6d4fe0;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Ouvrir Kalchat</a></p>`
    ),
  };
}

function passwordChangedEmail({ firstName }) {
  return {
    subject: 'Ton mot de passe Kalchat a été modifié',
    text: `Salut${firstName ? ` ${firstName}` : ''} !\n\nLe mot de passe de ton compte Kalchat vient d'être modifié.\n\nSi c'est bien toi, tu n'as rien à faire. Sinon, utilise « Mot de passe oublié ? » sur la page de connexion pour reprendre le contrôle de ton compte, et réponds à cet email pour nous prévenir.\n\nL'équipe Kalchat`,
    html: layout(
      'Ton mot de passe a été modifié',
      `<p style="margin:0 0 12px">Salut${hello(firstName)} ! Le mot de passe de ton compte Kalchat vient d'être modifié.</p>
  <p style="margin:0;font-size:14px;color:#555">Si c'est bien toi, tu n'as rien à faire. Sinon, utilise <b>« Mot de passe oublié ? »</b> sur la page de connexion pour reprendre le contrôle de ton compte, et réponds à cet email pour nous prévenir.</p>`
    ),
  };
}

module.exports = { isMailEnabled, isMailPublic, sendMail, codeEmail, welcomeEmail, passwordChangedEmail };
