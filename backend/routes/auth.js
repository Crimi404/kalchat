const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { nextUsernameChangeAt } = require('../usernamePolicy');
const ai = require('../ai');

const router = express.Router();

// ---------- Inscription ----------
router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, username, password, avatar_url } = req.body;

    if (!first_name?.trim() || !last_name?.trim()) {
      return res.status(400).json({ error: 'Prénom et nom requis' });
    }
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères' });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris' });
    }

    const id = uuid();
    const password_hash = await bcrypt.hash(password, 10);
    const countRow = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id != ?').get(ai.BOT_ID); // le compte IA ne compte pas
    const isFirstUser = Number(countRow.n) === 0;

    await db
      .prepare(
        'INSERT INTO users (id, username, password_hash, avatar_url, first_name, last_name, is_admin, badge) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, username, password_hash, avatar_url || null, first_name.trim(), last_name.trim(), isFirstUser ? 1 : 0, isFirstUser ? 'gold' : null);

    // Chaque nouveau membre a d'office une discussion avec Kalia (l'IA de Kalchat)
    await ai.ensureConversationFor(id).catch((err) => console.error('Kalia : discussion non créée:', err.message));

    const token = jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id, username, avatar_url: avatar_url || null, first_name, last_name, is_admin: isFirstUser } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Connexion ----------
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Ce compte a été bloqué par un administrateur' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    res.json({
      token,
      user: { id: user.id, username: user.username, avatar_url: user.avatar_url, status_text: user.status_text, badge: user.badge, role: user.role, is_admin: !!user.is_admin },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Profil courant ----------
router.get('/me', authMiddleware, async (req, res) => {
  const user = await db
    .prepare('SELECT id, username, avatar_url, cover_url, location, status_text, bio, badge, role, is_admin, is_blocked, first_name, last_name, created_at, theme, username_changed_at, privacy_online, read_receipts, default_ephemeral FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({
    ...user,
    is_admin: !!user.is_admin,
    is_staff: !!user.is_admin || user.role === 'moderator',
    username_next_change_at: nextUsernameChangeAt(user.username_changed_at),
  });
});

// ---------- Recherche d'utilisateurs (pour démarrer une conversation) ----------
router.get('/search', authMiddleware, async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const users = await db
    .prepare(
      `SELECT id, username, avatar_url, badge, role, first_name, last_name FROM users
       WHERE (username ILIKE ? OR (COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE ?) AND id != ?
         AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ? AND ub.blocked_id = users.id) OR (ub.blocker_id = users.id AND ub.blocked_id = ?))
       LIMIT 20`
    )
    .all(q, q, req.user.id, req.user.id, req.user.id);
  res.json(users);
});

module.exports = router;
