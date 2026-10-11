const jwt = require('jsonwebtoken');
const db = require('../db');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await db.prepare('SELECT is_blocked, password_changed_at FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Compte introuvable' });
    // Après une réinitialisation du mot de passe, les anciennes sessions (autres appareils) ne sont plus valables
    if (user.password_changed_at && payload.iat && payload.iat < Math.floor(new Date(user.password_changed_at).getTime() / 1000)) {
      return res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
    }
    if (user.is_blocked) return res.status(403).json({ error: 'Ce compte a été bloqué par un administrateur' });

    // Session glissante : jeton valable 14 jours ; tant que la personne utilise l'appli, un jeton neuf lui est donné (en-tête X-Renewed-Token)
    // dès que l'actuel a plus de 3 jours. Un jeton volé et laissé de côté expire donc vite, sans déconnecter les vrais utilisateurs.
    if (payload.iat && Math.floor(Date.now() / 1000) - payload.iat > 3 * 24 * 3600) {
      res.setHeader('X-Renewed-Token', jwt.sign({ id: payload.id, username: payload.username }, process.env.JWT_SECRET, { expiresIn: '14d' }));
    }

    req.user = payload; // { id, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = authMiddleware;
