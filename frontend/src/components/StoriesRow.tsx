import { Plus, Trash2, X, Eye, Volume2, VolumeX, Heart, Repeat2, Send } from "lucide-react";
import { AutoTextarea } from "@/components/AutoTextarea";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { deleteStory, fetchStoryGroups, fetchStoryViewers, markStoryViewed, replyToStory, shareStory, toggleStoryLike, type StoryGroup } from "@/lib/stories";
import { timeAgo } from "@/lib/social";
import { BadgeList } from "@/components/KalBadge";
import { resolveFont, resolveTheme, themedTextSize } from "@/lib/themes";
import { useBackHandler } from "@/lib/back";

function Avatar({ url, name, size = 56 }: { url: string | null; name: string; size?: number }) {
  return url ? (
    <img src={url} alt={name} width={size} height={size} style={{ width: size, height: size }} className="rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="brand-gradient flex items-center justify-center rounded-full font-bold text-primary-foreground">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function StoryViewer({ group, onClose, startId }: { group: StoryGroup; onClose: () => void; startId?: string }) {
  useBackHandler(onClose);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [i, setI] = useState(() => Math.max(0, startId ? group.stories.findIndex((x) => x.id === startId) : 0));
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSeconds, setVideoSeconds] = useState<number | null>(null);
  const s = group.stories[i];
  const isVideo = !!s?.image_url && s.media_type === "video";
  const mine = user?.id === group.author.id;
  const [showViewers, setShowViewers] = useState(false);
  const [reply, setReply] = useState("");
  const [typing, setTyping] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);
  const [sending, setSending] = useState(false);
  const [restart, setRestart] = useState(0);
  // ♥ : l'état affiché vient du serveur au départ, puis de mes clics (la story ouverte n'est pas rechargée)
  const [likes, setLikes] = useState<Record<string, { liked: boolean; count: number }>>({});
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const like = s ? likes[s.id] ?? { liked: s.liked_by_me, count: s.like_count } : { liked: false, count: 0 };
  const paused = showViewers || typing || confirmShare;
  const viewers = useQuery({ queryKey: ["storyViewers", s?.id], queryFn: () => fetchStoryViewers(s!.id), enabled: mine && !!s });

  useEffect(() => {
    if (!s || !user) return;
    if (!mine && !s.seen) void markStoryViewed(s.id);
    setVideoSeconds(null);
    if (isVideo || paused) return; // la vidéo passe à la suite toute seule quand elle se termine (onEnded)
    const t = setTimeout(() => (i < group.stories.length - 1 ? setI(i + 1) : onClose()), 6000);
    return () => clearTimeout(t);
  }, [s, i, user, mine, group.stories.length, onClose, isVideo, paused, restart]);

  // Démarre avec le son ; si le navigateur refuse (autoplay), on repasse en muet et le bouton permet de réactiver
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    v.muted = muted;
    const p = v.play();
    if (p) p.catch(() => { v.muted = true; setMuted(true); void v.play().catch(() => undefined); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, isVideo]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    if (paused) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, isVideo]);

  // Quand la pause se termine sur une photo / un texte, le délai de 6 s et la barre repartent ensemble
  useEffect(() => { if (!paused) setRestart((r) => r + 1); }, [paused]);

  // On change de story : on repart à zéro
  useEffect(() => { setReply(""); setTyping(false); setConfirmShare(false); }, [i]);

  function nextStory() {
    if (i < group.stories.length - 1) setI(i + 1);
    else onClose();
  }

  const del = useMutation({
    mutationFn: () => deleteStory(s!.id),
    onSuccess: () => { toast.success("Story supprimée"); qc.invalidateQueries({ queryKey: ["stories"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const likeMut = useMutation({
    mutationFn: () => toggleStoryLike(s!.id),
    onMutate: () => { const id = s!.id; const cur = likes[id] ?? { liked: s!.liked_by_me, count: s!.like_count }; setLikes((m) => ({ ...m, [id]: { liked: !cur.liked, count: Math.max(0, cur.count + (cur.liked ? -1 : 1)) } })); return { id, cur }; },
    onError: (e: Error, _v, ctx) => { if (ctx) setLikes((m) => ({ ...m, [ctx.id]: ctx.cur })); toast.error(e.message); },
  });

  const shareMut = useMutation({
    mutationFn: () => shareStory(s!.id),
    onSuccess: () => { setShared((m) => ({ ...m, [s!.id]: true })); setConfirmShare(false); toast.success("Story repartagée"); qc.invalidateQueries({ queryKey: ["stories"] }); },
    onError: (e: Error) => { setConfirmShare(false); toast.error(e.message); },
  });

  async function sendReply() {
    if (!s || !reply.trim() || sending) return;
    setSending(true);
    try {
      await replyToStory(s, reply);
      setReply(""); setTyping(false);
      toast.success("Réponse envoyée");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!s) return null;
  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="relative h-full w-full max-w-md">
        <div className="absolute inset-x-3 top-3 z-10 flex gap-1">
          {group.stories.map((x, k) => (
            <span key={x.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                key={k === i && !isVideo ? `${x.id}-${restart}` : x.id}
                className={`block h-full bg-foreground ${k < i ? "w-full" : k === i ? "w-0" : "w-0"}`}
                style={k === i && (!isVideo || videoSeconds) ? { animation: `grow ${isVideo ? Math.min(videoSeconds!, 60) : 6}s linear forwards`, animationPlayState: paused ? "paused" : "running" } : undefined}
              />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-6 z-10 flex items-center gap-2">
          <Avatar url={group.author.avatar_url} name={group.author.display_name} size={34} />
          <span className="text-sm font-bold text-foreground">{group.author.display_name}</span>
          <BadgeList badges={group.author.badges} size={14} />
          <span className="text-xs text-muted-foreground">{timeAgo(s.created_at)}</span>
          {s.shared_from_username && <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><Repeat2 className="h-3.5 w-3.5 shrink-0" />@{s.shared_from_username}</span>}
          <span className="flex-1" />
          {isVideo && (
            <button
              aria-label={muted ? "Activer le son" : "Couper le son"}
              onClick={() => { const v = videoRef.current; const next = !muted; setMuted(next); if (v) v.muted = next; }}
              className="p-1.5 text-foreground"
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          )}
          {mine && (
            <>
              <button aria-label="Voir qui a vu la story" onClick={() => setShowViewers(true)} className="flex items-center gap-1 rounded-full bg-secondary/60 px-2.5 py-1 text-xs font-semibold text-foreground"><Eye className="h-4 w-4" />{viewers.data?.length ?? 0}</button>
              <button aria-label="Supprimer la story" onClick={() => del.mutate()} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="h-5 w-5" /></button>
            </>
          )}
          <button aria-label="Fermer" onClick={onClose} className="p-1.5 text-foreground"><X className="h-6 w-6" /></button>
        </div>
        <div className="flex h-full items-center justify-center">
          {s.image_url ? (
            <div className="relative w-full">
              {s.media_type === "video" ? (
                <video
                  key={s.id}
                  ref={videoRef}
                  src={s.image_url}
                  autoPlay
                  playsInline
                  onLoadedMetadata={(e) => setVideoSeconds(e.currentTarget.duration || 6)}
                  onEnded={nextStory}
                  className="max-h-[85vh] w-full object-contain"
                />
              ) : (
                <img src={s.image_url} alt="Story" className="max-h-[85vh] w-full object-contain" />
              )}
              {s.content && <p className="absolute inset-x-4 bottom-6 rounded-xl bg-background/70 p-3 text-center text-sm text-foreground backdrop-blur">{s.content}</p>}
            </div>
          ) : (
            (() => {
              const t = resolveTheme(s.theme ?? "kalchat")!;
              return (
                <div className="flex h-full w-full items-center justify-center p-8" style={{ background: t.background, color: t.color, fontFamily: resolveFont(s.font) }}>
                  <p className={`whitespace-pre-wrap break-words text-center font-bold leading-snug ${themedTextSize((s.content ?? "").length, true)}`}>{s.content}</p>
                </div>
              );
            })()
          )}
        </div>
        {showViewers && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50" onClick={() => setShowViewers(false)}>
            <div className="max-h-[65%] overflow-y-auto rounded-t-3xl border-t border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">Vu par {viewers.data?.length ?? 0} personne{(viewers.data?.length ?? 0) > 1 ? "s" : ""}</h3>
                <button aria-label="Fermer" onClick={() => setShowViewers(false)} className="p-1 text-muted-foreground"><X className="h-5 w-5" /></button>
              </div>
              {viewers.isLoading ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Chargement…</p>
              ) : viewers.data?.length ? (
                viewers.data.map((v) => (
                  <Link key={v.id} to="/u/$username" params={{ username: v.username }} onClick={onClose} className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-secondary/60">
                    <Avatar url={v.avatar_url} name={v.username} size={36} />
                    <span className="flex-1 text-sm font-semibold text-foreground">@{v.username}</span>
                    {v.liked && <Heart className="h-4 w-4 fill-red-500 text-red-500" aria-label="A aimé" />}
                    <span className="text-[11px] text-muted-foreground">{timeAgo(v.viewed_at)}</span>
                  </Link>
                ))
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">Personne n'a encore vu cette story.</p>
              )}
            </div>
          </div>
        )}
        <button aria-label="Précédente" className={`absolute left-0 top-20 w-1/3 ${mine ? "bottom-0" : "bottom-24"}`} onClick={() => setI(Math.max(0, i - 1))} />
        <button aria-label="Suivante" className={`absolute right-0 top-20 w-1/3 ${mine ? "bottom-0" : "bottom-24"}`} onClick={() => (i < group.stories.length - 1 ? setI(i + 1) : onClose())} />
        {mine && like.count > 0 && (
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs font-semibold text-foreground">
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />{like.count}
          </div>
        )}
        {!mine && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex items-end gap-2 bg-gradient-to-t from-background/90 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6">
            <AutoTextarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onEnterSend={() => void sendReply()}
              maxLength={1500}
              placeholder={`Répondre à ${group.author.display_name}…`}
              className="max-h-24 min-w-0 flex-1 rounded-3xl border border-border bg-background/80 px-4 py-2.5 text-sm leading-5 text-foreground outline-none backdrop-blur focus:border-primary"
            />
            {reply.trim() ? (
              <button aria-label="Envoyer la réponse" disabled={sending} onClick={() => void sendReply()} className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground disabled:opacity-60">
                <Send className="h-4 w-4" />
              </button>
            ) : (
              <>
                <button aria-label={like.liked ? "Ne plus aimer" : "Aimer"} aria-pressed={like.liked} onMouseDown={(e) => e.preventDefault()} onClick={() => likeMut.mutate()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground">
                  <Heart className={`h-6 w-6 transition-transform active:scale-125 ${like.liked ? "fill-red-500 text-red-500" : ""}`} />
                </button>
                {s.can_share && !shared[s.id] && (
                  <button aria-label="Repartager la story" onMouseDown={(e) => e.preventDefault()} onClick={() => setConfirmShare(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground">
                    <Repeat2 className="h-6 w-6" />
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {confirmShare && (
          <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/50" onClick={() => setConfirmShare(false)}>
            <div className="w-full rounded-t-3xl border-t border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-foreground">Repartager cette story ?</h3>
              <p className="mt-1 text-xs text-muted-foreground">Elle apparaîtra dans ta story avec le nom de {group.author.display_name}, et disparaîtra en même temps que l'originale.</p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setConfirmShare(false)} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground">Annuler</button>
                <button disabled={shareMut.isPending} onClick={() => shareMut.mutate()} className="brand-gradient flex-1 rounded-xl py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">Repartager</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StoriesRow() {
  const { user, profile } = useAuth();
  const q = useQuery({ queryKey: ["stories", user?.id], queryFn: () => fetchStoryGroups(user!.id), enabled: !!user });
  const [open, setOpen] = useState<StoryGroup | null>(null);
  if (!user) return null;
  const groups = q.data ?? [];

  return (
    <>
      <div className="no-scrollbar flex gap-3 overflow-x-auto border-b border-border px-4 py-3">
        <Link to="/story" className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="relative rounded-full border-2 border-dashed border-border p-[3px]">
            <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name ?? "?"} />
            <span className="brand-gradient absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full text-primary-foreground ring-2 ring-background">
              <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          </span>
          <span className="text-[11px] text-muted-foreground">Ajouter</span>
        </Link>
        {groups.map((g) => (
          <button key={g.author.id} onClick={() => setOpen(g)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <span className={`rounded-full p-[2.5px] ${g.allSeen ? "bg-muted" : "story-ring"}`}>
              <span className="block rounded-full bg-background p-[2.5px]">
                <Avatar url={g.author.avatar_url} name={g.author.display_name} />
              </span>
            </span>
            <span className="max-w-full truncate text-[11px] text-muted-foreground">
              {g.author.id === user.id ? "Ma story" : g.author.display_name}
            </span>
          </button>
        ))}
      </div>
      {open && <StoryViewer group={open} onClose={() => { setOpen(null); void q.refetch(); }} />}
    </>
  );
}
