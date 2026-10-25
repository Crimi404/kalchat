import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useBackHandler } from "@/lib/back";
import { createSticker, drawSticker, loadImage, type StickerFit } from "@/lib/stickers";

/** Création d'un sticker à partir d'une photo de ton téléphone (carré 512×512, fond transparent possible). */
export function StickerCreator({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  useBackHandler(onClose);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fit, setFit] = useState<StickerFit>("cover");

  useEffect(() => {
    if (img && canvasRef.current) drawSticker(canvasRef.current, img, fit, 256);
  }, [img, fit]);

  async function choose(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Choisis une image");
    try {
      setImg(await loadImage(file));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const create = useMutation({
    mutationFn: () => createSticker(img!, fit),
    onSuccess: () => { toast.success("Sticker créé ✨"); onCreated(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="animate-fade-in relative w-full max-w-md rounded-t-3xl border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">Créer un sticker</h3>
          <button type="button" aria-label="Fermer" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />

        {!img ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-primary">
            <ImagePlus className="h-10 w-10" />
            <span className="text-sm font-bold">Choisir une image</span>
          </button>
        ) : (
          <>
            <div className="mx-auto w-64 overflow-hidden rounded-2xl border border-border" style={{ backgroundImage: "conic-gradient(#8884 25%, transparent 0 50%, #8884 0 75%, transparent 0)", backgroundSize: "20px 20px" }}>
              <canvas ref={canvasRef} className="block h-64 w-64" />
            </div>
            <div className="mx-auto mt-3 flex w-64 rounded-full bg-secondary p-1">
              {([["cover", "Rogner"], ["contain", "Image entière"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setFit(k)} className={`flex-1 rounded-full py-1.5 text-xs font-bold ${fit === k ? "brand-gradient text-primary-foreground shadow" : "text-muted-foreground"}`}>{label}</button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={create.isPending} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground disabled:opacity-50">Autre image</button>
              <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="brand-gradient flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Créer le sticker
              </button>
            </div>
          </>
        )}
        <p className="mt-3 text-center text-[11px] leading-snug text-muted-foreground">Utilise uniquement des images dont tu as le droit de te servir. Les contenus choquants ou interdits peuvent être signalés.</p>
      </div>
    </div>
  );
}
