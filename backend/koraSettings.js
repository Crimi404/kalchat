const { v4: uuid } = require('uuid');
const db = require('./db');

/**
 * Réglages de Kora IA modifiables depuis la page Administration (sans redéployer),
 * et journal d'événements pour les statistiques.
 *
 * Les valeurs par défaut reprennent les variables d'environnement existantes :
 * tant qu'un réglage n'a pas été modifié dans l'admin, rien ne change.
 */
const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

const DEFAULTS = {
  replies_enabled: true, // réponses en messages privés
  comments_enabled: true, // réponses en commentaires (@kora)
  images_enabled: true, // génération d'images (🎨 / /image)
  vision_enabled: false, // lecture des images envoyées (désactivée tant que le quota gratuit ne le permet pas)
  daily_post_enabled: String(process.env.KORA_DAILY_POST || '').toLowerCase() !== 'off',
  personalize_enabled: true, // Kora connaît le prénom, le pseudo et la bio (profil public) du membre en messages privés
  msg_per_hour: 25,
  comment_per_hour: 10,
  vision_per_hour: num(process.env.VISION_HOURLY_LIMIT, 10),
  image_per_day: num(process.env.IMAGE_DAILY_LIMIT, 5),
  image_global_per_day: num(process.env.IMAGE_GLOBAL_DAILY_LIMIT, 150),
};

const BOOLEANS = ['replies_enabled', 'comments_enabled', 'images_enabled', 'vision_enabled', 'daily_post_enabled', 'personalize_enabled'];
// Bornes des quotas (min, max)
const LIMITS = {
  msg_per_hour: [1, 200],
  comment_per_hour: [1, 100],
  vision_per_hour: [1, 100],
  image_per_day: [0, 50],
  image_global_per_day: [0, 2000],
};

const cache = new Map(Object.entries(DEFAULTS));

function get(key) {
  return cache.get(key);
}

function all() {
  return Object.fromEntries(cache.entries());
}

function parse(key, raw) {
  if (BOOLEANS.includes(key)) return raw === 'true' || raw === true;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULTS[key];
}

/** Charge les réglages enregistrés (à appeler au démarrage). En cas d'erreur, les valeurs par défaut restent actives. */
async function load() {
  try {
    const rows = await db.prepare('SELECT key, value FROM kora_settings').all();
    for (const r of rows) {
      if (r.key in DEFAULTS) cache.set(r.key, parse(r.key, r.value));
    }
  } catch (err) {
    console.error('Kora (réglages) :', err.message);
  }
}

/** Valide et enregistre un ensemble de réglages. Renvoie tous les réglages à jour. */
async function update(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) continue;
    if (BOOLEANS.includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`Valeur invalide pour « ${key} »`);
      clean[key] = value;
    } else {
      const n = Math.round(Number(value));
      const [min, max] = LIMITS[key];
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`« ${key} » doit être compris entre ${min} et ${max}`);
      clean[key] = n;
    }
  }
  for (const [key, value] of Object.entries(clean)) {
    await db
      .prepare(
        `INSERT INTO kora_settings (key, value, updated_at) VALUES (?, ?, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
      )
      .run(key, String(value));
    cache.set(key, value);
  }
  return all();
}

// ---------- Journal d'événements ----------
// kind : dm | image | vision | comment | post — status : ok | error | limited | disabled
function logEvent(kind, status, userId = null, detail = null) {
  db.prepare('INSERT INTO kora_events (id, kind, status, user_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), kind, status, userId, detail ? String(detail).slice(0, 300) : null)
    .catch((err) => console.error('Kora (journal) :', err.message));
}

async function pruneEvents() {
  try {
    await db.prepare("DELETE FROM kora_events WHERE created_at < NOW() - INTERVAL '30 days'").run();
  } catch (err) {
    console.error('Kora (journal) :', err.message);
  }
}

const KINDS = ['dm', 'image', 'vision', 'comment', 'post'];

async function stats() {
  const rows = await db
    .prepare(
      `SELECT kind, status,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS d1,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS d7,
              COUNT(*) AS d30
       FROM kora_events GROUP BY kind, status`
    )
    .all();
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { ok_24h: 0, ok_7d: 0, ok_30d: 0, errors_24h: 0, limited_24h: 0 }]));
  for (const r of rows) {
    const k = byKind[r.kind];
    if (!k) continue;
    if (r.status === 'ok') {
      k.ok_24h = Number(r.d1);
      k.ok_7d = Number(r.d7);
      k.ok_30d = Number(r.d30);
    } else if (r.status === 'error') k.errors_24h = Number(r.d1);
    else if (r.status === 'limited') k.limited_24h = Number(r.d1);
  }
  const users = await db
    .prepare("SELECT COUNT(DISTINCT user_id) AS n FROM kora_events WHERE status = 'ok' AND user_id IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours'")
    .get();
  const errors = await db
    .prepare("SELECT kind, detail, created_at FROM kora_events WHERE status = 'error' ORDER BY created_at DESC LIMIT 8")
    .all();
  const images = await db.prepare("SELECT COUNT(*) AS n FROM image_generations WHERE created_at > NOW() - INTERVAL '24 hours'").get();
  const fb = await db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE rating = 1) AS up,
              COUNT(*) FILTER (WHERE rating = -1) AS down,
              COUNT(*) FILTER (WHERE rating = 1 AND created_at > NOW() - INTERVAL '7 days') AS up_7d,
              COUNT(*) FILTER (WHERE rating = -1 AND created_at > NOW() - INTERVAL '7 days') AS down_7d
       FROM kora_feedback`
    )
    .get();
  const feedback = { up: Number(fb?.up || 0), down: Number(fb?.down || 0), up_7d: Number(fb?.up_7d || 0), down_7d: Number(fb?.down_7d || 0) };
  return { by_kind: byKind, users_24h: Number(users?.n || 0), images_used_24h: Number(images?.n || 0), feedback, recent_errors: errors };
}

module.exports = { DEFAULTS, LIMITS, get, all, load, update, logEvent, pruneEvents, stats };
