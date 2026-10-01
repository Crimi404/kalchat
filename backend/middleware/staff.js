const db = require('../db');

// Accès réservé à l'équipe : administrateurs et modérateurs.
// Place `req.staff = { is_admin, role }` pour que les routes sachent qui parle.
async function staffMiddleware(req, res, next) {
  const user = await db.prepare('SELECT is_admin, role FROM users WHERE id = ?').get(req.user.id);
  const isAdmin = !!user?.is_admin;
  const isMod = user?.role === 'moderator';
  if (!isAdmin && !isMod) {
    return res.status(403).json({ error: "Accès réservé à l'équipe Kalchat" });
  }
  req.staff = { is_admin: isAdmin, role: isAdmin ? 'admin' : 'moderator' };
  next();
}

module.exports = staffMiddleware;
