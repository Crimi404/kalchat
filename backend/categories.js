// Catégories de publication (clé stockée en base). « divers » est la catégorie par défaut.
const CATEGORIES = ['divers', 'info', 'economie', 'crypto', 'musique', 'sport', 'gaming', 'anime', 'tech', 'humour', 'education', 'lifestyle'];
const DEFAULT_CATEGORY = 'divers';

function normalizeCategory(value) {
  const key = String(value || '').trim().toLowerCase();
  return CATEGORIES.includes(key) ? key : DEFAULT_CATEGORY;
}

module.exports = { CATEGORIES, DEFAULT_CATEGORY, normalizeCategory };
