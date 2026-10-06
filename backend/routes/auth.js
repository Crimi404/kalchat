const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { USERNAME_RE, nextUsernameChangeAt } = require('../usernamePolicy');
const { isMailPublic, sendMail, codeEmail, welcomeEmail, passwordChangedEmail } = require('../mailer');
const otp = require('../otp');
const ai = require('../ai');

const router = express.Router();

// Création du compte (inscription classique ou après validation du code par email)
async function createUser({ first_name, last_name, username, password_hash, avatar_url, email = null }) {
  const id = uuid();
  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id != ?').get(ai.BOT_ID); // le compte IA ne compte pas
  const isFirstUser = Number(countRow.n) === 0;
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, avatar_url, first_name, last_name, is_admin, badge, email, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${email ? 'NOW()' : 'NULL'})`
    )
    .run(id, username, password_hash, avatar_url || null, first_name.trim(), last_name.trim(), isFirstUser ? 1 : 0, isFirstUser ? 'gold' : null, email);
  // Chaque nouveau membre a d'office une discussion avec Kora IA (l'IA de Kalchat)
  await ai.ensureConversationFor(id).catch((err) => console.error('Kora : discussion non créée:', err.message));
  const token = jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
  return { token, user: { id, username, avatar_url: avatar_url || null, first_name, last_name, is_admin: isFirstUser } };
}

// Retrouve un membre par pseudo, ou par adresse email vérifiée
async function findByIdentifier(identifier) {
  const ident = String(identifier || '').trim();
  if (!ident) return null;
  if (ident.includes('@')) {
    return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND email_verified_at IS NOT NULL').get(ident);
  }
  return db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(ident);
}

// ---------- Configuration publique : l'inscription se fait-elle avec un code par email ? ----------
router.get('/config', (req, res) => {
  res.json({ email_signup: isMailPublic() });
});

// ---------- Inscription avec code par email (étape 1 : on vérifie les infos et on envoie le code) ----------
router.post('/register/start', async (req, res) => {
  try {
    if (!isMailPublic()) return res.status(503).json({ error: "L'inscription par email n'est pas encore disponible" });
    otp.rateLimit(req, 'signup-start', 10, 60 * 60 * 1000);

    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const email = otp.normalizeEmail(req.body.email);
    const avatar_url = req.body.avatar_url || null;

    if (!first_name || !last_name) return res.status(400).json({ error: 'Prénom et nom requis' });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Nom d'utilisateur : 3 à 20 caractères (lettres minuscules, chiffres et _)" });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Le mot de passe doit faire entre 8 et 72 caractères' });
    if (!otp.isValidEmail(email)) return res.status(400).json({ error: 'Adresse email invalide', field: 'email' });

    if (await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)) {
      return res.status(409).json({ error: "Ce nom d'utilisateur est déjà pris", field: 'username' });
    }
    if (await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email)) {
      return res.status(409).json({ error: 'Cette adresse email est déjà utilisée', field: 'email' });
    }

    const payload = { first_name, last_name, username, password_hash: await bcrypt.hash(password, 10), avatar_url };
    const { id, code } = await otp.issueCode({ purpose: 'signup', email, payload });
    try {
      await sendMail({ to: email, ...codeEmail({ purpose: 'signup', code, firstName: first_name }) });
    } catch (err) {
      console.error("Email d'inscription non envoyé :", err.message);
      await otp.discard(id);
      return res.status(502).json({ error: "Impossible d'envoyer l'email pour le moment, vérifie l'adresse ou réessaie plus tard", field: 'email' });
    }
    res.json({ ok: true, expires_in: 15 * 60 });
  } catch (err) {
    otp.sendError(res, err);
  }
});

// ---------- Renvoyer le code d'inscription ----------
router.post('/register/resend', async (req, res) => {
  try {
    if (!isMailPublic()) return res.status(503).json({ error: "L'inscription par email n'est pas encore disponible" });
    otp.rateLimit(req, 'signup-resend', 15, 60 * 60 * 1000);
    const email = otp.normalizeEmail(req.body.email);
    const payload = await otp.peekPayload(email, 'signup');
    if (!payload) return res.status(400).json({ error: "Demande introuvable, recommence l'inscription" });

    const { id, code } = await otp.issueCode({ purpose: 'signup', email, payload });
    try {
      await sendMail({ to: email, ...codeEmail({ purpose: 'signup', code, firstName: payload.first_name }) });
    } catch (err) {
      console.error("Email d'inscription non renvoyé :", err.message);
      await otp.discard(id);
      return res.status(502).json({ error: "Impossible d'envoyer l'email pour le moment, réessaie plus tard" });
    }
    res.json({ ok: true, expires_in: 15 * 60 });
  } catch (err) {
    otp.sendError(res, err);
  }
});

// ---------- Inscription avec code par email (étape 2 : le code est bon, on crée le compte) ----------
router.post('/register/verify', async (req, res) => {
  try {
    otp.rateLimit(req, 'signup-verify', 30, 60 * 60 * 1000);
    const email = otp.normalizeEmail(req.body.email);
    const row = await otp.checkCode({ purpose: 'signup', email, code: req.body.code });
    const p = row.payload;
    if (!p) return res.status(400).json({ error: "Demande introuvable, recommence l'inscription" });

    // Entre-temps, quelqu'un a pu prendre ce pseudo ou cette adresse
    if (await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(p.username)) {
      return res.status(409).json({ error: "Ce nom d'utilisateur vient d'être pris, recommence l'inscription avec un autre", field: 'username' });
    }
    if (await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email)) {
      return res.status(409).json({ error: 'Cette adresse email est déjà utilisée', field: 'email' });
    }

    const created = await createUser({ ...p, email });
    await otp.consume(email, 'signup');
    sendMail({ to: email, ...welcomeEmail({ firstName: p.first_name, username: p.username }) }).catch((err) => console.error('Email de bienvenue non envoyé :', err.message));
    res.status(201).json(created);
  } catch (err) {
    otp.sendError(res, err);
  }
});

// ---------- Mot de passe oublié (étape 1 : envoi du code) ----------
// La réponse est toujours la même, pour ne pas révéler quels pseudos ou adresses existent.
router.post('/forgot', async (req, res) => {
  try {
    if (!isMailPublic()) return res.status(503).json({ error: "La récupération par email n'est pas encore disponible" });
    otp.rateLimit(req, 'forgot', 10, 60 * 60 * 1000);
    const user = await findByIdentifier(req.body.identifier);
    if (user && user.email && user.email_verified_at && !user.is_blocked) {
      try {
        const { id, code } = await otp.issueCode({ purpose: 'reset', email: user.email, userId: user.id });
        await sendMail({ to: user.email, ...codeEmail({ purpose: 'reset', code, firstName: user.first_name }) }).catch(async (err) => {
          console.error('Email de réinitialisation non envoyé :', err.message);
          await otp.discard(id);
        });
      } catch (err) {
        if (!(err instanceof otp.HttpError)) throw err; // délai ou plafond atteint : même réponse neutre
      }
    }
    res.json({ ok: true });
  } catch (err) {
    otp.sendError(res, err);
  }
});

// ---------- Mot de passe oublié (étape 2 : code + nouveau mot de passe) ----------
router.post('/reset', async (req, res) => {
  try {
    if (!isMailPublic()) return res.status(503).json({ error: "La récupération par email n'est pas encore disponible" });
    otp.rateLimit(req, 'reset', 20, 60 * 60 * 1000);
    const password = String(req.body.password || '');
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Le mot de passe doit faire entre 8 et 72 caractères' });

    const user = await findByIdentifier(req.body.identifier);
    if (!user || !user.email || !user.email_verified_at || user.is_blocked) {
      return res.status(400).json({ error: 'Code incorrect ou expiré' });
    }
    await otp.checkCode({ purpose: 'reset', email: user.email, code: req.body.code, userId: user.id });

    // Toutes les sessions ouvertes ailleurs sont fermées ; on connecte directement ce téléphone
    await db.prepare('UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?').run(await bcrypt.hash(password, 10), user.id);
    await otp.consume(user.email, 'reset');
    sendMail({ to: user.email, ...passwordChangedEmail({ firstName: user.first_name }) }).catch((err) => console.error('Email de confirmation non envoyé :', err.message));

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, avatar_url: user.avatar_url, badge: user.badge, role: user.role, is_admin: !!user.is_admin } });
  } catch (err) {
    otp.sendError(res, err);
  }
});

// ---------- Inscription ----------
router.post('/register', async (req, res) => {
  try {
    // Quand les emails sont actifs, l'inscription passe obligatoirement par le code (voir /register/start)
    if (isMailPublic()) return res.status(403).json({ error: "L'inscription se fait avec ton adresse email : mets-la à jour dans l'application", code: 'email_required' });

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

    const created = await createUser({ first_name, last_name, username, password_hash: await bcrypt.hash(password, 10), avatar_url });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Connexion ----------
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    // On peut se connecter avec son pseudo ou avec son adresse email vérifiée
    const ident = String(username ?? '').trim();
    const user = ident.includes('@')
      ? await db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND email_verified_at IS NOT NULL').get(ident)
      : await db.prepare('SELECT * FROM users WHERE username = ?').get(username);

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
