// Codes à usage unique (OTP) envoyés par email : inscription, vérification d'adresse, mot de passe oublié.
// Les codes ne sont jamais stockés en clair (empreinte SHA-256) et expirent après 15 minutes.
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('./db');

const TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 60;
const MAX_CODES_PER_HOUR = 5;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function hashCode(code, email, purpose) {
  return crypto.createHash('sha256').update(`${purpose}:${email}:${code}`).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const normalizeEmail = (v) => String(v || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isValidEmail = (e) => e.length <= 254 && EMAIL_RE.test(e);

async function latest(email, purpose) {
  return db.prepare('SELECT * FROM email_otps WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(email, purpose);
}

async function peekPayload(email, purpose) {
  const r = await latest(email, purpose);
  return r?.payload ? JSON.parse(r.payload) : null;
}

async function latestForUser(userId, purpose) {
  return db.prepare('SELECT * FROM email_otps WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(userId, purpose);
}

/** Crée un code pour (email, purpose) et le renvoie en clair pour l'envoyer par email. Respecte délai et plafond horaire. */
async function issueCode({ purpose, email, userId = null, payload = null }) {
  const last = await latest(email, purpose);
  if (last) {
    const wait = COOLDOWN_SECONDS - Math.floor((Date.now() - new Date(last.created_at).getTime()) / 1000);
    if (wait > 0) throw new HttpError(429, `Patiente ${wait} s avant de redemander un code`, { retry_after: wait });
  }
  const hourly = await db
    .prepare("SELECT COUNT(*) AS n FROM email_otps WHERE email = ? AND purpose = ? AND created_at > NOW() - INTERVAL '1 hour'")
    .get(email, purpose);
  if (hourly.n >= MAX_CODES_PER_HOUR) throw new HttpError(429, 'Trop de demandes, réessaie dans une heure');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const id = uuid();
  // Un seul code actif à la fois ; les lignes récentes comptent quand même pour le plafond horaire (on les garde en « consommées »)
  await db.prepare("UPDATE email_otps SET expires_at = NOW() - INTERVAL '1 second' WHERE email = ? AND purpose = ?").run(email, purpose);
  await db
    .prepare("INSERT INTO email_otps (id, purpose, email, user_id, code_hash, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?, NOW() + (? * INTERVAL '1 minute'))")
    .run(id, purpose, email, userId, hashCode(code, email, purpose), payload ? JSON.stringify(payload) : null, TTL_MINUTES);
  return { id, code };
}

/** Annule un code qu'on n'a pas pu envoyer (échec d'envoi de l'email). */
async function discard(id) {
  await db.prepare('DELETE FROM email_otps WHERE id = ?').run(id);
}

/** Vérifie un code saisi. Renvoie la ligne (avec payload déjà décodé) ou lève une HttpError. */
async function checkCode({ purpose, email, code, userId = null }) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) throw new HttpError(400, 'Le code contient 6 chiffres');

  const row = await latest(email, purpose);
  if (!row || (userId && row.user_id !== userId) || new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(400, 'Ce code a expiré, demande-en un nouveau');
  }
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Trop d'essais, demande un nouveau code");
  if (!sameHash(hashCode(clean, email, purpose), row.code_hash)) {
    await db.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new HttpError(400, left > 0 ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''})` : 'Code incorrect, demande un nouveau code');
  }
  return { ...row, payload: row.payload ? JSON.parse(row.payload) : null };
}

/** Supprime les codes d'un (email, purpose) une fois l'action terminée. */
async function consume(email, purpose) {
  await db.prepare('DELETE FROM email_otps WHERE email = ? AND purpose = ?').run(email, purpose);
}

async function purgeExpired() {
  await db.prepare("DELETE FROM email_otps WHERE expires_at < NOW() - INTERVAL '1 day'").run();
}

// ---------- Limiteur simple par adresse IP (en mémoire) ----------
const hits = new Map();
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
}
function rateLimit(req, key, max, windowMs) {
  const k = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(k, list);
    throw new HttpError(429, 'Trop de tentatives, réessaie un peu plus tard');
  }
  list.push(now);
  hits.set(k, list);
  if (hits.size > 10000) hits.clear();
}

function sendError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(err);
  return res.status(500).json({ error: 'Erreur serveur' });
}

module.exports = { HttpError, normalizeEmail, isValidEmail, issueCode, discard, checkCode, consume, peekPayload, latestForUser, purgeExpired, rateLimit, sendError };
