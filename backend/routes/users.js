const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');
const { USERNAME_RE, nextUsernameChangeAt } = require('../usernamePolicy');

const router = express.Router();
router.use(authMiddleware);

async function followStatusBetween(aId, bId) {
  // Statut de la relation vue depuis "aId" vers "bId"
  const row = await db.prepare('SELECT status FROM follows WHERE follower_id = ? AND followed_id = ?').get(aId, bId);
  return row?.status || null;
}

async function canMessage(aId, bId) {
  const row = await db
    .prepare(
      `SELECT 1 FROM follows
       WHERE status = 'accepted' AND (
         (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)
       )`
    )
    .get(aId, bId, bId, aId);
  return !!row;
}

// ---------- Mon propre profil (édition) ----------
router.patch('/me', async (req, res) => {
  const { bio, avatar_url, cover_url, location, status_text, first_name, last_name } = req.body;
  await db
    .prepare(
      `UPDATE users SET
         bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url), cover_url = COALESCE(?, cover_url),
         location = COALESCE(?, location), status_text = COALESCE(?, status_text),
         first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name)
       WHERE id = ?`
    )
    .run(bio ?? null, avatar_url ?? null, cover_url ?? null, location ?? null, status_text ?? null, first_name ?? null, last_name ?? null, req.user.id);

  const user = await db
    .prepare('SELECT id, username, avatar_url, cover_url, location, bio, status_text, badge, role, first_name, last_name, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  res.json(user);
});

// ---------- Paramètres : thème de l'application (clair / sombre) ----------
router.patch('/me/settings', async (req, res) => {
  const { theme } = req.body;
  if (theme !== 'dark' && theme !== 'light') {
    return res.status(400).json({ error: 'Thème invalide' });
  }
  await db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.user.id);
  res.json({ theme });
});

// ---------- Paramètres : changer son nom d'utilisateur (1 fois tous les 60 jours) ----------
// Vérification d'identité : pour l'instant le mot de passe. Quand la vérification e-mail sera
// branchée, c'est ici (et seulement ici) qu'il faudra exiger le code reçu par e-mail à la place.
async function verifyIdentityForUsernameChange(user, body) {
  const password = String(body.password ?? '');
  if (!password) return { ok: false, error: 'Entre ton mot de passe pour confirmer' };
  const valid = await bcrypt.compare(password, user.password_hash);
  // Attention : on évite le code 401, le site le prendrait pour une session expirée et te déconnecterait.
  return valid ? { ok: true } : { ok: false, error: 'Mot de passe incorrect' };
}

router.post('/me/username', async (req, res) => {
  try {
    const wanted = String(req.body.username ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME_RE.test(wanted)) {
      return res.status(400).json({ error: 'Nom d\'utilisateur : 3 à 20 caractères, minuscules, chiffres et _ uniquement' });
    }

    const user = await db
      .prepare('SELECT id, username, password_hash, username_changed_at FROM users WHERE id = ?')
      .get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });

    if (wanted === user.username) {
      return res.status(400).json({ error: 'C\'est déjà ton nom d\'utilisateur' });
    }

    const next = nextUsernameChangeAt(user.username_changed_at);
    if (next) {
      const when = new Date(next).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      return res.status(403).json({ error: `Tu pourras changer ton nom d'utilisateur à partir du ${when}`, next_change_at: next });
    }

    const identity = await verifyIdentityForUsernameChange(user, req.body);
    if (!identity.ok) return res.status(403).json({ error: identity.error });

    const taken = await db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
      .get(wanted, req.user.id);
    if (taken) return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris' });

    try {
      await db.prepare('UPDATE users SET username = ?, username_changed_at = NOW() WHERE id = ?').run(wanted, req.user.id);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris' });
      throw err;
    }

    const row = await db.prepare('SELECT username, username_changed_at FROM users WHERE id = ?').get(req.user.id);
    // Le jeton contient le nom d'utilisateur : on en émet un nouveau avec le bon pseudo.
    const token = jwt.sign({ id: req.user.id, username: row.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      username: row.username,
      username_changed_at: row.username_changed_at,
      username_next_change_at: nextUsernameChangeAt(row.username_changed_at),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Demandes d'abonnement reçues, en attente ----------
router.get('/me/requests', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT f.follower_id, f.created_at, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---------- Demandes d'abonnement envoyées, en attente ----------
router.get('/me/sent-requests', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT f.followed_id, f.created_at, u.username, u.avatar_url
       FROM follows f JOIN users u ON u.id = f.followed_id
       WHERE f.follower_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---------- Répondre à une demande d'abonnement ----------
router.post('/requests/:followerId/respond', async (req, res) => {
  const { accept } = req.body;
  const reqRow = await db
    .prepare("SELECT * FROM follows WHERE follower_id = ? AND followed_id = ? AND status = 'pending'")
    .get(req.params.followerId, req.user.id);
  if (!reqRow) return res.status(404).json({ error: 'Demande introuvable' });

  if (accept) {
    await db
      .prepare("UPDATE follows SET status = 'accepted', responded_at = NOW() WHERE follower_id = ? AND followed_id = ?")
      .run(req.params.followerId, req.user.id);
    await notify(req.app.get('io'), { user_id: req.params.followerId, actor_id: req.user.id, type: 'follow_accept' });
  } else {
    await db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.params.followerId, req.user.id);
  }
  res.json({ ok: true });
});

// ---------- Profil public d'un utilisateur ----------
router.get('/:username', async (req, res) => {
  const user = await db
    .prepare('SELECT id, username, avatar_url, cover_url, location, bio, status_text, badge, role, first_name, last_name, is_blocked, created_at FROM users WHERE username = ?')
    .get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const followerRow = await db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ? AND status = 'accepted'").get(user.id);
  const followingRow = await db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? AND status = 'accepted'").get(user.id);
  const postRow = await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?').get(user.id);

  const isMe = user.id === req.user.id;
  const relationship = isMe ? 'me' : (await followStatusBetween(req.user.id, user.id)) || 'none';

  res.json({
    ...user,
    follower_count: followerRow.n,
    following_count: followingRow.n,
    post_count: postRow.n,
    relationship,
    can_message: isMe ? false : await canMessage(req.user.id, user.id),
  });
});

// ---------- Liste des abonnés / abonnements d'un utilisateur ----------
router.get('/:username/followers', async (req, res) => {
  const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = ? AND f.status = 'accepted'
       ORDER BY f.responded_at DESC`
    )
    .all(user.id);
  res.json(rows);
});

router.get('/:username/following', async (req, res) => {
  const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM follows f JOIN users u ON u.id = f.followed_id
       WHERE f.follower_id = ? AND f.status = 'accepted'
       ORDER BY f.responded_at DESC`
    )
    .all(user.id);
  res.json(rows);
});

// ---------- Envoyer une demande d'abonnement ----------
router.post('/:username/follow', async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Impossible de s\'abonner à soi-même' });

  const existing = await followStatusBetween(req.user.id, target.id);
  if (existing) return res.json({ status: existing });

  await db.prepare("INSERT INTO follows (follower_id, followed_id, status) VALUES (?, ?, 'pending')").run(req.user.id, target.id);
  await notify(req.app.get('io'), { user_id: target.id, actor_id: req.user.id, type: 'follow_request' });
  res.status(201).json({ status: 'pending' });
});

// ---------- Se désabonner / annuler une demande ----------
router.delete('/:username/follow', async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.user.id, target.id);
  res.json({ status: 'none' });
});

module.exports = router;
