const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');
const { isBlockedEitherWay } = require('../blocks');
const { USERNAME_RE, nextUsernameChangeAt } = require('../usernamePolicy');
const { releaseMedia, releaseMany } = require('../mediaCleanup');
const { isMailEnabled, sendMail, passwordChangedEmail } = require('../mailer');

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
  const before = await db.prepare('SELECT avatar_url, cover_url FROM users WHERE id = ?').get(req.user.id);
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
  // Les anciennes photos remplacées ne servent plus : on les retire du stockage
  if (before?.avatar_url && before.avatar_url !== user.avatar_url) await releaseMedia(before.avatar_url);
  if (before?.cover_url && before.cover_url !== user.cover_url) await releaseMedia(before.cover_url);
  res.json(user);
});

// ---------- Paramètres : thème de l'application (clair / sombre) ----------
router.patch('/me/settings', async (req, res) => {
  const { theme, privacy_online, read_receipts, default_ephemeral } = req.body;
  const sets = [];
  const params = [];

  if (theme !== undefined) {
    if (theme !== 'dark' && theme !== 'light') return res.status(400).json({ error: 'Thème invalide' });
    sets.push('theme = ?');
    params.push(theme);
  }
  if (privacy_online !== undefined) {
    if (!['everyone', 'friends', 'nobody'].includes(privacy_online)) return res.status(400).json({ error: 'Valeur invalide pour la présence en ligne' });
    sets.push('privacy_online = ?');
    params.push(privacy_online);
  }
  if (read_receipts !== undefined) {
    sets.push('read_receipts = ?');
    params.push(read_receipts ? 1 : 0);
  }
  if (default_ephemeral !== undefined) {
    // 0 = désactivé, sinon 24 h, 7 jours ou 90 jours
    if (![0, 86400, 604800, 7776000].includes(Number(default_ephemeral))) return res.status(400).json({ error: 'Durée invalide' });
    sets.push('default_ephemeral = ?');
    params.push(Number(default_ephemeral));
  }
  if (!sets.length) return res.status(400).json({ error: 'Aucun réglage à modifier' });

  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.user.id);
  if (privacy_online !== undefined) void req.app.get('broadcastPresence')?.();

  const row = await db.prepare('SELECT theme, privacy_online, read_receipts, default_ephemeral FROM users WHERE id = ?').get(req.user.id);
  res.json(row);
});

