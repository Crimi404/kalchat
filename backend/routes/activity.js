const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Temps passé dans l'application : l'appli envoie un « ping » toutes les 60 secondes tant qu'elle est ouverte au premier plan.
// Le serveur additionne par jour. Les valeurs sont plafonnées pour qu'un client détraqué ne fausse pas les chiffres.
const router = express.Router();
router.use(authMiddleware);

const MAX_PING_SECONDS = 90; // un ping vaut au plus 90 s (l'appli en envoie ~60)
const MIN_GAP_MS = 20 * 1000; // au plus un ping compté toutes les 20 s par membre
const lastPing = new Map();
setInterval(() => {
  const limit = Date.now() - 5 * 60_000;
  for (const [k, t] of lastPing) if (t < limit) lastPing.delete(k);
}, 5 * 60_000).unref();

router.post('/ping', async (req, res) => {
  try {
    const seconds = Math.round(Number(req.body?.seconds));
    if (!Number.isFinite(seconds) || seconds < 1) return res.status(400).json({ error: 'Durée invalide' });
    const now = Date.now();
    if (now - (lastPing.get(req.user.id) || 0) < MIN_GAP_MS) return res.json({ counted: false });
    lastPing.set(req.user.id, now);
    await db
      .prepare(
        `INSERT INTO user_activity_daily (user_id, day, seconds) VALUES (?, (NOW() AT TIME ZONE 'UTC')::date, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET seconds = user_activity_daily.seconds + EXCLUDED.seconds`
      )
      .run(req.user.id, Math.min(seconds, MAX_PING_SECONDS));
    res.json({ counted: true });
  } catch (err) {
    console.error('Activité :', err.message);
    res.status(500).json({ error: "Erreur du serveur d'activité" });
  }
});

module.exports = router;
