const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { extractFilenameFromUrl } = require('../storage');
const { releaseMedia } = require('../mediaCleanup');
const { notify } = require('../notify');
const { isBlockedEitherWay } = require('../blocks');

const router = express.Router();
router.use(authMiddleware);

const MAX_OWNED = 5; // communautés créées par membre (anti-abus)
const NAME_MIN = 3;
const NAME_MAX = 40;
const DESC_MAX = 300;
const JOIN_MODES = ['open', 'approval'];
const INVITES_PER_DAY = 30; // invitations envoyées par membre et par 24 h (anti-spam)

const isManager = (m) => !!m && m.status === 'active' && (m.role === 'owner' || m.role === 'admin');

async function getMember(communityId, userId) {
  return db.prepare('SELECT role, status FROM community_members WHERE community_id = ? AND user_id = ?').get(communityId, userId);
}

async function isStaff(userId) {
  const me = await db.prepare('SELECT is_admin, role FROM users WHERE id = ?').get(userId);
  return !!(me && (me.is_admin || me.role === 'moderator'));
}

const SELECT = `SELECT c.id, c.name, c.description, c.avatar_url, c.join_mode, c.owner_id, c.created_at,
       (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id AND m.status = 'active') AS member_count,
       (SELECT u.username FROM community_invites i JOIN users u ON u.id = i.invited_by WHERE i.community_id = c.id AND i.user_id = ?) AS invited_by,
       me.role AS my_role, me.status AS my_status,
       CASE WHEN me.status = 'active' AND me.role IN ('owner', 'admin')
            THEN (SELECT COUNT(*) FROM community_members p WHERE p.community_id = c.id AND p.status = 'pending') ELSE 0 END AS pending_count
     FROM communities c
     LEFT JOIN community_members me ON me.community_id = c.id AND me.user_id = ?`;

async function getCommunity(id, userId) {
  return db.prepare(`${SELECT} WHERE c.id = ?`).get(userId, userId, id);
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validateFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = cleanText(body.name, NAME_MAX + 1);
    if (name.length < NAME_MIN || name.length > NAME_MAX) return { error: `Le nom doit faire entre ${NAME_MIN} et ${NAME_MAX} caractères` };
    out.name = name;
  }
  if (!partial || body.description !== undefined) {
    out.description = cleanText(body.description, DESC_MAX) || null;
  }
  if (body.avatar_url !== undefined) {
    const url = body.avatar_url ? String(body.avatar_url).slice(0, 500) : null;
    // Seules les photos envoyées sur le stockage de Kalchat sont acceptées (pas d'adresse externe)
    if (url && !extractFilenameFromUrl(url)) return { error: 'Photo invalide' };
    out.avatar_url = url;
  }
  if (!partial || body.join_mode !== undefined) {
    const mode = body.join_mode ?? 'open';
    if (!JOIN_MODES.includes(mode)) return { error: "Mode d'adhésion invalide" };
    out.join_mode = mode;
  }
  return { fields: out };
}

async function nameTaken(name, exceptId = null) {
  const row = await db.prepare('SELECT id FROM communities WHERE LOWER(name) = LOWER(?)').get(name);
  return !!row && row.id !== exceptId;
}

// Une seule notification non lue par personne, type et communauté (évite de spammer si on rejoint/quitte en boucle).
// Une erreur de notification ne doit jamais faire échouer l'action du membre.
async function notifyOnce(req, { user_id, type, community_id }) {
  try {
    const dup = await db
      .prepare('SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND community_id = ? AND is_read = 0 LIMIT 1')
      .get(user_id, req.user.id, type, community_id);
    if (dup) return;
    await notify(req.app.get('io'), { user_id, actor_id: req.user.id, type, community_id });
  } catch (err) {
    console.error('Communauté (notification) :', err.message);
  }
}

// ---------- Liste (les communautés du membre d'abord côté appli ; recherche optionnelle) ----------
router.get('/', async (req, res) => {
  const q = cleanText(req.query.q, 60);
  const rows = q
    ? await db.prepare(`${SELECT} WHERE c.name ILIKE ? OR c.description ILIKE ? ORDER BY member_count DESC, c.created_at DESC LIMIT 100`).all(req.user.id, req.user.id, `%${q}%`, `%${q}%`)
    : await db.prepare(`${SELECT} ORDER BY member_count DESC, c.created_at DESC LIMIT 100`).all(req.user.id, req.user.id);
  res.json(rows);
});

