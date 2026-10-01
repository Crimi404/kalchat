import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { useAuth } from "@/lib/auth";
import { MAX_UPLOAD_MB, uploadMedia } from "@/lib/media";
import { createStory } from "@/lib/stories";

export const Route = createFileRoute("/_authenticated/story")({
  head: () => ({
    meta: [
      { title: "Nouvelle story — Kalchat" },
      { name: "description", content: "Partage un moment éphémère avec ta communauté Kalchat." },
      { property: "og:title", content: "Nouvelle story — Kalchat" },
      { property: "og:description", content: "Partage un moment éphémère avec ta communauté Kalchat." },
    ],
  }),
  component: NewStory,
});

function NewStory() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!user) return;
    if (!text.trim() && !file) { toast.error("Ajoute un texte, une photo ou une vidéo"); return; }
    setBusy(true);
    try {
      const media = file ? await uploadMedia(file) : null;
      await createStory({ content: text.slice(0, 300), image_url: media?.url, media_type: media?.type });
      await qc.invalidateQueries({ queryKey: ["stories"] });
      toast.success("Story publiée");
      nav({ to: "/" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <TopBar title="Nouvelle story" subtitle="Visible pendant 24 h" />
      <main className="space-y-4 p-4 pb-28">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={4}
          placeholder="Écris quelque chose…" className="w-full rounded-2xl border border-border bg-card p-4 text-sm text-foreground outline-none focus:border-primary" />
        {file ? (
          <div className="relative overflow-hidden rounded-2xl">
            {file.type.startsWith("video/") ? (
              <video src={URL.createObjectURL(file)} controls className="max-h-80 w-full" />
            ) : (
              <img src={URL.createObjectURL(file)} alt="Aperçu" className="max-h-80 w-full object-cover" />
            )}
            <button onClick={() => setFile(null)} aria-label="Retirer" className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-8 text-sm text-muted-foreground hover:bg-secondary/50">
            <ImagePlus className="h-5 w-5" /> Ajouter une photo ou une vidéo
            <input type="file" accept="image/*,video/*" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > MAX_UPLOAD_MB * 1024 * 1024) { toast.error(`Fichier trop lourd (${MAX_UPLOAD_MB} Mo max)`); return; }
              setFile(f ?? null);
            }} />
          </label>
        )}
        <button disabled={busy} onClick={submit} className="brand-gradient glow-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Publier la story
        </button>
      </main>
    </div>
  );
}
