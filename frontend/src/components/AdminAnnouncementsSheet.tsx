import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useBackHandler } from "@/lib/back";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_DAYS,
  ANNOUNCEMENT_TITLE_MAX,
  createAnnouncement,
  fetchAdminAnnouncements,
  removeAnnouncement,
  type AdminAnnouncement,
} from "@/lib/announcements";

function statusLabel(a: AdminAnnouncement): string {
  const end = new Date(a.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  if (a.status === "removed") return "Retirée";
  if (a.status === "expired") return `Terminée le ${end}`;
  return `En cours jusqu'au ${end}`;
}

/** Panneau « Annonces » de la page Administration : écrire une annonce, la durée, la notification push, et retirer les anciennes. */
export function AdminAnnouncementsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [days, setDays] = useState(7);
  const [push, setPush] = useState(false);
  useBackHandler(onClose, open);

  const list = useQuery({ queryKey: ["adminAnnouncements"], enabled: open, queryFn: fetchAdminAnnouncements, refetchInterval: open ? 20_000 : false });

  const publish = useMutation({
    mutationFn: () => createAnnouncement({ title: title.trim(), body: body.trim(), days, push }),
    onSuccess: () => {
      toast.success(push ? "Annonce publiée, notification en cours d'envoi" : "Annonce publiée");
      setTitle("");
      setBody("");
      setPush(false);
      void qc.invalidateQueries({ queryKey: ["adminAnnouncements"] });
      void qc.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeAnnouncement(id),
    onSuccess: () => {
      toast.success("Annonce retirée");
      void qc.invalidateQueries({ queryKey: ["adminAnnouncements"] });
      void qc.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open || typeof document === "undefined") return null;
  const canPublish = title.trim().length >= 2 && body.trim().length >= 2 && !publish.isPending;
  const field = "w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet-up relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-foreground">Annonces</p>
            <p className="mt-0.5 text-xs text-muted-foreground">S'affichent en haut du fil de tous les membres, jusqu'à la date de fin.</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={ANNOUNCEMENT_TITLE_MAX} placeholder="Titre de l'annonce" className={`${field} mt-3`} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={ANNOUNCEMENT_BODY_MAX} rows={4} placeholder="Ton message pour la communauté…" className={`${field} mt-2 resize-none`} />
        <p className="mt-1 text-right text-[11px] text-muted-foreground">{body.length}/{ANNOUNCEMENT_BODY_MAX}</p>

        <div className="mt-2 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold text-foreground">Visible pendant</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ANNOUNCEMENT_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${days === d ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground"}`}
              >
                {d} {d > 1 ? "jours" : "jour"}
              </button>
            ))}
          </div>
        </div>

        <button type="button" onClick={() => setPush(!push)} aria-pressed={push} className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left">
          <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${push ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{push && <Check className="h-3.5 w-3.5" />}</span>
          <span>
            <span className="block text-sm font-semibold text-foreground">Envoyer aussi une notification</span>
            <span className="block text-xs text-muted-foreground">Sur le téléphone de tous les membres qui ont l'application Android. À réserver aux annonces importantes.</span>
          </span>
        </button>

        <button
          onClick={() => publish.mutate()}
          disabled={!canPublish}
          className="brand-gradient glow-primary mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Publier l'annonce
        </button>

        <p className="mt-5 text-sm font-semibold text-foreground">Annonces récentes</p>
        <div className="mt-2 space-y-2">
          {list.isLoading && <p className="py-4 text-center text-sm text-muted-foreground">Chargement…</p>}
          {list.isError && <p className="py-4 text-center text-sm text-destructive">{(list.error as Error).message}</p>}
          {list.isSuccess && list.data.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Aucune annonce pour le moment.</p>}
          {list.data?.map((a) => (
            <div key={a.id} className="rounded-2xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{a.title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${a.status === "live" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                  {a.status === "live" ? "En cours" : a.status === "expired" ? "Terminée" : "Retirée"}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{a.body}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {statusLabel(a)} · fermée par {a.dismissed_count}
                {a.push_requested ? ` · notification : ${a.push_sent} membre${a.push_sent > 1 ? "s" : ""}` : ""}
              </p>
              {a.status === "live" && (
                <button
                  onClick={() => remove.mutate(a.id)}
                  disabled={remove.isPending}
                  className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-40"
                >
                  Retirer maintenant
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
