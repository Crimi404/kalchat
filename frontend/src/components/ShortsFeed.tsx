import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Heart, Loader2, MessageCircle, Play, Plus, Send, Share2, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ApiError, displayName, toBadges } from "@/lib/api";
import { BadgeList } from "@/components/KalBadge";
import { Avatar } from "@/components/PostCard";
import { ShortUploadSheet } from "@/components/ShortUploadSheet";
import { publicUrl, shareLink } from "@/lib/share";
import { useBackHandler } from "@/lib/back";
import {
  addShortComment,
  deleteShort,
  deleteShortComment,
  fetchShort,
  fetchShortComments,
  fetchShortsFeed,
  timeLeft,
  toggleShortCommentLike,
  toggleShortLike,
  type ShortComment,
  type ShortItem,
} from "@/lib/shorts";

type Patch = Partial<ShortItem> & { gone?: boolean };

// ---------- Un commentaire (aimer, répondre, supprimer) ----------
function CommentRow({
  c,
  reply,
  canDelete,
  deleting,
  onLike,
  onReply,
  onDelete,
  onClose,
}: {
  c: ShortComment;
  reply?: boolean;
  canDelete: boolean;
  deleting: boolean;
  onLike: (c: ShortComment) => void;
  onReply: (c: ShortComment) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className={`flex gap-2 py-2 ${reply ? "ml-9" : ""}`}>
      <Link to="/u/$username" params={{ username: c.username }} onClick={onClose}>
        <Avatar url={c.avatar_url} name={c.username} size={reply ? 24 : 28} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{c.username}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{c.content}</p>
        <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
          <button onClick={() => onReply(c)} className="font-semibold hover:text-foreground">Répondre</button>
          {canDelete && (
            <button onClick={() => onDelete(c.id)} disabled={deleting} aria-label="Supprimer le commentaire" className="hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <button onClick={() => onLike(c)} aria-label="J'aime ce commentaire" className="flex flex-col items-center gap-0.5 self-start px-1 pt-1 text-muted-foreground">
        <Heart className={`h-4 w-4 ${c.liked_by_me ? "fill-red-500 text-red-500" : ""}`} />
        <span className="text-[11px]">{c.like_count > 0 ? c.like_count : ""}</span>
      </button>
    </div>
  );
}

// ---------- Commentaires (feuille du bas), aussi utilisée par les vidéos du fil classique ----------
export function ShortComments({
  shortId,
  open,
  isOwner,
  onClose,
  onCountChange,
}: {
  shortId: string | null;
  open: boolean;
  isOwner: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  useBackHandler(onClose, open);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ShortComment | null>(null);
  const key = ["shortComments", shortId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchShortComments(shortId as string),
    enabled: open && !!shortId,
  });

  // Le compteur de la vidéo suit toujours la vraie liste (ajout, suppression d'un commentaire et de ses réponses)
  const total = list.data?.length;
  useEffect(() => {
    if (open && typeof total === "number") onCountChange(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, open]);

  useEffect(() => {
    if (!open) {
      setText("");
      setReplyTo(null);
    }
  }, [open]);

  const add = useMutation({
    mutationFn: () => addShortComment(shortId as string, text.trim(), replyTo?.id ?? null),
    onSuccess: () => {
      setText("");
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (commentId: string) => deleteShortComment(commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });
  const like = useMutation({
    mutationFn: (c: ShortComment) => toggleShortCommentLike(c.id),
    onMutate: async (c) => {
      // Le coeur réagit tout de suite
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ShortComment[]>(key);
      qc.setQueryData<ShortComment[]>(key, (old) =>
        old?.map((x) => (x.id === c.id ? { ...x, liked_by_me: !x.liked_by_me, like_count: Math.max(0, x.like_count + (x.liked_by_me ? -1 : 1)) } : x)),
      );
      return { prev };
    },
    onError: (e: Error, _c, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (r, c) => {
      qc.setQueryData<ShortComment[]>(key, (old) => old?.map((x) => (x.id === c.id ? { ...x, liked_by_me: r.liked, like_count: r.like_count } : x)));
    },
  });

  const { roots, replies } = useMemo(() => {
    const all = list.data ?? [];
    const byParent = new Map<string, ShortComment[]>();
    for (const c of all) if (c.parent_id) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
    return { roots: all.filter((c) => !c.parent_id), replies: byParent };
  }, [list.data]);

  function startReply(c: ShortComment) {
    setReplyTo(c);
    setText((t) => (t ? t : `@${c.username} `));
  }
  const canDelete = (c: ShortComment) => c.user_id === user?.id || isOwner;
  const rowProps = { deleting: del.isPending, onLike: (c: ShortComment) => like.mutate(c), onReply: startReply, onDelete: (id: string) => del.mutate(id), onClose };

  if (!open || !shortId || typeof document === "undefined") return null;
  // Affichée dans <body> : sinon elle passerait sous la barre du bas de l'application
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet-up relative flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="text-base font-bold text-foreground">Commentaires{total ? ` (${total})` : ""}</p>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-[8rem] flex-1 overflow-y-auto px-4">
          {list.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : list.error ? (
            <p className="py-8 text-center text-sm text-destructive">Impossible de charger les commentaires.</p>
          ) : roots.length ? (
            roots.map((c) => (
              <div key={c.id}>
                <CommentRow c={c} canDelete={canDelete(c)} {...rowProps} />
                {(replies.get(c.id) ?? []).map((r) => (
                  <CommentRow key={r.id} c={r} reply canDelete={canDelete(r)} {...rowProps} />
                ))}
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun commentaire. Lance la discussion !</p>
          )}
        </div>
        {replyTo && (
          <div className="flex items-center justify-between border-t border-border bg-secondary/50 px-4 py-1.5 text-xs text-muted-foreground">
            <span className="truncate">Réponse à @{replyTo.username}</span>
            <button onClick={() => { setReplyTo(null); setText(""); }} aria-label="Annuler la réponse" className="p-1"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder={replyTo ? "Ta réponse…" : "Ajouter un commentaire…"}
            className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !add.isPending) add.mutate();
            }}
          />
          <button
            onClick={() => add.mutate()}
            disabled={!text.trim() || add.isPending}
            aria-label="Envoyer"
            className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-primary-foreground disabled:opacity-50"
          >
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Une vidéo plein écran ----------
function ShortSlide({
  item,
  active,
  near,
  muted,
  setMuted,
  onPatch,
  onOpenComments,
}: {
  item: ShortItem;
  active: boolean;
  near: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  onPatch: (id: string, patch: Patch) => void;
  onOpenComments: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const refetching = useRef(false);
  const [src, setSrc] = useState(item.video_url);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSrc(item.video_url);
  }, [item.video_url]);

  // Lecture uniquement pour la vidéo visible à l'écran
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.muted = muted;
      const p = v.play();
      if (p) {
        p.then(() => setPaused(false)).catch(() => {
          // Le téléphone refuse le son automatique : on lance sans le son
          v.muted = true;
          setMuted(true);
          v.play().then(() => setPaused(false)).catch(() => setPaused(true));
        });
      }
    } else {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        /* vidéo pas encore chargée : on ignore */
      }
      setPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  // Pause quand l'application passe en arrière-plan
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else void v.play().catch(() => setPaused(true));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active]);

  // L'adresse de lecture est temporaire (~30 min) : si elle expire, on en demande une nouvelle
  function onVideoError() {
    if (refetching.current) return;
    refetching.current = true;
    fetchShort(item.id)
      .then((s) => {
        if (s.video_url) setSrc(s.video_url);
        else onPatch(item.id, { gone: true });
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
          toast.info("Cette vidéo n'est plus disponible");
          onPatch(item.id, { gone: true });
        }
      })
      .finally(() => {
        window.setTimeout(() => {
          refetching.current = false;
        }, 5000);
      });
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }

  function onTime() {
    const v = videoRef.current;
    const b = barRef.current;
    if (v && b && v.duration) b.style.width = `${(v.currentTime / v.duration) * 100}%`;
  }

  const like = useMutation({
    mutationFn: () => toggleShortLike(item.id),
    onSuccess: (r) => onPatch(item.id, { liked: r.liked, like_count: r.like_count }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteShort(item.id),
    onSuccess: () => {
      toast.success("Vidéo supprimée");
      onPatch(item.id, { gone: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const author = item.author;
  const name = author ? displayName({ username: author.username, first_name: author.first_name, last_name: author.last_name }) : "Membre";
  const railBottom = "calc(6rem + env(safe-area-inset-bottom))";
  const infoBottom = "calc(5.5rem + env(safe-area-inset-bottom))";

  return (
    <section className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {near && src ? (
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          loop
          muted={muted}
          preload={active ? "auto" : "metadata"}
          onClick={togglePlay}
          onError={onVideoError}
          onTimeUpdate={onTime}
        />
      ) : null}

      {paused && active && (
        <button onClick={togglePlay} aria-label="Lecture" className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white">
          <Play className="h-8 w-8 fill-white" />
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />

      <div className="absolute inset-x-0 h-0.5 bg-white/20" style={{ bottom: "calc(4.6rem + env(safe-area-inset-bottom))" }}>
        <div ref={barRef} className="h-full w-0 bg-white/80" />
      </div>

      {/* Boutons à droite */}
      <div className="absolute right-3 flex flex-col items-center gap-5 text-white" style={{ bottom: railBottom }}>
        {author && (
          <Link to="/u/$username" params={{ username: author.username }} aria-label={`Profil de ${name}`}>
            <Avatar url={author.avatar_url} name={name} size={44} />
          </Link>
        )}
        <button onClick={() => like.mutate()} disabled={like.isPending} aria-label="J'aime" className="flex flex-col items-center gap-1">
          <Heart className={`h-8 w-8 drop-shadow ${item.liked ? "fill-red-500 text-red-500" : ""}`} />
          <span className="text-xs font-semibold drop-shadow">{item.like_count}</span>
        </button>
        <button onClick={() => onOpenComments(item.id)} aria-label="Commentaires" className="flex flex-col items-center gap-1">
          <MessageCircle className="h-8 w-8 drop-shadow" />
          <span className="text-xs font-semibold drop-shadow">{item.comment_count}</span>
        </button>
        <button
          onClick={() => void shareLink({ url: publicUrl(`/?k=${item.id}`), title: "K-Short sur Kalchat", text: item.caption ?? "Regarde cette vidéo sur Kalchat" })}
          aria-label="Partager"
          className="flex flex-col items-center gap-1"
        >
          <Share2 className="h-7 w-7 drop-shadow" />
          <span className="text-xs font-semibold drop-shadow">Partager</span>
        </button>
        <button onClick={() => setMuted(!muted)} aria-label={muted ? "Activer le son" : "Couper le son"} className="rounded-full bg-black/40 p-2">
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        {item.mine && (
          <button
            onClick={() => {
              if (window.confirm("Supprimer cette vidéo ? Elle disparaîtra immédiatement.")) remove.mutate();
            }}
            disabled={remove.isPending}
            aria-label="Supprimer ma vidéo"
            className="rounded-full bg-black/40 p-2"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Infos en bas à gauche */}
      <div className="absolute left-4 right-20 text-white" style={{ bottom: infoBottom }}>
        {author && (
          <div className="flex items-center gap-1.5">
            <Link to="/u/$username" params={{ username: author.username }} className="truncate text-sm font-bold drop-shadow hover:underline">
              {name}
            </Link>
            <BadgeList badges={toBadges(author.id, author.badge, null)} size={14} />
          </div>
        )}
        {item.caption && (
          <p onClick={() => setExpanded(!expanded)} className={`mt-1 whitespace-pre-wrap break-words text-sm drop-shadow ${expanded ? "" : "line-clamp-2"}`}>
            {item.caption}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1 text-[11px] text-white/70">
          <Clock className="h-3 w-3" /> Disparaît dans {timeLeft(item.expires_at)}
        </p>
      </div>
    </section>
  );
}

// ---------- Section K-Short ----------
export function ShortsFeed({ header, startId }: { header: ReactNode; startId?: string | null }) {
  const { user } = useAuth();
  const scroller = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(false);
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const feed = useInfiniteQuery({
    queryKey: ["shorts", "feed", user?.id],
    queryFn: ({ pageParam }) => fetchShortsFeed(pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!user,
  });

  // Vidéo ouverte depuis un lien de partage
  const start = useQuery({
    queryKey: ["shorts", "one", startId],
    queryFn: () => fetchShort(startId as string),
    enabled: !!startId && !!user,
    retry: false,
  });
  useEffect(() => {
    if (start.error instanceof ApiError && start.error.status === 410) toast.info("Cette vidéo a expiré");
    else if (start.error instanceof ApiError && start.error.status === 404) toast.info("Cette vidéo n'est plus disponible");
  }, [start.error]);

  const list = useMemo(() => {
    const base = (feed.data?.pages ?? []).flatMap((p) => p.items);
    const all = start.data && !base.some((b) => b.id === start.data!.id) ? [start.data, ...base] : base;
    return all.filter((i) => !patches[i.id]?.gone).map((i) => ({ ...i, ...(patches[i.id] ?? {}) }) as ShortItem);
  }, [feed.data, start.data, patches]);

  // Charge la suite quand on approche de la fin
  useEffect(() => {
    if (active >= list.length - 3 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, list.length, feed.hasNextPage, feed.isFetchingNextPage]);

  function onScroll() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = scroller.current;
      if (!el || !el.clientHeight) return;
      setActive(Math.round(el.scrollTop / el.clientHeight));
    });
  }

  function patch(id: string, p: Patch) {
    setPatches((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } }));
  }

  const commentTarget = list.find((i) => i.id === commentsFor) ?? null;

  return (
    <div className="fixed inset-y-0 left-1/2 z-30 flex w-full max-w-md -translate-x-1/2 flex-col bg-black">
      {/* Barre d'onglets (Pour vous / Abonnements / K-Short / Communautés) dans la bande noire du haut, au-dessus de la vidéo */}
      <div className="relative z-10 shrink-0 bg-black">{header}</div>

      <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain">
        {feed.isLoading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-white" /></div>
        ) : feed.error && !list.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white">
            <p className="text-sm">Impossible de charger K-Short.</p>
            <button onClick={() => void feed.refetch()} className="rounded-full border border-white/40 px-5 py-2 text-sm font-semibold">Réessayer</button>
          </div>
        ) : list.length ? (
          list.map((item, i) => (
            <ShortSlide
              key={item.id}
              item={item}
              active={i === active}
              near={Math.abs(i - active) <= 1}
              muted={muted}
              setMuted={setMuted}
              onPatch={patch}
              onOpenComments={setCommentsFor}
            />
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white">
            <p className="text-base font-bold">Aucune vidéo pour le moment</p>
            <p className="text-sm text-white/70">Sois le premier à publier une vidéo K-Short !</p>
            <button onClick={() => setUploadOpen(true)} className="brand-gradient mt-2 rounded-full px-6 py-2.5 text-sm font-bold text-primary-foreground">Publier une vidéo</button>
          </div>
        )}
        {feed.isFetchingNextPage && (
          <div className="flex h-16 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white" /></div>
        )}
      </div>

      <button
        onClick={() => setUploadOpen(true)}
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-black shadow-[0_2px_12px_rgba(0,0,0,0.6)] ring-2 ring-black/30 active:scale-95"
      >
        <Plus className="h-4 w-4" strokeWidth={3} /> Publier
      </button>
      </div>

      <ShortComments
        shortId={commentsFor}
        open={!!commentsFor}
        isOwner={!!commentTarget?.mine}
        onClose={() => setCommentsFor(null)}
        onCountChange={(n) => commentsFor && patch(commentsFor, { comment_count: n })}
      />
      <ShortUploadSheet open={uploadOpen} onClose={() => setUploadOpen(false)} onPublished={() => void feed.refetch()} />
    </div>
  );
}
