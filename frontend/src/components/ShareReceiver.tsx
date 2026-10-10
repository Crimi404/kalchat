import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Film, ImagePlus, Loader2, PenLine, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { ContactPicker } from "@/components/ContactPicker";
import { isInsideApp } from "@/lib/apk";
import { useAuth } from "@/lib/auth";
import { useBackHandler } from "@/lib/back";
import { fetchContacts, getOrCreateConversation, sendMessage } from "@/lib/chat";
import { MAX_UPLOAD_MB, uploadMedia } from "@/lib/media";
import type { MiniProfile } from "@/lib/social";
import { clearPendingShare, handOverShare, setPendingShare, usePendingShare } from "@/lib/shareIn";

interface SharedFile { uri?: string; name?: string; mimeType?: string }
interface ShareEvent { title?: string; texts?: string[]; files?: SharedFile[] }
interface ShareTargetPlugin {
  addListener: (event: "shareReceived", cb: (e: ShareEvent) => void) => Promise<{ remove: () => void }> | { remove: () => void };
}
interface FilesystemPlugin { readFile: (o: { path: string }) => Promise<{ data: string | Blob }> }
type CapacitorGlobal = { Plugins?: { CapacitorShareTarget?: ShareTargetPlugin; Filesystem?: FilesystemPlugin }; convertFileSrc?: (p: string) => string };

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Transforme le fichier reçu d'Android (chemin ou data:) en File utilisable par l'envoi habituel. */
async function toFile(f: SharedFile): Promise<File | null> {
  const mime = f.mimeType ?? "";
  if (!f.uri || !(mime.startsWith("image/") || mime.startsWith("video/"))) return null;
  const name = f.name || `kalchat-${Date.now()}.${mime.startsWith("video/") ? "mp4" : "jpg"}`;
  let blob: Blob | null = null;
  try {
    if (f.uri.startsWith("data:")) {
      blob = await (await fetch(f.uri)).blob();
    } else {
      const fs = cap()?.Plugins?.Filesystem;
      if (fs) {
        const r = await fs.readFile({ path: f.uri });
        blob = typeof r.data === "string" ? base64ToBlob(r.data, mime) : r.data;
      }
    }
  } catch {
    blob = null;
  }
  if (!blob) {
    try {
      const src = cap()?.convertFileSrc?.(f.uri);
      if (src) blob = await (await fetch(src)).blob();
    } catch {
      blob = null;
    }
  }
  if (!blob) return null;
  return new File([blob], name, { type: mime });
}

/**
 * Kalchat dans le menu « Partager » d'Android (APK uniquement) : on reçoit un texte, un lien, une photo ou une vidéo,
 * et on propose de le publier, d'en faire une story ou de l'envoyer à un contact.
 * Sans effet si l'APK n'a pas le module de réception des partages.
 */
export function ShareReceiver() {
  const { user } = useAuth();
  const pending = usePendingShare();

  useEffect(() => {
    if (!isInsideApp()) return;
    const plugin = cap()?.Plugins?.CapacitorShareTarget;
    if (!plugin) return;
    const sub = plugin.addListener("shareReceived", (e) => {
      void (async () => {
        const text = (e.texts ?? []).filter(Boolean).join("\n").trim();
        const first = (e.files ?? []).find((f) => (f.mimeType ?? "").startsWith("image/") || (f.mimeType ?? "").startsWith("video/"));
        let file: File | null = null;
        if (first) {
          file = await toFile(first);
          if (!file) toast.error("Impossible de lire le fichier partagé");
          else if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { toast.error(`Fichier trop lourd (${MAX_UPLOAD_MB} Mo max)`); file = null; }
        }
        if (!text && !file) return;
        setPendingShare({ text, file });
      })();
    });
    return () => {
      void Promise.resolve(sub).then((h) => h?.remove?.());
    };
  }, []);

  if (!user || !pending || pending.stage !== "choose") return null;
  return <ShareSheet text={pending.text} file={pending.file} />;
}

function ShareSheet({ text, file }: { text: string; file: File | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<"menu" | "contact">("menu");
  useBackHandler(() => { if (step === "contact") setStep("menu"); else clearPendingShare(); });

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const contactsQ = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts, enabled: step === "contact" });

  const sendTo = useMutation({
    mutationFn: async (c: MiniProfile) => {
      const id = await getOrCreateConversation(c.id);
      const media = file ? await uploadMedia(file) : undefined;
      await sendMessage(id, text, media);
      return id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      clearPendingShare();
      toast.success("Envoyé");
      void navigate({ to: "/messages/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function go(to: "/nouveau" | "/story") {
    handOverShare();
    void navigate({ to });
  }

  const options: { label: string; hint: string; icon: typeof PenLine; run: () => void }[] = [
    { label: "Publier", hint: "Sur ton fil Kalchat", icon: PenLine, run: () => go("/nouveau") },
    { label: "Ajouter à ma story", hint: "Visible pendant 24 h", icon: ImagePlus, run: () => go("/story") },
    { label: "Envoyer à un contact", hint: "En message privé", icon: Users, run: () => setStep("contact") },
  ];

  return (
    <div className="fixed inset-0 z-[110] flex items-end bg-black/60" onClick={() => !sendTo.isPending && clearPendingShare()}>
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-card pb-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          {step === "contact" && (
            <button onClick={() => setStep("menu")} aria-label="Retour" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><ArrowLeft className="h-5 w-5" /></button>
          )}
          <h2 className="flex-1 text-base font-bold text-foreground">{step === "menu" ? "Partager vers Kalchat" : "Envoyer à…"}</h2>
          <button onClick={() => clearPendingShare()} aria-label="Fermer" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        {step === "menu" && (
          <>
            <div className="mx-4 mb-3 flex items-center gap-3 rounded-2xl border border-border bg-secondary/50 p-3">
              {preview && file?.type.startsWith("image/") && <img src={preview} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
              {file?.type.startsWith("video/") && <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Film className="h-6 w-6" /></span>}
              <p className="line-clamp-3 min-w-0 flex-1 break-words text-sm text-foreground">{text || (file?.type.startsWith("video/") ? "Vidéo" : "Photo")}</p>
            </div>
            <div className="px-2">
              {options.map(({ label, hint, icon: Icon, run }) => (
                <button key={label} onClick={run} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-secondary">
                  <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-foreground">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "contact" && (
          <div className="relative">
            <ContactPicker contacts={contactsQ.data} loading={contactsQ.isLoading} onPick={(c) => !sendTo.isPending && sendTo.mutate(c)} />
            {sendTo.isPending && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-card/80 text-sm font-semibold text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> <Send className="h-4 w-4" /> Envoi…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