// ---------- Créer une communauté (le créateur en devient le propriétaire) ----------
router.post('/', async (req, res) => {
  const { fields, error } = validateFields(req.body);
  if (error) return res.status(400).json({ error });
  const owned = await db.prepare('SELECT COUNT(*) AS n FROM communities WHERE owner_id = ?').get(req.user.id);
  if (Number(owned.n) >= MAX_OWNED) return res.status(400).json({ error: `Tu peux créer ${MAX_OWNED} communautés maximum` });
  if (await nameTaken(fields.name)) return res.status(409).json({ error: 'Ce nom de communauté existe déjà' });

  const id = uuid();
  await db.prepare('INSERT INTO communities (id, name, description, avatar_url, join_mode, owner_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, fields.name, fields.description, fields.avatar_url ?? null, fields.join_mode, req.user.id);
  await db.prepare("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')").run(id, req.user.id);
  res.status(201).json(await getCommunity(id, req.user.id));
});

router.get('/:id', async (req, res) => {
  const c = await getCommunity(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Communauté introuvable' });
  res.json(c);
});

// ---------- Modifier (propriétaire ou administrateur de la communauté) ----------
router.patch('/:id', async (req, res) => {
  const c = await db.prepare('SELECT id, avatar_url FROM communities WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Communauté introuvable' });
  if (!isManager(await getMember(c.id, req.user.id))) return res.status(403).json({ error: 'Réservé aux administrateurs de la communauté' });
  const { fields, error } = validateFields(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  if (fields.name && (await nameTaken(fields.name, c.id))) return res.status(409).json({ error: 'Ce nom de communauté existe déjà' });
  for (const [key, value] of Object.entries(fields)) {
    await db.prepare(`UPDATE communities SET ${key} = ? WHERE id = ?`).run(value, c.id); // clés issues de validateFields uniquement
  }
  if (fields.avatar_url !== undefined && c.avatar_url && c.avatar_url !== fields.avatar_url) await releaseMedia(c.avatar_url);
  res.json(await getCommunity(c.id, req.user.id));
});

// ---------- Supprimer (propriétaire, ou équipe Kalchat) ----------
router.delete('/:id', async (req, res) => {
  const c = await db.prepare('SELECT id, owner_id, avatar_url FROM communities WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Communauté introuvable' });
  if (c.owner_id !== req.user.id && !(await isStaff(req.user.id))) return res.status(403).json({ error: 'Seul le propriétaire peut supprimer la communauté' });
  await db.prepare('DELETE FROM communities WHERE id = ?').run(c.id);
  await releaseMedia(c.avatar_url);
  res.json({ ok: true });
});

// ---------- Rejoindre (immédiat, ou en demande si la communauté valide les adhésions) ----------
router.post('/:id/join', async (req, res) => {
  const c = await db.prepare('SELECT id, join_mode FROM communities WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Communauté introuvable' });
  const existing = await getMember(c.id, req.user.id);
  if (existing) return res.json({ status: existing.status });
  // Un membre invité rejoint directement, même si la communauté valide les adhésions
  const invite = await db.prepare('SELECT 1 FROM community_invites WHERE community_id = ? AND user_id = ?').get(c.id, req.user.id);
  const status = c.join_mode === 'approval' && !invite ? 'pending' : 'active';
  await db.prepare("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, 'member', ?)").run(c.id, req.user.id, status);
  if (invite) await db.prepare('DELETE FROM community_invites WHERE community_id = ? AND user_id = ?').run(c.id, req.user.id);
  if (status === 'pending') {
    const managers = await db.prepare("SELECT user_id FROM community_members WHERE community_id = ? AND status = 'active' AND role IN ('owner', 'admin')").all(c.id);
    for (const m of managers) await notifyOnce(req, { user_id: m.user_id, type: 'community_request', community_id: c.id });
  }
  res.status(201).json({ status });
});

