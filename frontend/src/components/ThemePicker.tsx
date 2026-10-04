import { Check } from "lucide-react";
import { FONTS, THEMES, isCustomColor } from "@/lib/themes";

/** Choix du fond (thèmes + couleur personnalisée) et de la police pour un texte. */
export function ThemePicker({
  theme,
  font,
  onTheme,
  onFont,
  allowNone = false,
}: {
  theme: string | null;
  font: string;
  onTheme: (t: string | null) => void;
  onFont: (f: string) => void;
  /** Autorise « sans fond » (publications) ; pour les stories il y a toujours un fond. */
  allowNone?: boolean;
}) {
  const custom = isCustomColor(theme);
  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-1">
        {allowNone && (
          <button
            type="button"
            aria-label="Sans fond"
            aria-pressed={theme === null}
            onClick={() => onTheme(null)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-card text-xs font-bold text-muted-foreground ${theme === null ? "border-primary" : "border-border"}`}
          >
            Aa
          </button>
        )}
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            aria-pressed={theme === t.id}
            onClick={() => onTheme(t.id)}
            style={{ background: t.background }}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-white ${theme === t.id ? "border-foreground" : "border-transparent"}`}
          >
            {theme === t.id && <Check className="h-4 w-4 drop-shadow" />}
          </button>
        ))}
        <label
          aria-label="Couleur personnalisée"
          className={`relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${custom ? "border-foreground" : "border-transparent"}`}
          style={{ background: custom ? theme! : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
        >
          {custom && <Check className="h-4 w-4 text-white drop-shadow" />}
          <input type="color" value={custom ? theme! : "#6d4fe0"} onChange={(e) => onTheme(e.target.value.toLowerCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
      </div>
      {(theme !== null || !allowNone) && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFont(f.id)}
              aria-pressed={font === f.id}
              style={{ fontFamily: f.family }}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm ${font === f.id ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-secondary"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
