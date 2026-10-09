const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { extractFilenameFromUrl } = require('../storage');
const { releaseMedia } = require('../mediaCleanup');

const router = express.Router();
router.use(authMiddleware);

const MAX_OWNED = 5; // communautés créées par membre (anti-abus)
const NAME_MIN = 3;
const NAME_MAX = 40;
const DESC_MAX = 300;
const JOIN_MODES = ['open', 'approval'];

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
       me.role AS my_role, me.status AS my_status,
       CASE WHEN me.status = 'active' AND me.role IN ('owner', 'admin')
            THEN (SELECT COUNT(*) FROM community_members p WHERE p.community_id = c.id AND p.status = 'pending') ELSE 0 END AS pending_count
     FROM communities c
     LEFT JOIN community_members me ON me.community_id = c.id AND me.user_id = ?`;

async function getCommunity(id, userId) {
  return db.prepare(`${SELECT} WHERE c.id = ?`).get(userId, id);
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

// ---------- Liste (les communautés du membre d'abord côté appli ; recherche optionnelle) ----------
router.get('/', async (req, res) => {
  const q = cleanText(req.query.q, 60);
  const rows = q
    ? await db.prepare(`${SELECT} WHERE c.name ILIKE ? OR c.description ILIKE ? ORDER BY member_count DESC, c.created_at DESC LIMIT 100`).all(req.user.id, `%${q}%`, `%${q}%`)
    : await db.prepare(`${SELECT} ORDER BY member_count DESC, c.created_at DESC LIMIT 100`).all(req.user.id);
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
  const status = c.join_mode === 'approval' ? 'pending' : 'active';
  await db.prepare("INSERT INTO community_members (community_id, user_id, role, status) VALUES (?, ?, 'member', ?)").run(c.id, req.user.id, status);
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
    if (action === 'approve') await db.prepare("UPDATE community_members SET status = 'active', joined_at = NOW() WHERE community_id = ? AND user_id = ?").run(...where);
    else await db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(...where);
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
