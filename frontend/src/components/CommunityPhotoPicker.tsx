import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MiniAvatar } from "@/components/MiniAvatar";
import { uploadMedia } from "@/lib/media";

/** Choisir (ou retirer) la photo d'une communauté. `onChange` reçoit l'adresse de la photo, ou null pour la retirer. */
export function CommunityPhotoPicker({ url, name, onChange }: { url: string | null; name: string; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choisis une photo"); return; }
    setBusy(true);
    try {
      const media = await uploadMedia(file, { maxSide: 512 });
      onChange(media.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label="Choisir une photo" className="relative shrink-0 disabled:opacity-60">
        <MiniAvatar url={url} name={name || "?"} size={72} group />
        <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
        </span>
      </button>
      <div className="text-xs text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">Photo de la communauté</p>
        <p>Facultative. Tu pourras la changer plus tard.</p>
        {url && <button type="button" onClick={() => onChange(null)} className="mt-1 font-semibold text-destructive">Retirer la photo</button>}
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}
