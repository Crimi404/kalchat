// Règles du nom d'utilisateur (changement depuis la page Paramètres).
// Même format qu'à l'inscription : 3 à 20 caractères, minuscules, chiffres et _.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// Un membre ne peut changer de nom d'utilisateur qu'une fois tous les 60 jours.
const USERNAME_COOLDOWN_DAYS = 60;

// Renvoie la date (ISO) à partir de laquelle un nouveau changement sera possible,
// ou null si le membre peut changer dès maintenant.
function nextUsernameChangeAt(changedAt) {
  if (!changedAt) return null;
  const next = new Date(new Date(changedAt).getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  return next > new Date() ? next.toISOString() : null;
}

module.exports = { USERNAME_RE, USERNAME_COOLDOWN_DAYS, nextUsernameChangeAt };
