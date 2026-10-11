import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { ContactPicker } from "@/components/ContactPicker";
import { useBackHandler } from "@/lib/back";
import { fetchContacts, getOrCreateConversation, sendMessage } from "@/lib/chat";
import { publicUrl } from "@/lib/share";
import type { MiniProfile } from "@/lib/social";

/** « Envoyer » une vidéo K-Short : choisir un contact Kalchat (abonnement accepté) et lui envoyer le lien en message privé. */
export function ShortSendSheet({ shortId, caption, onClose }: { shortId: string; caption: string | null; onClose: () => void }) {
  useBackHandler(onClose, true);
  const qc = useQueryClient();
  const contactsQ = useQuery({ queryKey: ["contacts"], queryFn: fetchContacts });

  const sendTo = useMutation({
    mutationFn: async (c: MiniProfile) => {
      const id = await getOrCreateConversation(c.id);
      const note = caption?.trim() ? `${caption.trim().slice(0, 120)}\n` : "";
      await sendMessage(id, `🎬 ${note}${publicUrl(`/?k=${shortId}`)}`);
      return c;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success(`Envoyé à ${c.display_name}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (typeof document === "undefined") return null;
  // Affichée dans <body> : sinon elle passerait sous la barre du bas de l'application
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={() => !sendTo.isPending && onClose()} />
      <div className="animate-sheet-up relative flex h-[70dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="text-base font-bold text-foreground">Envoyer à…</p>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        <ContactPicker contacts={contactsQ.data} loading={contactsQ.isLoading} onPick={(c) => !sendTo.isPending && sendTo.mutate(c)} onNavigate={onClose} />
        {sendTo.isPending && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-t-3xl bg-card/80 text-sm font-semibold text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> <Send className="h-4 w-4" /> Envoi…
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
