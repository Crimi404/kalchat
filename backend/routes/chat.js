const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');
const { isBlockedEitherWay } = require('../blocks');

const router = express.Router();
router.use(authMiddleware);

const MAX_GROUP_MEMBERS = 50;
const MAX_GROUP_NAME = 50;

// ---------- Utilitaires ----------
function ephemeralLabel(seconds) {
  if (seconds === 86400) return '24 heures';
  if (seconds === 604800) return '7 jours';
  if (seconds === 7776000) return '90 jours';
  return `${seconds} s`;
}

async function areFriends(a, b) {
  const row = await db
    .prepare(
      `SELECT 1 FROM follows WHERE status = 'accepted' AND (
         (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)
       )`
    )
    .get(a, b, b, a);
  return !!row;
}

async function nameOf(userId) {
  const u = await db.prepare('SELECT username, first_name, last_name FROM users WHERE id = ?').get(userId);
  if (!u) return 'Quelqu\'un';
  const full = [u.first_name, u.last_name].filter((x) => x && x.trim()).join(' ').trim();
  return full || u.username;
}

async function getMembership(conversationId, userId) {
  return db
    .prepare('SELECT is_admin, is_favorite FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
}

// Message « système » (ex. « Awa a créé le groupe ») : affiché au centre du chat, pas comme une bulle.
async function addSystemMessage(io, conversationId, actorId, text) {
  const id = uuid();
  await db
    .prepare("INSERT INTO messages (id, conversation_id, sender_id, content, media_type) VALUES (?, ?, ?, ?, 'system')")
    .run(id, conversationId, actorId, text);
  const message = await db
    .prepare(
      `SELECT m.id, m.sender_id, u.username AS sender_username, u.first_name AS sender_first_name, u.last_name AS sender_last_name,
              u.avatar_url AS sender_avatar_url, m.content, m.media_url, m.media_type, m.created_at
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(id);
  io?.to(conversationId).emit('new_message', { conversation_id: conversationId, message });
  return message;
}

// Prévient les membres concernés pour que leur liste de conversations se rafraîchisse en direct.
async function pingMembers(io, conversationId, extraUserIds = []) {
  const members = await db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId);
  const ids = new Set([...members.map((m) => m.user_id), ...extraUserIds]);
  for (const uid of ids) io?.to(`user:${uid}`).emit('conversation_changed', { conversation_id: conversationId });
}

// ---------- Amis avec qui on peut discuter (abonnement accepté dans un sens ou dans l'autre) ----------
router.get('/contacts', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name
       FROM users u
       WHERE u.id != ? AND u.is_blocked = 0
         AND EXISTS (
           SELECT 1 FROM follows f WHERE f.status = 'accepted'
             AND ((f.follower_id = ? AND f.followed_id = u.id) OR (f.follower_id = u.id AND f.followed_id = ?))
         )
         AND (? = '' OR u.username ILIKE ? OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE ?)
       ORDER BY LOWER(COALESCE(NULLIF(u.first_name, ''), u.username)) ASC
       LIMIT 200`
    )
    .all(req.user.id, req.user.id, req.user.id, q, like, like);
  res.json(rows);
});

// ---------- Liste des conversations de l'utilisateur ----------
router.get('/conversations', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT c.id, c.is_group, c.name, c.avatar_url, cm.is_favorite,
              (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > NOW()) ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT media_type FROM messages m WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > NOW()) ORDER BY m.created_at DESC LIMIT 1) AS last_media_type,
              (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > NOW()) ORDER BY m.created_at DESC LIMIT 1) AS last_sender_id,
              (SELECT COALESCE(NULLIF(u.first_name, ''), u.username) FROM messages m JOIN users u ON u.id = m.sender_id
                 WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > NOW()) ORDER BY m.created_at DESC LIMIT 1) AS last_sender_name,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > NOW()) ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > NOW()) AND m.sender_id != ?
                   AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.user_id = ?)) AS unread
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?
       ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id);

  // Pour les discussions 1:1, on ajoute le nom/avatar de l'autre personne
  const enriched = await Promise.all(
    rows.map(async (c) => {
      if (!c.is_group) {
        const other = await db
          .prepare(
            `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name FROM users u
             JOIN conversation_members cm ON cm.user_id = u.id
             WHERE cm.conversation_id = ? AND u.id != ?`
          )
          .get(c.id, req.user.id);
        return { ...c, name: other?.username, username: other?.username, avatar_url: other?.avatar_url, other_user_id: other?.id, badge: other?.badge, role: other?.role, first_name: other?.first_name, last_name: other?.last_name };
      }
      return c;
    })
  );

  res.json(enriched);
});

