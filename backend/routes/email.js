const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { isMailEnabled, isMailPublic, sendMail, codeEmail } = require('../mailer');
const otp = require('../otp');

const router = express.Router();
router.use(authMiddleware);

// Ouvert à tous quand un domaine est configuré (MAIL_FROM) ; sinon (mode test Resend) seulement aux administrateurs
async function canUseMail(userId) {
  if (isMailPublic()) return true;
  if (!isMailEnabled()) return false;
  const u = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  return !!u?.is_admin;
}

// ---------- État : le service est-il actif, et l'adresse du membre est-elle vérifiée ? ----------
router.get('/status', async (req, res) => {
  const u = await db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ enabled: await canUseMail(req.user.id), email: u?.email || null, verified: !!u?.email_verified_at });
});

// ---------- Demander un code de vérification pour une adresse ----------
router.post('/request', async (req, res) => {
  try {
    if (!(await canUseMail(req.user.id))) return res.status(503).json({ error: 'Les emails ne sont pas encore activés sur Kalchat' });
    otp.rateLimit(req, 'verify-request', 15, 60 * 60 * 1000);

    const email = otp.normalizeEmail(req.body.email);
    if (!otp.isValidEmail(email)) return res.status(400).json({ error: 'Adresse email invalide' });

    const me = await db.prepare('SELECT first_name, email, email_verified_at FROM users WHERE id = ?').get(req.user.id);
    if (me.email_verified_at && me.email === email) return res.status(400).json({ error: 'Cette adresse est déjà vérifiée' });
    const taken = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(email, req.user.id);
    if (taken) return res.status(409).json({ error: 'Cette adresse est déjà utilisée par un autre compte' });

    const { id, code } = await otp.issueCode({ purpose: 'verify', email, userId: req.user.id });
    try {
      await sendMail({ to: email, ...codeEmail({ purpose: 'verify', code, firstName: me.first_name }) });
    } catch (err) {
      console.error('Email de vérification non envoyé :', err.message);
      await otp.discard(id);
      return res.status(502).json({ error: "Impossible d'envoyer l'email pour le moment, vérifie l'adresse ou réessaie plus tard" });
    }
    res.json({ ok: true, expires_in: 15 * 60 });
  } catch (err) {
    otp.sendError(res, err);
  }
});

// ---------- Saisir le code reçu ----------
router.post('/verify', async (req, res) => {
  try {
    const pending = await otp.latestForUser(req.user.id, 'verify');
    if (!pending) return res.status(400).json({ error: 'Demande un code avant de le saisir' });
    const row = await otp.checkCode({ purpose: 'verify', email: pending.email, code: req.body.code, userId: req.user.id });

    const taken = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(row.email, req.user.id);
    if (taken) return res.status(409).json({ error: 'Cette adresse est déjà utilisée par un autre compte' });

    await db.prepare('UPDATE users SET email = ?, email_verified_at = NOW() WHERE id = ?').run(row.email, req.user.id);
    await otp.consume(row.email, 'verify');
    res.json({ ok: true, email: row.email });
  } catch (err) {
    otp.sendError(res, err);
  }
});

module.exports = router;
