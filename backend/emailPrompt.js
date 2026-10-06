const db = require('./db');
const ai = require('./ai');
const { isMailPublic } = require('./mailer');
const { purgeExpired } = require('./otp');

// Délai avant d'inviter un membre (0 = tout de suite : les membres déjà inscrits reçoivent l'invitation au démarrage)
const DELAY_HOURS = Math.max(0, Number(process.env.EMAIL_PROMPT_DELAY_HOURS ?? 0) || 0);

const MESSAGE = (firstName) =>
  `Salut${firstName ? ` ${firstName}` : ''} ! 👋 Kalchat passe à la **vérification par email**.\n\n` +
  `En ajoutant ton adresse email, tu pourras :\n` +
  `- **récupérer ton mot de passe** si tu l'oublies\n` +
  `- te **connecter avec ton email** ou ton pseudo\n` +
  `- être prévenu(e) par email si ton mot de passe est modifié\n\n` +
  `Comment faire :\n1. Ouvre **Paramètres › Adresse email**\n2. Saisis ton adresse : tu reçois un code à 6 chiffres\n3. Entre le code, c'est fait ✅\n\n` +
  `Ça prend 1 minute, et ton adresse reste privée (elle n'apparaît jamais sur ton profil).`;

/** Envoie, une seule fois par membre, un message de Kora qui invite à vérifier son adresse email (+ notification push). */
async function promptUnverified(io) {
  if (!isMailPublic()) return 0; // invitations seulement quand les emails peuvent réellement partir vers tous les membres
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
  // Ménage des codes périmés
  const purge = () => purgeExpired().catch((err) => console.error('Ménage des codes :', err.message));
  setTimeout(purge, 120 * 1000);
  setInterval(purge, 60 * 60 * 1000);
}

module.exports = { promptUnverified, startEmailPrompts };
