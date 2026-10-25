const express = require('express');
const authMiddleware = require('../middleware/auth');
const gifProvider = require('../gifProvider');

const router = express.Router();
router.use(authMiddleware);

// 60 requêtes par minute et par membre (le cache serveur évite de solliciter le fournisseur à chaque fois)
const hits = new Map();

router.get('/', async (req, res) => {
  const now = Date.now();
  const recent = (hits.get(req.user.id) || []).filter((t) => now - t < 60 * 1000);
  if (recent.length >= 60) return res.status(429).json({ error: 'Trop de recherches, réessaie dans un instant' });
  recent.push(now);
  hits.set(req.user.id, recent);
  if (hits.size > 5000) hits.clear();

  if (!gifProvider.isConfigured()) return res.json({ configured: false, items: [], next: null });
  try {
    const type = req.query.type === 'sticker' ? 'sticker' : 'gif';
    const result = await gifProvider.search({ type, q: String(req.query.q || ''), page: req.query.page });
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ configured: true, ...result });
  } catch (err) {
    console.error('GIFs :', err.message);
    res.status(502).json({ error: 'Les GIFs sont indisponibles pour le moment' });
  }
});

module.exports = router;
