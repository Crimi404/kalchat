import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { useAuth } from "@/lib/auth";
import { MAX_UPLOAD_MB, uploadMedia } from "@/lib/media";
import { createPost } from "@/lib/social";
import { CATEGORIES, DEFAULT_CATEGORY } from "@/lib/categories";

export const Route = createFileRoute("/_authenticated/nouveau")({
  head: () => ({
    meta: [
      { title: "Nouvelle publication — Kalchat" },
      { name: "description", content: "Partage un texte, une photo ou une vidéo avec ta communauté Kalchat." },
      { property: "og:title", content: "Nouvelle publication — Kalchat" },
      { property: "og:description", content: "Partage un texte, une photo ou une vidéo avec ta communauté Kalchat." },
    ],
  }),
  component: NewPost,
});

const MAX = 1000;

function NewPost() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState(DEFAULT_CATEGORY);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) { toast.error("Choisis une photo ou une vidéo"); return; }
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) { toast.error(`Fichier trop lourd (${MAX_UPLOAD_MB} Mo max)`); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    if (!user) return;
    if (!text.trim() && !file) { toast.error("Écris quelque chose ou ajoute une photo"); return; }
    setBusy(true);
    try {
      const media = file ? await uploadMedia(file) : null;
      await createPost({ content: text.trim(), imageUrl: media?.url ?? null, mediaType: media?.type ?? null, category });
      await qc.invalidateQueries();
      toast.success("Publication partagée");
      navigate({ to: "/" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <TopBar title="Nouvelle publication" />
      <main className="space-y-4 p-4">
        <textarea
          autoFocus
          value={text}
          maxLength={MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Quoi de neuf ?"
          rows={6}
          className="w-full resize-none rounded-2xl border border-border bg-card p-4 text-foreground outline-none focus:border-primary"
        />
        <p className="text-right text-xs text-muted-foreground">{text.length}/{MAX}</p>
        {preview ? (
          <div className="relative overflow-hidden rounded-2xl">
            {file?.type.startsWith("video/") ? (
              <video src={preview} controls className="max-h-96 w-full" />
            ) : (
              <img src={preview} alt="Aperçu" className="w-full object-cover" />
            )}
            <button onClick={() => { setFile(null); setPreview(null); }} aria-label="Retirer l'image" className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-8 text-sm text-muted-foreground hover:bg-secondary/60">
            <ImagePlus className="h-5 w-5" /> Ajouter une photo ou une vidéo
            <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Catégorie <span className="font-normal">(facultatif — « Divers » par défaut)</span></p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                aria-pressed={category === c.value}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${category === c.value ? "border-primary bg-primary/15 text-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"}`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={publish} disabled={busy} className="brand-gradient glow-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold text-primary-foreground disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Publier
        </button>
      </main>
    </div>
  );
}
