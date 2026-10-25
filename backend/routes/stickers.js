const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { isOwnMediaUrl } = require('../mediaUrl');
const { releaseMedia } = require('../mediaCleanup');

const router = express.Router();
router.use(authMiddleware);

const MAX_PER_USER = 40;
const created = new Map(); // limite de créations : 20 par heure et par membre

// Ma bibliothèque de stickers
router.get('/mine', async (req, res) => {
  const rows = await db.prepare('SELECT id, url, created_at FROM user_stickers WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ stickers: rows, max: MAX_PER_USER });
});

// Ajouter un sticker : le fichier (WebP/PNG, déjà réduit par l'appli) vient d'être envoyé via /api/upload
router.post('/', async (req, res) => {
  const url = String(req.body?.url || '');
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { /* adresse invalide */ }
  if (!url || url.length > 1000 || !isOwnMediaUrl(url) || !/\.(webp|png)$/i.test(pathname)) {
    return res.status(400).json({ error: 'Fichier de sticker invalide' });
  }

  const now = Date.now();
  const recent = (created.get(req.user.id) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Tu as créé beaucoup de stickers, réessaie un peu plus tard' });

  const count = await db.prepare('SELECT COUNT(*) AS n FROM user_stickers WHERE user_id = ?').get(req.user.id);
  if (Number(count?.n) >= MAX_PER_USER) return res.status(400).json({ error: `Tu as atteint la limite de ${MAX_PER_USER} stickers. Supprime-en un pour en créer un nouveau.` });

  const dup = await db.prepare('SELECT id FROM user_stickers WHERE user_id = ? AND url = ?').get(req.user.id, url);
  if (dup) return res.json({ id: dup.id, url });

  recent.push(now);
  created.set(req.user.id, recent);
  if (created.size > 5000) created.clear();

  const id = uuid();
  await db.prepare('INSERT INTO user_stickers (id, user_id, url) VALUES (?, ?, ?)').run(id, req.user.id, url);
  res.status(201).json({ id, url });
});

// Supprimer un de mes stickers (le fichier est effacé s'il n'est plus utilisé nulle part)
router.delete('/:id', async (req, res) => {
  const row = await db.prepare('SELECT id, url FROM user_stickers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Sticker introuvable' });
  await db.prepare('DELETE FROM user_stickers WHERE id = ?').run(row.id);
  await releaseMedia(row.url);
  res.json({ ok: true });
});

module.exports = router;
