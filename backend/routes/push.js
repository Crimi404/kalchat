const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { isPushEnabled, pushConfigError, sendPushToUser } = require('../push');

const router = express.Router();
router.use(authMiddleware);

const MAX_DEVICES_PER_USER = 10;

// ---------- État : le serveur sait-il envoyer des notifications, et combien d'appareils du membre sont enregistrés ----------
router.get('/status', async (req, res) => {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?').get(req.user.id);
  res.json({ enabled: isPushEnabled(), devices: n.n, config_error: pushConfigError() });
});

// ---------- Enregistrer l'appareil (jeton Firebase) ----------
router.post('/register', async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token.length < 50 || token.length > 4096) return res.status(400).json({ error: 'Jeton invalide' });
  // Un même appareil ne peut appartenir qu'à un seul compte : si quelqu'un d'autre s'y connecte, il prend la place
  await db
    .prepare('INSERT INTO push_tokens (token, user_id) VALUES (?, ?) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()')
    .run(token, req.user.id);
  // On garde les 10 appareils les plus récents
  await db
    .prepare(
      `DELETE FROM push_tokens WHERE user_id = ? AND token NOT IN (
         SELECT token FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${MAX_DEVICES_PER_USER}
       )`
    )
    .run(req.user.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Oublier l'appareil (déconnexion, notifications désactivées) ----------
router.post('/unregister', async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token) await db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(token, req.user.id);
  res.json({ ok: true });
});

// ---------- Notification de test sur mes appareils ----------
const lastTest = new Map();
router.post('/test', async (req, res) => {
  if (!isPushEnabled()) return res.status(503).json({ error: "Les notifications ne sont pas encore activées sur le serveur" });
  const last = lastTest.get(req.user.id) || 0;
  if (Date.now() - last < 10 * 1000) return res.status(429).json({ error: 'Patiente quelques secondes entre deux tests' });
  lastTest.set(req.user.id, Date.now());
  try {
    const sent = await sendPushToUser(req.user.id, {
      title: 'Kalchat',
      body: 'Les notifications fonctionnent 🎉',
      url: '/notifications',
      tag: 'test',
      type: 'test',
      priority: 'high',
    });
    res.json({ sent });
  } catch (err) {
    console.error('Test push :', err.message);
    res.status(502).json({ error: `Envoi impossible : ${err.message}` });
  }
});

module.exports = router;
