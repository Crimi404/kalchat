function codeEmail({ purpose, code, firstName }) {
  const c = CODE_COPY[purpose] || CODE_COPY.verify;
  return {
    subject: c.subject(code),
    text: Salut${firstName ?  ${firstName} : ''} !\n\n${c.intro} ${code}\n\nIl est valable 15 minutes. ${c.where}\n\n${c.ignore}\n\nL'équipe Kalchat,
    html: layout(
      c.title,
      <p style="margin:0 0 16px">Salut${hello(firstName)} ! ${c.intro}</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f1eeff;border-radius:12px;padding:16px;text-align:center;margin:0 0 16px">${escapeHtml(code)}</p>
  <p style="margin:0 0 8px;font-size:14px;color:#555">Il est valable 15 minutes. ${escapeHtml(c.where)}</p>
  <p style="margin:0;font-size:13px;color:#888">${escapeHtml(c.ignore)}</p>
    ),
  };
}

function welcomeEmail({ firstName, username }) {
  const url = siteUrl();
  return {
    subject: 'Bienvenue sur Kalchat 🎉',
    text: Bienvenue${firstName ?  ${firstName} : ''} !\n\nTon compte @${username} est prêt. Retrouve ta communauté : ${url}\n\nTu peux te connecter avec ton pseudo ou avec cette adresse email, et récupérer ton mot de passe par email si tu l'oublies.\n\nL'équipe Kalchat,
    html: layout(
      'Bienvenue sur Kalchat 🎉',
      <p style="margin:0 0 12px">Bienvenue${hello(firstName)} ! Ton compte <b>@${escapeHtml(username)}</b> est prêt.</p>
  <p style="margin:0 0 16px;font-size:14px;color:#555">Tu peux te connecter avec ton pseudo ou avec cette adresse email, et récupérer ton mot de passe par email si tu l'oublies.</p>
  <p style="margin:0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#6d4fe0;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Ouvrir Kalchat</a></p>
    ),
  };
}

function passwordChangedEmail({ firstName }) {
  return {
    subject: 'Ton mot de passe Kalchat a été modifié',
    text: Salut${firstName ?  ${firstName} : ''} !\n\nLe mot de passe de ton compte Kalchat vient d'être modifié.\n\nSi c'est bien toi, tu n'as rien à faire. Sinon, utilise « Mot de passe oublié ? » sur la page de connexion pour reprendre le contrôle de ton compte, et réponds à cet email pour nous prévenir.\n\nL'équipe Kalchat,
    html: layout(
      'Ton mot de passe a été modifié',
      <p style="margin:0 0 12px">Salut${hello(firstName)} ! Le mot de passe de ton compte Kalchat vient d'être modifié.</p>
  <p style="margin:0;font-size:14px;color:#555">Si c'est bien toi, tu n'as rien à faire. Sinon, utilise <b>« Mot de passe oublié ? »</b> sur la page de connexion pour reprendre le contrôle de ton compte, et réponds à cet email pour nous prévenir.</p>
    ),
  };
}

module.exports = { isMailEnabled, isMailPublic, sendMail, codeEmail, welcomeEmail, passwordChangedEmail };
