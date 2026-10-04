function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Clé du jour (heure locale) pour savoir si deux messages sont de la même journée. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** « Aujourd'hui », « Hier », « Avant-hier », sinon la date complète. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  if (diff === 2) return "Avant-hier";
  const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
