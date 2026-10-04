/** Fonds et polices des stories texte et des publications texte (mêmes identifiants que backend/themes.js). */
export interface PostTheme {
  id: string;
  label: string;
  background: string;
  color: string;
}

const dots = "radial-gradient(rgba(255,255,255,.28) 2px, transparent 2.5px) 0 0/22px 22px";
const grid = "linear-gradient(rgba(255,255,255,.12) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, rgba(255,255,255,.12) 1px, transparent 1px) 0 0/24px 24px";

export const THEMES: PostTheme[] = [
  { id: "kalchat", label: "Kalchat", background: "linear-gradient(135deg,#6d4fe0,#3b82f6)", color: "#ffffff" },
  { id: "sunset", label: "Coucher de soleil", background: "linear-gradient(135deg,#ff7e5f,#feb47b)", color: "#ffffff" },
  { id: "ocean", label: "Océan", background: "linear-gradient(135deg,#2193b0,#6dd5ed)", color: "#ffffff" },
  { id: "forest", label: "Forêt", background: "linear-gradient(135deg,#11998e,#38ef7d)", color: "#ffffff" },
  { id: "berry", label: "Mûre", background: "linear-gradient(135deg,#8e2de2,#4a00e0)", color: "#ffffff" },
  { id: "candy", label: "Bonbon", background: "linear-gradient(135deg,#f093fb,#f5576c)", color: "#ffffff" },
  { id: "night", label: "Nuit", background: "linear-gradient(135deg,#0f2027,#2c5364)", color: "#ffffff" },
  { id: "gold", label: "Or", background: "linear-gradient(135deg,#f7971e,#ffd200)", color: "#3b2700" },
  { id: "aurora", label: "Aurore", background: "linear-gradient(135deg,#00c6ff,#0072ff 50%,#7f00ff)", color: "#ffffff" },
  { id: "dots", label: "Pois", background: `${dots}, linear-gradient(135deg,#6a11cb,#2575fc)`, color: "#ffffff" },
  { id: "stripes", label: "Rayures", background: "repeating-linear-gradient(45deg, rgba(255,255,255,.14) 0 12px, transparent 12px 24px), linear-gradient(135deg,#ff416c,#ff4b2b)", color: "#ffffff" },
  { id: "waves", label: "Vagues", background: "repeating-radial-gradient(circle at 0 100%, rgba(255,255,255,.2) 0 10px, transparent 10px 20px), linear-gradient(135deg,#00b09b,#96c93d)", color: "#ffffff" },
  { id: "grid", label: "Quadrillage", background: `${grid}, linear-gradient(135deg,#232526,#414345)`, color: "#ffffff" },
];

export interface PostFont {
  id: string;
  label: string;
  family: string;
}

export const FONTS: PostFont[] = [
  { id: "sans", label: "Classique", family: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "serif", label: "Élégante", family: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Machine", family: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" },
  { id: "script", label: "Manuscrite", family: "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive" },
  { id: "condensed", label: "Affiche", family: "Impact, 'Arial Narrow', 'Helvetica Neue', sans-serif" },
];

export const THEME_MAX_CHARS = 280;
export const DEFAULT_FONT = "sans";

export function isCustomColor(theme: string | null | undefined): theme is string {
  return !!theme && /^#[0-9a-fA-F]{6}$/.test(theme);
}

/** Texte clair ou foncé selon la luminosité du fond choisi. */
function contrastColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1a1a1a" : "#ffffff";
}

export function resolveTheme(theme: string | null | undefined): { background: string; color: string } | null {
  if (!theme) return null;
  if (isCustomColor(theme)) return { background: theme, color: contrastColor(theme) };
  const t = THEMES.find((x) => x.id === theme);
  return t ? { background: t.background, color: t.color } : null;
}

export function resolveFont(font: string | null | undefined): string {
  return (FONTS.find((f) => f.id === font) ?? FONTS[0]).family;
}

/** Taille du texte selon sa longueur, pour qu'un message court ressorte et qu'un long reste lisible. */
export function themedTextSize(length: number, story = false): string {
  if (story) return length < 40 ? "text-4xl" : length < 120 ? "text-3xl" : "text-2xl";
  return length < 50 ? "text-3xl" : length < 120 ? "text-2xl" : "text-xl";
}
