import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Play, Search, X } from "lucide-react";
import { toast } from "sonner";
import { BadgeList } from "@/components/KalBadge";
import { Avatar } from "@/components/PostCard";
import { displayName, toBadges } from "@/lib/api";
import { useBackHandler } from "@/lib/back";
import { toggleFollow, type Relationship } from "@/lib/social";
import { fetchShortLikers, type ShortFollow, type ShortLiker } from "@/lib/shorts";

/** 736 K, 1,2 M… pour les grands nombres. */
function compact(n: number): string {
  const fmt = (v: number, unit: string) => `${v.toFixed(1).replace(/\.0$/, "").replace(".", ",")} ${unit}`;
  if (n >= 1_000_000) return fmt(n / 1_000_000, "M");
  if (n >= 10_000) return fmt(n / 1_000, "K");
  return n.toLocaleString("fr-FR");
}

function LikerRow({ u, rel, onRel, onClose }: { u: ShortLiker; rel: ShortFollow; onRel: (id: string, s: ShortFollow) => void; onClose: () => void }) {
  const name = displayName({ username: u.username, first_name: u.first_name, last_name: u.last_name });
  const follow = useMutation({
    mutationFn: () => toggleFollow(u.username, rel as Relationship),
    onSuccess: (status) => {
      onRel(u.id, status as ShortFollow);
      if (status === "pending") toast.success("Demande d'abonnement envoyée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex items-center gap-3 py-2">
      <Link to="/u/$username" params={{ username: u.username }} onClick={onClose} className="shrink-0">
        <Avatar url={u.avatar_url} name={name} size={48} />
      </Link>
      <Link to="/u/$username" params={{ username: u.username }} onClick={onClose} className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-sm font-bold text-foreground">{u.username}</span>
          <BadgeList badges={toBadges(u.id, u.badge, u.role)} size={13} />
        </span>
        <span className="block truncate text-sm text-muted-foreground">{name}</span>
      </Link>
      {!u.me && (
        <button
          onClick={() => {
            if (rel === "accepted" && !window.confirm(`Ne plus suivre @${u.username} ?`)) return;
            follow.mutate();
          }}
          disabled={follow.isPending}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${rel === "none" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
        >
          {rel === "accepted" ? "Abonné" : rel === "pending" ? "Demandé" : "Suivre"}
        </button>
      )}
    </div>
  );
}

/** « Mentions J'aime » d'une vidéo K-Short : nombre de lectures, nombre de j'aime, et la liste de ceux qui ont aimé. */
export function ShortLikesSheet({ shortId, onClose }: { shortId: string; onClose: () => void }) {
  useBackHandler(onClose, true);
  const [term, setTerm] = useState("");
  const [rels, setRels] = useState<Record<string, ShortFollow>>({});
  const q = useQuery({ queryKey: ["shortLikers", shortId], queryFn: () => fetchShortLikers(shortId) });

  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    const all = q.data?.items ?? [];
    if (!t) return all;
    return all.filter((u) => u.username.toLowerCase().includes(t) || displayName({ username: u.username, first_name: u.first_name, last_name: u.last_name }).toLowerCase().includes(t));
  }, [q.data, term]);

  if (typeof document === "undefined") return null;
  const likes = q.data?.like_count ?? 0;
  const views = q.data?.view_count ?? 0;
  // Affichée dans <body> : sinon elle passerait sous la barre du bas de l'application
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet-up relative flex h-[80dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto mb-1 mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
        <div className="flex items-center justify-between px-4 pb-2 pt-2">
          <p className="text-lg font-bold text-foreground">Mentions J'aime</p>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-xl bg-secondary/70 px-3 py-2.5 focus-within:ring-1 focus-within:ring-primary">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Rechercher" className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 pb-3 text-base font-semibold text-foreground">
          <Play className="h-4 w-4" /> {compact(views)} {views > 1 ? "lectures" : "lecture"}
        </div>
        <div className="flex items-center justify-between px-4 pb-1 text-sm font-semibold text-muted-foreground">
          <span>Aimé par</span>
          <span>{compact(likes)} {likes > 1 ? "mentions J'aime" : "mention J'aime"}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {q.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : q.error ? (
            <p className="py-8 text-center text-sm text-destructive">Impossible de charger la liste.</p>
          ) : list.length ? (
            list.map((u) => (
              <LikerRow key={u.id} u={u} rel={rels[u.id] ?? u.follow_status} onRel={(id, s) => setRels((p) => ({ ...p, [id]: s }))} onClose={onClose} />
            ))
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{term ? "Aucun résultat." : "Personne n'a encore aimé cette vidéo."}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
