import { useRef, useState } from "react";
import { Check, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { MAX_DIM, resetChatTheme, setChatPhoto, updateChatTheme, useChatTheme } from "@/lib/chatTheme";
import { THEMES, isCustomColor } from "@/lib/themes";

const MAX_PHOTO_MB = 15;

/** Pastilles : « aucun », les thèmes, une couleur libre. Sert pour le fond comme pour les bulles. */
function Swatches({ value, onChange, noneLabel, extra }: { value: string | null; onChange: (v: string | null) => void; noneLabel: string; extra?: React.ReactNode }) {
  const custom = isCustomColor(value);
  return (
    <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-1">
      {extra}
      <button
        type="button"
        aria-label={noneLabel}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-card text-[10px] font-bold text-muted-foreground ${value === null ? "border-primary" : "border-border"}`}
      >
        {value === null ? <Check className="h-4 w-4 text-primary" /> : "Aucun"}
      </button>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={t.label}
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          style={{ background: t.background }}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-white ${value === t.id ? "border-foreground" : "border-transparent"}`}
        >
          {value === t.id && <Check className="h-4 w-4 drop-shadow" />}
        </button>
      ))}
      <label
        aria-label="Couleur libre"
        className={`relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${custom ? "border-foreground" : "border-transparent"}`}
        style={{ background: custom ? value! : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
      >
        {custom && <Check className="h-4 w-4 text-white drop-shadow" />}
        <input type="color" value={custom ? value! : "#6d4fe0"} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

/**
 * Éditeur du thème des discussions (fond + bulles), avec aperçu en direct.
 * `scope` : null = thème par défaut de toutes les discussions ; sinon l'identifiant d'une discussion.
 */
export function ChatThemeEditor({ scope }: { scope: string | null }) {
  const { theme, hasOwn, wallpaperStyle, bubbleStyle } = useChatTheme(scope);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const forChat = scope !== null;
  const hasWallpaper = theme.wallpaper !== null;

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choisis une photo"); return; }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) { toast.error(`Photo trop lourde (${MAX_PHOTO_MB} Mo max)`); return; }
    setBusy(true);
    try {
      await setChatPhoto(scope, file);
    } catch {
      toast.error("Impossible d'utiliser cette photo");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const progress = (theme.dim / MAX_DIM) * 100;

  return (
    <div className="space-y-5">
      {forChat && (
        <p className="rounded-2xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {hasOwn ? "Cette discussion a son propre thème." : "Cette discussion utilise le thème par défaut. Si tu changes quelque chose ici, ça ne s'applique qu'à elle."}
        </p>
      )}

      {/* Aperçu */}
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="flex min-h-[10rem] flex-col justify-end gap-2 bg-background px-3 py-4" style={wallpaperStyle}>
          <div className="flex justify-start"><div className="max-w-[75%] rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2 text-sm text-foreground">Salut ! Tu as vu mon nouveau fond ? 👀</div></div>
          <div className="flex justify-end">
            <div className={`max-w-[75%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm ${bubbleStyle ? "" : "brand-gradient text-primary-foreground"}`} style={bubbleStyle ?? undefined}>
              Il est trop beau 😍
            </div>
          </div>
        </div>
      </div>

      {/* Fond */}
      <section>
        <h3 className="mb-1 text-sm font-bold text-foreground">Fond de la discussion</h3>
        <Swatches
          value={theme.wallpaper === "photo" ? null : theme.wallpaper}
          onChange={(v) => void updateChatTheme(scope, { wallpaper: v })}
          noneLabel="Fond d'origine"
          extra={
            <button
              type="button"
              aria-label="Choisir une photo"
              aria-pressed={theme.wallpaper === "photo"}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 bg-card px-3 text-xs font-bold text-foreground disabled:opacity-60 ${theme.wallpaper === "photo" ? "border-primary" : "border-border"}`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Ma photo
            </button>
          }
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
        <p className="mt-1 text-[11px] text-muted-foreground">Ta photo reste sur ton téléphone : personne d'autre ne la voit.</p>
      </section>

      {hasWallpaper && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-foreground">Assombrir le fond</h3>
          <input
            type="range"
            aria-label="Assombrir le fond"
            min={0}
            max={MAX_DIM}
            step={0.05}
            value={theme.dim}
            onChange={(e) => void updateChatTheme(scope, { dim: Number(e.target.value) })}
            className="kal-range block h-1.5 w-full cursor-pointer appearance-none rounded-full"
            style={{ background: `linear-gradient(to right, var(--primary) ${progress}%, rgba(255,255,255,0.28) ${progress}%)` }}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Plus c'est sombre, plus les messages sont faciles à lire.</p>
        </section>
      )}

      {/* Bulles */}
      <section>
        <h3 className="mb-1 text-sm font-bold text-foreground">Couleur de mes messages</h3>
        <Swatches value={theme.bubble} onChange={(v) => void updateChatTheme(scope, { bubble: v })} noneLabel="Violet Kalchat" />
      </section>

      <button
        type="button"
        onClick={() => void resetChatTheme(scope).then(() => toast.success(forChat ? "Thème par défaut rétabli" : "Thème réinitialisé"))}
        disabled={forChat ? !hasOwn : !hasWallpaper && theme.bubble === null}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
      >
        <RotateCcw className="h-4 w-4" /> {forChat ? "Revenir au thème par défaut" : "Tout réinitialiser"}
      </button>
    </div>
  );
}
