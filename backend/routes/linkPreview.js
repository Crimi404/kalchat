const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getLinkPreview } = require('../linkPreview');

const router = express.Router();
router.use(authMiddleware);

// 30 aperçus par minute et par membre (les réponses en cache comptent aussi : simple et sans surprise)
const hits = new Map();

router.get('/', async (req, res) => {
  const now = Date.now();
  const recent = (hits.get(req.user.id) || []).filter((t) => now - t < 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Trop de requêtes, réessaie dans un instant' });
  recent.push(now);
  hits.set(req.user.id, recent);
  if (hits.size > 5000) hits.clear();

  try {
    const preview = await getLinkPreview(String(req.query.url || ''));
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ preview }); // preview = null : aucune métadonnée exploitable (ou adresse refusée) — on ne dit pas pourquoi
  } catch (err) {
    if (err.code === 'BUSY') return res.status(503).json({ error: 'Service occupé' });
    res.json({ preview: null });
  }
});

module.exports = router;
