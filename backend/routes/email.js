const crypto = require('crypto');
const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { isMailEnabled, sendMail, verificationEmail } = require('../mailer');

const router = express.Router();
router.use(authMiddleware);

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_CODES_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hashCode(code, userId, email) {
  return crypto.createHash('sha256').update(`${code}:${userId}:${email}`).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- État : le service est-il actif, et l'adresse du membre est-elle vérifiée ? ----------
router.get('/status', async (req, res) => {
  const u = await db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ enabled: isMailEnabled(), email: u?.email || null, verified: !!u?.email_verified_at });
});

// ---------- Demander un code de vérification pour une adresse ----------
router.post('/request', async (req, res) => {
  if (!isMailEnabled()) return res.status(503).json({ error: 'Les emails ne sont pas encore activés sur Kalchat' });

  const email = String(req.body.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse email invalide' });

  const me = await db.prepare('SELECT id, first_name, email, email_verified_at FROM users WHERE id = ?').get(req.user.id);
  if (me.email_verified_at && me.email === email) return res.status(400).json({ error: 'Cette adresse est déjà vérifiée' });

  const taken = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(email, req.user.id);
  if (taken) return res.status(409).json({ error: 'Cette adresse est déjà utilisée par un autre compte' });

  const last = await db.prepare('SELECT created_at FROM email_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
  if (last) {
    const wait = RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - new Date(last.created_at).getTime()) / 1000);
    if (wait > 0) return res.status(429).json({ error: `Patiente ${wait} s avant de redemander un code`, retry_after: wait });
  }
  const hourly = await db.prepare("SELECT COUNT(*) AS n FROM email_codes WHERE user_id = ? AND created_at > NOW() - INTERVAL '1 hour'").get(req.user.id);
  if (hourly.n >= MAX_CODES_PER_HOUR) return res.status(429).json({ error: 'Trop de demandes, réessaie dans une heure' });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const id = uuid();
  await db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(req.user.id);
  await db
    .prepare("INSERT INTO email_codes (id, user_id, email, code_hash, expires_at) VALUES (?, ?, ?, ?, NOW() + (? * INTERVAL '1 minute'))")
    .run(id, req.user.id, email, hashCode(code, req.user.id, email), CODE_TTL_MINUTES);

  try {
    await sendMail({ to: email, ...verificationEmail({ code, firstName: me.first_name }) });
  } catch (err) {
    console.error('Email de vérification non envoyé :', err.message);
    await db.prepare('DELETE FROM email_codes WHERE id = ?').run(id);
    return res.status(502).json({ error: 'Impossible d\'envoyer l\'email pour le moment, vérifie l\'adresse ou réessaie plus tard' });
  }
  res.json({ ok: true, expires_in: CODE_TTL_MINUTES * 60 });
});

// ---------- Saisir le code reçu ----------
router.post('/verify', async (req, res) => {
  const code = String(req.body.code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Le code contient 6 chiffres' });

  const row = await db
    .prepare('SELECT id, email, code_hash, attempts, expires_at FROM email_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(req.user.id);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) await db.prepare('DELETE FROM email_codes WHERE id = ?').run(row.id);
    return res.status(400).json({ error: 'Ce code a expiré, demande-en un nouveau' });
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.prepare('DELETE FROM email_codes WHERE id = ?').run(row.id);
    return res.status(429).json({ error: 'Trop d\'essais, demande un nouveau code' });
  }
  if (!sameHash(hashCode(code, req.user.id, row.email), row.code_hash)) {
    await db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return res.status(400).json({ error: left > 0 ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''})` : 'Code incorrect, demande un nouveau code' });
  }

  const taken = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(row.email, req.user.id);
  if (taken) return res.status(409).json({ error: 'Cette adresse est déjà utilisée par un autre compte' });

  await db.prepare('UPDATE users SET email = ?, email_verified_at = NOW() WHERE id = ?').run(row.email, req.user.id);
  await db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true, email: row.email });
});

module.exports = router;
