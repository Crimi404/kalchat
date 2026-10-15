import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { dismissAnnouncement, fetchAnnouncements, type Announcement } from "@/lib/announcements";

/**
 * Annonces de l'équipe Kalchat, en haut du fil : jusqu'à 3 en même temps, chacune fermable.
 * Une annonce fermée ne revient plus pour ce membre ; elle disparaît seule à sa date de fin ou si l'équipe la retire.
 */
export function AnnouncementBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Fermeture immédiate à l'écran, sans attendre la réponse du serveur
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const list = useQuery({
    queryKey: ["announcements", user?.id],
    queryFn: fetchAnnouncements,
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => dismissAnnouncement(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const shown = (list.data ?? []).filter((a: Announcement) => !hidden.has(a.id));
  if (!user || shown.length === 0) return null;

  return (
    <div className="mx-4 mt-3 space-y-2">
      {shown.map((a) => (
        <div key={a.id} role="status" className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-card p-3">
          <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground">
            <Megaphone className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{a.title}</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">{a.body}</p>
          </div>
          <button
            aria-label="Fermer l'annonce"
            onClick={() => {
              setHidden((prev) => new Set(prev).add(a.id));
              dismiss.mutate(a.id);
            }}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
