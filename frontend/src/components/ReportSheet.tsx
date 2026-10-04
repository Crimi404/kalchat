import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { REPORT_REASONS, sendReport, type ReportTarget } from "@/lib/reports";
import { useBackHandler } from "@/lib/back";

const TITLES: Record<ReportTarget, string> = {
  post: "Signaler cette publication",
  comment: "Signaler ce commentaire",
  message: "Signaler ce message",
  user: "Signaler ce compte",
};

/** Feuille de signalement : choix du motif + précisions facultatives. */
export function ReportSheet({
  type,
  targetId,
  onClose,
  onDone,
}: {
  type: ReportTarget;
  targetId: string;
  onClose: () => void;
  /** Appelé après l'envoi (ex. proposer de bloquer le compte). */
  onDone?: () => void;
}) {
  useBackHandler(onClose);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");

  const send = useMutation({
    mutationFn: () => sendReport({ type, targetId, reason: reason!, details }),
    onSuccess: () => {
      toast.success("Merci, ton signalement a été transmis à la modération");
      onClose();
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="animate-fade-in flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card pb-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <button aria-label="Fermer" onClick={onClose} className="rounded-full p-2 hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
          <h3 className="flex-1 font-bold text-foreground">{TITLES[type]}</h3>
        </div>
        <p className="px-5 pb-2 text-xs leading-snug text-muted-foreground">
          Pourquoi le signales-tu ?{type === "message" ? " Ce message et les 4 précédents seront transmis à la modération." : ""} Ton signalement reste anonyme pour la personne concernée.
        </p>

        <div className="flex-1 overflow-y-auto px-2">
          {REPORT_REASONS.map((o) => {
            const selected = reason === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setReason(o.value)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-secondary"
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                  {selected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                </span>
              </button>
            );
          })}
          {reason && (
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Précisions (facultatif)"
              className="mx-1 mt-2 w-[calc(100%-0.5rem)] rounded-xl border border-border bg-secondary/40 p-3 text-sm text-foreground outline-none focus:border-primary"
            />
          )}
        </div>

        <div className="px-4 pt-3">
          <button
            disabled={!reason || send.isPending}
            onClick={() => send.mutate()}
            className="brand-gradient flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {send.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Envoyer le signalement
          </button>
        </div>
      </div>
    </div>
  );
}
