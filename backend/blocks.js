const db = require('./db');

// Vrai si l'un des deux membres a bloqué l'autre (dans un sens ou dans l'autre).
async function isBlockedEitherWay(a, b) {
  const row = await db
    .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(a, b, b, a);
  return !!row;
}

module.exports = { isBlockedEitherWay };
