const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Annonces de l'équipe vues par les membres : celles en cours (non expirées, non retirées) qu'ils n'ont pas fermées.
const router = express.Router();
router.use(authMiddleware);

const MAX_SHOWN = 3;

router.get('/', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        `SELECT a.id, a.title, a.body, a.created_at, a.expires_at
         FROM announcements a
         WHERE a.deleted_at IS NULL AND a.expires_at > NOW()
           AND NOT EXISTS (SELECT 1 FROM announcement_dismissed d WHERE d.announcement_id = a.id AND d.user_id = ?)
         ORDER BY a.created_at DESC
         LIMIT ?`
      )
      .all(req.user.id, MAX_SHOWN);
    res.json(rows);
  } catch (err) {
    console.error('Annonces :', err.message);
    res.status(500).json({ error: 'Annonces indisponibles' });
  }
});

// Fermer une annonce : elle ne réapparaît plus pour ce membre
router.post('/:id/dismiss', async (req, res) => {
  try {
    const a = await db.prepare('SELECT id FROM announcements WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Annonce introuvable' });
    await db.prepare('INSERT INTO announcement_dismissed (announcement_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(a.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Annonces (fermeture) :', err.message);
    res.status(500).json({ error: "Impossible de fermer l'annonce" });
  }
});

module.exports = router;