// ---------- Quitter (ou annuler sa demande) ----------
router.delete('/:id/leave', async (req, res) => {
  const m = await getMember(req.params.id, req.user.id);
  if (!m) return res.json({ ok: true });
  if (m.role === 'owner') return res.status(400).json({ error: 'Le propriétaire ne peut pas quitter sa communauté : supprime-la si tu ne veux plus la gérer' });
  await db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Membres (réservé aux membres ; les demandes en attente ne sont visibles que des administrateurs) ----------
router.get('/:id/members', async (req, res) => {
  const me = await getMember(req.params.id, req.user.id);
  if ((!me || me.status !== 'active') && !(await isStaff(req.user.id))) return res.status(403).json({ error: 'Rejoins la communauté pour voir ses membres' });
  const select = `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, u.badge, u.role AS user_role, m.role, m.status, m.joined_at
                  FROM community_members m JOIN users u ON u.id = m.user_id WHERE m.community_id = ? AND m.status = ?`;
  const members = await db
    .prepare(`${select} ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at ASC LIMIT 500`)
    .all(req.params.id, 'active');
  const pending = isManager(me) ? await db.prepare(`${select} ORDER BY m.joined_at ASC LIMIT 200`).all(req.params.id, 'pending') : [];
  res.json({ members, pending });
});

// ---------- Inviter : recherche de membres à inviter (avec leur état vis-à-vis de la communauté) ----------
async function canInvite(communityId, userId) {
  const c = await db.prepare('SELECT id, join_mode FROM communities WHERE id = ?').get(communityId);
  if (!c) return { error: 'Communauté introuvable', code: 404 };
  const me = await getMember(c.id, userId);
  if (!me || me.status !== 'active') return { error: 'Rejoins la communauté pour inviter des membres', code: 403 };
  if (c.join_mode === 'approval' && !isManager(me)) return { error: 'Dans une communauté sur validation, seuls les administrateurs peuvent inviter', code: 403 };
  return { community: c, me };
}

router.get('/:id/invite-search', async (req, res) => {
  const check = await canInvite(req.params.id, req.user.id);
  if (check.error) return res.status(check.code).json({ error: check.error });
  const term = cleanText(req.query.q, 40);
  if (term.length < 2) return res.json([]);
  const q = `%${term}%`;
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, m.status AS member_status, (i.user_id IS NOT NULL) AS invited
       FROM users u
       LEFT JOIN community_members m ON m.community_id = ? AND m.user_id = u.id
       LEFT JOIN community_invites i ON i.community_id = ? AND i.user_id = u.id
       WHERE (u.username ILIKE ? OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE ?) AND u.id != ? AND u.id != 'kalchat-ai'
         AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ? AND ub.blocked_id = u.id) OR (ub.blocker_id = u.id AND ub.blocked_id = ?))
       ORDER BY u.username LIMIT 20`
    )
    .all(req.params.id, req.params.id, q, q, req.user.id, req.user.id, req.user.id);
  res.json(rows);
});

// ---------- Inviter un membre (il reçoit une notification et peut rejoindre directement) ----------
router.post('/:id/invite', async (req, res) => {
  const check = await canInvite(req.params.id, req.user.id);
  if (check.error) return res.status(check.code).json({ error: check.error });
  const { community, me } = check;
  const targetId = String(req.body.user_id || '');
  if (!targetId || targetId === req.user.id || targetId === 'kalchat-ai') return res.status(400).json({ error: 'Membre invalide' });
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Membre introuvable' });
  if (await isBlockedEitherWay(req.user.id, targetId)) return res.status(400).json({ error: "Impossible d'inviter ce membre" });

  const tm = await getMember(community.id, targetId);
  if (tm?.status === 'active') return res.status(400).json({ error: 'Ce membre est déjà dans la communauté' });
  if (tm?.status === 'pending') {
    if (!isManager(me)) return res.status(400).json({ error: 'Ce membre a déjà demandé à rejoindre : un administrateur va répondre' });
    await db.prepare("UPDATE community_members SET status = 'active', joined_at = NOW() WHERE community_id = ? AND user_id = ?").run(community.id, targetId);
    await notifyOnce(req, { user_id: targetId, type: 'community_approved', community_id: community.id });
    return res.json({ status: 'approved' });
  }
  const already = await db.prepare('SELECT 1 FROM community_invites WHERE community_id = ? AND user_id = ?').get(community.id, targetId);
  if (already) return res.json({ status: 'already_invited' });
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM community_invites WHERE invited_by = ? AND created_at > NOW() - INTERVAL '24 hours'").get(req.user.id);
  if (Number(recent.n) >= INVITES_PER_DAY) return res.status(429).json({ error: `Tu as atteint la limite de ${INVITES_PER_DAY} invitations par jour` });

  await db.prepare('INSERT INTO community_invites (community_id, user_id, invited_by) VALUES (?, ?, ?)').run(community.id, targetId, req.user.id);
  await notifyOnce(req, { user_id: targetId, type: 'community_invite', community_id: community.id });
  res.status(201).json({ status: 'invited' });
});

// ---------- Gérer un membre : approve | reject | remove | promote | demote ----------
router.patch('/:id/members/:userId', async (req, res) => {
  const action = String(req.body.action || '');
  const me = await getMember(req.params.id, req.user.id);
  if (!isManager(me)) return res.status(403).json({ error: 'Réservé aux administrateurs de la communauté' });
  const target = await getMember(req.params.id, req.params.userId);
  if (!target) return res.status(404).json({ error: 'Membre introuvable' });
  if (target.role === 'owner') return res.status(400).json({ error: 'Le propriétaire ne peut pas être modifié' });

  const where = [req.params.id, req.params.userId];
  if (action === 'approve' || action === 'reject') {
    if (target.status !== 'pending') return res.status(400).json({ error: "Ce membre n'a pas de demande en attente" });
    if (action === 'approve') {
      await db.prepare("UPDATE community_members SET status = 'active', joined_at = NOW() WHERE community_id = ? AND user_id = ?").run(...where);
      await notifyOnce(req, { user_id: req.params.userId, type: 'community_approved', community_id: req.params.id });
    } else await db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(...where);
  } else if (action === 'remove') {
    if (target.role === 'admin' && me.role !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut retirer un administrateur' });
    await db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(...where);
  } else if (action === 'promote' || action === 'demote') {
    if (me.role !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut nommer ou retirer un administrateur' });
    if (target.status !== 'active') return res.status(400).json({ error: "Ce membre n'a pas encore rejoint la communauté" });
    await db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?').run(action === 'promote' ? 'admin' : 'member', ...where);
  } else {
    return res.status(400).json({ error: 'Action invalide' });
  }
  res.json({ ok: true });
});

module.exports = router;