// ---------- Créer une conversation 1:1 ou un groupe ----------
router.post('/conversations', async (req, res) => {
  try {
    const { is_group = false } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const avatar_url = req.body.avatar_url || null;
    // Sans doublons, sans soi-même
    const member_ids = [...new Set((req.body.member_ids || []).filter((x) => typeof x === 'string' && x !== req.user.id))];

    if (!is_group && member_ids.length !== 1) {
      return res.status(400).json({ error: 'Une conversation privée nécessite exactement un autre membre' });
    }
    if (is_group) {
      if (!name) return res.status(400).json({ error: 'Un groupe doit avoir un nom' });
      if (name.length > MAX_GROUP_NAME) return res.status(400).json({ error: `Nom du groupe : ${MAX_GROUP_NAME} caractères max` });
      if (member_ids.length < 1) return res.status(400).json({ error: 'Choisis au moins un membre pour le groupe' });
      if (member_ids.length + 1 > MAX_GROUP_MEMBERS) return res.status(400).json({ error: `Un groupe peut avoir ${MAX_GROUP_MEMBERS} membres au maximum` });
      // On ne peut ajouter à un groupe que des personnes avec qui on a un abonnement accepté
      for (const uid of member_ids) {
        if (!(await areFriends(req.user.id, uid))) {
          return res.status(403).json({ error: 'Tu ne peux ajouter que des membres avec qui tu es abonné (abonnement accepté)' });
        }
      }
    }

    // Évite de dupliquer une conversation 1:1 déjà existante
    if (!is_group) {
      const otherId = member_ids[0];

      if (!(await areFriends(req.user.id, otherId))) {
        return res.status(403).json({ error: 'Vous devez vous abonner (et être accepté) avant de pouvoir écrire à cette personne' });
      }

      const existing = await db
        .prepare(
          `SELECT c.id FROM conversations c
           JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
           JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
           WHERE c.is_group = 0`
        )
        .get(req.user.id, otherId);
      if (existing) {
        return res.json({ id: existing.id, already_existed: true });
      }
    }

    const id = uuid();
    // Durée « messages éphémères » par défaut choisie dans la confidentialité du créateur
    const prefs = await db.prepare('SELECT default_ephemeral FROM users WHERE id = ?').get(req.user.id);
    const ephemeral = Number(prefs?.default_ephemeral) || 0;
    await db
      .prepare('INSERT INTO conversations (id, is_group, name, avatar_url, created_by, ephemeral_seconds) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, is_group ? 1 : 0, is_group ? name : null, is_group ? avatar_url : null, req.user.id, ephemeral);

    const insertMember = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, is_admin) VALUES (?, ?, ?)');
    await insertMember.run(id, req.user.id, 1);
    for (const uid of member_ids) {
      await insertMember.run(id, uid, 0);
    }

    if (ephemeral > 0) {
      await addSystemMessage(req.app.get('io'), id, req.user.id, `Messages éphémères activés : ${ephemeralLabel(ephemeral)}`);
    }

    if (is_group) {
      const io = req.app.get('io');
      const creator = await nameOf(req.user.id);
      await addSystemMessage(io, id, req.user.id, `${creator} a créé le groupe « ${name} »`);
      for (const uid of member_ids) {
        await notify(io, { user_id: uid, actor_id: req.user.id, type: 'group_add', conversation_id: id });
      }
      await pingMembers(io, id);
    }

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Détails d'une conversation (membres, rôle, favori) ----------
router.get('/conversations/:id', async (req, res) => {
  const me = await getMembership(req.params.id, req.user.id);
  if (!me) return res.status(403).json({ error: 'Accès refusé' });

  const conv = await db.prepare('SELECT id, is_group, name, avatar_url, created_by, created_at, ephemeral_seconds FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable' });

  const members = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.role, u.first_name, u.last_name, cm.is_admin
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ?
       ORDER BY cm.is_admin DESC, cm.joined_at ASC`
    )
    .all(req.params.id);

  res.json({ ...conv, is_favorite: me.is_favorite, my_is_admin: me.is_admin, members });
});

// ---------- Modifier le nom / la photo d'un groupe (administrateurs du groupe) ----------
router.patch('/conversations/:id', async (req, res) => {
  const me = await getMembership(req.params.id, req.user.id);
  if (!me) return res.status(403).json({ error: 'Accès refusé' });
  const conv = await db.prepare('SELECT id, is_group, name FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !conv.is_group) return res.status(404).json({ error: 'Groupe introuvable' });
  if (!me.is_admin) return res.status(403).json({ error: 'Seuls les administrateurs du groupe peuvent le modifier' });

  const io = req.app.get('io');
  if (typeof req.body.name === 'string') {
    const name = req.body.name.trim();
    if (!name) return res.status(400).json({ error: 'Le nom du groupe ne peut pas être vide' });
    if (name.length > MAX_GROUP_NAME) return res.status(400).json({ error: `Nom du groupe : ${MAX_GROUP_NAME} caractères max` });
    if (name !== conv.name) {
      await db.prepare('UPDATE conversations SET name = ? WHERE id = ?').run(name, req.params.id);
      await addSystemMessage(io, req.params.id, req.user.id, `${await nameOf(req.user.id)} a renommé le groupe en « ${name} »`);
    }
  }
  if (typeof req.body.avatar_url === 'string') {
    await db.prepare('UPDATE conversations SET avatar_url = ? WHERE id = ?').run(req.body.avatar_url || null, req.params.id);
  }
  await pingMembers(io, req.params.id);
  res.json({ ok: true });
});

// ---------- Ajouter des membres à un groupe (administrateurs, parmi ses amis) ----------
router.post('/conversations/:id/members', async (req, res) => {
  const me = await getMembership(req.params.id, req.user.id);
  if (!me) return res.status(403).json({ error: 'Accès refusé' });
  const conv = await db.prepare('SELECT id, is_group FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !conv.is_group) return res.status(404).json({ error: 'Groupe introuvable' });
  if (!me.is_admin) return res.status(403).json({ error: 'Seuls les administrateurs du groupe peuvent ajouter des membres' });

  const wanted = [...new Set([...(req.body.user_ids || []), ...(req.body.user_id ? [req.body.user_id] : [])])].filter((x) => typeof x === 'string');
  if (!wanted.length) return res.status(400).json({ error: 'Aucun membre choisi' });

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?').get(req.params.id);
  if (countRow.n + wanted.length > MAX_GROUP_MEMBERS) {
    return res.status(400).json({ error: `Un groupe peut avoir ${MAX_GROUP_MEMBERS} membres au maximum` });
  }

  const io = req.app.get('io');
  const adder = await nameOf(req.user.id);
  const added = [];
  for (const uid of wanted) {
    const already = await getMembership(req.params.id, uid);
    if (already) continue;
    if (!(await areFriends(req.user.id, uid))) {
      return res.status(403).json({ error: 'Tu ne peux ajouter que des membres avec qui tu es abonné (abonnement accepté)' });
    }
    await db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.params.id, uid);
    added.push(uid);
  }
  for (const uid of added) {
    await addSystemMessage(io, req.params.id, req.user.id, `${adder} a ajouté ${await nameOf(uid)}`);
    await notify(io, { user_id: uid, actor_id: req.user.id, type: 'group_add', conversation_id: req.params.id });
  }
  await pingMembers(io, req.params.id);
  res.json({ ok: true, added: added.length });
});

// ---------- Retirer un membre (administrateur) ou quitter le groupe (soi-même) ----------
router.delete('/conversations/:id/members/:userId', async (req, res) => {
  const me = await getMembership(req.params.id, req.user.id);
  if (!me) return res.status(403).json({ error: 'Accès refusé' });
  const conv = await db.prepare('SELECT id, is_group FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !conv.is_group) return res.status(404).json({ error: 'Groupe introuvable' });

  const targetId = req.params.userId;
  const leaving = targetId === req.user.id;
  if (!leaving && !me.is_admin) return res.status(403).json({ error: 'Seuls les administrateurs du groupe peuvent retirer un membre' });
  const target = await getMembership(req.params.id, targetId);
  if (!target) return res.status(404).json({ error: 'Ce membre ne fait pas partie du groupe' });

  const io = req.app.get('io');
  const actor = await nameOf(req.user.id);
  const targetName = leaving ? actor : await nameOf(targetId);

  // Le message système est écrit avant le départ pour garder une trace dans l'historique
  await addSystemMessage(io, req.params.id, req.user.id, leaving ? `${actor} a quitté le groupe` : `${actor} a retiré ${targetName}`);
  await db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(req.params.id, targetId);

  // La personne retirée ne doit plus recevoir les messages en direct
  try {
    const sockets = await io?.in(`user:${targetId}`).fetchSockets();
    (sockets || []).forEach((s) => s.leave(req.params.id));
  } catch { /* sans conséquence */ }

  const left = await db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?').get(req.params.id);
  if (left.n === 0) {
    await db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  } else {
    // S'il ne reste aucun administrateur, le membre le plus ancien le devient
    const admins = await db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ? AND is_admin = 1').get(req.params.id);
    if (admins.n === 0) {
      const oldest = await db
        .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at ASC LIMIT 1')
        .get(req.params.id);
      if (oldest) {
        await db.prepare('UPDATE conversation_members SET is_admin = 1 WHERE conversation_id = ? AND user_id = ?').run(req.params.id, oldest.user_id);
      }
    }
    await pingMembers(io, req.params.id, [targetId]);
  }
  io?.to(`user:${targetId}`).emit('conversation_changed', { conversation_id: req.params.id });
  res.json({ ok: true });
});

// ---------- Mettre / retirer une conversation des favoris (propre à chaque membre) ----------
router.post('/conversations/:id/favorite', async (req, res) => {
  const me = await getMembership(req.params.id, req.user.id);
  if (!me) return res.status(403).json({ error: 'Accès refusé' });
  const next = me.is_favorite ? 0 : 1;
  await db.prepare('UPDATE conversation_members SET is_favorite = ? WHERE conversation_id = ? AND user_id = ?').run(next, req.params.id, req.user.id);
  res.json({ favorite: !!next });
});

// ---------- Messages éphémères : durée de vie des NOUVEAUX messages (0 = désactivé) ----------
// Discussion privée : chacun des deux peut changer ; groupe : seulement les administrateurs.
router.post('/conversations/:id/ephemeral', async (req, res) => {
  const me = await getMembership(req.params.id, req.user.id);
  if (!me) return res.status(403).json({ error: 'Accès refusé' });
  const conv = await db.prepare('SELECT id, is_group, ephemeral_seconds FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable' });
  if (conv.is_group && !me.is_admin) return res.status(403).json({ error: 'Seuls les administrateurs du groupe peuvent changer cette option' });

  const seconds = Number(req.body.seconds);
  if (![0, 86400, 604800, 7776000].includes(seconds)) return res.status(400).json({ error: 'Durée invalide' });
  if (seconds === conv.ephemeral_seconds) return res.json({ ok: true, seconds });

  const io = req.app.get('io');
  await db.prepare('UPDATE conversations SET ephemeral_seconds = ? WHERE id = ?').run(seconds, req.params.id);
  const who = await nameOf(req.user.id);
  await addSystemMessage(
    io,
    req.params.id,
    req.user.id,
    seconds > 0 ? `${who} a activé les messages éphémères : ${ephemeralLabel(seconds)}` : `${who} a désactivé les messages éphémères`
  );
  await pingMembers(io, req.params.id);
  res.json({ ok: true, seconds });
});

// ---------- Historique des messages d'une conversation ----------
router.get('/conversations/:id/messages', async (req, res) => {
  const isMember = await db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Accès refusé' });

  const messages = await db
    .prepare(
      `SELECT m.id, m.sender_id, u.username AS sender_username, u.first_name AS sender_first_name, u.last_name AS sender_last_name,
              u.avatar_url AS sender_avatar_url, u.badge AS sender_badge, u.role AS sender_role,
              m.content, m.media_url, m.media_type, m.media_duration, m.created_at,
              EXISTS(SELECT 1 FROM message_reads r JOIN users ru ON ru.id = r.user_id WHERE r.message_id = m.id AND r.user_id != m.sender_id AND ru.read_receipts = 1) AS seen
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? AND (m.expires_at IS NULL OR m.expires_at > NOW()) ORDER BY m.created_at ASC LIMIT 200`
    )
    .all(req.params.id);

  res.json(messages);
});

// ---------- Envoyer un message (aussi disponible via Socket.io) ----------
router.post('/conversations/:id/messages', async (req, res) => {
  const { content, media_url, media_type } = req.body;
  const isMember = await db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Accès refusé' });
  // « system » est réservé aux messages automatiques du serveur
  if (media_type === 'system' || (media_type && String(media_type).endsWith('_expired'))) {
    return res.status(400).json({ error: 'Type de média invalide' });
  }

  // Message vocal : 2 minutes maximum (une petite marge est tolérée pour l'arrondi côté appareil)
  let duration = null;
  if (media_type === 'audio') {
    duration = Math.round(Number(req.body.media_duration));
    if (!Number.isFinite(duration) || duration < 1) duration = null;
    if (duration && duration > 125) return res.status(400).json({ error: 'Un message vocal dure 2 minutes maximum' });
    if (duration && duration > 120) duration = 120;
  }

  // Discussion privée : impossible d'écrire si l'un des deux a bloqué l'autre
  const convRow = await db.prepare('SELECT is_group, ephemeral_seconds FROM conversations WHERE id = ?').get(req.params.id);
  if (convRow && !convRow.is_group) {
    const peer = await db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(req.params.id, req.user.id);
    if (peer && (await isBlockedEitherWay(req.user.id, peer.user_id))) {
      return res.status(403).json({ error: 'Tu ne peux pas envoyer de message à ce compte' });
    }
  }
  const eph = Number(convRow?.ephemeral_seconds) || 0;
  const expiresAt = eph > 0 ? new Date(Date.now() + eph * 1000).toISOString() : null;

  const id = uuid();
  await db
    .prepare('INSERT INTO messages (id, conversation_id, sender_id, content, media_url, media_type, media_duration, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content || null, media_url || null, media_type || null, duration, expiresAt);

  const message = await db
    .prepare(
      `SELECT m.id, m.sender_id, u.username AS sender_username, u.first_name AS sender_first_name, u.last_name AS sender_last_name,
              u.avatar_url AS sender_avatar_url, u.badge AS sender_badge, u.role AS sender_role,
              m.content, m.media_url, m.media_type, m.media_duration, m.created_at
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(id);

  // Diffusion en temps réel si Socket.io est initialisé
  const io = req.app.get('io');
  io?.to(req.params.id).emit('new_message', { conversation_id: req.params.id, message });

  const otherMembers = await db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?')
    .all(req.params.id, req.user.id);
  for (const m of otherMembers) {
    await notify(io, { user_id: m.user_id, actor_id: req.user.id, type: 'message', conversation_id: req.params.id, message_id: id });
  }

  res.status(201).json(message);
});

// ---------- Marquer les messages reçus comme lus ----------
router.post('/conversations/:id/read', async (req, res) => {
  const isMember = await db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Accès refusé' });

  await db
    .prepare(
      `INSERT INTO message_reads (message_id, user_id)
       SELECT m.id, ? FROM messages m WHERE m.conversation_id = ? AND m.sender_id != ?
       ON CONFLICT DO NOTHING`
    )
    .run(req.user.id, req.params.id, req.user.id);
  await db
    .prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type IN ('message', 'group_add') AND conversation_id = ?")
    .run(req.user.id, req.params.id);

  req.app.get('io')?.to(req.params.id).emit('messages_read', { conversation_id: req.params.id, reader_id: req.user.id });
  res.json({ ok: true });
});

// ---------- Supprimer son propre message ----------
router.delete('/messages/:id', async (req, res) => {
  const m = await db.prepare('SELECT id, sender_id, conversation_id, media_type FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message introuvable' });
  if (m.sender_id !== req.user.id || m.media_type === 'system') return res.status(403).json({ error: 'Non autorisé' });
  await db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  req.app.get('io')?.to(m.conversation_id).emit('message_deleted', { conversation_id: m.conversation_id, message_id: m.id });
  res.json({ ok: true });
});

module.exports = router;
