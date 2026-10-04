const db = require('./db');
const ai = require('./ai');
const { isMailEnabled } = require('./mailer');

// Délai avant d'inviter un nouveau membre (les membres déjà inscrits reçoivent l'invitation tout de suite)
const DELAY_HOURS = Math.max(0, Number(process.env.EMAIL_PROMPT_DELAY_HOURS ?? 24) || 0);

const MESSAGE = (firstName) =>
  `Salut${firstName ? ` ${firstName}` : ''} ! 👋 Kalchat propose maintenant la **vérification de l'adresse email**.\n\n` +
  `En ajoutant la tienne, tu sécurises ton compte et tu pourras le récupérer si besoin.\n\n` +
  `- Ouvre **Paramètres › Adresse email**\n- Saisis ton adresse, tu reçois un code à 6 chiffres\n- Entre le code : c'est fait ✅\n\n` +
  `Ça prend 1 minute, et ton adresse reste privée.`;

/** Envoie, une seule fois par membre, un message de Kora qui invite à vérifier son adresse email. */
async function promptUnverified(io) {
  if (!isMailEnabled()) return 0;
  const users = await db
    .prepare(
      `SELECT id, first_name FROM users
       WHERE email_verified_at IS NULL AND email_prompted_at IS NULL AND is_blocked = 0 AND id != ?
         AND created_at < NOW() - (? * INTERVAL '1 hour')
       ORDER BY created_at LIMIT 200`
    )
    .all(ai.BOT_ID, DELAY_HOURS);
  let sent = 0;
  for (const u of users) {
    // On marque d'abord : au pire un membre ne reçoit pas l'invitation, jamais deux fois
    await db.prepare('UPDATE users SET email_prompted_at = NOW() WHERE id = ?').run(u.id);
    try {
      await ai.sendBotMessage(io, u.id, MESSAGE(u.first_name));
      sent++;
    } catch (err) {
      console.error('Invitation email non envoyée :', err.message);
    }
  }
  if (sent) console.log(`📧 ${sent} membre(s) invité(s) à vérifier leur email.`);
  return sent;
}

function startEmailPrompts(io) {
  const run = () => promptUnverified(io).catch((err) => console.error('Invitations email :', err.message));
  setTimeout(run, 90 * 1000);
  setInterval(run, 6 * 60 * 60 * 1000);
}

module.exports = { promptUnverified, startEmailPrompts };
