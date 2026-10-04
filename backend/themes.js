// Fonds et polices pour les stories texte et les publications texte.
// Les identifiants doivent rester identiques à ceux de frontend/src/lib/themes.ts.
const THEME_IDS = [
  'kalchat', 'sunset', 'ocean', 'forest', 'berry', 'candy', 'night', 'gold', 'aurora',
  'dots', 'stripes', 'waves', 'grid',
];
const FONT_IDS = ['sans', 'serif', 'mono', 'script', 'condensed'];
const DEFAULT_FONT = 'sans';

// Un fond est soit un thème de la liste, soit une couleur personnalisée « #rrggbb ».
function normalizeTheme(value) {
  const t = String(value || '').trim();
  if (THEME_IDS.includes(t)) return t;
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  return null;
}

function normalizeFont(value) {
  const f = String(value || '').trim();
  return FONT_IDS.includes(f) ? f : DEFAULT_FONT;
}

// Une publication avec fond reste courte (comme sur Facebook) et n'a pas de média
const THEMED_POST_MAX_CHARS = 280;

module.exports = { THEME_IDS, FONT_IDS, DEFAULT_FONT, THEMED_POST_MAX_CHARS, normalizeTheme, normalizeFont };