// ---------- Paramètres : changer son mot de passe ----------
router.post('/me/password', async (req, res) => {
  try {
    const current = String(req.body.current_password ?? '');
    const next = String(req.body.new_password ?? '');
    if (!current || !next) return res.status(400).json({ error: 'Remplis tous les champs' });
    if (next.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 6 caractères' });
    if (next === current) return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\'ancien' });

    const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });
    // Pas de code 401 ici : le site le prendrait pour une session expirée et te déconnecterait.
    if (!(await bcrypt.compare(current, user.password_hash))) return res.status(403).json({ error: 'Mot de passe actuel incorrect' });

    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(next, 10), req.user.id);
    // Alerte de sécurité par email si l'adresse est vérifiée
    if (isMailEnabled()) {
      const me = await db.prepare('SELECT email, email_verified_at, first_name FROM users WHERE id = ?').get(req.user.id);
      if (me?.email && me.email_verified_at) {
        sendMail({ to: me.email, ...passwordChangedEmail({ firstName: me.first_name }) }).catch((err) => console.error('Email de confirmation non envoyé :', err.message));
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Paramètres : supprimer définitivement son compte ----------
router.delete('/me', async (req, res) => {
  try {
    const password = String(req.body?.password ?? '');
    if (!password) return res.status(400).json({ error: 'Entre ton mot de passe pour confirmer' });

    const user = await db.prepare('SELECT id, password_hash, is_admin FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });
    if (!(await bcrypt.compare(password, user.password_hash))) return res.status(403).json({ error: 'Mot de passe incorrect' });

    if (user.is_admin) {
      const others = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?').get(user.id);
      if (Number(others.n) === 0) {
        return res.status(403).json({ error: 'Tu es le seul administrateur : nomme un autre administrateur avant de supprimer ton compte' });
      }
    }

    // Groupes dont il est le seul admin : le membre le plus ancien reprend la main
    const adminGroups = await db
      .prepare('SELECT cm.conversation_id FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id WHERE cm.user_id = ? AND c.is_group = 1 AND cm.is_admin = 1')
      .all(user.id);
    for (const g of adminGroups) {
      const other = await db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ? AND is_admin = 1 AND user_id != ?').get(g.conversation_id, user.id);
      if (Number(other.n) === 0) {
        const oldest = await db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? ORDER BY joined_at ASC LIMIT 1').get(g.conversation_id, user.id);
        if (oldest) await db.prepare('UPDATE conversation_members SET is_admin = 1 WHERE conversation_id = ? AND user_id = ?').run(g.conversation_id, oldest.user_id);
      }
    }

    // Fichiers de l'utilisateur à retirer du stockage une fois son compte supprimé
    const ownUrls = [
      ...(await db.prepare('SELECT media_url AS url FROM posts WHERE user_id = ? AND media_url IS NOT NULL').all(user.id)),
      ...(await db.prepare("SELECT media_url AS url FROM stories WHERE user_id = ? AND media_url IS NOT NULL AND media_url != ''").all(user.id)),
      ...(await db.prepare('SELECT media_url AS url FROM messages WHERE sender_id = ? AND media_url IS NOT NULL').all(user.id)),
      ...(await db.prepare('SELECT avatar_url AS url FROM users WHERE id = ? AND avatar_url IS NOT NULL').all(user.id)),
      ...(await db.prepare('SELECT cover_url AS url FROM users WHERE id = ? AND cover_url IS NOT NULL').all(user.id)),
    ].map((r) => r.url);

    // Conversations privées supprimées ; les groupes créés par lui restent (sans créateur)
    await db.prepare('DELETE FROM conversations WHERE is_group = 0 AND id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)').run(user.id);
    await db.prepare('UPDATE conversations SET created_by = NULL WHERE created_by = ?').run(user.id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    // Groupes devenus vides
    await db.prepare('DELETE FROM conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM conversation_members)').run();
    await releaseMany(ownUrls);

    req.app.get('io')?.in(`user:${user.id}`).disconnectSockets(true);
    void req.app.get('broadcastPresence')?.();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Comptes que j'ai bloqués ----------
router.get('/me/blocked', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, b.created_at
       FROM user_blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
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
  const blockedByMe = isMe ? false : !!(await db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, user.id));
  const blockedMe = isMe ? false : !!(await db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').get(user.id, req.user.id));

  res.json({
    ...user,
    follower_count: followerRow.n,
    following_count: followingRow.n,
    post_count: postRow.n,
    relationship,
    blocked_by_me: blockedByMe,
    blocked_me: blockedMe,
    // Tout le monde peut écrire : sans abonnement accepté, c'est une demande de message (voir chat.js)
    can_message: !(isMe || blockedByMe || blockedMe),
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

  if (await isBlockedEitherWay(req.user.id, target.id)) {
    return res.status(403).json({ error: 'Action impossible avec ce compte' });
  }

  const existing = await followStatusBetween(req.user.id, target.id);
  if (existing) return res.json({ status: existing });

  // Le compte IA accepte tout le monde d'office
  if (target.id === 'kalchat-ai') {
    await db.prepare("INSERT INTO follows (follower_id, followed_id, status) VALUES (?, ?, 'accepted')").run(req.user.id, target.id);
    return res.status(201).json({ status: 'accepted' });
  }

  await db.prepare("INSERT INTO follows (follower_id, followed_id, status) VALUES (?, ?, 'pending')").run(req.user.id, target.id);
  await notify(req.app.get('io'), { user_id: target.id, actor_id: req.user.id, type: 'follow_request' });
  res.status(201).json({ status: 'pending' });
});

// ---------- Bloquer un compte (coupe aussi les abonnements dans les deux sens) ----------
router.post('/:username/block', async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas te bloquer toi-même' });

  await db.prepare('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, target.id);
  await db
    .prepare('DELETE FROM follows WHERE (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)')
    .run(req.user.id, target.id, target.id, req.user.id);
  void req.app.get('broadcastPresence')?.();
  res.json({ blocked: true });
});

router.delete('/:username/block', async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  await db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, target.id);
  res.json({ blocked: false });
});

// ---------- Se désabonner / annuler une demande ----------
router.delete('/:username/follow', async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.user.id, target.id);
  res.json({ status: 'none' });
});

module.exports = router;
